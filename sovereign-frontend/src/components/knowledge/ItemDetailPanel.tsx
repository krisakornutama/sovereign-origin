"use client";
// ── ตัวแสดงผลละเอียดของรายการที่เลือก — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { Dispatch, SetStateAction } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import { KnowledgeItem, TYPE_META, fmtDate } from './knowledge-types';

interface ItemDetailPanelProps {
  selected: KnowledgeItem;
  embed: string | null;
  setSelected: Dispatch<SetStateAction<KnowledgeItem | null>>;
}

export default function ItemDetailPanel({ selected, embed, setSelected }: ItemDetailPanelProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card panel-cyan p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-gray-500 flex items-center gap-1.5"><Icon name={TYPE_META[selected.type].icon} size={14} /> {t(`knowledge.type.${selected.type}`, TYPE_META[selected.type].label)} · {fmtDate(selected.created_at)}</div>
          <h2 className="text-lg font-bold text-gray-100 glow-text-cyan mt-0.5">{selected.title}</h2>
          {selected.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {selected.tags.map((tag) => <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">#{tag}</span>)}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {selected.url && (
            <a href={selected.url} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded">{t('knowledge.detail.openSource', 'เปิดต้นทาง')}</a>
          )}
          <button onClick={() => setSelected(null)} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">{t('knowledge.detail.close', '✕ ปิด')}</button>
        </div>
      </div>

      {/* วิดีโอ */}
      {selected.type === 'VIDEO' && embed && (
        <div className="aspect-video bg-black rounded-lg overflow-hidden">
          <iframe src={embed} className="w-full h-full" allowFullScreen title={selected.title} />
        </div>
      )}
      {selected.type === 'VIDEO' && !embed && (
        <div className="text-sm text-amber-300 bg-amber-500/15 border border-amber-500/40 rounded p-3">
          {t('knowledge.detail.videoUnknown', 'ไม่รู้จักรูปแบบวิดีโอนี้ (รองรับ YouTube / Vimeo) — เปิดลิงก์ต้นทางแทน')}
        </div>
      )}

      {/* PDF */}
      {selected.type === 'PDF' && selected.file_path && (
        <div className="bg-black rounded-lg overflow-hidden" style={{ height: '480px' }}>
          <iframe
            src={`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/uploads/${encodeURIComponent(selected.file_path.split('/').pop() || '')}`}
            className="w-full h-full"
            title={selected.title}
          />
        </div>
      )}

      {/* เนื้อหา */}
      {selected.content && selected.type !== 'PDF' && (
        <pre className="text-xs text-gray-300 bg-gray-950/60 border border-cyan-800/50 rounded-lg p-3 max-h-96 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
          {selected.content}
        </pre>
      )}
      {selected.type === 'PDF' && !selected.content && (
        <div className="text-xs text-gray-500">{t('knowledge.detail.noPdfText', 'ไม่มีข้อความที่สกัดได้ (อาจเป็นภาพสแกน) — เปิดไฟล์ PDF ด้านบนดูเอง หรือเพิ่มบันทึก')}</div>
      )}

      {selected.notes && (
        <div className="text-xs text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-3">
          {selected.notes}
        </div>
      )}
    </div>
  );
}
