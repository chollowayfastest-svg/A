import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Sparkles,
  Square,
  Table2,
  Trash2,
} from 'lucide-react';
import {
  downloadDriveImageAsDataUrl,
  openGooglePicker,
} from '../lib/googleWorkspace';
import type { BatchRawInput, CoinSeries } from '../shared/types';

interface StagedPhotoItem {
  localId: string;
  filename: string;
  mimeType: string;
  imageDataUrl: string;
  proposedSeries: CoinSeries;
  coinYear: string;
  coinMint: string;
  proposedVariety: string;
  confidencePct: string;
  suggestedGrade: string;
  guideLow: string;
  guideHigh: string;
  diagnosticNotes: string;
  aiStatus: 'staged' | 'analyzing' | 'proposed' | 'error';
  aiError?: string;
}

interface BulkPhotoUploadPanelProps {
  onBulkSubmit: (items: Array<Partial<BatchRawInput>>) => Promise<void>;
  onClose: () => void;
  accessToken?: string | null;
  onEnsureGoogleToken?: () => Promise<string | null>;
}

async function readAndCompressImage(
  file: File,
): Promise<{ dataUrl: string; mimeType: string }> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Unable to read image file'));
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  // Keep small files (< 550 KB) intact; resize oversized camera photos cleanly
  if (file.size <= 550 * 1024) {
    return { dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1280;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ dataUrl: compressed, mimeType: 'image/jpeg' });
    };
    img.onerror = () => {
      resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
    };
    img.src = rawDataUrl;
  });
}

export const BulkPhotoUploadPanel: React.FC<BulkPhotoUploadPanelProps> = ({
  onBulkSubmit,
  onClose,
  accessToken,
  onEnsureGoogleToken,
}) => {
  const [staged, setStaged] = useState<StagedPhotoItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pickingDrive, setPickingDrive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [error, setError] = useState<string | null>(null);
  const cancelAnalysisRef = useRef(false);

  const handlePickFromDrive = async () => {
    setError(null);
    setPickingDrive(true);
    try {
      const token = accessToken || (onEnsureGoogleToken ? await onEnsureGoogleToken() : null);
      if (!token) {
        setPickingDrive(false);
        return;
      }
      const picked = await openGooglePicker({
        accessToken: token,
        mode: 'images',
        multiselect: true,
        title: 'Pick Coin Photographs from Google Drive',
      });
      if (picked.length === 0) return;

      const imported: StagedPhotoItem[] = [];
      for (const file of picked) {
        const { dataUrl, mimeType } = await downloadDriveImageAsDataUrl(
          token,
          file.id,
          file.mimeType,
        );
        imported.push({
          localId: `${file.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          filename: file.name,
          mimeType,
          imageDataUrl: dataUrl,
          proposedSeries: 'Classic Morgan',
          coinYear: '',
          coinMint: '',
          proposedVariety: '',
          confidencePct: '',
          suggestedGrade: '',
          guideLow: '',
          guideHigh: '',
          diagnosticNotes: `Imported from Google Drive (${file.id})`,
          aiStatus: 'staged',
        });
      }
      if (imported.length > 0) {
        setStaged((prev) => [...prev, ...imported]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to import photos from Google Drive.',
      );
    } finally {
      setPickingDrive(false);
    }
  };

  const stageFiles = async (fileList: FileList | File[]) => {
    setError(null);
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) {
      setError('Please select valid image files (.jpg, .png, .webp).');
      return;
    }

    const prepared: StagedPhotoItem[] = [];
    for (const file of files) {
      try {
        const { dataUrl, mimeType } = await readAndCompressImage(file);
        prepared.push({
          localId: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          filename: file.name,
          mimeType,
          imageDataUrl: dataUrl,
          proposedSeries: 'Classic Morgan',
          coinYear: '',
          coinMint: '',
          proposedVariety: '',
          confidencePct: '',
          suggestedGrade: '',
          guideLow: '',
          guideHigh: '',
          diagnosticNotes: '',
          aiStatus: 'staged',
        });
      } catch {
        setError(`Skipped unreadable file: ${file.name}`);
      }
    }

    if (prepared.length > 0) {
      setStaged((prev) => [...prev, ...prepared]);
    }
  };

  const updateItem = (localId: string, patch: Partial<StagedPhotoItem>) => {
    setStaged((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    );
  };

  const removeItem = (localId: string) => {
    setStaged((prev) => prev.filter((item) => item.localId !== localId));
  };

  const handleAnalyzeAll = async () => {
    const targets = staged.filter((item) => item.aiStatus !== 'proposed');
    if (targets.length === 0) return;

    cancelAnalysisRef.current = false;
    setAnalyzing(true);
    setError(null);
    setAnalyzeProgress({ done: 0, total: targets.length });

    let completed = 0;
    for (const target of targets) {
      if (cancelAnalysisRef.current) break;

      updateItem(target.localId, { aiStatus: 'analyzing', aiError: undefined });
      try {
        const res = await fetch('/api/analyze-coin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: target.imageDataUrl,
            mimeType: target.mimeType,
            filename: target.filename,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Gemini Vision request failed');
        }
        const p = data.proposal || {};
        const validSeries: CoinSeries[] = [
          'Classic Morgan',
          '2021+ Morgan',
          'Peace',
          'American Silver Eagle',
          'Other',
        ];
        const nextSeries = validSeries.includes(p.proposedSeries)
          ? (p.proposedSeries as CoinSeries)
          : target.proposedSeries;

        updateItem(target.localId, {
          proposedSeries: nextSeries,
          coinYear: p.coinYear ? String(p.coinYear) : target.coinYear,
          coinMint: p.coinMint ? String(p.coinMint) : target.coinMint,
          proposedVariety: p.proposedVariety
            ? String(p.proposedVariety)
            : target.proposedVariety,
          confidencePct:
            p.confidencePct !== undefined
              ? String(p.confidencePct)
              : target.confidencePct,
          suggestedGrade: p.suggestedGrade
            ? String(p.suggestedGrade)
            : target.suggestedGrade,
          guideLow: p.guideLow !== undefined ? String(p.guideLow) : target.guideLow,
          guideHigh: p.guideHigh !== undefined ? String(p.guideHigh) : target.guideHigh,
          diagnosticNotes: p.diagnosticNotes
            ? String(p.diagnosticNotes)
            : target.diagnosticNotes,
          aiStatus: 'proposed',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Analysis failed';
        updateItem(target.localId, { aiStatus: 'error', aiError: msg });
        setError(msg);
      }

      completed += 1;
      setAnalyzeProgress({ done: completed, total: targets.length });
    }

    setAnalyzing(false);
  };

  const handleStopAnalysis = () => {
    cancelAnalysisRef.current = true;
  };

  const handleCommitBatch = async () => {
    if (staged.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const items: Array<Partial<BatchRawInput>> = staged.map((s) => ({
        filename: s.filename,
        proposedSeries: s.proposedSeries,
        coinYear: s.coinYear.trim() === '' ? '' : Number(s.coinYear),
        coinMint: s.coinMint.trim(),
        proposedVariety: s.proposedVariety.trim(),
        confidencePct: s.confidencePct.trim() === '' ? '' : Number(s.confidencePct),
        suggestedGrade: s.suggestedGrade.trim(),
        guideLow: s.guideLow.trim() === '' ? '' : Number(s.guideLow),
        guideHigh: s.guideHigh.trim() === '' ? '' : Number(s.guideHigh),
        diagnosticNotes: s.diagnosticNotes.trim(),
        imageDataUrl: s.imageDataUrl,
      }));
      await onBulkSubmit(items);
      setStaged([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo batch');
    } finally {
      setSubmitting(false);
    }
  };

  const unanalyzedCount = staged.filter((s) => s.aiStatus !== 'proposed').length;

  return (
    <div className="p-6 space-y-5">
      {error && (
        <div className="border border-red-200 bg-red-50 rounded-md px-4 py-2.5 text-xs text-red-900 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-700" />
          <span>{error}</span>
        </div>
      )}

      {/* Drag & Drop + Multi-File Input */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) {
            stageFiles(e.dataTransfer.files);
          }
        }}
        className={`block border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
          dragging
            ? 'border-[#1E3A5F] bg-slate-100'
            : 'border-slate-300 bg-slate-50/70 hover:bg-slate-50'
        }`}
      >
        <ImagePlus className="w-7 h-7 text-[#1E3A5F] mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-900">
          Drop multiple coin photographs here, or click to browse
        </p>
        <p className="text-xs text-slate-500 mt-1">
          One Batch Log record per uploaded photo · All entries enter the Review Queue pending human confirmation (Rule R7)
        </p>
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) stageFiles(e.target.files);
            e.currentTarget.value = '';
          }}
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 rounded-md px-3.5 py-2.5 bg-white">
        <span className="text-xs text-slate-600">
          Or pick coin photographs stored in your Google Drive using Google Picker.
        </span>
        <button
          type="button"
          onClick={handlePickFromDrive}
          disabled={pickingDrive || analyzing || submitting}
          className="px-3 py-1.5 text-xs font-semibold text-[#1E3A5F] border border-[#1E3A5F]/35 bg-slate-50 hover:bg-slate-100 rounded-md inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap cursor-pointer"
        >
          {pickingDrive ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FolderOpen className="w-3.5 h-3.5" />
          )}
          {pickingDrive ? 'Importing from Drive...' : 'Pick Photos from Google Drive'}
        </button>
      </div>

      {/* Staged Action Toolbar */}
      {staged.length > 0 && (
        <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-medium text-slate-700">
              <span className="font-mono tabular-nums font-semibold text-slate-900">
                {staged.length}
              </span>{' '}
              {staged.length === 1 ? 'photo' : 'photos'} staged
              {analyzing && analyzeProgress && (
                <span className="text-[#1E3A5F] font-semibold">
                  {' '}
                  · Analyzing {analyzeProgress.done + 1 <= analyzeProgress.total ? analyzeProgress.done + 1 : analyzeProgress.total} of{' '}
                  {analyzeProgress.total}...
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-200/70 rounded-md">
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
              </div>

              {analyzing ? (
                <button
                  type="button"
                  onClick={handleStopAnalysis}
                  className="px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Square className="w-3 h-3" />
                  Stop Analysis
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleAnalyzeAll}
                  disabled={unanalyzedCount === 0 || submitting}
                  className="px-3 py-1.5 text-xs font-semibold text-[#1E3A5F] border border-[#1E3A5F]/30 bg-white hover:bg-slate-100 rounded-md inline-flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Analyze Staged with Gemini ({unanalyzedCount})
                </button>
              )}

              <button
                type="button"
                onClick={() => setStaged([])}
                disabled={analyzing || submitting}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-300 bg-white hover:bg-slate-50 rounded-md disabled:opacity-45 whitespace-nowrap cursor-pointer"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Staged Photos Grid or Table */}
          {viewMode === 'grid' ? (
            <div className="p-4 max-h-[420px] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {staged.map((item) => (
                <div
                  key={item.localId}
                  className="border border-slate-200 rounded-lg bg-white overflow-hidden flex flex-col"
                >
                  <div className="aspect-[4/3] bg-slate-100 border-b border-slate-200 flex items-center justify-center overflow-hidden">
                    <img
                      src={item.imageDataUrl}
                      alt={item.filename}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  </div>

                  <div className="p-3 space-y-2.5 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          className="text-xs font-semibold text-slate-900 truncate"
                          title={item.filename}
                        >
                          {item.filename}
                        </p>
                        <div className="text-[11px] mt-0.5">
                          {item.aiStatus === 'analyzing' ? (
                            <span className="inline-flex items-center gap-1 text-[#1E3A5F] font-semibold">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Analyzing...
                            </span>
                          ) : item.aiStatus === 'proposed' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="w-3 h-3" />
                              AI Proposed
                            </span>
                          ) : item.aiStatus === 'error' ? (
                            <span className="text-red-700 font-semibold" title={item.aiError}>
                              Error
                            </span>
                          ) : (
                            <span className="text-slate-500">Staged · Ready</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeItem(item.localId)}
                        disabled={analyzing || submitting}
                        className="p-1 text-slate-400 hover:text-red-700 disabled:opacity-45 cursor-pointer shrink-0"
                        title={`Remove ${item.filename}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="col-span-2">
                        <select
                          value={item.proposedSeries}
                          onChange={(e) =>
                            updateItem(item.localId, {
                              proposedSeries: e.target.value as CoinSeries,
                            })
                          }
                          aria-label="Series"
                          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                        >
                          <option value="Classic Morgan">Classic Morgan</option>
                          <option value="2021+ Morgan">2021+ Morgan</option>
                          <option value="Peace">Peace</option>
                          <option value="American Silver Eagle">American Silver Eagle</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      <input
                        type="number"
                        value={item.coinYear}
                        onChange={(e) =>
                          updateItem(item.localId, { coinYear: e.target.value })
                        }
                        placeholder="Year (1893)"
                        className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded"
                      />

                      <input
                        type="text"
                        value={item.coinMint}
                        onChange={(e) =>
                          updateItem(item.localId, { coinMint: e.target.value })
                        }
                        placeholder="Mint (P, O, CC)"
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded"
                      />

                      <input
                        type="text"
                        value={item.proposedVariety}
                        onChange={(e) =>
                          updateItem(item.localId, { proposedVariety: e.target.value })
                        }
                        placeholder="Variety / VAM"
                        className="col-span-2 w-full px-2 py-1 text-xs border border-slate-300 rounded"
                      />

                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={item.confidencePct}
                        onChange={(e) =>
                          updateItem(item.localId, { confidencePct: e.target.value })
                        }
                        placeholder="Conf %"
                        className="w-full px-2 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded"
                      />

                      <input
                        type="text"
                        value={item.suggestedGrade}
                        onChange={(e) =>
                          updateItem(item.localId, { suggestedGrade: e.target.value })
                        }
                        placeholder="Grade (MS63)"
                        className="w-full px-2 py-1 text-xs font-mono border border-slate-300 rounded"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <div className="overflow-x-auto max-h-[360px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold z-10">
                <tr>
                  <th className="py-2 px-3">Photo</th>
                  <th className="py-2 px-3">Series</th>
                  <th className="py-2 px-3 w-20">Year</th>
                  <th className="py-2 px-3 w-20">Mint</th>
                  <th className="py-2 px-3">Variety / VAM</th>
                  <th className="py-2 px-3 w-20">Conf %</th>
                  <th className="py-2 px-3 w-24">Grade</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 text-right">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staged.map((item) => (
                  <tr key={item.localId} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={item.imageDataUrl}
                          alt={item.filename}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded object-cover border border-slate-200 shrink-0 bg-white"
                        />
                        <span
                          className="font-medium text-slate-900 truncate max-w-[130px]"
                          title={item.filename}
                        >
                          {item.filename}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={item.proposedSeries}
                        onChange={(e) =>
                          updateItem(item.localId, {
                            proposedSeries: e.target.value as CoinSeries,
                          })
                        }
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                      >
                        <option value="Classic Morgan">Classic Morgan</option>
                        <option value="2021+ Morgan">2021+ Morgan</option>
                        <option value="Peace">Peace</option>
                        <option value="American Silver Eagle">American Silver Eagle</option>
                        <option value="Other">Other</option>
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={item.coinYear}
                        onChange={(e) =>
                          updateItem(item.localId, { coinYear: e.target.value })
                        }
                        placeholder="1893"
                        className="w-20 px-2 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={item.coinMint}
                        onChange={(e) =>
                          updateItem(item.localId, { coinMint: e.target.value })
                        }
                        placeholder="P, O, S..."
                        className="w-20 px-2 py-1 text-xs border border-slate-300 rounded"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={item.proposedVariety}
                        onChange={(e) =>
                          updateItem(item.localId, { proposedVariety: e.target.value })
                        }
                        placeholder="Optional variety"
                        className="w-32 px-2 py-1 text-xs border border-slate-300 rounded"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={item.confidencePct}
                        onChange={(e) =>
                          updateItem(item.localId, { confidencePct: e.target.value })
                        }
                        placeholder="—"
                        className="w-16 px-2 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={item.suggestedGrade}
                        onChange={(e) =>
                          updateItem(item.localId, { suggestedGrade: e.target.value })
                        }
                        placeholder="MS63"
                        className="w-20 px-2 py-1 text-xs font-mono border border-slate-300 rounded"
                      />
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {item.aiStatus === 'analyzing' ? (
                        <span className="inline-flex items-center gap-1 text-[#1E3A5F] font-semibold">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Analyzing
                        </span>
                      ) : item.aiStatus === 'proposed' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          AI Proposed
                        </span>
                      ) : item.aiStatus === 'error' ? (
                        <span
                          className="text-red-700 font-semibold"
                          title={item.aiError}
                        >
                          Error
                        </span>
                      ) : (
                        <span className="text-slate-500">Staged</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => removeItem(item.localId)}
                        disabled={analyzing || submitting}
                        className="p-1 text-slate-400 hover:text-red-700 disabled:opacity-45 cursor-pointer"
                        title={`Remove ${item.filename}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {/* Footer Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
        <span className="text-xs text-slate-500">
          {staged.length === 0
            ? 'Select one or more coin photos above to begin.'
            : 'All staged coins will receive sequential Photo_IDs and enter the Review Queue.'}
        </span>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCommitBatch}
            disabled={staged.length === 0 || analyzing || submitting}
            className="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting
              ? 'Uploading...'
              : `Add ${staged.length} ${staged.length === 1 ? 'Photo' : 'Photos'} to Batch Log`}
          </button>
        </div>
      </div>
    </div>
  );
};
