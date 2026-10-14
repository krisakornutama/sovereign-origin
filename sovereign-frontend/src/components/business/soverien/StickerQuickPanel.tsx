"use client";
// components/business/soverien/StickerQuickPanel.tsx
// แผง "โหมดง่าย" — เหลือเฉพาะที่ต้องทำจริง (14/10/69)
//
// เจ้าของบอกว่าหน้าสติกเกอร์ "ยุ่งยาก" เพราะมีตัวเลื่อน/ช่องกรอกราว 20 ตัว
// ทั้งที่งานจริงคือ "อัปโหลด → จับขนาด → คลิกที่ช่อง → เลือก serial → ดาวน์โหลด"
//   → ไฟล์นี้คือหน้าที่ "จำได้" ให้ ส่วนที่ปรับละเอียดอยู่ใน StickerControls
import type { StickerConfig, StickerPreset } from './types';
import StickerPresets from './StickerPresets';
import { clamp } from './sticker-layout';
import { btnGhost } from './ui';

/** ช่องตัวเลขย่อ — ไม่ต้องเห็นสไลเดอร์ยาว ๆ */
function NumBox({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-400">
      {label}
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(clamp(n, min, max)); }}
        className="w-20 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-right text-xs text-gray-100" />
    </label>
  );
}

export default function StickerQuickPanel({
  cfg, presets, onPatch, onAutoFit, onSavePreset, onApplyPreset, onDeletePreset, onGoAdvanced,
}: {
  cfg: StickerConfig;
  presets: StickerPreset[];
  onPatch: (p: Partial<StickerConfig>) => void;
  onAutoFit: () => void;
  onSavePreset: (name: string) => void;
  onApplyPreset: (p: StickerPreset) => void;
  onDeletePreset: (id: string) => void;
  onGoAdvanced: () => void;
}) {
  return (
    <div className="space-y-2">
      <ol className="text-xs text-gray-300 space-y-1 list-decimal pl-4">
        <li>อัปโหลดภาพป้าย (ทำครั้งเดียว)</li>
        <li>กด ⚡ จับขนาดให้ตรงกับภาพ</li>
        <li>คลิกที่ช่องว่างบนภาพ 1 ครั้ง</li>
        <li>เลือกว่าป้ายมี QR พิมพ์ไว้ไหม</li>
      </ol>

      <div className="flex flex-wrap gap-1.5 pt-1">
        <button type="button" className="rounded-lg border border-emerald-600 bg-emerald-600/15 px-2 py-1 text-xs text-emerald-200"
          onClick={onAutoFit} disabled={!cfg.templateDataUrl}>
          ⚡ จับขนาดให้ตรง
        </button>
        <button type="button" className={btnGhost} onClick={() => onPatch({ showQr: false, showWarranty: false })}>
          มี QR พิมพ์ไว้แล้ว
        </button>
        <button type="button" className={btnGhost} onClick={() => onPatch({ showQr: true, showWarranty: true })}>
          ป้ายเปล่า ให้ใส่ QR
        </button>
        <button type="button" className={btnGhost} onClick={() => onPatch({ serialPlate: !cfg.serialPlate })}>
          {cfg.serialPlate ? '☑ กลบตัวเลขเดิมแล้วเขียนทับ' : '☐ กลบตัวเลขเดิมบนป้าย'}
        </button>
      </div>

      <div className="pt-1">
        <NumBox label="ขนาดตัวอักษร" value={cfg.serialSize} min={8} max={120} step={1}
          onChange={(n) => onPatch({ serialSize: n })} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <StickerPresets presets={presets} cfg={cfg}
          onSave={onSavePreset} onApply={onApplyPreset} onDelete={onDeletePreset} />
        <button type="button" className="text-[11px] text-cyan-400 hover:underline" onClick={onGoAdvanced}>
          ต้องการปรับละเอียดเอง →
        </button>
      </div>
    </div>
  );
}