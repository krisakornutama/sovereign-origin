"use client";
// ── ผลการค้นหา — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';

interface SearchResultsPanelProps {
  searchResults: any[];
  setSearchResults: Dispatch<SetStateAction<any[] | null>>;
  openSearchResult: (r: any) => void;
}

export default function SearchResultsPanel({ searchResults, setSearchResults, openSearchResult }: SearchResultsPanelProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card panel-cyan p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 glow-text-cyan">{t('knowledge.results.title', 'ผลการค้นหา ({n})', { n: searchResults.length })}</h3>
        <button onClick={() => setSearchResults(null)} className="text-xs text-gray-500 hover:text-gray-300">{t('knowledge.results.close', '✕ ปิด')}</button>
      </div>
      {searchResults.length === 0 ? (
        <div className="text-gray-500 text-sm">{t('knowledge.results.empty', 'ไม่พบข้อมูลที่เกี่ยวข้อง')}</div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {searchResults.map((r, i) => (
            <div key={i} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
              <div className="flex items-center justify-between mb-1 text-[10px] text-gray-500">
                <span>{r.source === 'semantic' ? 'semantic' : 'keyword'} · {r.file} · {t('knowledge.results.score', 'ความใกล้เคียง {n}', { n: r.score })}</span>
                <button onClick={() => openSearchResult(r)} className="text-sky-400 hover:underline">{t('knowledge.results.open', 'เปิด')}</button>
              </div>
              <p className="text-xs text-gray-300 whitespace-pre-wrap line-clamp-4">{r.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
