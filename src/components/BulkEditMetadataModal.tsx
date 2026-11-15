import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Loader2,
  Pencil,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  evaluateSingleRow,
  normalizeDatasetGrade,
  normalizeMintCode,
} from '../shared/ruleEngine';
import type {
  BatchEvaluatedRow,
  BatchRawInput,
  CoinSeries,
  DatasetGrade,
  WorkbookSettings,
} from '../shared/types';

interface BulkEditMetadataModalProps {
  open: boolean;
  selectedRows: BatchEvaluatedRow[];
  settings: WorkbookSettings;
  onClose: () => void;
  onApply: (patch: Partial<BatchRawInput>) => Promise<void>;
}

const fmtUsd = (val: number | '') =>
  val === '' ? '—' : `$${Number(val).toLocaleString('en-US')}`;

export const BulkEditMetadataModal: React.FC<BulkEditMetadataModalProps> = ({
  open,
  selectedRows,
  settings,
  onClose,
  onApply,
}) => {
  const [applySeries, setApplySeries] = useState(false);
  const [proposedSeries, setProposedSeries] = useState<CoinSeries>('Classic Morgan');

  const [applyYear, setApplyYear] = useState(false);
  const [coinYear, setCoinYear] = useState('');

  const [applyMint, setApplyMint] = useState(false);
  const [coinMint, setCoinMint] = useState('');

  const [applyVariety, setApplyVariety] = useState(false);
  const [proposedVariety, setProposedVariety] = useState('');

  const [applyGrade, setApplyGrade] = useState(false);
  const [suggestedGrade, setSuggestedGrade] = useState('');
  const [datasetGradeOverride, setDatasetGradeOverride] = useState<DatasetGrade | 'AUTO'>(
    'AUTO',
  );

  const [applyNotes, setApplyNotes] = useState(false);
  const [diagnosticNotes, setDiagnosticNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setApplySeries(false);
    setProposedSeries('Classic Morgan');
    setApplyYear(false);
    setCoinYear('');
    setApplyMint(false);
    setCoinMint('');
    setApplyVariety(false);
    setProposedVariety('');
    setApplyGrade(false);
    setSuggestedGrade('');
    setDatasetGradeOverride('AUTO');
    setApplyNotes(false);
    setDiagnosticNotes('');
    setSaving(false);
    setServerError(null);
  }, [open]);

  const hasAnyEnabledField =
    applySeries || applyYear || applyMint || applyVariety || applyGrade || applyNotes;

  const fieldValidationError = useMemo(() => {
    if (applyYear && coinYear.trim() !== '') {
      const y = Number(coinYear.trim());
      if (!Number.isInteger(y) || y < 1794 || y > 2100) {
        return 'Coin Year must be a 4-digit year between 1794 and 2100 (or leave blank to clear).';
      }
    }
    return null;
  }, [applyYear, coinYear]);

  const effectivePatch = useMemo((): Partial<BatchRawInput> => {
    const patch: Partial<BatchRawInput> = {};
    if (applySeries) {
      patch.proposedSeries = proposedSeries;
    }
    if (applyYear) {
      patch.coinYear = coinYear.trim() === '' ? '' : Number(coinYear.trim());
    }
    if (applyMint) {
      patch.coinMint = coinMint.trim();
    }
    if (applyVariety) {
      patch.proposedVariety = proposedVariety.trim();
    }
    if (applyGrade) {
      const cleanSuggested = suggestedGrade.trim();
      patch.suggestedGrade = cleanSuggested;
      patch.datasetGrade =
        datasetGradeOverride === 'AUTO'
          ? normalizeDatasetGrade('', cleanSuggested)
          : datasetGradeOverride;
    }
    if (applyNotes) {
      patch.diagnosticNotes = diagnosticNotes.trim();
    }
    return patch;
  }, [
    applySeries,
    proposedSeries,
    applyYear,
    coinYear,
    applyMint,
    coinMint,
    applyVariety,
    proposedVariety,
    applyGrade,
    suggestedGrade,
    datasetGradeOverride,
    applyNotes,
    diagnosticNotes,
  ]);

  const previews = useMemo(() => {
    return selectedRows.map((row) => {
      const candidate: BatchRawInput = {
        ...row,
        ...effectivePatch,
      };
      const evaluated = evaluateSingleRow(candidate, settings);
      return {
        before: row,
        after: evaluated,
      };
    });
  }, [selectedRows, effectivePatch, settings]);

  const stats = useMemo(() => {
    const blocked = previews.filter((p) => p.after.isBlocked);
    const warnings = previews.filter(
      (p) =>
        !p.after.isBlocked &&
        (p.after.isKeyDate === 'Yes' ||
          p.after.valueCheck === 'Below base - verify' ||
          p.after.confidenceFlag === 'WARNING'),
    );
    const clean = previews.length - blocked.length;
    return { blocked, warnings, clean };
  }, [previews]);

  if (!open) return null;

  const canSubmit =
    selectedRows.length > 0 &&
    hasAnyEnabledField &&
    !fieldValidationError &&
    stats.blocked.length === 0 &&
    !saving;

  const normalizedMintPreview = coinMint.trim()
    ? normalizeMintCode(coinMint.trim())
    : '';
  const normalizedGradePreview =
    datasetGradeOverride === 'AUTO'
      ? normalizeDatasetGrade('', suggestedGrade.trim())
      : datasetGradeOverride;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setServerError(null);
    try {
      await onApply(effectivePatch);
      onClose();
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : 'Bulk metadata update rejected by rules',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-edit-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-5xl w-full max-h-[92vh] overflow-y-auto shadow-xl">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-slate-100 text-[#1E3A5F]">
              <Pencil className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="bulk-edit-modal-title"
                className="text-lg font-semibold text-slate-900"
              >
                Bulk Edit Coin Metadata
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Updating{' '}
                <span className="font-mono tabular-nums font-semibold text-slate-700">
                  {selectedRows.length}
                </span>{' '}
                selected {selectedRows.length === 1 ? 'record' : 'records'} · Validated live
                against Rule Engine before applying
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {serverError && (
            <div className="border border-red-200 bg-red-50 rounded-md px-4 py-3 text-xs text-red-900 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
          )}

          {fieldValidationError && (
            <div className="border border-red-200 bg-red-50 rounded-md px-4 py-2.5 text-xs text-red-900 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
              <span>{fieldValidationError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Selective Field Controls */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Fields to Update
                </h3>
                <span className="text-[11px] text-slate-500">
                  Checked fields overwrite selected coins
                </span>
              </div>

              {/* Proposed Series */}
              <div
                className={`border rounded-md p-3 space-y-2 transition-colors ${
                  applySeries
                    ? 'border-[#1E3A5F] bg-slate-50/70'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applySeries}
                    onChange={(e) => setApplySeries(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
                  />
                  Update Coin Series
                </label>
                <select
                  value={proposedSeries}
                  disabled={!applySeries}
                  onChange={(e) => setProposedSeries(e.target.value as CoinSeries)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:bg-slate-100"
                >
                  <option value="Classic Morgan">Classic Morgan</option>
                  <option value="2021+ Morgan">2021+ Morgan</option>
                  <option value="Peace">Peace</option>
                  <option value="American Silver Eagle">American Silver Eagle</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Coin Year & Mint Mark */}
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`border rounded-md p-3 space-y-2 transition-colors ${
                    applyYear
                      ? 'border-[#1E3A5F] bg-slate-50/70'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyYear}
                      onChange={(e) => setApplyYear(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
                    />
                    Coin Year
                  </label>
                  <input
                    type="number"
                    min={1794}
                    max={2100}
                    value={coinYear}
                    disabled={!applyYear}
                    onChange={(e) => setCoinYear(e.target.value)}
                    placeholder="e.g. 1889"
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white disabled:opacity-50 disabled:bg-slate-100"
                  />
                </div>

                <div
                  className={`border rounded-md p-3 space-y-2 transition-colors ${
                    applyMint
                      ? 'border-[#1E3A5F] bg-slate-50/70'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyMint}
                      onChange={(e) => setApplyMint(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
                    />
                    Mint Mark
                  </label>
                  <input
                    type="text"
                    value={coinMint}
                    disabled={!applyMint}
                    onChange={(e) => setCoinMint(e.target.value)}
                    placeholder="P, O, S, CC..."
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:bg-slate-100"
                  />
                  {applyMint && normalizedMintPreview && (
                    <div className="text-[11px] text-slate-500">
                      Mapped Mint_Code:{' '}
                      <span className="font-mono font-semibold text-slate-800">
                        {normalizedMintPreview}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Variety / VAM */}
              <div
                className={`border rounded-md p-3 space-y-2 transition-colors ${
                  applyVariety
                    ? 'border-[#1E3A5F] bg-slate-50/70'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyVariety}
                    onChange={(e) => setApplyVariety(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
                  />
                  Update Variety / VAM
                </label>
                <input
                  type="text"
                  value={proposedVariety}
                  disabled={!applyVariety}
                  onChange={(e) => setProposedVariety(e.target.value)}
                  placeholder="e.g. Standard Strike or VAM-4 Hot Lips"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:bg-slate-100"
                />
              </div>

              {/* Suggested Grade & Dataset Grade */}
              <div
                className={`border rounded-md p-3 space-y-2 transition-colors ${
                  applyGrade
                    ? 'border-[#1E3A5F] bg-slate-50/70'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyGrade}
                    onChange={(e) => setApplyGrade(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
                  />
                  Update Grade &amp; Dataset Map
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={suggestedGrade}
                    disabled={!applyGrade}
                    onChange={(e) => setSuggestedGrade(e.target.value)}
                    placeholder="e.g. MS63, AU55"
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white disabled:opacity-50 disabled:bg-slate-100"
                  />
                  <select
                    value={datasetGradeOverride}
                    disabled={!applyGrade}
                    onChange={(e) =>
                      setDatasetGradeOverride(e.target.value as DatasetGrade | 'AUTO')
                    }
                    className="w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white disabled:opacity-50 disabled:bg-slate-100"
                  >
                    <option value="AUTO">
                      Auto ({normalizedGradePreview || '—'})
                    </option>
                    <option value="G-4">G-4</option>
                    <option value="F-12">F-12</option>
                    <option value="MS-60">MS-60</option>
                    <option value="MS-63">MS-63</option>
                    <option value="MS-65">MS-65</option>
                    <option value="">Blank</option>
                  </select>
                </div>
              </div>

              {/* Diagnostic Notes */}
              <div
                className={`border rounded-md p-3 space-y-2 transition-colors ${
                  applyNotes
                    ? 'border-[#1E3A5F] bg-slate-50/70'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyNotes}
                    onChange={(e) => setApplyNotes(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
                  />
                  Update Diagnostic Notes
                </label>
                <textarea
                  rows={2}
                  value={diagnosticNotes}
                  disabled={!applyNotes}
                  onChange={(e) => setDiagnosticNotes(e.target.value)}
                  placeholder="Shared diagnostic notes (required for Custom_ID / Custom_Value rows)"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:bg-slate-100"
                />
              </div>
            </div>

            {/* Right Column: Live Rule Engine Validation Preview */}
            <div className="lg:col-span-7 flex flex-col space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Live Rule Engine Pre-Flight Check
                </h3>
                <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                  <span className="text-emerald-700 font-semibold">
                    {stats.clean} Valid
                  </span>
                  {stats.warnings.length > 0 && (
                    <span className="text-amber-700 font-semibold">
                      {stats.warnings.length} Advisory
                    </span>
                  )}
                  {stats.blocked.length > 0 && (
                    <span className="text-red-700 font-semibold">
                      {stats.blocked.length} BLOCK
                    </span>
                  )}
                </div>
              </div>

              {stats.blocked.length > 0 && (
                <div className="border border-red-200 bg-red-50 rounded-md p-3 text-xs text-red-900 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <ShieldAlert className="w-4 h-4 text-red-700 shrink-0" />
                    <span>
                      Rule Engine blocked {stats.blocked.length}{' '}
                      {stats.blocked.length === 1 ? 'record' : 'records'} — resolve before
                      applying:
                    </span>
                  </div>
                  <ul className="list-disc list-inside text-[11px] space-y-0.5 pl-1">
                    {stats.blocked.map((b) => (
                      <li key={b.before.photoId}>
                        <span className="font-mono font-semibold">
                          {b.before.photoId}
                        </span>
                        : {b.after.guardrailCheck}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {stats.blocked.length === 0 && stats.warnings.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-md px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    {stats.warnings.length}{' '}
                    {stats.warnings.length === 1 ? 'record triggers' : 'records trigger'}{' '}
                    Key Date, Confidence, or Below-Base advisories and will remain flagged
                    for verification.
                  </span>
                </div>
              )}

              <div className="border border-slate-200 rounded-lg overflow-hidden flex-1 bg-white">
                <div className="overflow-x-auto max-h-[380px]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold z-10">
                      <tr>
                        <th className="py-2 px-3">Coin</th>
                        <th className="py-2 px-3">Resulting Attribution</th>
                        <th className="py-2 px-3 text-right">Lookup Base</th>
                        <th className="py-2 px-3">Rule Engine Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previews.map(({ before, after }) => {
                        const changedAttr =
                          before.dateMintKey !== after.dateMintKey ||
                          before.proposedSeries !== after.proposedSeries ||
                          before.proposedVariety !== after.proposedVariety ||
                          before.suggestedGrade !== after.suggestedGrade;

                        return (
                          <tr
                            key={before.photoId}
                            className={
                              after.isBlocked ? 'bg-red-50/70' : 'hover:bg-slate-50/60'
                            }
                          >
                            <td className="py-2 px-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded border border-slate-200 bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                                  {before.imageDataUrl ? (
                                    <img
                                      src={before.imageDataUrl}
                                      alt={before.filename}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-contain"
                                    />
                                  ) : (
                                    <Coins className="w-3.5 h-3.5 text-slate-400" />
                                  )}
                                </div>
                                <div>
                                  <div className="font-mono font-semibold text-slate-900">
                                    {before.photoId}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {before.status || 'Pending'}
                                    {after.isKeyDate === 'Yes' && ' · Key Date'}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-2 px-3">
                              <div
                                className={`font-medium ${
                                  changedAttr ? 'text-[#1E3A5F]' : 'text-slate-900'
                                }`}
                              >
                                {after.dateMintKey || '—'} · {after.proposedSeries}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                                {after.proposedVariety || 'Standard Strike'}
                                {after.suggestedGrade ? ` · ${after.suggestedGrade}` : ''}
                              </div>
                            </td>

                            <td className="py-2 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                              <div className="text-slate-900">
                                {fmtUsd(after.lookupValue)}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {after.datasetGrade || 'No map'}
                              </div>
                            </td>

                            <td className="py-2 px-3">
                              {after.isBlocked ? (
                                <span className="inline-flex items-center gap-1 text-red-700 font-semibold text-[11px]">
                                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                                  {after.guardrailCheck}
                                </span>
                              ) : after.guardrailCheck === 'OK' ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  OK
                                  {after.valueCheck === 'Below base - verify' &&
                                    ' · Below base'}
                                </span>
                              ) : (
                                <span className="text-slate-500 text-[11px]">
                                  Pending review
                                  {after.valueCheck === 'Below base - verify' &&
                                    ' · Below base'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {!hasAnyEnabledField
                ? 'Enable at least one metadata field on the left to preview and apply changes.'
                : stats.blocked.length > 0
                  ? 'Resolve all Rule Engine BLOCK errors before applying.'
                  : `Ready to update ${selectedRows.length} ${selectedRows.length === 1 ? 'coin' : 'coins'}.`}
            </span>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving
                  ? 'Applying...'
                  : `Apply Changes to ${selectedRows.length} ${selectedRows.length === 1 ? 'Coin' : 'Coins'}`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
