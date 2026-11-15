import React, { useMemo, useState } from 'react';
import { CheckCircle2, Play, XCircle } from 'lucide-react';
import { runQaAcceptanceSuite } from '../shared/ruleEngine';
import type { BatchEvaluatedRow, QaTestResult, WorkbookSettings } from '../shared/types';

interface SettingsQaViewProps {
  settings: WorkbookSettings;
  batchRows: BatchEvaluatedRow[];
  onSaveSettings: (next: WorkbookSettings) => Promise<void>;
}

export const SettingsQaView: React.FC<SettingsQaViewProps> = ({
  settings,
  batchRows,
  onSaveSettings,
}) => {
  const [form, setForm] = useState<WorkbookSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [qaResults, setQaResults] = useState<QaTestResult[]>(() =>
    runQaAcceptanceSuite(batchRows, settings),
  );

  // Keep form synchronized when external reset occurs
  React.useEffect(() => {
    setForm(settings);
  }, [settings]);

  const meltPreview = useMemo(
    () => (0.7734 * (Number(form.silverSpot) || 0)).toFixed(2),
    [form.silverSpot],
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings(form);
    } finally {
      setSaving(false);
    }
  };

  const handleRunSuite = () => {
    setQaResults(runQaAcceptanceSuite(batchRows, settings));
  };

  const passCount = qaResults.filter((r) => r.passed).length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Settings Panel */}
      <form
        onSubmit={handleSave}
        className="xl:col-span-5 border border-slate-200 bg-white rounded-lg p-6 space-y-5 self-start"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Appraisal &amp; Guardrail Settings
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Changes immediately re-evaluate Confidence_Flag, Guardrail_Check, and Review Queue across the Batch Log.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Confidence Threshold % (B3)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.confidenceThreshold}
              onChange={(e) =>
                setForm({ ...form, confidenceThreshold: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              High Confidence Cutoff % (B5)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.highCutoff}
              onChange={(e) =>
                setForm({ ...form, highCutoff: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Medium Confidence Floor % (B6)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.mediumFloor}
              onChange={(e) =>
                setForm({ ...form, mediumFloor: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Silver Spot USD / oz (B11)
            </label>
            <input
              type="number"
              step="0.01"
              min={1}
              value={form.silverSpot}
              onChange={(e) =>
                setForm({ ...form, silverSpot: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Price As-Of Date
            </label>
            <input
              type="date"
              value={form.priceAsOf}
              onChange={(e) => setForm({ ...form, priceAsOf: e.target.value })}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Auto-Accept Policy (Rule R7)
            </label>
            <input
              type="text"
              value="Disabled (Locked)"
              disabled
              className="w-full px-3 py-2 text-sm border border-slate-200 bg-slate-50 text-slate-500 rounded-md"
            />
          </div>
        </div>

        <div className="border border-slate-200 bg-slate-50 rounded-md px-4 py-3 text-xs text-slate-700 flex justify-between items-center">
          <span>Calculated Morgan Melt Floor (0.7734 oz Ag)</span>
          <strong className="font-mono tabular-nums text-slate-900">${meltPreview}</strong>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md disabled:opacity-60 cursor-pointer"
        >
          {saving ? 'Saving Settings...' : 'Save & Re-Evaluate Batch'}
        </button>
      </form>

      {/* Automated QA Acceptance Suite */}
      <div className="xl:col-span-7 border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Automated QA Guardrail &amp; Sample Test Suite
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Validates live state invariants, Err:539 lookup parity, and all 8 testing sample scenarios (PH007–PH014).
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-mono tabular-nums font-semibold ${
                passCount === qaResults.length ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {passCount}/{qaResults.length} Passed
            </span>
            <button
              type="button"
              onClick={handleRunSuite}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Run Full QA Suite
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
          {qaResults.map((t) => (
            <div key={t.id} className="p-4 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-700">{t.id}</span> ·{' '}
                  {t.scope}
                </div>
                <p className="text-sm font-medium text-slate-900">{t.name}</p>
                <div className="text-xs font-mono text-slate-600">
                  <div>Expected: {t.expected}</div>
                  <div>Actual: {t.actual}</div>
                </div>
              </div>
              <div className="shrink-0">
                {t.passed ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-4 h-4" />
                    PASS
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                    <XCircle className="w-4 h-4" />
                    FAIL
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
