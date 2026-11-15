import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { BatchEvaluatedRow } from '../shared/types';

interface ReviewQueueViewProps {
  queue: BatchEvaluatedRow[];
  onInspect: (row: BatchEvaluatedRow) => void;
}

export const ReviewQueueView: React.FC<ReviewQueueViewProps> = ({
  queue,
  onInspect,
}) => {
  return (
    <div className="space-y-4">
      <div className="border border-slate-200 bg-white rounded-lg px-5 py-4">
        <p className="text-sm font-semibold text-slate-900">
          Dynamic Review Queue Filter Rule
        </p>
        <p className="text-sm text-slate-600 mt-1">
          Mirrors{' '}
          <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
            Review_Seq
          </code>{' '}
          and{' '}
          <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
            Review Queue!A4
          </code>
          : includes every record not yet marked <strong>Reviewed</strong> that has{' '}
          <strong>Confidence_Flag = WARNING</strong>, <strong>Status = Flagged</strong>,
          blank <strong>User_Action</strong>, or <strong>Is_Key_Date = Yes</strong>.
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="border border-slate-200 bg-white rounded-lg p-12 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="text-base font-semibold text-slate-900">
            No rows pending review
          </p>
          <p className="text-sm text-slate-600">
            All batch records have passed human attribution and guardrail verification.
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3 whitespace-nowrap text-right">#</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Photo ID</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Series · Date-Mint</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Proposed Variety</th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-right">Conf %</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Flag · Key Date</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Suggested Grade</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">User Action</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Guardrail</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Diagnostic Notes</th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.map((r) => (
                  <tr
                    key={r.photoId}
                    className={`h-11 ${
                      r.isBlocked ? 'bg-red-50/70 hover:bg-red-50' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="py-2 px-3 whitespace-nowrap text-right font-mono tabular-nums font-semibold text-slate-700">
                      {r.reviewSeq}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="font-mono font-semibold text-slate-900">{r.photoId}</div>
                      <div className="text-[11px] text-slate-500">{r.filename}</div>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="font-medium text-slate-900">{r.dateMintKey || '—'}</div>
                      <div className="text-[11px] text-slate-500">{r.proposedSeries}</div>
                    </td>
                    <td className="py-2 px-3 max-w-[180px] truncate text-slate-800">
                      {r.proposedVariety || '—'}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-900">
                      {r.confidencePct === '' ? 'Blank' : `${r.confidencePct}%`}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          r.confidenceFlag === 'WARNING'
                            ? 'text-amber-700'
                            : r.confidenceFlag === 'OK'
                              ? 'text-emerald-700'
                              : 'text-red-700'
                        }`}
                      >
                        {r.confidenceFlag || 'Blank'}
                      </span>
                      {r.isKeyDate === 'Yes' && (
                        <span className="text-amber-700 font-semibold"> · Key Date</span>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-slate-800">
                      {r.suggestedGrade || '—'}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-slate-800">
                      {r.userAction || 'Pending'}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-semibold text-amber-700">
                      {r.status || 'Pending'}
                    </td>
                    <td className="py-2 px-3 max-w-[200px]">
                      <span
                        className={`font-semibold ${
                          r.isBlocked ? 'text-red-700' : 'text-slate-600'
                        }`}
                      >
                        {r.guardrailCheck || 'Awaiting Decision'}
                      </span>
                    </td>
                    <td className="py-2 px-3 max-w-[220px] truncate text-slate-600" title={r.diagnosticNotes}>
                      {r.diagnosticNotes || '—'}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => onInspect(r)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded cursor-pointer"
                      >
                        Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
