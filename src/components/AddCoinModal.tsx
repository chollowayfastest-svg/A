import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles, Upload, X } from 'lucide-react';
import { BulkPhotoUploadPanel } from './BulkPhotoUploadPanel';
import type { BatchRawInput, CoinSeries, DatasetGrade } from '../shared/types';

interface AddCoinModalProps {
  open: boolean;
  initialMode?: 'single' | 'bulk';
  onClose: () => void;
  onSubmit: (payload: Partial<BatchRawInput>) => Promise<void>;
  onBulkSubmit: (items: Array<Partial<BatchRawInput>>) => Promise<void>;
}

export const AddCoinModal: React.FC<AddCoinModalProps> = ({
  open,
  initialMode = 'single',
  onClose,
  onSubmit,
  onBulkSubmit,
}) => {
  const [mode, setMode] = useState<'single' | 'bulk'>(initialMode);
  const [photoId, setPhotoId] = useState('');
  const [filename, setFilename] = useState('');
  const [proposedSeries, setProposedSeries] = useState<CoinSeries>('Classic Morgan');
  const [coinYear, setCoinYear] = useState('');
  const [coinMint, setCoinMint] = useState('');
  const [proposedVariety, setProposedVariety] = useState('');
  const [confidencePct, setConfidencePct] = useState('');
  const [suggestedGrade, setSuggestedGrade] = useState('');
  const [datasetGrade, setDatasetGrade] = useState<DatasetGrade>('');
  const [guideLow, setGuideLow] = useState('');
  const [guideHigh, setGuideHigh] = useState('');
  const [diagnosticNotes, setDiagnosticNotes] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | undefined>(undefined);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
    }
  }, [open, initialMode]);

  if (!open) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setImageMime(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyzeWithGemini = async () => {
    if (!imageDataUrl) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch('/api/analyze-coin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageDataUrl,
          mimeType: imageMime,
          filename,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Analysis failed');
      }
      const p = data.proposal || {};
      if (p.proposedSeries) setProposedSeries(p.proposedSeries);
      if (p.coinYear) setCoinYear(String(p.coinYear));
      if (p.coinMint) setCoinMint(String(p.coinMint));
      if (p.proposedVariety) setProposedVariety(String(p.proposedVariety));
      if (p.confidencePct !== undefined) setConfidencePct(String(p.confidencePct));
      if (p.suggestedGrade) setSuggestedGrade(String(p.suggestedGrade));
      if (p.guideLow !== undefined) setGuideLow(String(p.guideLow));
      if (p.guideHigh !== undefined) setGuideHigh(String(p.guideHigh));
      if (p.diagnosticNotes) setDiagnosticNotes(String(p.diagnosticNotes));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to analyze coin image');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        photoId: photoId.trim(),
        filename: filename.trim(),
        proposedSeries,
        coinYear: coinYear.trim() === '' ? '' : Number(coinYear),
        coinMint: coinMint.trim(),
        proposedVariety: proposedVariety.trim(),
        confidencePct: confidencePct.trim() === '' ? '' : Number(confidencePct),
        suggestedGrade: suggestedGrade.trim(),
        datasetGrade,
        guideLow: guideLow.trim() === '' ? '' : Number(guideLow),
        guideHigh: guideHigh.trim() === '' ? '' : Number(guideHigh),
        diagnosticNotes: diagnosticNotes.trim(),
        imageDataUrl,
      });
      setPhotoId('');
      setFilename('');
      setCoinYear('');
      setCoinMint('');
      setProposedVariety('');
      setConfidencePct('');
      setSuggestedGrade('');
      setDatasetGrade('');
      setGuideLow('');
      setGuideHigh('');
      setDiagnosticNotes('');
      setImageDataUrl(undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-coin-title"
    >
      <div
        className={`bg-white border border-slate-200 rounded-lg w-full max-h-[92vh] overflow-y-auto shadow-xl ${
          mode === 'bulk' ? 'max-w-5xl' : 'max-w-3xl'
        }`}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 sticky top-0 bg-white z-10">
          <div>
            <h2 id="add-coin-title" className="text-lg font-semibold text-slate-900">
              {mode === 'bulk'
                ? 'Bulk Coin Photo Upload'
                : 'Add Coin Photo or Manual Record'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Advisory proposal only (Rule R7): new records always enter the Review Queue pending human confirmation.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'single'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Single Coin
              </button>
              <button
                type="button"
                onClick={() => setMode('bulk')}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'bulk'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Bulk Photos
              </button>
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
        </div>

        {mode === 'bulk' ? (
          <BulkPhotoUploadPanel onBulkSubmit={onBulkSubmit} onClose={onClose} />
        ) : (
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="border border-red-200 bg-red-50 rounded-md px-4 py-2.5 text-sm text-red-900">
              {error}
            </div>
          )}

          {/* Optional Photo Upload + Gemini Vision Proposal */}
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/60 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Coin Photograph (Optional)
                </p>
                <p className="text-xs text-slate-600">
                  Attach a coin image to generate an advisory Gemini Vision preliminary attribution, or fill metadata manually below.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="px-3 py-2 text-xs font-semibold text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  Choose Image
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>

                {imageDataUrl && (
                  <button
                    type="button"
                    onClick={handleAnalyzeWithGemini}
                    disabled={analyzing}
                    className="px-3 py-2 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md inline-flex items-center gap-1.5 disabled:opacity-60 whitespace-nowrap cursor-pointer"
                  >
                    {analyzing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Propose with Gemini Vision
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {imageDataUrl && (
              <div className="flex items-center gap-4 pt-2">
                <img
                  src={imageDataUrl}
                  alt="Coin upload preview"
                  referrerPolicy="no-referrer"
                  className="h-20 w-20 object-cover rounded border border-slate-200 bg-white"
                />
                <div className="text-xs text-slate-600">
                  <div className="font-medium text-slate-900">{filename}</div>
                  <div>Ready for optional preliminary proposal or direct intake.</div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Photo_ID (Blank = Auto)
              </label>
              <input
                type="text"
                value={photoId}
                onChange={(e) => setPhotoId(e.target.value)}
                placeholder="e.g. PH015"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Filename
              </label>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="coin_obv_rev.jpg"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Proposed_Series
              </label>
              <select
                value={proposedSeries}
                onChange={(e) => setProposedSeries(e.target.value as CoinSeries)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              >
                <option value="Classic Morgan">Classic Morgan</option>
                <option value="2021+ Morgan">2021+ Morgan</option>
                <option value="Peace">Peace</option>
                <option value="American Silver Eagle">American Silver Eagle</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Coin_Year
              </label>
              <input
                type="number"
                value={coinYear}
                onChange={(e) => setCoinYear(e.target.value)}
                placeholder="1893"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Coin_Mint (Code or Name)
              </label>
              <input
                type="text"
                value={coinMint}
                onChange={(e) => setCoinMint(e.target.value)}
                placeholder="P, O, S, CC, D, Philadelphia..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Confidence % (0–100)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={confidencePct}
                onChange={(e) => setConfidencePct(e.target.value)}
                placeholder="82"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Suggested_Grade
              </label>
              <input
                type="text"
                value={suggestedGrade}
                onChange={(e) => setSuggestedGrade(e.target.value)}
                placeholder="MS63, F12, G4..."
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Dataset_Grade (Auto-maps if blank)
              </label>
              <select
                value={datasetGrade}
                onChange={(e) => setDatasetGrade(e.target.value as DatasetGrade)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              >
                <option value="">Auto-map from Suggested</option>
                <option value="G-4">G-4</option>
                <option value="F-12">F-12</option>
                <option value="MS-60">MS-60</option>
                <option value="MS-63">MS-63</option>
                <option value="MS-65">MS-65</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Proposed_Variety / VAM
              </label>
              <input
                type="text"
                value={proposedVariety}
                onChange={(e) => setProposedVariety(e.target.value)}
                placeholder="e.g. Hot Lips VAM-4"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Guide_Value_Low (USD)
              </label>
              <input
                type="number"
                value={guideLow}
                onChange={(e) => setGuideLow(e.target.value)}
                placeholder="150"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Guide_Value_High (USD)
              </label>
              <input
                type="number"
                value={guideHigh}
                onChange={(e) => setGuideHigh(e.target.value)}
                placeholder="300"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Initial Diagnostic_Notes
            </label>
            <textarea
              rows={2}
              value={diagnosticNotes}
              onChange={(e) => setDiagnosticNotes(e.target.value)}
              placeholder="Preliminary notes..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md disabled:opacity-60 cursor-pointer"
            >
              {saving ? 'Adding...' : 'Add to Batch Log'}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};
