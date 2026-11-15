import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
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
  stageStatus: 'staged' | 'analyzing' | 'proposed' | 'error';
  stageError?: string;
}

interface BulkPhotoUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSubmitBulk: (items: Array<Partial<BatchRawInput>>) => Promise<void>;
}

async function readAndCompressImage(
  file: File,
): Promise<{ dataUrl: string; mimeType: string }> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to read image file'));
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  // Keep small images untouched; resize large camera photos to keep batch JSON snappy
  if (file.size <= 750_000) {
    return { dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale >= 1) {
        resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.85),
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () =>
      resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
    img.src = rawDataUrl;
  });
}

function inferHintsFromFilename(filename: string): {
  year: string;
  mint: string;
} {
  const match = /(18\d{2}|19\d{2}|20\d{2})[-_ ]?(CC|P|O|S|D|W)?/i.exec(filename);
  if (!match) return { year: '', mint: '' };
  return {
    year: match[1] || '',
    mint: match[2] ? match[2].toUpperCase() : '',
  };
}

export const BulkPhotoUploadModal: React.FC<BulkPhotoUploadModalProps> = ({
  open,
  onClose,
  onSubmitBulk,
}) => {
  const [staged, setStaged] = useState<StagedPhotoItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const addFiles = async (fileList: FileList | File[]) => {
    setError(null);
    const files = Array.from(fileList).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length === 0) {
      setError('Please select one or more image files (JPG, PNG, WEBP).');
      return;
    }

    const prepared: StagedPhotoItem[] = [];
    for (const file of files) {
      const { dataUrl, mimeType } = await readAndCompressImage(file);
      const hints = inferHintsFromFilename(file.name);
      prepared.push({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name,
        mimeType,
        imageDataUrl: dataUrl,
        proposedSeries: 'Classic Morgan',
        coinYear: hints.year,
        coinMint: hints.mint,
        proposedVariety: '',
        confidencePct: '',
        suggestedGrade: '',
        guideLow: '',
        guideHigh: '',
        diagnosticNotes: '',
        stageStatus: 'staged',
      });
    }

    setStaged((prev) => [...prev, ...prepared]);
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
    if (staged.length === 0) return;
    setAnalyzingAll(true);
    setError(null);

    const targets = staged.filter((s) => s.stageStatus !== 'proposed');
    for (const item of targets) {
      updateItem(item.localId, { stageStatus: 'analyzing', stageError: undefined });
      try {
        const res = await fetch('/api/analyze-coin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: item.imageDataUrl,
            mimeType: item.mimeType,
            filename: item.filename,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Gemini analysis failed');
        }
        const p = data.proposal || {};
        updateItem(item.localId, {
          proposedSeries: (p.proposedSeries as CoinSeries) || item.proposedSeries,
          coinYear: p.coinYear ? String(p.coinYear) : item.coinYear,
          coinMint: p.coinMint ? String(p.coinMint) : item.coinMint,
          proposedVariety: p.proposedVariety ? String(p.proposedVariety) : item.proposedVariety,
          confidencePct:
            p.confidencePct !== undefined ? String(p.confidencePct) : item.confidencePct,
          suggestedGrade: p.suggestedGrade ? String(p.suggestedGrade) : item.suggestedGrade,
          guideLow: p.guideLow !== undefined ? String(p.guideLow) : item.guideLow,
          guideHigh: p.guideHigh !== undefined ? String(p.guideHigh) : item.guideHigh,
          diagnosticNotes: p.diagnosticNotes ? String(p.diagnosticNotes) : item.diagnosticNotes,
          stageStatus: 'proposed',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Analysis failed';
        updateItem(item.localId, { stageStatus: 'error', stageError: msg });
        if (msg.includes('GEMINI_API_KEY')) {
          setError(msg);
          break;
        }
      }
    }

    setAnalyzingAll(false);
  };

  const handleSubmit = async () => {
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
      await onSubmitBulk(items);
      setStaged([]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk photo upload failed');
    } finally {
      setSubmitting(false);
    }
  };

  const analyzedCount = staged.filter((s) => s.stageStatus === 'proposed').length;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-photo-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg max-w-5xl w-full max-h-[92vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div>
            <h2 id="bulk-photo-modal-title" className="text-lg font-semibold text-slate-900">
              Bulk Coin Photo Upload
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Drop or select multiple coin photographs. All entries enter the Review Queue with blank human decisions (Rule R7).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={analyzingAll || submitting}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 disabled:opacity-45 cursor-pointer"
            aria-label="Close bulk photo upload"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {error && (
            <div className="border border-red-200 bg-red-50 rounded-md px-4 py-2.5 text-sm text-red-900">
              {error}
            </div>
          )}

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files?.length) {
                addFiles(e.dataTransfer.files);
              }
            }}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive
                ? 'border-[#1E3A5F] bg-slate-50'
                : 'border-slate-300 bg-slate-50/50 hover:bg-slate-50'
            }`}
          >
            <ImagePlus className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-800">
              Drag and drop multiple coin photos here, or browse files
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Supports JPG, PNG, and WEBP. Year &amp; Mint hints (e.g. <code>1893-S.jpg</code>) are auto-detected from filenames.
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={analyzingAll || submitting}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-1.5 disabled:opacity-45 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Select Coin Photos
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.currentTarget.value = '';
                }}
              />
            </div>
          </div>

          {/* Staged Photos List */}
          {staged.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">
                  Staged Photos (
                  <span className="font-mono tabular-nums">{staged.length}</span>)
                  {analyzedCount > 0 && (
                    <span className="text-xs font-normal text-emerald-700 ml-2">
                      · {analyzedCount} AI-proposed
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAnalyzeAll}
                    disabled={analyzingAll || submitting}
                    className="px-3.5 py-1.5 text-xs font-semibold text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 disabled:opacity-45 whitespace-nowrap cursor-pointer"
                  >
                    {analyzingAll ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Analyzing Staged...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-[#1E3A5F]" />
                        Analyze All with Gemini Vision
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaged([])}
                    disabled={analyzingAll || submitting}
                    className="px-3 py-1.5 text-xs font-semibold text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 rounded-md disabled:opacity-45 cursor-pointer"
                  >
                    Clear Staged
                  </button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <th className="py-2 px-3">Photo</th>
                        <th className="py-2 px-3">Series</th>
                        <th className="py-2 px-3">Year</th>
                        <th className="py-2 px-3">Mint</th>
                        <th className="py-2 px-3">Variety / VAM</th>
                        <th className="py-2 px-3">Conf %</th>
                        <th className="py-2 px-3">Grade</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3 text-right">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {staged.map((item) => (
                        <tr key={item.localId} className="hover:bg-slate-50/60">
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2.5">
                              <img
                                src={item.imageDataUrl}
                                alt={item.filename}
                                referrerPolicy="no-referrer"
                                className="w-10 h-10 rounded object-cover border border-slate-200 shrink-0 bg-white"
                              />
                              <span
                                className="font-medium text-slate-800 truncate max-w-[140px]"
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
                              className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                            >
                              <option value="Classic Morgan">Classic Morgan</option>
                              <option value="2021+ Morgan">2021+ Morgan</option>
                              <option value="Peace">Peace</option>
                              <option value="American Silver Eagle">
                                American Silver Eagle
                              </option>
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
                              placeholder="1889"
                              className="w-16 px-2 py-1 border border-slate-300 rounded font-mono tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={item.coinMint}
                              onChange={(e) =>
                                updateItem(item.localId, { coinMint: e.target.value })
                              }
                              placeholder="CC"
                              className="w-14 px-2 py-1 border border-slate-300 rounded font-mono"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={item.proposedVariety}
                              onChange={(e) =>
                                updateItem(item.localId, {
                                  proposedVariety: e.target.value,
                                })
                              }
                              placeholder="Optional variety"
                              className="w-32 px-2 py-1 border border-slate-300 rounded"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={item.confidencePct}
                              onChange={(e) =>
                                updateItem(item.localId, {
                                  confidencePct: e.target.value,
                                })
                              }
                              placeholder="—"
                              className="w-14 px-2 py-1 border border-slate-300 rounded font-mono tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={item.suggestedGrade}
                              onChange={(e) =>
                                updateItem(item.localId, {
                                  suggestedGrade: e.target.value,
                                })
                              }
                              placeholder="MS63"
                              className="w-16 px-2 py-1 border border-slate-300 rounded font-mono"
                            />
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {item.stageStatus === 'analyzing' && (
                              <span className="inline-flex items-center gap-1 text-[#1E3A5F] font-semibold">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Analyzing
                              </span>
                            )}
                            {item.stageStatus === 'proposed' && (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                <CheckCircle2 className="w-3 h-3" />
                                AI Proposed
                              </span>
                            )}
                            {item.stageStatus === 'staged' && (
                              <span className="text-slate-500">Ready</span>
                            )}
                            {item.stageStatus === 'error' && (
                              <span
                                className="text-red-700 font-semibold"
                                title={item.stageError}
                              >
                                Error
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => removeItem(item.localId)}
                              disabled={analyzingAll || submitting}
                              className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"
                              aria-label={`Remove ${item.filename}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-slate-50 rounded-b-lg">
          <span className="text-xs text-slate-500">
            Photos enter Batch Log &amp; Review Queue as pending proposals.
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={analyzingAll || submitting}
              className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 bg-white rounded-md hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={staged.length === 0 || analyzingAll || submitting}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              {submitting
                ? 'Uploading...'
                : `Upload ${staged.length} ${staged.length === 1 ? 'Photo' : 'Photos'} to Batch Log`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
