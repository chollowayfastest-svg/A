import React, { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type {
  AuditFormulaItem,
  AuditIssueItem,
  BatchEvaluatedRow,
  PriceDataRow,
  VarietyRow,
} from '../shared/types';
import { TESTING_SAMPLE_BATCH, SEED_BATCH } from '../shared/seedData';
import { toBatchCsv, toRawTemplateCsv } from '../shared/ruleEngine';

interface WorkbookFormulasViewProps {
  formulas: AuditFormulaItem[];
  auditIssues: AuditIssueItem[];
  liveBatchRows: BatchEvaluatedRow[];
  priceData: PriceDataRow[];
  varietyReference: VarietyRow[];
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const WorkbookFormulasView: React.FC<WorkbookFormulasViewProps> = ({
  formulas,
  auditIssues,
  liveBatchRows,
  priceData,
  varietyReference,
}) => {
  const [sheetFilter, setSheetFilter] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const visibleFormulas = useMemo(() => {
    if (sheetFilter === 'ALL') return formulas;
    return formulas.filter((f) => f.sheet === sheetFilter);
  }, [formulas, sheetFilter]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      // Clipboard fallback ignored if blocked
    }
  };

  const downloadPriceDataCsv = () => {
    const header =
      'Lookup_Key,Year,Mint_As_Given,Mint_Code,Mintage,G-4,F-12,MS-60,MS-63,MS-65,Key_Date,Source_Quality';
    const lines = priceData.map((r) =>
      [
        r.Lookup_Key,
        r.Year,
        r.Mint_As_Given,
        r.Mint_Code,
        r.Mintage,
        r['G-4'],
        r['F-12'],
        r['MS-60'],
        r['MS-63'],
        r['MS-65'],
        r.Key_Date,
        r.Source_Quality,
      ].join(','),
    );
    downloadBlob('price_data_95.csv', [header, ...lines].join('\n'), 'text/csv;charset=utf-8');
  };

  const downloadVarietiesCsv = () => {
    const header =
      'Variety_ID,Series,Date_Mint,Variety_Name,VAM_or_Code,Key_Diagnostics,Value_Low_USD,Value_High_USD,QC_Note';
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = varietyReference.map((v) =>
      [
        v.Variety_ID,
        v.Series,
        v.Date_Mint,
        v.Variety_Name,
        v.VAM_or_Code,
        v.Key_Diagnostics,
        v.Value_Low_USD,
        v.Value_High_USD,
        v.QC_Note,
      ]
        .map(esc)
        .join(','),
    );
    downloadBlob('variety_reference_18.csv', [header, ...lines].join('\n'), 'text/csv;charset=utf-8');
  };

  return (
    <div className="space-y-8">
      {/* Downloadable Patched Templates Strip */}
      <div className="border border-slate-200 bg-white rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Patched CSV Templates &amp; Reference Exports
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Download clean CSV inputs or full evaluated batch snapshots aligned with the repaired workbook formulas.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                downloadBlob(
                  'batch_log_seed_PH001_PH006.csv',
                  toRawTemplateCsv(SEED_BATCH),
                  'text/csv;charset=utf-8',
                )
              }
              className="px-3 py-2 text-xs font-semibold text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Seed CSV (PH001–PH006)
            </button>
            <button
              type="button"
              onClick={() =>
                downloadBlob(
                  'testing_sample_PH007_PH014.csv',
                  toRawTemplateCsv(TESTING_SAMPLE_BATCH),
                  'text/csv;charset=utf-8',
                )
              }
              className="px-3 py-2 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Testing Sample CSV (PH007–PH014)
            </button>
            <button
              type="button"
              onClick={() =>
                downloadBlob(
                  'batch_log_evaluated_live.csv',
                  toBatchCsv(liveBatchRows),
                  'text/csv;charset=utf-8',
                )
              }
              className="px-3 py-2 text-xs font-semibold text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Live Evaluated Batch CSV
            </button>
            <button
              type="button"
              onClick={downloadPriceDataCsv}
              className="px-3 py-2 text-xs font-semibold text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Price Data (95)
            </button>
            <button
              type="button"
              onClick={downloadVarietiesCsv}
              className="px-3 py-2 text-xs font-semibold text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Varieties (18)
            </button>
          </div>
        </div>
      </div>

      {/* Audit Findings & Fixes */}
      <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-900">
            Workbook Audit Resolution Log
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Every defect identified in v3 is resolved both in the Excel/Sheets formulas below and in the shared backend rule engine.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {auditIssues.map((issue) => (
            <div key={issue.id} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
              <div className="md:col-span-3">
                <span className="font-mono font-semibold text-slate-900">{issue.id}</span>
                <span className="text-slate-400"> · </span>
                <span
                  className={`font-semibold ${
                    issue.severity === 'Critical'
                      ? 'text-red-700'
                      : issue.severity === 'High'
                        ? 'text-amber-700'
                        : 'text-[#1E3A5F]'
                  }`}
                >
                  {issue.severity}
                </span>
                <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                  {issue.location}
                </div>
              </div>
              <div className="md:col-span-4 text-slate-700">
                <strong className="text-slate-900">Defect: </strong>
                {issue.defect}
              </div>
              <div className="md:col-span-5 text-slate-700">
                <strong className="text-emerald-800">Fix Applied: </strong>
                {issue.resolution}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Patched Formula Reference */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">
            Patched Workbook &amp; Dynamic Review Queue Formulas
          </h3>
          <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {['ALL', 'Settings', 'Batch Log', 'Portfolio Summary', 'Review Queue'].map(
              (tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSheetFilter(tab)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    sheetFilter === tab
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab === 'ALL' ? 'All Sheets' : tab}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="space-y-3">
          {visibleFormulas.map((item) => (
            <div
              key={item.id}
              className="border border-slate-200 bg-white rounded-lg p-4 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">
                  {item.sheet} · <span className="font-mono text-[#1E3A5F]">{item.cellRange}</span> —{' '}
                  {item.fieldLabel}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>
                    Format: <code className="font-mono text-slate-700">{item.numberFormat}</code>
                  </span>
                  <span>
                    Sample: <strong className="font-mono text-slate-900">{item.sampleOutput}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(item.id, item.formula)}
                    className="px-2.5 py-1 text-xs font-semibold border border-slate-300 rounded hover:bg-slate-50 text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {copiedId === item.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Formula
                      </>
                    )}
                  </button>
                </div>
              </div>

              <pre className="bg-slate-50 border border-slate-200 rounded p-3 text-xs font-mono text-slate-900 overflow-x-auto whitespace-pre-wrap break-all">
                {item.formula}
              </pre>

              <p className="text-xs text-slate-600">{item.fixSummary}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
