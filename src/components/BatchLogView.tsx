import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Coins,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FlaskConical,
  HardDrive,
  ImageOff,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { exportFilteredBatchToNewSpreadsheet } from '../lib/googleWorkspace';
import { normalizeDatasetGrade } from '../shared/ruleEngine';
import type {
  BatchEvaluatedRow,
  BatchRawInput,
  CoinSeries,
  ReviewStatus,
  WorkbookSettings,
} from '../shared/types';
import { BulkEditMetadataModal } from './BulkEditMetadataModal';

type AutoGradeItemStatus = 'queued' | 'grading' | 'completed' | 'skipped' | 'error';

interface AutoGradeItemProgress {
  photoId: string;
  filename: string;
  status: AutoGradeItemStatus;
  detail: string;
}

function extractMimeType(dataUrl: string): string {
  const match = /^data:([^;]+);base64,/.exec(dataUrl);
  return match ? match[1] : 'image/jpeg';
}

interface BatchLogViewProps {
  rows: BatchEvaluatedRow[];
  settings: WorkbookSettings;
  onInspect: (row: BatchEvaluatedRow) => void;
  onDelete: (photoId: string) => void;
  onBulkStatusUpdate: (photoIds: string[], status: ReviewStatus) => Promise<void>;
  onBulkEditMetadata: (
    photoIds: string[],
    patch: Partial<BatchRawInput>,
  ) => Promise<void>;
  onBulkDelete: (photoIds: string[]) => Promise<void>;
  onApplyAutoGrade: (photoId: string, patch: Partial<BatchRawInput>) => Promise<void>;
  onNotify?: (msg: string) => void;
  onLoadTestingSample: () => void;
  onResetSeed: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onImportCsv: (file: File) => void;
  onOpenAddModal: () => void;
  onOpenBulkUploadModal: () => void;
  onOpenWorkspace?: () => void;
  accessToken?: string | null;
  onEnsureGoogleToken?: () => Promise<string | null>;
  onAuthExpired?: () => void;
}

const fmtUsd = (val: number | '') =>
  val === '' ? '—' : `$${Number(val).toLocaleString('en-US')}`;

export const BatchLogView: React.FC<BatchLogViewProps> = ({
  rows,
  settings,
  onInspect,
  onDelete,
  onBulkStatusUpdate,
  onBulkEditMetadata,
  onBulkDelete,
  onApplyAutoGrade,
  onNotify,
  onLoadTestingSample,
  onResetSeed,
  onExportCsv,
  onExportJson,
  onImportCsv,
  onOpenAddModal,
  onOpenBulkUploadModal,
  onOpenWorkspace,
  accessToken,
  onEnsureGoogleToken,
  onAuthExpired,
}) => {
  const [search, setSearch] = useState('');
  const [flagFilter, setFlagFilter] = useState<string>('ALL');
  const [seriesFilter, setSeriesFilter] = useState<string>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkStatusTarget, setBulkStatusTarget] = useState<ReviewStatus>('Reviewed');
  const [applyingBulk, setApplyingBulk] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [sheetExportResult, setSheetExportResult] = useState<{
    title: string;
    url: string;
    count: number;
  } | null>(null);
  const [sheetExportError, setSheetExportError] = useState<string | null>(null);
  const [autoGrading, setAutoGrading] = useState(false);
  const [autoGradeOrder, setAutoGradeOrder] = useState<string[]>([]);
  const [autoGradeProgress, setAutoGradeProgress] = useState<
    Record<string, AutoGradeItemProgress>
  >({});
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const cancelAutoGradeRef = useRef(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (seriesFilter !== 'ALL' && r.proposedSeries !== seriesFilter) return false;
      if (flagFilter === 'WARNING' && r.confidenceFlag !== 'WARNING') return false;
      if (flagFilter === 'BLOCK' && !r.isBlocked) return false;
      if (flagFilter === 'KEYDATE' && r.isKeyDate !== 'Yes') return false;
      if (flagFilter === 'BELOW_BASE' && r.valueCheck !== 'Below base - verify')
        return false;
      if (!q) return true;
      return (
        r.photoId.toLowerCase().includes(q) ||
        r.filename.toLowerCase().includes(q) ||
        r.dateMintKey.toLowerCase().includes(q) ||
        r.proposedVariety.toLowerCase().includes(q) ||
        r.finalId.toLowerCase().includes(q)
      );
    });
  }, [rows, search, flagFilter, seriesFilter]);

  // Prune any selected IDs that are no longer present in the batch
  useEffect(() => {
    const validIds = new Set(rows.map((r) => r.photoId));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const visibleIds = useMemo(() => filtered.map((r) => r.photoId), [filtered]);
  const selectedVisibleCount = useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)).length,
    [visibleIds, selectedIds],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected, viewMode, filtered.length]);

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  const toggleRowSelection = (photoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.photoId)),
    [rows, selectedIds],
  );

  const selectedPendingRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.photoId) && r.status === ''),
    [rows, selectedIds],
  );

  const autoGradeStats = useMemo(() => {
    const items = autoGradeOrder
      .map((id) => autoGradeProgress[id])
      .filter((item): item is AutoGradeItemProgress => Boolean(item));
    const total = items.length;
    const processed = items.filter(
      (i) => i.status === 'completed' || i.status === 'skipped' || i.status === 'error',
    ).length;
    const completed = items.filter((i) => i.status === 'completed').length;
    const failedOrSkipped = items.filter(
      (i) => i.status === 'skipped' || i.status === 'error',
    ).length;
    return { items, total, processed, completed, failedOrSkipped };
  }, [autoGradeOrder, autoGradeProgress]);

  useEffect(() => {
    if (selectedIds.size === 0) {
      setConfirmBulkDelete(false);
    }
  }, [selectedIds.size]);

  const handleApplyBulkStatus = async () => {
    if (selectedIds.size === 0 || autoGrading || deletingBulk) return;
    setConfirmBulkDelete(false);
    setApplyingBulk(true);
    try {
      await onBulkStatusUpdate(Array.from(selectedIds), bulkStatusTarget);
      setSelectedIds(new Set());
    } finally {
      setApplyingBulk(false);
    }
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.size === 0 || autoGrading || applyingBulk || deletingBulk) return;
    const targets = Array.from(selectedIds);
    setDeletingBulk(true);
    try {
      await onBulkDelete(targets);
      const deletedSet = new Set(targets);
      setAutoGradeOrder((prev) => prev.filter((id) => !deletedSet.has(id)));
      setAutoGradeProgress((prev) => {
        const next = { ...prev };
        for (const id of targets) delete next[id];
        return next;
      });
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleExportToGoogleSheets = async () => {
    if (filtered.length === 0 || exportingSheet) return;
    setSheetExportError(null);
    setExportingSheet(true);
    try {
      const token =
        accessToken || (onEnsureGoogleToken ? await onEnsureGoogleToken() : null);
      if (!token) {
        return;
      }

      const activeFilters: string[] = [];
      if (seriesFilter !== 'ALL') activeFilters.push(seriesFilter);
      if (flagFilter !== 'ALL') activeFilters.push(flagFilter);
      if (search.trim()) activeFilters.push(`"${search.trim()}"`);

      const created = await exportFilteredBatchToNewSpreadsheet(token, filtered, {
        priceAsOf: settings.priceAsOf,
        filterLabel: activeFilters.length > 0 ? activeFilters.join(' · ') : 'All Rows',
      });

      setSheetExportResult({
        title: created.title,
        url: created.spreadsheetUrl,
        count: filtered.length,
      });
      onNotify?.(
        `Exported ${filtered.length} filtered row(s) to Google Sheets: "${created.title}"`,
      );
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        onAuthExpired?.();
        setSheetExportError(
          'Your Google session expired. Click Export to Google Sheets again to reconnect.',
        );
      } else {
        setSheetExportError(
          err instanceof Error ? err.message : 'Failed to export to Google Sheets.',
        );
      }
    } finally {
      setExportingSheet(false);
    }
  };

  const handleAutoGradeSelected = async () => {
    const targets = selectedPendingRows;
    if (targets.length === 0 || autoGrading) return;

    cancelAutoGradeRef.current = false;
    setAutoGrading(true);

    const initialOrder = targets.map((t) => t.photoId);
    const initialMap: Record<string, AutoGradeItemProgress> = {};
    for (const t of targets) {
      initialMap[t.photoId] = {
        photoId: t.photoId,
        filename: t.filename,
        status: 'queued',
        detail: 'Queued for Gemini Vision',
      };
    }
    setAutoGradeOrder(initialOrder);
    setAutoGradeProgress(initialMap);

    let gradedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    const validSeries: CoinSeries[] = [
      'Classic Morgan',
      '2021+ Morgan',
      'Peace',
      'American Silver Eagle',
      'Other',
    ];

    for (let idx = 0; idx < targets.length; idx++) {
      const target = targets[idx];
      if (cancelAutoGradeRef.current) {
        for (let rem = idx; rem < targets.length; rem++) {
          const remTarget = targets[rem];
          setAutoGradeProgress((prev) => ({
            ...prev,
            [remTarget.photoId]: {
              photoId: remTarget.photoId,
              filename: remTarget.filename,
              status: 'skipped',
              detail: 'Cancelled by reviewer',
            },
          }));
          skippedCount += 1;
        }
        break;
      }

      if (!target.imageDataUrl) {
        setAutoGradeProgress((prev) => ({
          ...prev,
          [target.photoId]: {
            photoId: target.photoId,
            filename: target.filename,
            status: 'skipped',
            detail: 'No coin image attached',
          },
        }));
        skippedCount += 1;
        continue;
      }

      setAutoGradeProgress((prev) => ({
        ...prev,
        [target.photoId]: {
          photoId: target.photoId,
          filename: target.filename,
          status: 'grading',
          detail: 'Analyzing coin photo...',
        },
      }));

      try {
        const res = await fetch('/api/analyze-coin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: target.imageDataUrl,
            mimeType: extractMimeType(target.imageDataUrl),
            filename: target.filename,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Gemini Vision request failed');
        }

        const p = data.proposal || {};
        const nextSeries = validSeries.includes(p.proposedSeries)
          ? (p.proposedSeries as CoinSeries)
          : target.proposedSeries;
        const nextGrade = p.suggestedGrade
          ? String(p.suggestedGrade)
          : target.suggestedGrade;
        const parsedConf = Number(p.confidencePct);
        const nextConf =
          p.confidencePct !== undefined &&
          p.confidencePct !== null &&
          Number.isFinite(parsedConf)
            ? Math.max(0, Math.min(100, Math.round(parsedConf)))
            : target.confidencePct;
        const parsedYear = Number(p.coinYear);
        const nextYear =
          p.coinYear && Number.isFinite(parsedYear) && parsedYear > 0
            ? parsedYear
            : target.coinYear;
        const parsedLow = Number(p.guideLow);
        const nextLow =
          p.guideLow !== undefined && p.guideLow !== null && Number.isFinite(parsedLow)
            ? parsedLow
            : target.guideLow;
        const parsedHigh = Number(p.guideHigh);
        const nextHigh =
          p.guideHigh !== undefined && p.guideHigh !== null && Number.isFinite(parsedHigh)
            ? parsedHigh
            : target.guideHigh;

        await onApplyAutoGrade(target.photoId, {
          proposedSeries: nextSeries,
          coinYear: nextYear,
          coinMint: p.coinMint ? String(p.coinMint) : target.coinMint,
          proposedVariety: p.proposedVariety
            ? String(p.proposedVariety)
            : target.proposedVariety,
          confidencePct: nextConf,
          suggestedGrade: nextGrade,
          datasetGrade: normalizeDatasetGrade('', nextGrade),
          guideLow: nextLow,
          guideHigh: nextHigh,
          diagnosticNotes: p.diagnosticNotes
            ? String(p.diagnosticNotes)
            : target.diagnosticNotes,
        });

        gradedCount += 1;
        setAutoGradeProgress((prev) => ({
          ...prev,
          [target.photoId]: {
            photoId: target.photoId,
            filename: target.filename,
            status: 'completed',
            detail: `${nextGrade || 'Proposed'} · ${nextConf === '' ? '—' : `${nextConf}%`}`,
          },
        }));
      } catch (err) {
        errorCount += 1;
        const msg = err instanceof Error ? err.message : 'Auto-grade failed';
        setAutoGradeProgress((prev) => ({
          ...prev,
          [target.photoId]: {
            photoId: target.photoId,
            filename: target.filename,
            status: 'error',
            detail: msg,
          },
        }));
      }
    }

    setAutoGrading(false);
    if (onNotify) {
      if (errorCount > 0 || skippedCount > 0) {
        onNotify(
          `Auto-graded ${gradedCount} pending coin(s) (${skippedCount} skipped, ${errorCount} failed)`,
        );
      } else {
        onNotify(
          `Auto-graded ${gradedCount} pending coin(s) — awaiting human confirmation`,
        );
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Workspace Action Toolbar */}
      <div className="border border-slate-200 bg-white rounded-lg p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Photo ID, Date-Mint, Variety..."
              className="pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md w-64 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
          </div>

          <select
            value={flagFilter}
            onChange={(e) => setFlagFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
          >
            <option value="ALL">All Guardrails &amp; Flags</option>
            <option value="BLOCK">Guardrail BLOCK only</option>
            <option value="WARNING">Confidence WARNING only</option>
            <option value="KEYDATE">Key Dates only</option>
            <option value="BELOW_BASE">Below Dataset Base</option>
          </select>

          <select
            value={seriesFilter}
            onChange={(e) => setSeriesFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
          >
            <option value="ALL">All Series</option>
            <option value="Classic Morgan">Classic Morgan</option>
            <option value="2021+ Morgan">2021+ Morgan</option>
            <option value="Peace">Peace</option>
            <option value="American Silver Eagle">American Silver Eagle</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenBulkUploadModal}
            className="px-3 py-2 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ImagePlus className="w-3.5 h-3.5" />
            Bulk Upload Photos
          </button>

          <button
            type="button"
            onClick={onLoadTestingSample}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            Load Sample (PH007–PH014)
          </button>

          <label className="px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportCsv(file);
                e.currentTarget.value = '';
              }}
            />
          </label>

          <button
            type="button"
            onClick={onExportCsv}
            className="px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>

          <button
            type="button"
            onClick={onExportJson}
            className="px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            JSON
          </button>

          <button
            type="button"
            onClick={handleExportToGoogleSheets}
            disabled={filtered.length === 0 || exportingSheet}
            title={
              filtered.length === 0
                ? 'No filtered batch records to export'
                : `Create a new Google Sheet with ${filtered.length} filtered coin record(s)`
            }
            className="px-3 py-2 text-xs font-semibold text-emerald-800 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
          >
            {exportingSheet ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5" />
            )}
            {exportingSheet ? 'Exporting Sheet...' : 'Export to Google Sheets'}
          </button>

          {onOpenWorkspace && (
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="px-3 py-2 text-xs font-semibold text-[#1E3A5F] border border-[#1E3A5F]/35 bg-slate-50 hover:bg-slate-100 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <HardDrive className="w-3.5 h-3.5" />
              Drive &amp; Sheets
            </button>
          )}

          <button
            type="button"
            onClick={onResetSeed}
            className="px-3 py-2 text-xs font-semibold text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Seed
          </button>
        </div>
        </div>
        {/* Persistent Header Selection Counter & Bulk Action Controls */}
        <div className="border-t border-slate-200 pt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              aria-live="polite"
              className="text-xs font-medium text-slate-600 whitespace-nowrap shrink-0"
            >
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {selectedIds.size}
              </span>{' '}
              selected
            </span>

            <label
              htmlFor="bulk-status-select"
              className="text-xs font-semibold text-slate-600 whitespace-nowrap"
            >
              Bulk Action:
            </label>
            <select
              id="bulk-status-select"
              value={bulkStatusTarget}
              disabled={selectedIds.size === 0 || applyingBulk || autoGrading || deletingBulk}
              onChange={(e) => setBulkStatusTarget(e.target.value as ReviewStatus)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] disabled:opacity-45 disabled:bg-slate-50 disabled:cursor-not-allowed"
            >
              <option value="Reviewed">Mark Reviewed</option>
              <option value="Flagged">Mark Flagged</option>
              <option value="">Reset to Pending</option>
            </select>

            <button
              type="button"
              onClick={handleApplyBulkStatus}
              disabled={selectedIds.size === 0 || applyingBulk || autoGrading || deletingBulk}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
            >
              {applyingBulk ? 'Applying...' : 'Apply Bulk Status'}
            </button>

            <button
              type="button"
              onClick={() => {
                setConfirmBulkDelete(false);
                setBulkEditOpen(true);
              }}
              disabled={selectedIds.size === 0 || applyingBulk || autoGrading || deletingBulk}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              Bulk Edit Metadata
            </button>

            <span
              aria-hidden="true"
              className="hidden sm:block h-5 w-px bg-slate-200 mx-0.5"
            />

            <button
              type="button"
              onClick={handleAutoGradeSelected}
              disabled={
                selectedPendingRows.length === 0 ||
                applyingBulk ||
                autoGrading ||
                deletingBulk
              }
              title={
                selectedIds.size === 0
                  ? 'Select coins to auto-grade'
                  : selectedPendingRows.length === 0
                    ? 'Only selected coins in Pending status can be auto-graded'
                    : `Run Gemini Vision analysis on ${selectedPendingRows.length} Pending selected coin(s)`
              }
              className="px-3.5 py-1.5 text-xs font-semibold text-[#1E3A5F] border border-[#1E3A5F]/40 bg-slate-50 hover:bg-slate-100 rounded-md inline-flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
            >
              {autoGrading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>
                {autoGrading
                  ? `Grading ${autoGradeStats.processed}/${autoGradeStats.total}...`
                  : 'Auto-Grade All Selected'}
              </span>
              {!autoGrading && selectedPendingRows.length > 0 && (
                <span className="font-mono tabular-nums text-[11px] text-slate-600">
                  ({selectedPendingRows.length} Pending)
                </span>
              )}
            </button>

            {autoGrading && (
              <button
                type="button"
                onClick={() => {
                  cancelAutoGradeRef.current = true;
                }}
                className="px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="w-3 h-3" />
                Stop Grading
              </button>
            )}

            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              disabled={
                selectedIds.size === 0 ||
                applyingBulk ||
                autoGrading ||
                deletingBulk
              }
              className="px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 rounded-md inline-flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedIds(new Set());
                setConfirmBulkDelete(false);
              }}
              disabled={selectedIds.size === 0 || applyingBulk || autoGrading || deletingBulk}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
            >
              Clear Selection
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 text-xs font-semibold rounded inline-flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                Table
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`px-2.5 py-1 text-xs font-semibold rounded inline-flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Photo Grid
              </button>
            </div>
          </div>
        </div>

        {/* Inline Bulk Delete Confirmation Bar */}
        {confirmBulkDelete && selectedIds.size > 0 && (
          <div
            role="alertdialog"
            aria-label="Confirm bulk delete"
            className="border border-red-200 bg-red-50 rounded-md px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 text-xs text-red-900">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
              <span>
                Permanently delete{' '}
                <strong className="font-mono tabular-nums">
                  {selectedIds.size}
                </strong>{' '}
                selected coin {selectedIds.size === 1 ? 'record' : 'records'} from the Batch Log?
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(false)}
                disabled={deletingBulk}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                disabled={deletingBulk}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-md inline-flex items-center gap-1.5 disabled:opacity-45 cursor-pointer"
              >
                {deletingBulk && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {deletingBulk
                  ? 'Deleting...'
                  : `Confirm Delete (${selectedIds.size})`}
              </button>
            </div>
          </div>
        )}

        {sheetExportError && (
          <div className="border border-red-200 bg-red-50 rounded-md px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs text-red-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
              <span>{sheetExportError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSheetExportError(null)}
              className="text-red-700 hover:text-red-900 cursor-pointer"
              aria-label="Dismiss Google Sheets export error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {sheetExportResult && (
          <div className="border border-emerald-200 bg-emerald-50 rounded-md px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-900">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span className="truncate">
                Created Google Sheet{' '}
                <strong className="font-semibold">{sheetExportResult.title}</strong>{' '}
                (<span className="font-mono tabular-nums">{sheetExportResult.count}</span>{' '}
                filtered rows)
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <a
                href={sheetExportResult.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-emerald-800 hover:underline inline-flex items-center gap-1"
              >
                Open in Google Sheets
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => setSheetExportResult(null)}
                className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
                aria-label="Dismiss Google Sheets export banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Per-Item Auto-Grade Batch Progress Tracker */}
      {autoGradeStats.total > 0 && (
        <div
          aria-live="polite"
          className="border border-slate-200 bg-white rounded-lg p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              {autoGrading ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#1E3A5F]" />
              ) : (
                <Sparkles className="w-4 h-4 text-[#1E3A5F]" />
              )}
              <span className="font-semibold text-slate-900">
                Gemini Vision Batch Auto-Grade Progress
              </span>
              <span className="font-mono tabular-nums text-slate-600">
                {autoGradeStats.processed} / {autoGradeStats.total} processed
              </span>
            </div>

            {!autoGrading && (
              <button
                type="button"
                onClick={() => {
                  setAutoGradeOrder([]);
                  setAutoGradeProgress({});
                }}
                aria-label="Dismiss auto-grade progress"
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="h-1.5 w-full bg-slate-100 rounded-sm overflow-hidden">
            <div
              className="h-full bg-[#1E3A5F] transition-all duration-300"
              style={{
                width: `${Math.round(
                  (autoGradeStats.processed / autoGradeStats.total) * 100,
                )}%`,
              }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {autoGradeStats.items.map((item) => (
              <div
                key={item.photoId}
                className="border border-slate-200 rounded-md px-3 py-2 bg-slate-50/70 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {item.status === 'grading' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1E3A5F] shrink-0" />
                    ) : item.status === 'completed' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    ) : item.status === 'error' ? (
                      <AlertCircle className="w-3.5 h-3.5 text-red-700 shrink-0" />
                    ) : item.status === 'skipped' ? (
                      <ImageOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <span className="font-mono font-semibold text-slate-900">
                      {item.photoId}
                    </span>
                    <span
                      className="text-slate-500 truncate"
                      title={item.filename}
                    >
                      {item.filename}
                    </span>
                  </div>
                  <span
                    className={`text-[11px] font-semibold whitespace-nowrap ${
                      item.status === 'grading'
                        ? 'text-[#1E3A5F]'
                        : item.status === 'completed'
                          ? 'text-emerald-700'
                          : item.status === 'error'
                            ? 'text-red-700'
                            : item.status === 'skipped'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                    }`}
                  >
                    {item.status === 'grading'
                      ? 'Grading'
                      : item.status === 'completed'
                        ? 'Graded'
                        : item.status === 'error'
                          ? 'Error'
                          : item.status === 'skipped'
                            ? 'Skipped'
                            : 'Queued'}
                  </span>
                </div>

                <div className="h-1 w-full bg-slate-200 rounded-sm overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      item.status === 'grading'
                        ? 'w-2/3 bg-[#1E3A5F] animate-pulse'
                        : item.status === 'completed'
                          ? 'w-full bg-emerald-600'
                          : item.status === 'error'
                            ? 'w-full bg-red-600'
                            : item.status === 'skipped'
                              ? 'w-full bg-amber-500'
                              : 'w-0 bg-slate-300'
                    }`}
                  />
                </div>

                <div
                  className="text-[11px] text-slate-600 truncate"
                  title={item.detail}
                >
                  {item.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Data Grid */}
      {filtered.length === 0 ? (
        <div className="border border-slate-200 bg-white rounded-lg p-10 text-center space-y-3">
          <p className="text-sm font-medium text-slate-700">
            No batch records match your current filters.
          </p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setFlagFilter('ALL');
                setSeriesFilter('ALL');
              }}
              className="px-4 py-2 text-sm font-semibold border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
            >
              Clear Filters
            </button>
            <button
              type="button"
              onClick={onOpenAddModal}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#1E3A5F] rounded-md hover:bg-[#162C49] cursor-pointer"
            >
              Add Coin Record
            </button>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="space-y-3">
          <div className="border border-slate-200 bg-white rounded-lg px-4 py-2.5 flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                aria-label="Select all visible coins"
                className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
              />
              Select all visible ({filtered.length})
            </label>
            <span className="text-xs text-slate-500">
              Showing {filtered.length} coin {filtered.length === 1 ? 'record' : 'records'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {filtered.map((r) => {
              const isSelected = selectedIds.has(r.photoId);
              const itemProgress = autoGradeProgress[r.photoId];
              return (
                <div
                  key={r.photoId}
                  className={`border rounded-lg overflow-hidden flex flex-col transition-colors ${
                    r.isBlocked
                      ? 'border-red-300 bg-red-50/40'
                      : isSelected
                        ? 'border-[#1E3A5F] bg-slate-50'
                        : 'border-slate-200 bg-white'
                  }`}
                >
                  {itemProgress && (
                    <div className="h-1 w-full bg-slate-100 overflow-hidden shrink-0">
                      <div
                        className={`h-full transition-all duration-300 ${
                          itemProgress.status === 'grading'
                            ? 'w-2/3 bg-[#1E3A5F] animate-pulse'
                            : itemProgress.status === 'completed'
                              ? 'w-full bg-emerald-600'
                              : itemProgress.status === 'error'
                                ? 'w-full bg-red-600'
                                : itemProgress.status === 'skipped'
                                  ? 'w-full bg-amber-500'
                                  : 'w-1/4 bg-slate-300'
                        }`}
                      />
                    </div>
                  )}

                  {/* Responsive CSS Grid: Compact horizontal list on <md, Detailed vertical card on md+ */}
                  <div className="p-3 grid grid-cols-[64px_minmax(0,1fr)_auto] sm:grid-cols-[80px_minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-x-3 gap-y-1.5 items-center md:p-0 md:flex md:flex-col md:items-stretch md:gap-0 md:flex-1">
                    {/* Selection, Photo ID & Status Header */}
                    <div className="col-start-2 col-span-2 row-start-1 flex items-center justify-between gap-2 md:order-1 md:px-3.5 md:py-2.5 md:border-b md:border-slate-100">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRowSelection(r.photoId)}
                          aria-label={`Select ${r.photoId}`}
                          className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
                        />
                        <span className="font-mono text-xs font-semibold text-slate-900">
                          {r.photoId}
                        </span>
                      </label>

                      <span
                        className={`text-xs font-semibold whitespace-nowrap ${
                          r.status === 'Flagged'
                            ? 'text-amber-700'
                            : r.status === 'Reviewed'
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {r.status || 'Pending'}
                        {r.isKeyDate === 'Yes' && ' · Key Date'}
                      </span>
                    </div>

                    {/* Coin Photo Thumbnail (compact on <md, 4:3 card preview on md+) */}
                    <div className="col-start-1 row-start-1 row-span-2 w-16 h-14 sm:w-20 sm:h-[60px] rounded border border-slate-200 bg-slate-100 flex items-center justify-center overflow-hidden md:order-2 md:w-full md:h-auto md:aspect-[4/3] md:rounded-none md:border-0 md:border-b md:border-slate-100">
                      {r.imageDataUrl ? (
                        <img
                          src={r.imageDataUrl}
                          alt={r.filename}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="text-center px-1.5 md:px-4 md:py-6 space-y-1 text-slate-400">
                          <Coins className="w-5 h-5 md:w-8 md:h-8 mx-auto text-slate-300" />
                          <div className="hidden md:block text-xs font-medium text-slate-600 truncate max-w-[200px]">
                            {r.filename}
                          </div>
                          <div className="hidden md:block text-[11px] text-slate-400">
                            Metadata entry · No image attached
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Coin Metadata, Valuation & Guardrail Details */}
                    <div className="col-start-2 row-start-2 min-w-0 space-y-0.5 text-xs md:order-3 md:p-3.5 md:pb-2 md:space-y-1 md:flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-slate-900 truncate">
                          {r.dateMintKey || '—'} · {r.proposedSeries}
                        </span>
                        <span className="font-mono tabular-nums text-slate-700 shrink-0">
                          {r.confidencePct === '' ? '—' : `${r.confidencePct}%`}
                        </span>
                      </div>
                      <p className="text-slate-600 truncate text-[11px] md:text-xs" title={r.proposedVariety}>
                        {r.proposedVariety || 'Standard Strike'}
                        {r.suggestedGrade ? ` · ${r.suggestedGrade}` : ''}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] pt-0.5 md:pt-1 font-mono tabular-nums text-slate-600">
                        <span>Base: {fmtUsd(r.lookupValue)}</span>
                        <span>Final: {fmtUsd(r.finalValue)}</span>
                      </div>
                      <div className="text-[11px] pt-0.5 truncate">
                        <span
                          className={`font-semibold ${
                            r.isBlocked
                              ? 'text-red-700'
                              : r.guardrailCheck === 'OK'
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {r.guardrailCheck || 'Awaiting decision'}
                        </span>
                      </div>

                      {itemProgress && (
                        <div
                          className={`pt-0.5 md:pt-1 flex items-center gap-1.5 text-[11px] font-medium ${
                            itemProgress.status === 'grading'
                              ? 'text-[#1E3A5F]'
                              : itemProgress.status === 'completed'
                                ? 'text-emerald-700'
                                : itemProgress.status === 'error'
                                  ? 'text-red-700'
                                  : itemProgress.status === 'skipped'
                                    ? 'text-amber-700'
                                    : 'text-slate-500'
                          }`}
                        >
                          {itemProgress.status === 'grading' ? (
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                          ) : itemProgress.status === 'completed' ? (
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                          ) : itemProgress.status === 'error' ? (
                            <AlertCircle className="w-3 h-3 shrink-0" />
                          ) : itemProgress.status === 'skipped' ? (
                            <ImageOff className="w-3 h-3 shrink-0" />
                          ) : (
                            <Clock className="w-3 h-3 shrink-0" />
                          )}
                          <span className="truncate" title={itemProgress.detail}>
                            {itemProgress.detail}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Row / Card Actions */}
                    <div className="col-start-3 row-start-2 flex flex-col sm:flex-row items-end sm:items-center gap-1.5 shrink-0 md:order-4 md:mx-3.5 md:mb-3.5 md:pt-2 md:border-t md:border-slate-100 md:flex-row md:justify-between md:gap-2">
                      <button
                        type="button"
                        onClick={() => onInspect(r)}
                        className="px-2.5 py-1 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded cursor-pointer md:flex-1 md:py-1.5 md:px-3"
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(r.photoId)}
                        title={`Delete ${r.photoId}`}
                        className="p-1.5 text-slate-400 hover:text-red-700 border border-slate-200 rounded cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3 w-10">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label="Select all visible coins"
                      className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Photo ID</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Series · Date-Mint</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Variety / VAM</th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-right">Conf %</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Grade (Map)</th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-right">Lookup Base</th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-right">Guide Mid</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Decision</th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-right">Final Val</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Status · Key</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Value Check</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Guardrail</th>
                  <th className="py-2.5 px-3 whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => {
                  const isSelected = selectedIds.has(r.photoId);
                  const itemProgress = autoGradeProgress[r.photoId];
                  return (
                    <tr
                      key={r.photoId}
                      className={`h-11 transition-colors ${
                        r.isBlocked
                          ? 'bg-red-50/70 hover:bg-red-50'
                          : isSelected
                            ? 'bg-slate-100/80 hover:bg-slate-100'
                            : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRowSelection(r.photoId)}
                          aria-label={`Select ${r.photoId}`}
                          className="h-4 w-4 rounded border-slate-300 text-[#1E3A5F] focus:ring-[#1E3A5F] cursor-pointer"
                        />
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded border border-slate-200 bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                            {r.imageDataUrl ? (
                              <img
                                src={r.imageDataUrl}
                                alt={r.filename}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <Coins className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-mono font-semibold text-slate-900">
                              {r.photoId}
                            </div>
                            <div
                              className="text-[11px] text-slate-500 truncate max-w-[130px]"
                              title={r.filename}
                            >
                              {r.filename}
                            </div>
                            {itemProgress && (
                              <div
                                className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold ${
                                  itemProgress.status === 'grading'
                                    ? 'text-[#1E3A5F]'
                                    : itemProgress.status === 'completed'
                                      ? 'text-emerald-700'
                                      : itemProgress.status === 'error'
                                        ? 'text-red-700'
                                        : itemProgress.status === 'skipped'
                                          ? 'text-amber-700'
                                          : 'text-slate-500'
                                }`}
                                title={itemProgress.detail}
                              >
                                {itemProgress.status === 'grading' ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : itemProgress.status === 'completed' ? (
                                  <CheckCircle2 className="w-3 h-3" />
                                ) : itemProgress.status === 'error' ? (
                                  <AlertCircle className="w-3 h-3" />
                                ) : itemProgress.status === 'skipped' ? (
                                  <ImageOff className="w-3 h-3" />
                                ) : (
                                  <Clock className="w-3 h-3" />
                                )}
                                <span>
                                  {itemProgress.status === 'grading'
                                    ? 'Grading...'
                                    : itemProgress.status === 'completed'
                                      ? 'Auto-graded'
                                      : itemProgress.status === 'error'
                                        ? 'Error'
                                        : itemProgress.status === 'skipped'
                                          ? 'No photo'
                                          : 'Queued'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="font-medium text-slate-900">
                          {r.dateMintKey || '—'}
                        </div>
                        <div className="text-[11px] text-slate-500">{r.proposedSeries}</div>
                      </td>
                      <td className="py-2 px-3 max-w-[180px]">
                        <div className="truncate text-slate-800" title={r.proposedVariety}>
                          {r.proposedVariety || '—'}
                        </div>
                        {r.datasetSourceQuality && (
                          <div className="text-[11px] text-slate-500">
                            Src: {r.datasetSourceQuality}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-right font-mono tabular-nums">
                        <div className="text-slate-900">
                          {r.confidencePct === '' ? '—' : `${r.confidencePct}%`}
                        </div>
                        <div
                          className={`text-[11px] font-sans font-semibold ${
                            r.confidenceFlag === 'WARNING'
                              ? 'text-amber-700'
                              : r.confidenceFlag === 'OK'
                                ? 'text-emerald-700'
                                : 'text-slate-400'
                          }`}
                        >
                          {r.confidenceFlag || 'Blank'}
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap font-mono">
                        <span className="text-slate-900">{r.suggestedGrade || '—'}</span>
                        {r.datasetGrade && (
                          <span className="text-slate-500"> ({r.datasetGrade})</span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-800">
                        {fmtUsd(r.lookupValue)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-800">
                        {fmtUsd(r.guideValueMid)}
                      </td>
                      <td className="py-2 px-3 max-w-[170px]">
                        <div className="font-medium text-slate-900">
                          {r.userAction || 'Pending'}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate" title={r.finalId}>
                          {r.finalId || '—'}
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-right font-mono tabular-nums font-semibold text-slate-900">
                        {fmtUsd(r.finalValue)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            r.status === 'Flagged'
                              ? 'text-amber-700'
                              : r.status === 'Reviewed'
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {r.status || 'Pending'}
                        </span>
                        {r.isKeyDate === 'Yes' && (
                          <span className="text-amber-700 font-semibold"> · Key Date</span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span
                          className={
                            r.valueCheck === 'Below base - verify'
                              ? 'text-amber-700 font-semibold'
                              : r.valueCheck === 'OK'
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                          }
                        >
                          {r.valueCheck || '—'}
                        </span>
                      </td>
                      <td className="py-2 px-3 max-w-[200px]">
                        <span
                          className={`font-semibold ${
                            r.isBlocked
                              ? 'text-red-700'
                              : r.guardrailCheck === 'OK'
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {r.guardrailCheck || 'Pending'}
                        </span>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onInspect(r)}
                            className="px-2.5 py-1 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded cursor-pointer"
                          >
                            Review
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(r.photoId)}
                            title={`Delete ${r.photoId}`}
                            className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <BulkEditMetadataModal
        open={bulkEditOpen}
        selectedRows={selectedRows}
        settings={settings}
        onClose={() => setBulkEditOpen(false)}
        onApply={async (patch) => {
          await onBulkEditMetadata(
            selectedRows.map((r) => r.photoId),
            patch,
          );
          setSelectedIds(new Set());
        }}
      />
    </div>
  );
};
