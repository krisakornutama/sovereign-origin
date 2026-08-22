"use client";
// ── แผง "เพิ่มข้อมูลใหม่" (manual / import / upload) — ย้าย JSX มาจาก src/pages/knowledge.tsx verbatim ──
import { Dispatch, SetStateAction, RefObject } from 'react';
import { useLanguageStore } from '../../stores/useLanguageStore';
import Icon from '../ui/Icon';
import { ItemType, TYPE_META, TYPE_ORDER } from './knowledge-types';

interface AddDataPanelProps {
  addMode: 'manual' | 'import' | 'upload';
  setAddMode: Dispatch<SetStateAction<'manual' | 'import' | 'upload'>>;
  addForm: { type: ItemType; title: string; url: string; content: string; tags: string; notes: string };
  setAddForm: Dispatch<SetStateAction<{ type: ItemType; title: string; url: string; content: string; tags: string; notes: string }>>;
  importUrl: string;
  setImportUrl: Dispatch<SetStateAction<string>>;
  importTitle: string;
  setImportTitle: Dispatch<SetStateAction<string>>;
  importing: boolean;
  createItem: () => void;
  importFromUrl: () => void;
  uploading: boolean;
  uploadFile: (file: File) => void;
  fileRef: RefObject<HTMLInputElement | null>;
}

export default function AddDataPanel({ addMode, setAddMode, addForm, setAddForm, importUrl, setImportUrl, importTitle, setImportTitle, importing, createItem, importFromUrl, uploading, uploadFile, fileRef }: AddDataPanelProps) {
  const t = useLanguageStore((s) => s.t);
  return (
    <div className="card panel-glow p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-200 glow-text flex items-center gap-1.5"><Icon name="plus" size={14} className="text-gray-400" />{t('knowledge.add.title', 'เพิ่มข้อมูลใหม่')}</h3>
      {/* Tabs: กรอกเอง / นำเข้าจากเว็บ / อัปโหลด */}
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        {(['manual', 'import', 'upload'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setAddMode(mode)}
            className={`px-2 py-1.5 rounded ${addMode === mode ? 'bg-emerald-600 text-white shadow-neon-green' : 'bg-gray-800 text-gray-400'}`}
          >
            {mode === 'manual' ? t('knowledge.add.tabManual', 'กรอกเอง') : mode === 'import' ? t('knowledge.add.tabImport', 'นำเข้าเว็บ') : t('knowledge.add.tabUpload', 'อัปโหลดไฟล์')}
          </button>
        ))}
      </div>

      {addMode === 'manual' && (
        <div className="space-y-2">
          <select
            value={addForm.type}
            onChange={(e) => setAddForm({ ...addForm, type: e.target.value as ItemType })}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            {TYPE_ORDER.map((tt) => <option key={tt} value={tt}>{t(`knowledge.type.${tt}`, TYPE_META[tt].label)}</option>)}
          </select>
          <input value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} placeholder={t('knowledge.add.titlePh', 'ชื่อ/หัวข้อ *')} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
          {(addForm.type === 'LINK' || addForm.type === 'VIDEO' || addForm.type === 'WEBPAGE') && (
            <input value={addForm.url} onChange={(e) => setAddForm({ ...addForm, url: e.target.value })} placeholder={t('knowledge.add.urlPh', 'URL (https://...)')} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
          )}
          {(addForm.type === 'NOTE' || addForm.type === 'TXT') && (
            <textarea value={addForm.content} onChange={(e) => setAddForm({ ...addForm, content: e.target.value })} rows={4} placeholder={t('knowledge.add.contentPh', 'เนื้อหา/บันทึก...')} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
          )}
          <input value={addForm.tags} onChange={(e) => setAddForm({ ...addForm, tags: e.target.value })} placeholder={t('knowledge.add.tagsPh', 'แท็ก คั่นด้วย , เช่น ประวัติศาสตร์,สอนลูก')} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
          <button onClick={createItem} className="w-full btn-primary py-1.5 text-sm">{t('common.save', 'บันทึก')}</button>
        </div>
      )}

      {addMode === 'import' && (
        <div className="space-y-2">
          <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder={t('knowledge.import.urlPh', 'URL ของเว็บที่อยากเก็บ (https://...)')} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
          <input value={importTitle} onChange={(e) => setImportTitle(e.target.value)} placeholder={t('knowledge.import.titlePh', 'ชื่อ (ไม่ใส่ = ดึงจากหน้าเว็บ)')} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
          <button onClick={importFromUrl} disabled={importing} className="w-full bg-cyan-600 hover:bg-cyan-500 py-1.5 rounded text-sm font-semibold disabled:opacity-50">
            {importing ? t('knowledge.import.fetching', 'กำลังดึงหน้าเว็บ...') : t('knowledge.import.fetch', 'ดึงเนื้อหาจากเว็บ')}
          </button>
        </div>
      )}

      {addMode === 'upload' && (
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md"
            onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
            className="w-full text-xs bg-gray-800 border border-gray-600 rounded px-2 py-1.5 file:mr-2 file:bg-emerald-600 file:border-0 file:rounded file:text-white file:px-2 file:py-0.5"
          />
          <div className="text-[10px] text-gray-600">{t('knowledge.upload.hint', 'รองรับ .pdf .txt .md — PDF จะพยายามสกัดข้อความอัตโนมัติ (ไฟล์สแกนภาพต้องเพิ่มบันทึกเอง)')}</div>
          {uploading && <div className="text-xs text-gray-400">{t('knowledge.upload.uploading', 'กำลังอัปโหลด...')}</div>}
        </div>
      )}
    </div>
  );
}
