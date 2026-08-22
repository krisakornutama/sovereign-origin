"use client";
// ── แผงค้นหาความหมาย (AI) — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';

interface SemanticSearchPanelProps {
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  runSearch: () => void;
  searching: boolean;
  indexInfo: { files: number; chunks: number; model: string } | null;
  isSuperadmin: boolean;
  rebuildIndex: () => void;
}

export default function SemanticSearchPanel({ searchQuery, setSearchQuery, runSearch, searching, indexInfo, isSuperadmin, rebuildIndex }: SemanticSearchPanelProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="search" size={14} className="text-gray-400" />{t('knowledge.search.title', 'ค้นหาความหมาย (AI)')}</h3>
      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        placeholder={t('knowledge.search.ph', 'เช่น วิธีรับมือพายุเข้า...')}
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
      />
      <button onClick={runSearch} disabled={searching} className="w-full btn-primary py-1.5 text-sm">
        {searching ? t('knowledge.search.searching', 'ค้นหา...') : <><Icon name="search" size={14} /> {t('common.search', 'ค้นหา')}</>}
      </button>
      <div className="text-[10px] text-gray-600 leading-relaxed">
        {indexInfo
          ? t('knowledge.search.indexInfo', 'index: {chunks} chunks / {files} รายการ · model: {model}', { chunks: indexInfo.chunks, files: indexInfo.files, model: indexInfo.model })
          : t('knowledge.search.noIndex', 'ยังไม่ได้สร้าง index — ค้นหาจะใช้แบบ keyword')}
      </div>
      {isSuperadmin && (
        <button onClick={rebuildIndex} className="w-full px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-xs">
          {t('knowledge.search.rebuildIndex', 'สร้าง index ใหม่')}
        </button>
      )}
    </div>
  );
}
