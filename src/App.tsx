import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  ClipboardCheck,
  FileSpreadsheet,
  LayoutDashboard,
  ListChecks,
  Menu,
  Plus,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { AddCoinModal } from './components/AddCoinModal';
import { BatchLogView } from './components/BatchLogView';
import { CoinDetailModal } from './components/CoinDetailModal';
import { PortfolioView } from './components/PortfolioView';
import { ReferenceView } from './components/ReferenceView';
import { ReviewQueueView } from './components/ReviewQueueView';
import { SettingsQaView } from './components/SettingsQaView';
import { WorkbookFormulasView } from './components/WorkbookFormulasView';
import { toBatchCsv } from './shared/ruleEngine';
import type {
  BatchEvaluatedRow,
  BatchRawInput,
  ReviewStatus,
  WorkbenchState,
  WorkbookSettings,
} from './shared/types';

type TabKey = 'dashboard' | 'batch' | 'queue' | 'reference' | 'formulas' | 'settings';

const NAV_ITEMS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'dashboard', label: 'Portfolio Summary', icon: LayoutDashboard },
  { key: 'batch', label: 'Batch Log', icon: ListChecks },
  { key: 'queue', label: 'Review Queue', icon: ClipboardCheck },
  { key: 'reference', label: 'Price Data & Varieties', icon: BookOpen },
  { key: 'formulas', label: 'Workbook Formulas', icon: FileSpreadsheet },
  { key: 'settings', label: 'Settings & QA Suite', icon: SlidersHorizontal },
];

export default function App() {
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalMode, setAddModalMode] = useState<'single' | 'bulk'>('single');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3200);
  }, []);

  const fetchState = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error('Failed to load workbench state');
      const data = (await res.json()) as WorkbenchState;
      setState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect to backend');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const handleSaveDecision = async (photoId: string, patch: Partial<BatchRawInput>) => {
    const res = await fetch(`/api/batch/${encodeURIComponent(photoId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Decision blocked by guardrails');
    }
    setState(data as WorkbenchState);
    notify(`Saved attribution decision for ${photoId}`);
  };

  const handleApplyAutoGrade = async (photoId: string, patch: Partial<BatchRawInput>) => {
    const res = await fetch(`/api/batch/${encodeURIComponent(photoId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save Gemini Vision grade proposal');
    }
    setState(data as WorkbenchState);
  };

  const handleAddRecord = async (payload: Partial<BatchRawInput>) => {
    const res = await fetch('/api/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to add record');
    }
    setState(data as WorkbenchState);
    notify('Added preliminary proposal to Batch Log & Review Queue');
  };

  const handleBulkAddRecords = async (items: Array<Partial<BatchRawInput>>) => {
    const res = await fetch('/api/batch/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to upload photo batch');
    }
    setState(data.state as WorkbenchState);
    notify(
      `Added ${data.added} ${data.added === 1 ? 'coin photo' : 'coin photos'} to Batch Log & Review Queue`,
    );
  };

  const handleDeleteRecord = async (photoId: string) => {
    const res = await fetch(`/api/batch/${encodeURIComponent(photoId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      const data = (await res.json()) as WorkbenchState;
      setState(data);
      notify(`Removed ${photoId}`);
    }
  };

  const handleBulkStatusUpdate = async (
    photoIds: string[],
    status: ReviewStatus,
  ) => {
    const res = await fetch('/api/batch/bulk-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds, status }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error || 'Bulk status update blocked by guardrails');
      return;
    }
    setState(data.state as WorkbenchState);
    const label = status || 'Pending';
    const updatedCount = Array.isArray(data.updatedIds) ? data.updatedIds.length : 0;
    const skippedList = Array.isArray(data.skipped) ? data.skipped : [];
    if (skippedList.length > 0) {
      notify(
        `Updated ${updatedCount} coin(s) to ${label}; skipped ${skippedList
          .map((s: { photoId: string }) => s.photoId)
          .join(', ')} (guardrail block)`,
      );
    } else {
      notify(`Updated ${updatedCount} coin(s) to ${label}`);
    }
  };

  const handleBulkDelete = async (photoIds: string[]) => {
    const res = await fetch('/api/batch/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error || 'Failed to delete selected records');
      return;
    }
    setState(data.state as WorkbenchState);
    const deletedCount = Number(data.deleted || 0);
    notify(
      `Deleted ${deletedCount} ${deletedCount === 1 ? 'coin record' : 'coin records'} from Batch Log`,
    );
  };

  const handleBulkEditMetadata = async (
    photoIds: string[],
    patch: Partial<BatchRawInput>,
  ) => {
    const res = await fetch('/api/batch/bulk-metadata', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds, patch }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Bulk metadata update rejected by rule engine');
    }
    setState(data.state as WorkbenchState);
    const updatedCount = Number(data.updated || 0);
    notify(
      `Updated metadata for ${updatedCount} ${updatedCount === 1 ? 'coin record' : 'coin records'}`,
    );
  };

  const handleLoadSample = async () => {
    const res = await fetch('/api/batch/load-sample', { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { added: number; state: WorkbenchState };
      setState(data.state);
      notify(
        data.added > 0
          ? `Loaded ${data.added} testing sample records (PH007–PH014)`
          : 'Testing sample records (PH007–PH014) are already loaded',
      );
      setActiveTab('batch');
    }
  };

  const handleResetSeed = async () => {
    const res = await fetch('/api/batch/reset', { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as WorkbenchState;
      setState(data);
      notify('Reset Batch Log to clean seed (PH001–PH006)');
    }
  };

  const handleImportCsv = async (file: File) => {
    const csvText = await file.text();
    const res = await fetch('/api/batch/import-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText, mode: 'append' }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify(data.error || 'CSV import failed');
      return;
    }
    setState(data.state as WorkbenchState);
    notify(`Imported ${data.imported} CSV rows`);
  };

  const handleExportCsv = () => {
    if (!state) return;
    const csv = toBatchCsv(state.batchRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morgan_batch_log_${state.settings.priceAsOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Exported evaluated Batch Log CSV');
  };

  const handleExportJson = () => {
    if (!state) return;
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morgan_workbench_snapshot_${state.settings.priceAsOf}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('Exported full JSON snapshot');
  };

  const handleSaveSettings = async (next: WorkbookSettings) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      const data = (await res.json()) as WorkbenchState;
      setState(data);
      notify('Updated settings and re-evaluated Batch Log');
    }
  };

  const activeNavLabel = NAV_ITEMS.find((n) => n.key === activeTab)?.label || '';
  const inspectingRow: BatchEvaluatedRow | null =
    state?.batchRows.find((r) => r.photoId === inspectingId) || null;

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] text-slate-900">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-slate-200 bg-white">
        <div className="h-16 px-6 border-b border-slate-200 flex items-center">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Silver Dollar Ledger
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            const countLabel =
              item.key === 'batch' && state
                ? state.summary.totalRecords
                : item.key === 'queue' && state
                  ? state.summary.activeReviewQueue
                  : item.key === 'settings' && state && state.summary.guardrailBlockCount > 0
                    ? `${state.summary.guardrailBlockCount} BLOCK`
                    : null;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#1E3A5F] text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="inline-flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {countLabel !== null && (
                  <span
                    className={`font-mono tabular-nums text-xs ${
                      isActive
                        ? 'text-white/90'
                        : item.key === 'settings'
                          ? 'text-red-700 font-semibold'
                          : 'text-slate-500'
                    }`}
                  >
                    {countLabel}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {state && (
          <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>Threshold</span>
              <span className="font-mono tabular-nums text-slate-800">
                {state.settings.confidenceThreshold}%
              </span>
            </div>
            <div className="flex justify-between">
              <span>Morgan Melt</span>
              <span className="font-mono tabular-nums text-slate-800">
                ${state.summary.meltValuePerMorgan.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Auto-Accept</span>
              <span className="text-slate-800">Disabled</span>
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-64 bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
              <span className="font-display text-base font-bold text-slate-900">
                Silver Dollar Ledger
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-1 text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.key);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium cursor-pointer ${
                      isActive
                        ? 'bg-[#1E3A5F] text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Strict 3-Zone Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-8 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded cursor-pointer"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="lg:hidden font-display text-base font-bold text-slate-900 whitespace-nowrap shrink-0">
              Silver Dollar Ledger
            </span>
            <span className="hidden lg:inline text-sm text-slate-500 whitespace-nowrap shrink-0">
              Appraisal Workbench
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-sm font-medium text-slate-900 whitespace-nowrap truncate">
            <span>{activeNavLabel}</span>
            {state && (
              <>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  As-Of {state.settings.priceAsOf}
                </span>
              </>
            )}
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => {
                setAddModalMode('single');
                setAddModalOpen(true);
              }}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Coin
            </button>
          </div>
        </header>

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {loading ? (
            <div className="space-y-4">
              <div className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : error || !state ? (
            <div className="border border-red-200 bg-red-50 rounded-lg p-6 text-sm text-red-900 space-y-3">
              <p className="font-semibold">{error || 'Unable to load workbench state.'}</p>
              <button
                type="button"
                onClick={fetchState}
                className="px-4 py-2 bg-red-700 text-white rounded-md font-semibold cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <PortfolioView
                  summary={state.summary}
                  settings={state.settings}
                  onNavigate={(t) => setActiveTab(t)}
                  onFilterQueue={() => setActiveTab('queue')}
                />
              )}

              {activeTab === 'batch' && (
                <BatchLogView
                  rows={state.batchRows}
                  settings={state.settings}
                  onInspect={(r) => setInspectingId(r.photoId)}
                  onDelete={handleDeleteRecord}
                  onBulkStatusUpdate={handleBulkStatusUpdate}
                  onBulkEditMetadata={handleBulkEditMetadata}
                  onBulkDelete={handleBulkDelete}
                  onApplyAutoGrade={handleApplyAutoGrade}
                  onNotify={notify}
                  onLoadTestingSample={handleLoadSample}
                  onResetSeed={handleResetSeed}
                  onExportCsv={handleExportCsv}
                  onExportJson={handleExportJson}
                  onImportCsv={handleImportCsv}
                  onOpenAddModal={() => {
                    setAddModalMode('single');
                    setAddModalOpen(true);
                  }}
                  onOpenBulkUploadModal={() => {
                    setAddModalMode('bulk');
                    setAddModalOpen(true);
                  }}
                />
              )}

              {activeTab === 'queue' && (
                <ReviewQueueView
                  queue={state.reviewQueue}
                  onInspect={(r) => setInspectingId(r.photoId)}
                />
              )}

              {activeTab === 'reference' && (
                <ReferenceView
                  priceData={state.priceData}
                  varietyReference={state.varietyReference}
                />
              )}

              {activeTab === 'formulas' && (
                <WorkbookFormulasView
                  formulas={state.workbookFormulas}
                  auditIssues={state.auditIssues}
                  liveBatchRows={state.batchRows}
                  priceData={state.priceData}
                  varietyReference={state.varietyReference}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsQaView
                  settings={state.settings}
                  batchRows={state.batchRows}
                  onSaveSettings={handleSaveSettings}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Modals */}
      <CoinDetailModal
        row={inspectingRow}
        settings={state?.settings || {
          confidenceThreshold: 70,
          highCutoff: 85,
          mediumFloor: 60,
          silverSpot: 49.11,
          priceAsOf: '2026-11-14',
          autoAccept: false,
        }}
        priceData={state?.priceData || []}
        varietyReference={state?.varietyReference || []}
        onClose={() => setInspectingId(null)}
        onSave={handleSaveDecision}
      />

      <AddCoinModal
        open={addModalOpen}
        initialMode={addModalMode}
        onClose={() => setAddModalOpen(false)}
        onSubmit={handleAddRecord}
        onBulkSubmit={handleBulkAddRecords}
      />

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
