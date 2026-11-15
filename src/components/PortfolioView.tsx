import React from 'react';
import { ArrowRight, AlertTriangle, ShieldAlert } from 'lucide-react';
import type { PortfolioSummary, WorkbookSettings } from '../shared/types';

interface PortfolioViewProps {
  summary: PortfolioSummary;
  settings: WorkbookSettings;
  onNavigate: (tab: 'batch' | 'queue' | 'formulas' | 'settings') => void;
  onFilterQueue: () => void;
}

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  summary,
  settings,
  onNavigate,
  onFilterQueue,
}) => {
  return (
    <div className="space-y-8">
      {/* Rule R9 Preliminary Disclosure */}
      <div className="border border-slate-200 bg-white px-5 py-4 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">
            Preliminary Appraisal Notice (Rule R9)
          </p>
          <p className="text-sm text-slate-600">
            Photo-based attributions and valuations are advisory estimates as of{' '}
            <span className="font-mono tabular-nums text-slate-800">{settings.priceAsOf}</span>.
            Confirm Key Dates and high-value VAM varieties in hand before settlement.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('formulas')}
          className="text-sm font-semibold text-[#1E3A5F] hover:underline whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer"
        >
          View Audited Formulas
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Active Guardrail Block Alert if any BLOCK rows exist */}
      {summary.guardrailBlockCount > 0 && (
        <div className="border border-red-200 bg-red-50 px-5 py-4 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-900">
                {summary.guardrailBlockCount} Guardrail{' '}
                {summary.guardrailBlockCount === 1 ? 'Block' : 'Blocks'} Detected
              </p>
              <p className="text-sm text-red-800">
                One or more records violate rules R1–R6 (e.g., low-confidence Accept, unreviewed Key Date, or missing custom notes). Resolve them in the Review Queue.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFilterQueue}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
          >
            Resolve in Review Queue
          </button>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="border border-slate-200 bg-white rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Batch Records</p>
          <p className="text-3xl font-semibold text-slate-900 font-mono tabular-nums mt-2">
            {summary.totalRecords}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            {summary.acceptedCount} accepted · {summary.customOverridesCount} custom · {summary.ignoredOrFlaggedDistinct} ignored/flagged
          </p>
        </div>

        <div className="border border-slate-200 bg-white rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Active Review Queue</p>
          <p
            className={`text-3xl font-semibold font-mono tabular-nums mt-2 ${
              summary.activeReviewQueue > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {summary.activeReviewQueue}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            {summary.confidenceWarnings} confidence{' '}
            {summary.confidenceWarnings === 1 ? 'warning' : 'warnings'} (&lt;{' '}
            <span className="font-mono tabular-nums">{settings.confidenceThreshold}%</span>)
          </p>
        </div>

        <div className="border border-slate-200 bg-white rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Approved Final Value</p>
          <p className="text-3xl font-semibold text-slate-900 font-mono tabular-nums mt-2">
            {fmtCurrency(summary.totalApprovedFinalValue)}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Guide mid sum:{' '}
            <span className="font-mono tabular-nums text-slate-700">
              {fmtCurrency(summary.approvedGuideMidSum)}
            </span>
          </p>
        </div>

        <div className="border border-slate-200 bg-white rounded-lg p-5">
          <p className="text-xs font-medium text-slate-500">Guardrail Blocks</p>
          <p
            className={`text-3xl font-semibold font-mono tabular-nums mt-2 ${
              summary.guardrailBlockCount > 0 ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {summary.guardrailBlockCount}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Morgan melt floor:{' '}
            <span className="font-mono tabular-nums text-slate-700">
              ${summary.meltValuePerMorgan.toFixed(2)}
            </span>{' '}
            (@ ${settings.silverSpot.toFixed(2)}/oz)
          </p>
        </div>
      </div>

      {/* 3-Column Ledger Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="border border-slate-200 bg-white rounded-lg p-6">
          <h3 className="text-base font-semibold text-slate-900 mb-4">
            Decision &amp; Dataset Verification
          </h3>
          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Accepted (B5)</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.acceptedCount}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Custom Overrides (B6)</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.customOverridesCount}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Ignored or Flagged, distinct (B7)</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.ignoredOrFlaggedDistinct}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Rows with Dataset Base Value (B18)</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.rowsWithDatasetBase}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Guide Mid &lt; Dataset Base (B19)</dt>
              <dd className="font-mono tabular-nums font-medium text-amber-700 inline-flex items-center gap-1.5">
                {summary.belowBaseCount > 0 && <AlertTriangle className="w-3.5 h-3.5" />}
                {summary.belowBaseCount}
              </dd>
            </div>
          </dl>
        </div>

        <div className="border border-slate-200 bg-white rounded-lg p-6">
          <h3 className="text-base font-semibold text-slate-900 mb-4">
            Confidence Distribution
          </h3>
          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">
                High (&ge; {settings.highCutoff}%) (B12)
              </dt>
              <dd className="font-mono tabular-nums font-medium text-emerald-700">
                {summary.highConfidenceCount}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">
                Medium ({settings.mediumFloor}–{settings.highCutoff - 1}%) (B13)
              </dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.mediumConfidenceCount}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">
                Low (&lt; {settings.mediumFloor}%) (B14)
              </dt>
              <dd className="font-mono tabular-nums font-medium text-red-700">
                {summary.lowConfidenceCount}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Average Confidence (B15)</dt>
              <dd className="font-mono tabular-nums font-semibold text-slate-900">
                {summary.averageConfidence !== null ? `${summary.averageConfidence.toFixed(1)}%` : '—'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Auto-Accept Policy (Rule R7)</dt>
              <dd className="font-medium text-slate-900">Disabled (Locked)</dd>
            </div>
          </dl>
        </div>

        <div className="border border-slate-200 bg-white rounded-lg p-6">
          <h3 className="text-base font-semibold text-slate-900 mb-4">
            Series Breakdown
          </h3>
          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Classic Morgan (B21)</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.seriesCounts.classicMorgan}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">2021+ Morgan (B22)</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.seriesCounts.modernMorgan}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Peace Dollar (B23)</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.seriesCounts.peace}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">American Silver Eagle (B24)</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.seriesCounts.silverEagle}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-600">Other / Unclassified (B25)</dt>
              <dd className="font-mono tabular-nums font-medium text-slate-900">
                {summary.seriesCounts.other}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
};
