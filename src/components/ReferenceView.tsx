import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { PriceDataRow, VarietyRow } from '../shared/types';

interface ReferenceViewProps {
  priceData: PriceDataRow[];
  varietyReference: VarietyRow[];
}

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US')}`;

export const ReferenceView: React.FC<ReferenceViewProps> = ({
  priceData,
  varietyReference,
}) => {
  const [priceSearch, setPriceSearch] = useState('');
  const [qualityFilter, setQualityFilter] = useState<string>('ALL');
  const [keyOnly, setKeyOnly] = useState<boolean>(false);
  const [varSearch, setVarSearch] = useState('');

  const filteredPrices = useMemo(() => {
    const q = priceSearch.trim().toLowerCase();
    return priceData.filter((r) => {
      if (qualityFilter !== 'ALL' && r.Source_Quality !== qualityFilter) return false;
      if (keyOnly && r.Key_Date !== 'Yes') return false;
      if (!q) return true;
      return (
        r.Lookup_Key.toLowerCase().includes(q) ||
        r.Mint_As_Given.toLowerCase().includes(q) ||
        String(r.Year).includes(q)
      );
    });
  }, [priceData, priceSearch, qualityFilter, keyOnly]);

  const filteredVarieties = useMemo(() => {
    const q = varSearch.trim().toLowerCase();
    return varietyReference.filter((v) => {
      if (!q) return true;
      return (
        v.Variety_ID.toLowerCase().includes(q) ||
        v.Date_Mint.toLowerCase().includes(q) ||
        v.Variety_Name.toLowerCase().includes(q) ||
        v.VAM_or_Code.toLowerCase().includes(q) ||
        v.Key_Diagnostics.toLowerCase().includes(q)
      );
    });
  }, [varietyReference, varSearch]);

  const counts = useMemo(() => {
    const orig = priceData.filter((r) => r.Source_Quality === 'Original').length;
    const corr = priceData.filter((r) => r.Source_Quality === 'Corrected').length;
    const est = priceData.filter((r) => r.Source_Quality === 'Estimated').length;
    return { orig, corr, est };
  }, [priceData]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* 95-Row Classic Morgan Price Data */}
      <div className="xl:col-span-7 border border-slate-200 bg-white rounded-lg overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              Classic Morgan Price Data (1878–1921)
            </h2>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {counts.orig} Original · {counts.corr} Corrected · {counts.est} Estimated ({priceData.length} total)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={priceSearch}
                onChange={(e) => setPriceSearch(e.target.value)}
                placeholder="Filter Date-Mint (e.g. 1893-S)..."
                className="pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md w-full focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            <select
              value={qualityFilter}
              onChange={(e) => setQualityFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            >
              <option value="ALL">All Source Quality ({priceData.length})</option>
              <option value="Original">Original ({counts.orig})</option>
              <option value="Corrected">Corrected ({counts.corr})</option>
              <option value="Estimated">Estimated ({counts.est})</option>
            </select>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700 px-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={keyOnly}
                onChange={(e) => setKeyOnly(e.target.checked)}
                className="rounded border-slate-300 text-[#1E3A5F]"
              />
              Key Dates only
            </label>
          </div>
        </div>

        <div className="overflow-auto max-h-[600px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold z-10">
              <tr>
                <th className="py-2.5 px-3 whitespace-nowrap">Lookup Key</th>
                <th className="py-2.5 px-3 whitespace-nowrap text-right">Mintage</th>
                <th className="py-2.5 px-3 whitespace-nowrap text-right">G-4</th>
                <th className="py-2.5 px-3 whitespace-nowrap text-right">F-12</th>
                <th className="py-2.5 px-3 whitespace-nowrap text-right">MS-60</th>
                <th className="py-2.5 px-3 whitespace-nowrap text-right">MS-63</th>
                <th className="py-2.5 px-3 whitespace-nowrap text-right">MS-65</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Key</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPrices.map((r) => (
                <tr key={r.Lookup_Key} className="h-9 hover:bg-slate-50">
                  <td className="py-1.5 px-3 whitespace-nowrap font-mono font-semibold text-slate-900">
                    {r.Lookup_Key}
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-600">
                    {r.Mintage.toLocaleString('en-US')}
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-800">
                    {fmtUsd(r['G-4'])}
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-800">
                    {fmtUsd(r['F-12'])}
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-800">
                    {fmtUsd(r['MS-60'])}
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-800">
                    {fmtUsd(r['MS-63'])}
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap text-right font-mono tabular-nums text-slate-800">
                    {fmtUsd(r['MS-65'])}
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap">
                    <span
                      className={
                        r.Key_Date === 'Yes'
                          ? 'font-semibold text-amber-700'
                          : 'text-slate-400'
                      }
                    >
                      {r.Key_Date}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap">
                    <span
                      className={
                        r.Source_Quality === 'Corrected'
                          ? 'font-semibold text-[#1E3A5F]'
                          : r.Source_Quality === 'Original'
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                      }
                    >
                      {r.Source_Quality}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 18-Row Variety Reference */}
      <div className="xl:col-span-5 border border-slate-200 bg-white rounded-lg overflow-hidden flex flex-col">
        <div className="p-5 border-b border-slate-200 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              Curated Variety &amp; Privy Reference
            </h2>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {varietyReference.length} entries
            </span>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={varSearch}
              onChange={(e) => setVarSearch(e.target.value)}
              placeholder="Search VAM, Privy, Date, or Diagnostic..."
              className="pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md w-full focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
          </div>
        </div>

        <div className="overflow-auto max-h-[600px] divide-y divide-slate-100">
          {filteredVarieties.map((v) => (
            <div key={v.Variety_ID} className="p-4 space-y-1.5 hover:bg-slate-50/70">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">
                  {v.Date_Mint} — {v.Variety_Name}
                </div>
                <div className="text-xs font-mono tabular-nums font-semibold text-[#1E3A5F] whitespace-nowrap">
                  {fmtUsd(v.Value_Low_USD)}–{fmtUsd(v.Value_High_USD)}
                </div>
              </div>
              <div className="text-xs text-slate-500">
                <span className="font-mono">{v.Variety_ID}</span> · {v.Series} · Code:{' '}
                <span className="font-mono text-slate-700">{v.VAM_or_Code}</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">{v.Key_Diagnostics}</p>
              {v.QC_Note && (
                <p className="text-xs text-amber-700 font-medium">QC Note: {v.QC_Note}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
