"use client";
// ── รายการในคลังความรู้ (grid) — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import { KnowledgeItem, TYPE_META, fmtDate } from './knowledge-types';

interface KnowledgeListProps {
  loading: boolean;
  filtered: KnowledgeItem[];
  selected: KnowledgeItem | null;
  openItem: (item: KnowledgeItem) => void;
  deleteItem: (item: KnowledgeItem) => void;
}

export default function KnowledgeList({ loading, filtered, selected, openItem, deleteItem }: KnowledgeListProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <>
      {loading ? (
        <div className="text-gray-500 text-sm text-center py-10">{t('knowledge.list.loading', 'กำลังโหลดคลังความรู้...')}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-10 text-center space-y-2">
          <div className="mx-auto"><Icon name="knowledge" size={40} className="text-gray-600" /></div>
          <div className="text-gray-400 text-sm">{t('knowledge.list.empty', 'ยังไม่มีข้อมูลในคลังความรู้')}</div>
          <div className="text-gray-600 text-xs">
            {t('knowledge.list.emptyHint1', 'เก็บได้ทั้ง ลิงก์เว็บ คลิปวิดีโอ ไฟล์ PDF/TXT บันทึกส่วนตัว — กด "เพิ่มข้อมูล" เพื่อเริ่ม')}
            <br />{t('knowledge.list.emptyHint2', 'ข้อมูลที่รวบรวมไว้จะใช้ค้นหา (semantic search) และเป็นฐานความรู้สำหรับ AI ต่าง ๆ ในอนาคต (เช่น AI สอนลูก)')}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((item) => {
            const meta = TYPE_META[item.type];
            return (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className={`text-left bg-gray-900 border rounded-xl p-4 space-y-2 transition hover:border-gray-500 ${selected?.id === item.id ? 'border-emerald-500' : 'border-gray-700'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl"><Icon name={meta.icon} size={20} /></span>
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-gray-100 truncate">{item.title}</div>
                      {item.url && <div className="text-[10px] text-sky-400 truncate">{item.url}</div>}
                    </div>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${meta.color}`}>{t(`knowledge.type.${item.type}`, meta.label)}</span>
                </div>
                {item.preview && <div className="text-xs text-gray-500 line-clamp-2">{item.preview}</div>}
                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">#{tag}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] text-gray-600">
                  <span>{fmtDate(item.created_at)}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); deleteItem(item); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); deleteItem(item); } }}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Icon name="trash" size={14} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
