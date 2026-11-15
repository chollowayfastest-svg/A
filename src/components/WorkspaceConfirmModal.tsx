import React from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

export interface WorkspaceConfirmRequest {
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  tone: 'danger' | 'warning';
  onConfirm: () => Promise<void> | void;
}

interface WorkspaceConfirmModalProps {
  request: WorkspaceConfirmRequest | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const WorkspaceConfirmModal: React.FC<WorkspaceConfirmModalProps> = ({
  request,
  busy = false,
  onCancel,
  onConfirm,
}) => {
  if (!request) return null;

  const isDanger = request.tone === 'danger';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="workspace-confirm-title"
      aria-describedby="workspace-confirm-desc"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full shadow-xl overflow-hidden">
        <div
          className={`px-5 py-4 border-b flex items-start gap-3 ${
            isDanger
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {isDanger ? (
            <Trash2 className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          )}
          <div>
            <h3 id="workspace-confirm-title" className="text-base font-semibold">
              {request.title}
            </h3>
          </div>
        </div>

        <div className="p-5 space-y-3 text-sm text-slate-700">
          <p id="workspace-confirm-desc">{request.description}</p>

          {request.details && request.details.length > 0 && (
            <ul className="border border-slate-200 bg-slate-50 rounded-md p-3 space-y-1 text-xs font-mono text-slate-800 max-h-40 overflow-y-auto">
              {request.details.map((line, i) => (
                <li key={i} className="truncate" title={line}>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-md inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer ${
              isDanger
                ? 'bg-red-700 hover:bg-red-800'
                : 'bg-[#1E3A5F] hover:bg-[#162C49]'
            }`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
