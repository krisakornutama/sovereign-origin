"use client";
// components/business/soverien/StickerPresets.tsx
// แม่แบบป้าย — ตั้งค่าครั้งเดียว แล้วกดชื่อเดียวจบ (14/10/69)
//
// ที่มาของของนี้: เจ้าของบอกว่า "ต้องปรับตัวหนังสือในแอปรวมถึงรวมเข้ากับภาพ ซึ่งมันยากมาก
// ทั้งๆ ที่ควรจะง่าย" — เพราะระบบไม่มีที่จำ ทุกครั้งต้องทำใหม่ตั้งแต่ต้น
//   → ตั้งค่าครั้งเดียว ตั้งชื่อ (เช่น "ป้ายหลัก") แล้วกดชื่อเพื่อเรียกค่าทั้งชุดกลับมา
import { useCallback, useState } from 'react';
import type { Db, StickerConfig, StickerPreset } from './types';
import { makePreset } from './sticker-presets';
import { btnGhost } from './ui';

/**
 * สร้าง/ใช้/ลบแม่แบบป้าย (16/10/69)
 * ย้ายมาจาก StickerStudio เพราะไฟล์นั้นชิดเพดาน 400 บรรทัดทุกรอบที่เพิ่มฟีเจอร์
 *   → logic ควรอยู่ติดกับ UI ที่ใช้มัน ไม่ใช่ในไฟล์ที่ยัดทุกอย่างเข้าไป
 */
export function useStickerPresets(db: Db, cfg: StickerConfig, setDb: (d: Db) => void) {
  const savePreset = useCallback((name: string) => {
    setDb({ ...db, stickerPresets: [...db.stickerPresets, makePreset(name, cfg)] });
  }, [db, cfg, setDb]);

  const applyPreset = useCallback((p: StickerPreset) => {
    setDb({ ...db, settings: { ...db.settings, sticker: { ...p.cfg } } });
  }, [db, setDb]);

  const deletePreset = useCallback((id: string) => {
    setDb({ ...db, stickerPresets: db.stickerPresets.filter((p) => p.id !== id) });
  }, [db, setDb]);

  return { savePreset, applyPreset, deletePreset };
}

export default function StickerPresets({ presets, cfg, onSave, onApply, onDelete }: {
  presets: StickerPreset[];
  cfg: StickerConfig;
  onSave: (name: string) => void;
  onApply: (p: StickerPreset) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
        💾 แม่แบบป้าย ({presets.length})
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-emerald-600/30 bg-emerald-500/5 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-emerald-200">แม่แบบป้าย — ตั้งค่าครั้งเดียว ใช้ซ้ำได้ทุกใบ</span>
        <button type="button" className="text-[11px] text-gray-500 hover:text-gray-300" onClick={() => setOpen(false)}>ปิด</button>
      </div>

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <span key={p.id} className="inline-flex items-center overflow-hidden rounded-lg border border-emerald-600/40">
              <button type="button" className="px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-600/20"
                onClick={() => onApply(p)}>
                {p.name}
              </button>
              <button type="button" className="border-l border-emerald-600/40 px-1.5 py-1 text-[11px] text-rose-300 hover:bg-rose-900/40"
                onClick={() => onDelete(p.id)} aria-label={`ลบแม่แบบ ${p.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-gray-100"
          placeholder="ตั้งชื่อ เช่น ป้ายหลัก"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !name.trim()) return;
            onSave(name.trim());
            setName('');
          }}
          aria-label="ชื่อแม่แบบป้าย"
        />
        <button type="button" className={btnGhost}
          disabled={!name.trim() || !cfg.templateDataUrl}
          onClick={() => { onSave(name.trim()); setName(''); }}>
          บันทึกค่าปัจจุบัน
        </button>
      </div>
      <p className="text-[11px] text-gray-500">
        {cfg.templateDataUrl
          ? 'บันทึกแล้วกดชื่อที่บันทึกไว้เมื่อไรก็ได้ ระบบจะเอาค่าทั้งชุด (ภาพ ขนาด ตำแหน่ง สี) มาครบ'
          : 'ยังไม่มีภาพต้นแบบ — อัปโหลดก่อนจึงจะบันทึกแม่แบบได้'}
      </p>
    </div>
  );
}