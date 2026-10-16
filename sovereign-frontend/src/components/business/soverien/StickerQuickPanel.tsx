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
import { STICKER_SIZES, sizePatch, matchSize } from './sticker-sizes';
import { STICKER_FONTS, DEFAULT_FONT, isFontAvailable, fontCss } from './sticker-fonts';
import { LABEL_PROFILES, profilePatch } from './sticker-presets';
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
  cfg, presets, onPatch, onAutoFit, onTrim, onSavePreset, onApplyPreset, onDeletePreset, onGoAdvanced,
  pxW, pxH, dlScale, onDlScale, sizeHint,
}: {
  cfg: StickerConfig;
  presets: StickerPreset[];
  onPatch: (p: Partial<StickerConfig>) => void;
  onAutoFit: () => void;
  onTrim: () => void;
  onSavePreset: (name: string) => void;
  onApplyPreset: (p: StickerPreset) => void;
  onDeletePreset: (id: string) => void;
  onGoAdvanced: () => void;
  pxW: number; pxH: number;
  dlScale: number;
  onDlScale: (n: number) => void;
  /** ขนาดจริงที่อ่านได้จากไฟล์ต้นแบบ (มิม.) — null ถ้าไฟล์ไม่ได้บันทึกไว้ */
  sizeHint?: { widthMm: number; heightMm: number } | null;
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
        {/* 16/10/69 — ภาพป้ายจริงมีพื้นขาวรอบกรอบอุปกรณ์ ถ้าไม่ตัด พอพิมพ์ที่ 81×55 มม.
            กรอบจริงจะเล็กกว่าขนาดป้ายและเหลือขอบขาวรอบ */}
        <button type="button" className={btnGhost} onClick={onTrim} disabled={!cfg.templateDataUrl}>
          ✂ ตัดขอบขาว
        </button>
        <button type="button" className={btnGhost} onClick={() => onPatch({ serialPlate: !cfg.serialPlate })}>
          {cfg.serialPlate ? '☑ กลบตัวเลขเดิมแล้วเขียนทับ' : '☐ กลบตัวเลขเดิมบนป้าย'}
        </button>
      </div>

      {/* ── ชนิดป้าย 16/10/69 ──
          เจ้าของส่งภาพป้ายจริงมา: ช่อง "Serial No." อยู่บนแถบน้ำเงินเข้ม
          ค่าเริ่มต้นเดิม = ตัวเลขสีดำ + วาง QR ทับ → บนป้ายนี้มองไม่เห็นและชนกับ QR ที่พิมพ์ไว้
          → ปุ่มเลือกชนิดป้ายตั้งค่าที่ถูกให้ครบชุดในคลิกเดียว */}
      <div className="space-y-1 border-t border-slate-800 pt-2">
        <div className="text-xs text-gray-400">ป้ายนี้เป็นแบบไหน</div>
        <div className="flex flex-wrap gap-1.5">
          {LABEL_PROFILES.map((p) => (
            <button key={p.key} type="button" className={btnGhost} title={p.hint}
              onClick={() => { const patch = profilePatch(p.key, cfg); if (patch) onPatch(patch); }}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-500">
          {LABEL_PROFILES[0].hint} — ดูภาพด้านซ้าย ถ้ายังไม่ตรงช่อง คลิกตรงที่ต้องการได้เลย
        </p>
      </div>

      <div className="pt-1">
        <NumBox label="ขนาดตัวอักษร" value={cfg.serialSize} min={8} max={120} step={1}
          onChange={(n) => onPatch({ serialSize: n })} />
      </div>

      {/* ── ขนาดภาพบนป้าย 16/10/69 ──
          เจ้าของ: "ผมสามารถกำหนดความกว้างและสูงของภาพได้มั้ย เพราะภาพมันเล็กกว่าที่ควรจะเป็น"
          ภาพจริงมีพื้นขาวรอบกรอบอุปกรณ์ พอใส่ในป้าย 81×55 มม. กรอบจึงเล็กกว่าป้าย
          → ให้กำหนดเป็นมิลลิเมตรได้ตรง ๆ (ใส่ข้างเดียวได้ อีกข้างคำนวณตามสัดส่วนภาพ) */}
      <div className="space-y-1 border-t border-slate-800 pt-2">
        <div className="text-xs text-gray-400">
          ขนาดภาพบนป้าย — ป้าย {cfg.widthMm}×{cfg.heightMm} มม.
          {(cfg.tplWMm > 0 || cfg.tplHMm > 0) && (
            <span className="ml-1 text-emerald-300">· กำลังใช้ค่าที่ตั้งเอง</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NumBox label="ภาพกว้าง (มม.)" value={cfg.tplWMm} min={0} max={300} step={1}
            onChange={(n) => onPatch({ tplWMm: n })} />
          <NumBox label="ภาพสูง (มม.)" value={cfg.tplHMm} min={0} max={300} step={1}
            onChange={(n) => onPatch({ tplHMm: n })} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btnGhost} disabled={!cfg.templateDataUrl}
            onClick={() => onPatch({ tplWMm: cfg.widthMm, tplHMm: cfg.heightMm, tplX: 0, tplY: 0 })}>
            ⬛ เต็มป้ายพอดี
          </button>
          <button type="button" className={btnGhost} disabled={!cfg.templateDataUrl}
            onClick={() => onPatch({ tplFit: 'cover', tplScale: 1, tplX: 0, tplY: 0, tplWMm: 0, tplHMm: 0 })}>
            ⤢ เต็มพอดี (ไม่บิด)
          </button>
          <button type="button" className={btnGhost}
            onClick={() => onPatch({ tplFit: 'contain', tplScale: 1, tplX: 0, tplY: 0, tplWMm: 0, tplHMm: 0 })}>
            ↺ ปรับอัตโนมัติ
          </button>
        </div>
        <p className="text-[11px] text-gray-500">ใส่ 0 = ให้ระบบคำนวณเอง · ใส่ข้างเดียวได้ อีกข้างจะคงสัดส่วนภาพ</p>
      </div>

      {/* ── ขนาดป้าย 16/10/69 ──
          เจ้าของวัดกรอบอุปกรณ์เองได้ 8.1 × 5.5 ซม. แต่ค่าที่บันทึกไว้ยังเป็นขนาดเก่า
          → ปุ่มคลิกเดียวได้ขนาด + ขนาดตัวอักษรที่เข้ากัน (ไม่ใช่แค่เปลี่ยน ก×ส) */}
      <div className="space-y-1 border-t border-slate-800 pt-2">
        <div className="text-xs text-gray-400">ขนาดป้าย (มม.) — ตอนนี้ {cfg.widthMm}×{cfg.heightMm}</div>
        <div className="flex flex-wrap gap-1.5">
          {sizeHint && (
            <button type="button"
              className="rounded-lg border border-amber-500 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200"
              onClick={() => onPatch({ widthMm: Math.round(sizeHint.widthMm), heightMm: Math.round(sizeHint.heightMm) })}>
              📐 ใช้ขนาดจริงจากไฟล์ ({Math.round(sizeHint.widthMm)}×{Math.round(sizeHint.heightMm)})
            </button>
          )}
          {STICKER_SIZES.map((s) => (
            <button key={s.key} type="button"
              className={matchSize(cfg.widthMm, cfg.heightMm) === s.key
                ? 'rounded-lg border border-emerald-500 bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-200'
                : btnGhost}
              onClick={() => onPatch(sizePatch(s, cfg.dpi))}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── ฟอนต์ 16/10/69 ──
          เจ้าของ: "Font ของผมคือ font Garuda … งั้นก็ควรมี font ให้ผมเลือก"
          Garuda มีจริงในเครื่องนี้ แต่ยังให้เลือกได้เผื่อไปใช้เครื่องอื่น
          ⚠ ขีดฆ่าฟอนต์ที่ไม่มีในเครื่อง = canvas จะเงียบ ๆ ใช้ฟอนต์อื่นแทน
             เจ้าของจะเห็นป้ายผิดแบบแต่ไม่รู้ว่าเพราะฟอนต์หาย */}
      <div className="space-y-1 border-t border-slate-800 pt-2">
        <div className="text-xs text-gray-400">ฟอนต์ตัวอักษร</div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={cfg.serialFont || DEFAULT_FONT} aria-label="เลือกฟอนต์"
            onChange={(e) => onPatch({ serialFont: e.target.value })}
            className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-gray-100">
            {STICKER_FONTS.map((f) => (
              <option key={f.css} value={f.css}>{f.label}{isFontAvailable(f.css) ? '' : ' — ไม่มีในเครื่องนี้'}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input type="checkbox" checked={cfg.serialBold !== false}
              onChange={(e) => onPatch({ serialBold: e.target.checked })} />
            ตัวหนา
          </label>
          <span className="rounded-md bg-slate-800 px-2 py-1 text-sm text-gray-100"
            style={{ fontFamily: `"${cfg.serialFont || DEFAULT_FONT}"` }}>
            Sovereign-Temp-000
          </span>
        </div>
        <p className="text-[11px] text-gray-500">
          {STICKER_FONTS.find((f) => f.css === (cfg.serialFont || DEFAULT_FONT))?.note ?? 'ฟอนต์ที่บันทึกไว้'}
          {' · '}{fontCss(cfg.serialFont || DEFAULT_FONT, cfg.serialSize, cfg.serialBold !== false)}
        </p>
      </div>

      {/* ── ความละเอียดไฟล์ 14/10/69 ──
          เจ้าของบอกว่า "พอดาวน์โหลดภาพกลับไม่ชัด"
          สาเหตุ: ขนาดพิมพ์จริง 30 มม. @300 dpi = 354×266 px ซึ่งเล็กมากถ้าเปิดดูหรือขยาย
          → ให้เลือกวาดไฟล์ที่ 2เท่า/3เท่า ขนาดกระดาษยังเท่าเดิม (พิกเซลต่อมิลลิเมตรเพิ่มขึ้น) */}
      <div className="space-y-1 border-t border-slate-800 pt-2">
        <div className="text-xs text-gray-400">ความละเอียดไฟล์ (ขนาดกระดาษเท่าเดิมทุกค่า)</div>
        <div className="flex flex-wrap gap-1.5">
          {[[1, 'ปกติ'], [2, 'คม 2เท่า'], [3, 'คม 3เท่า']].map(([v, lbl]) => (
            <button key={String(v)} type="button"
              className={dlScale === v ? 'rounded-lg border border-cyan-500 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-300' : btnGhost}
              onClick={() => onDlScale(Number(v))}>
              {lbl}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-500">
          ไฟล์ที่ได้ {Math.round(pxW * dlScale)}×{Math.round(pxH * dlScale)} px
          (= พิมพ์ที่ {Math.round(cfg.dpi * dlScale)} dpi ·เทียบกับขนาดกระดาษเดิม)
        </p>
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