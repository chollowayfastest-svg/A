import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { evaluateSingleRow } from '../shared/ruleEngine';
import type {
  BatchEvaluatedRow,
  BatchRawInput,
  DatasetGrade,
  PriceDataRow,
  ReviewStatus,
  UserAction,
  VarietyRow,
  WorkbookSettings,
} from '../shared/types';

interface CoinDetailModalProps {
  row: BatchEvaluatedRow | null;
  settings: WorkbookSettings;
  priceData: PriceDataRow[];
  varietyReference: VarietyRow[];
  onClose: () => void;
  onSave: (photoId: string, patch: Partial<BatchRawInput>) => Promise<void>;
}

const fmtUsd = (n: number | '') =>
  n === '' ? '—' : `$${Number(n).toLocaleString('en-US')}`;

export const CoinDetailModal: React.FC<CoinDetailModalProps> = ({
  row,
  settings,
  priceData,
  varietyReference,
  onClose,
  onSave,
}) => {
  const [userAction, setUserAction] = useState<UserAction>('');
  const [status, setStatus] = useState<ReviewStatus>('');
  const [datasetGrade, setDatasetGrade] = useState<DatasetGrade>('');
  const [finalId, setFinalId] = useState('');
  const [finalValue, setFinalValue] = useState<string>('');
  const [valueSourceAsOf, setValueSourceAsOf] = useState('');
  const [diagnosticNotes, setDiagnosticNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setUserAction(row.userAction);
    setStatus(row.status);
    setDatasetGrade(row.datasetGrade);
    setFinalId(row.finalId);
    setFinalValue(row.finalValue === '' ? '' : String(row.finalValue));
    setValueSourceAsOf(row.valueSourceAsOf || settings.priceAsOf);
    setDiagnosticNotes(row.diagnosticNotes);
    setServerError(null);
  }, [row, settings.priceAsOf]);

  const liveEval = useMemo(() => {
    if (!row) return null;
    const candidate: BatchRawInput = {
      ...row,
      userAction,
      status,
      datasetGrade,
      finalId,
      finalValue: finalValue.trim() === '' ? '' : Number(finalValue),
      valueSourceAsOf,
      diagnosticNotes,
    };
    return evaluateSingleRow(candidate, settings);
  }, [
    row,
    userAction,
    status,
    datasetGrade,
    finalId,
    finalValue,
    valueSourceAsOf,
    diagnosticNotes,
    settings,
  ]);

  const matchedPriceRow = useMemo(() => {
    if (!liveEval || liveEval.proposedSeries !== 'Classic Morgan' || !liveEval.dateMintKey)
      return null;
    return priceData.find((p) => p.Lookup_Key === liveEval.dateMintKey) || null;
  }, [liveEval, priceData]);

  const matchedVarieties = useMemo(() => {
    if (!row) return [];
    const key = liveEval?.dateMintKey || '';
    return varietyReference.filter(
      (v) =>
        (key && v.Date_Mint === key) ||
        (row.proposedSeries !== 'Classic Morgan' && v.Series === row.proposedSeries),
    );
  }, [row, liveEval, varietyReference]);

  if (!row || !liveEval) return null;

  const handleQuickFillAccept = () => {
    setUserAction('Accept');
    if (!finalId.trim()) {
      setFinalId(
        `${liveEval.dateMintKey || row.coinYear} ${row.proposedSeries}${
          row.proposedVariety ? ` (${row.proposedVariety})` : ''
        }`.trim(),
      );
    }
    if (finalValue.trim() === '' && row.guideValueMid !== '') {
      setFinalValue(String(row.guideValueMid));
    }
    setStatus('Reviewed');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (liveEval.isBlocked) return;
    setSaving(true);
    setServerError(null);
    try {
      await onSave(row.photoId, {
        userAction,
        status,
        datasetGrade,
        finalId,
        finalValue: finalValue.trim() === '' ? '' : Number(finalValue),
        valueSourceAsOf,
        diagnosticNotes,
      });
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to save decision');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coin-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-5xl w-full max-h-[92vh] overflow-y-auto shadow-xl">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 sticky top-0 bg-white z-10">
          <div>
            <h2 id="coin-modal-title" className="text-lg font-semibold text-slate-900">
              {row.photoId} · {liveEval.dateMintKey || row.proposedSeries} Attribution &amp; Review
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {row.filename} · Confidence:{' '}
              <span className="font-mono tabular-nums">
                {row.confidencePct === '' ? 'Blank' : `${row.confidencePct}%`}
              </span>{' '}
              ({liveEval.confidenceFlag || 'No score'})
              {liveEval.isKeyDate === 'Yes' && ' · Key Date (Human Review Mandatory)'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Guardrail / Key Date Banners */}
          {liveEval.isBlocked && (
            <div className="border border-red-200 bg-red-50 rounded-md px-4 py-3 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
              <div className="text-sm text-red-900">
                <strong>Guardrail Active:</strong> {liveEval.guardrailCheck}. Adjust the human decision below before saving.
              </div>
            </div>
          )}

          {serverError && (
            <div className="border border-red-200 bg-red-50 rounded-md px-4 py-3 text-sm text-red-900">
              {serverError}
            </div>
          )}

          {liveEval.isKeyDate === 'Yes' && (
            <div className="border border-amber-200 bg-amber-50 rounded-md px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <strong>Rule R6 Key Date Guardrail:</strong> {liveEval.dateMintKey} is a Key Date. Accepting requires explicit{' '}
                <code className="font-mono text-xs bg-amber-100 px-1 rounded">Status = Reviewed</code> and physical authentication confirmation.
              </div>
            </div>
          )}

          {/* Side-by-side Proposal vs Reference */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-slate-200 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Preserved Raw Proposal &amp; Photo
              </h3>

              {row.imageDataUrl ? (
                <div className="border border-slate-200 rounded-md bg-slate-50 p-2 flex items-center justify-center">
                  <img
                    src={row.imageDataUrl}
                    alt={row.filename}
                    referrerPolicy="no-referrer"
                    className="max-h-48 rounded object-contain"
                  />
                </div>
              ) : (
                <div className="border border-dashed border-slate-300 rounded-md bg-slate-50 py-6 px-4 text-center text-xs text-slate-500">
                  Metadata record ({row.filename}) · No photo bitmap attached
                </div>
              )}

              <dl className="divide-y divide-slate-100 text-xs">
                <div className="py-2 flex justify-between gap-4">
                  <dt className="text-slate-500">Proposed Series</dt>
                  <dd className="font-medium text-slate-900">{row.proposedSeries}</dd>
                </div>
                <div className="py-2 flex justify-between gap-4">
                  <dt className="text-slate-500">Year / Normalized Mint</dt>
                  <dd className="font-mono text-slate-900">
                    {row.coinYear || '—'} / {row.coinMint || '—'} &rarr; {liveEval.mintCode || '—'}
                  </dd>
                </div>
                <div className="py-2 flex justify-between gap-4">
                  <dt className="text-slate-500">Proposed Variety</dt>
                  <dd className="font-medium text-slate-900">{row.proposedVariety || '—'}</dd>
                </div>
                <div className="py-2 flex justify-between gap-4">
                  <dt className="text-slate-500">Suggested Grade</dt>
                  <dd className="font-mono text-slate-900">{row.suggestedGrade || '—'}</dd>
                </div>
                <div className="py-2 flex justify-between gap-4">
                  <dt className="text-slate-500">Guide Range &amp; Midpoint</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {fmtUsd(row.guideLow)} – {fmtUsd(row.guideHigh)} (Mid: {fmtUsd(liveEval.guideValueMid)})
                  </dd>
                </div>
              </dl>
            </div>

            <div className="border border-slate-200 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Price Data Lookup &amp; Variety Diagnostics
              </h3>

              {matchedPriceRow ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>
                      Matched Key:{' '}
                      <strong className="font-mono text-slate-900">
                        {matchedPriceRow.Lookup_Key}
                      </strong>
                    </span>
                    <span>
                      Source Quality:{' '}
                      <strong className="text-slate-900">
                        {matchedPriceRow.Source_Quality}
                      </strong>
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 text-center font-mono tabular-nums">
                    {(['G-4', 'F-12', 'MS-60', 'MS-63', 'MS-65'] as const).map((g) => (
                      <div
                        key={g}
                        className={`p-2 rounded border ${
                          datasetGrade === g
                            ? 'border-[#1E3A5F] bg-slate-100 font-semibold text-slate-900'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        <div className="text-[10px] text-slate-500">{g}</div>
                        <div className="text-xs mt-0.5">{fmtUsd(matchedPriceRow[g])}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-slate-600 pt-1">
                    Active Lookup Base ({datasetGrade || 'None'}):{' '}
                    <strong className="font-mono text-slate-900">
                      {fmtUsd(liveEval.lookupValue)}
                    </strong>{' '}
                    · Value Check:{' '}
                    <strong
                      className={
                        liveEval.valueCheck === 'Below base - verify'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }
                    >
                      {liveEval.valueCheck}
                    </strong>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
                  No Classic Morgan Price Data match (series is {row.proposedSeries} or date-mint not in 1878–1921 table).
                </p>
              )}

              <div className="border-t border-slate-200 pt-3 space-y-2">
                <p className="text-xs font-semibold text-slate-700">
                  Matching Variety Catalog Entries ({matchedVarieties.length})
                </p>
                {matchedVarieties.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No curated VAM/privy entries specifically linked to {liveEval.dateMintKey || row.proposedSeries}.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {matchedVarieties.map((v) => (
                      <div key={v.Variety_ID} className="text-xs border border-slate-200 rounded p-2.5">
                        <div className="flex justify-between font-semibold text-slate-900">
                          <span>
                            {v.Variety_Name} ({v.VAM_or_Code})
                          </span>
                          <span className="font-mono tabular-nums text-[#1E3A5F]">
                            {fmtUsd(v.Value_Low_USD)}–{fmtUsd(v.Value_High_USD)}
                          </span>
                        </div>
                        <p className="text-slate-600 mt-1">{v.Key_Diagnostics}</p>
                        {v.QC_Note && (
                          <p className="text-amber-700 mt-0.5 font-medium">QC: {v.QC_Note}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Human Attribution Form */}
          <form onSubmit={handleSubmit} className="border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Human Attribution &amp; Valuation Decision
              </h3>
              <button
                type="button"
                onClick={handleQuickFillAccept}
                className="text-xs font-semibold text-[#1E3A5F] hover:underline cursor-pointer"
              >
                Prefill Accept + Reviewed
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  User_Action
                </label>
                <select
                  value={userAction}
                  onChange={(e) => setUserAction(e.target.value as UserAction)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  <option value="">-- Pending --</option>
                  <option value="Accept">Accept</option>
                  <option value="Custom_ID">Custom_ID</option>
                  <option value="Custom_Value">Custom_Value</option>
                  <option value="Ignore">Ignore</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ReviewStatus)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  <option value="">-- Pending --</option>
                  <option value="Reviewed">Reviewed</option>
                  <option value="Flagged">Flagged</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Dataset_Grade (Base Lookup)
                </label>
                <select
                  value={datasetGrade}
                  onChange={(e) => setDatasetGrade(e.target.value as DatasetGrade)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  <option value="">(None / Unmapped)</option>
                  <option value="G-4">G-4</option>
                  <option value="F-12">F-12</option>
                  <option value="MS-60">MS-60</option>
                  <option value="MS-63">MS-63</option>
                  <option value="MS-65">MS-65</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Final_ID
                </label>
                <input
                  type="text"
                  value={finalId}
                  onChange={(e) => setFinalId(e.target.value)}
                  placeholder="Confirmed attribution"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Final_Value (USD)
                </label>
                <input
                  type="number"
                  value={finalValue}
                  onChange={(e) => setFinalValue(e.target.value)}
                  placeholder="USD"
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Value_Source_AsOf
                </label>
                <input
                  type="date"
                  value={valueSourceAsOf}
                  onChange={(e) => setValueSourceAsOf(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Diagnostic_Notes{' '}
                {(userAction === 'Custom_ID' || userAction === 'Custom_Value') && (
                  <span className="text-red-700">(Required for Custom decisions)</span>
                )}
              </label>
              <textarea
                rows={2}
                value={diagnosticNotes}
                onChange={(e) => setDiagnosticNotes(e.target.value)}
                placeholder="Loupe diagnostics, die cracks, mintmark notes, or reason for override..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-xs">
                Live Guardrail Status:{' '}
                <strong
                  className={
                    liveEval.isBlocked
                      ? 'text-red-700'
                      : liveEval.guardrailCheck === 'OK'
                        ? 'text-emerald-700'
                        : 'text-slate-600'
                  }
                >
                  {liveEval.guardrailCheck || 'Pending Decision'}
                </strong>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || liveEval.isBlocked}
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Decision'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
