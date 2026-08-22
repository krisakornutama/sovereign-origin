"use client";
// ── แผงกรองตามประเภท — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import { ItemType, KnowledgeItem, TYPE_META, TYPE_ORDER } from './knowledge-types';

interface TypeFilterPanelProps {
  typeFilter: ItemType | 'ALL';
  setTypeFilter: Dispatch<SetStateAction<ItemType | 'ALL'>>;
  items: KnowledgeItem[];
}

export default function TypeFilterPanel({ typeFilter, setTypeFilter, items }: TypeFilterPanelProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5"><Icon name="filter" size={14} className="text-gray-400" />{t('knowledge.filter.title', 'ประเภท')}</h3>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setTypeFilter('ALL')}
          className={`text-[11px] px-2 py-1 rounded-full border ${typeFilter === 'ALL' ? 'bg-emerald-600 border-emerald-600 text-white shadow-neon-green' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}
        >
          {t('knowledge.filter.all', 'ทั้งหมด ({n})', { n: items.length })}
        </button>
        {TYPE_ORDER.map((tt) => {
          const n = items.filter((i) => i.type === tt).length;
          return (
            <button
              key={tt}
              onClick={() => setTypeFilter(typeFilter === tt ? 'ALL' : tt)}
              className={`text-[11px] px-2 py-1 rounded-full border ${typeFilter === tt ? 'bg-emerald-600 border-emerald-600 text-white shadow-neon-green' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}
            >
              <span className="inline-flex items-center gap-1"><Icon name={TYPE_META[tt].icon} size={12} />{t(`knowledge.type.${tt}`, TYPE_META[tt].label)} ({n})</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
