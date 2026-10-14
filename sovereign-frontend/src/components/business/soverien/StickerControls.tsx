"use client";
// components/business/soverien/StickerControls.tsx
// แผงตั้งค่าสติกเกอร์ (แยกจาก StickerStudio เพื่อไม่ให้ไฟล์เดียวยาวเกินเพดาน 400 บรรทัด)
//
// ที่เจ้าของบอก 14/10/69: "ย่อภาพให้เล็กไม่ได้ / ปรับตัวอักษรไม่คล่อง / ตัวหนังสือไม่ชัด"
//   → ทุกตัวเลขที่เป็นสัดส่วน 0..1 ต้องมี "สไลเดอร์" คู่กับช่องกรอกเสมอ
//     เพราะการพิมพิเลขทศนิยม (0.3787364104) เป็นการปรับที่ไม่คล่องที่สุด
import type { StickerConfig } from './types';
import { round3, clamp } from './sticker-layout';
import { Card, inputCls, btnGhost } from './ui';

type Props = {
  cfg: StickerConfig;
  patch: (p: Partial<StickerConfig>) => void;
  hasTemplate: boolean;
  pxW: number;
  pxH: number;
  onAutoFit?: () => void;
  onNudge?: (dxMm: number, dyMm: number) => void;
};

/** สไลเดอร์ + ช่องกรอกเลข คู่กัน — ลากได้เร็ว พิมพ์แม่นยำ */
function NumSlider({ label, value, min, max, step, digits, onChange }: {
  label: string; value: number; min: number; max: number; step: number; digits: number;
  onChange: (n: number) => void;
}) {
  const shown = Number(value.toFixed(digits));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">{label}</span>
        <input
          type="number" min={min} max={max} step={step}
          className={`${inputCls} w-24 text-right`}
          value={shown}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Number(clamp(n, min, max).toFixed(digits)));
          }}
        />
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(clamp(Number(e.target.value), min, max).toFixed(digits)))}
        className="w-full accent-cyan-500"
        aria-label={label}
      />
    </div>
  );
}

/**
 * ตำแหน่งให้กรอกเป็น "มิลลิเมตร" ไม่ใช่เลข 0–1 (14/10/69)
 *   เจ้าของบอกว่า "ปรับให้ตรงกับสติกเกอร์ยังยากเลย" เพราะ 0.378 แปลว่าอะไรไม่ได้
 *   แต่ "จากขอบซ้าย 12.0 มม." คือเอากระดาษมาวางทับแล้วรู้เลย
 *   ข้างในยังเก็บเป็นสัดส่วน 0–1 เหมือนเดิม (ข้อมูลเดิมไม่ต้องแปลง)
 */
function MmPos({ label, value, sizeMm, maxMm, onChange }: {
  label: string; value: number; sizeMm: number; maxMm: number; onChange: (n: number) => void;
}) {
  const mm = value * sizeMm;
  const set = (v: number) => onChange(Math.min(1, Math.max(0, Number((v / sizeMm).toFixed(4)))));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">{label}</span>
        <div className="flex items-center gap-1">
          <input type="number" step={0.1} min={0} max={maxMm} className={`${inputCls} w-20 text-right`}
            value={Number(mm.toFixed(1))}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set(n); }} />
          <span className="text-[11px] text-gray-500">มม.</span>
        </div>
      </div>
      <input type="range" min={0} max={maxMm} step={0.1} value={Number(mm.toFixed(1))}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full accent-cyan-500" aria-label={`${label} (มม.)`} />
    </div>
  );
}

export default function StickerControls({ cfg, patch, hasTemplate, pxW, pxH, onAutoFit, onNudge }: Props) {
  const NUDGE = 0.5;   // ขยับทีละ 0.5 มม. — ละเอียดพอสำหรับจับช่อง "Serial No." ที่พิมพ์ไว้
  return (
    <Card title="3) ตั้งค่า">
      {/* ── ภาพต้นแบบ: ย่อ/ขยาย/เลื่อน ── */}
      <div className="space-y-2 rounded-lg border border-slate-700 p-2.5">
        <div className="text-xs font-semibold text-gray-300">ภาพต้นแบบ</div>
        <button type="button" className="w-full rounded-lg border border-emerald-600 bg-emerald-600/15 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-600/25"
          onClick={() => onAutoFit?.()} disabled={!hasTemplate}>
          ⚡ จับขนาดป้ายให้ตรงกับภาพที่อัปโหลด (เร็วสุด)
        </button>
        <p className="text-[11px] text-gray-500">
          กดปุ่มนี้แล้วจะคำนวณส่วนสูงของป้ายจากสัดส่วนภาพให้พอดี โดยคงความกว้างที่คุณตั้งไว้
          → ภาพเต็มพอดีไม่ตัด ไม่มีขอบขาว ไม่ต้องมาเดาเอง
        </p>
        {/* ── เลือกตามลักษณะป้าย 14/10/69 ──
            เจ้าของบอกว่าเครื่องมือ "ยังไม่ตอบโจทย์" เพราะป้ายจริงมี QR พิมพ์มาแล้ว
            แต่เครื่องมือยังวาด QR ซ้ำทับ → ให้เลือกครั้งเดียว ไม่ต้องจำมาปิดทีละรอบ */}
        <div className="pt-1">
          <div className="text-[11px] text-gray-400 mb-1">ป้ายของคุณเป็นแบบไหน?</div>
          <div className="grid gap-1.5">
            <button type="button" className={btnGhost}
              onClick={() => patch({ showQr: false, showWarranty: false })}>
              ป้ายมี QR พิมพ์ไว้แล้ว + ช่อง Serial No. ว่าง → ใส่แค่เลข
            </button>
            <button type="button" className={btnGhost}
              onClick={() => patch({ showQr: true, showWarranty: true })}>
              ป้ายเปล่า ไม่มีอะไรพิมพ์มา → ให้ระบบใส่ QR + วันสิ้นประกันให้
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {([['contain', 'พอดีทั้งภาพ (เห็นครบ)'], ['cover', 'เต็มจอ (ตัดขอบ)'], ['stretch', 'ยืดเต็มจอ']] as const).map(([v, lbl]) => (
            <button
              key={v} type="button"
              className={cfg.tplFit === v ? 'rounded-lg border border-cyan-500 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-300' : btnGhost}
              onClick={() => patch({ tplFit: v })}
            >{lbl}</button>
          ))}
        </div>
        <NumSlider label="ขนาดภาพ" value={cfg.tplScale} min={0.2} max={3} step={0.05} digits={2}
          onChange={(n) => patch({ tplScale: n })} />
        <div className="grid grid-cols-2 gap-2">
          <NumSlider label="เลื่อนแนวนอน" value={cfg.tplX} min={-1} max={1} step={0.02} digits={2}
            onChange={(n) => patch({ tplX: n })} />
          <NumSlider label="เลื่อนแนวตั้ง" value={cfg.tplY} min={-1} max={1} step={0.02} digits={2}
            onChange={(n) => patch({ tplY: n })} />
        </div>
        {!hasTemplate && <p className="text-[11px] text-amber-400/80">ยังไม่มีภาพต้นแบบ — อัปโหลดด้านบนก่อนจึงจะเห็นผลของค่าเหล่านี้</p>}
      </div>

      {/* ── ตัวอักษร S/N ── */}
      <div className="mt-3 space-y-2 rounded-lg border border-slate-700 p-2.5">
        <div className="text-xs font-semibold text-gray-300">ตัวอักษร S/N</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1"><span className="text-xs text-gray-400">กว้าง (มม.)</span>
            <input type="number" min={10} max={200} className={inputCls} value={cfg.widthMm} onChange={(e) => patch({ widthMm: Number(e.target.value) || 40 })} /></label>
          <label className="space-y-1"><span className="text-xs text-gray-400">สูง (มม.)</span>
            <input type="number" min={5} max={200} className={inputCls} value={cfg.heightMm} onChange={(e) => patch({ heightMm: Number(e.target.value) || 20 })} /></label>
          <label className="space-y-1"><span className="text-xs text-gray-400">DPI</span>
            <input type="number" min={96} max={600} className={inputCls} value={cfg.dpi} onChange={(e) => patch({ dpi: Number(e.target.value) || 300 })} /></label>
          <label className="space-y-1"><span className="text-xs text-gray-400">สีตัวอักษร</span>
            <input type="color" className="w-full h-9 rounded bg-slate-900 border border-slate-700" value={cfg.serialColor}
              onChange={(e) => patch({ serialColor: e.target.value })} /></label>
        </div>
        <NumSlider label="ขนาดฟอนต์ (px)" value={cfg.serialSize} min={8} max={120} step={1} digits={0}
          onChange={(n) => patch({ serialSize: n })} />

        <div className="rounded-lg border border-slate-600 p-2 space-y-1.5">
          <div className="text-[11px] text-gray-400">ตำแหน่ง (วัดเป็น มม. จากขอบซ้าย/บน)</div>
          <MmPos label="แนวนอน" value={cfg.serialX} sizeMm={cfg.widthMm} maxMm={cfg.widthMm}
            onChange={(n) => patch({ serialX: n })} />
          <MmPos label="แนวตั้ง" value={cfg.serialY} sizeMm={cfg.heightMm} maxMm={cfg.heightMm}
            onChange={(n) => patch({ serialY: n })} />
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <span className="text-[11px] text-gray-500">ขยับทีละ {NUDGE} มม.</span>
            <button type="button" className={btnGhost} onClick={() => onNudge?.(-NUDGE, 0)}>◀</button>
            <button type="button" className={btnGhost} onClick={() => onNudge?.(0, -NUDGE)}>▲</button>
            <button type="button" className={btnGhost} onClick={() => onNudge?.(0, NUDGE)}>▼</button>
            <button type="button" className={btnGhost} onClick={() => onNudge?.(NUDGE, 0)}>▶</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([['left', 'ชิดซ้าย'], ['center', 'กึ่งกลาง'], ['right', 'ชิดขวา']] as const).map(([v, lbl]) => (
            <button key={v} type="button"
              className={cfg.serialAlign === v ? 'rounded-lg border border-cyan-500 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-300' : btnGhost}
              onClick={() => patch({ serialAlign: v })}>{lbl}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={cfg.serialPlate} onChange={(e) => patch({ serialPlate: e.target.checked })} />
          พื้นหลังให้ตัวอักษร (อ่านออกแม้ทับภาพ)
        </label>
        {cfg.serialPlate && (
          <label className="space-y-1"><span className="text-xs text-gray-400">สีพื้นหลังตัวอักษร</span>
            <input type="color" className="w-full h-9 rounded bg-slate-900 border border-slate-700" value={cfg.serialPlateColor}
              onChange={(e) => patch({ serialPlateColor: e.target.value })} /></label>
        )}
      </div>

      {/* ── วันสิ้นประกัน ── */}
      <div className="mt-3 space-y-2 rounded-lg border border-slate-700 p-2.5">
        <div className="text-xs font-semibold text-gray-300">วันสิ้นประกัน</div>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={cfg.showWarranty} onChange={(e) => patch({ showWarranty: e.target.checked })} />
          แสดงวันสิ้นประกันมุมขวาล่าง
        </label>
        {cfg.showWarranty && (
          <label className="block space-y-1"><span className="text-xs text-gray-400">สีวันสิ้นประกัน</span>
            <input type="color" className="w-full h-9 rounded bg-slate-900 border border-slate-700" value={cfg.warrantyColor}
              onChange={(e) => patch({ warrantyColor: e.target.value })} /></label>
        )}
      </div>

      {/* ── QR ── */}
      <div className="mt-3 space-y-2 rounded-lg border border-slate-700 p-2.5">
        <div className="text-xs font-semibold text-gray-300">QR Code</div>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input type="checkbox" checked={cfg.showQr} onChange={(e) => patch({ showQr: e.target.checked })} />
          ใส่ QR Code (สแกนแล้วเปิดหน้าตรวจประกันพร้อม S/N)
        </label>
        {cfg.showQr && (
          <>
            <NumSlider label="ขนาด QR (px)" value={cfg.qrSize} min={24} max={240} step={2} digits={0}
              onChange={(n) => patch({ qrSize: n })} />
            <div className="grid grid-cols-2 gap-2">
              <NumSlider label="QR แนวนอน (0–1)" value={cfg.qrX} min={0} max={1} step={0.005} digits={3}
                onChange={(n) => patch({ qrX: n })} />
              <NumSlider label="QR แนวตั้ง (0–1)" value={cfg.qrY} min={0} max={1} step={0.005} digits={3}
                onChange={(n) => patch({ qrY: n })} />
            </div>
            <label className="block space-y-1">
              <span className="text-xs text-gray-400">ที่อยู่ปลายทาง QR (ปล่อยว่าง = ใช้ที่อยู่เครื่องนี้)</span>
              <input type="url" className={inputCls} value={cfg.qrBaseUrl ?? ''}
                placeholder="https://โดเมนของคุณ" onChange={(e) => patch({ qrBaseUrl: e.target.value })}
                aria-label="ที่อยู่ปลายทาง QR" />
              <span className="block text-[11px] text-amber-400/80">
                ⚠ ให้ลูกค้าสแกนด้วยมือถือได้ ต้องใส่โดเมนจริง ·ค่าว่างจะพิมพ์ localhost ซึ่งมือถือเปิดไม่ได้
              </span>
              {cfg.qrBaseUrl && /localhost|127\.0\.0\.1/.test(cfg.qrBaseUrl) && (
                <span className="block text-[11px] text-rose-400">ยังชี้ที่เครื่องตัวเอง — ลูกค้าสแกนแล้วเปิดไม่ได้</span>
              )}
            </label>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-gray-500">ขนาดจริง {pxW}×{pxH} px</span>
        <button type="button" className={btnGhost} onClick={() => patch({
          serialX: 0.06, serialY: 0.38, serialSize: 26, serialColor: '#111827',
          serialAlign: 'left', serialPlate: true, serialPlateColor: '#ffffff',
          qrX: 0.76, qrY: 0.18, qrSize: 64, showQr: true, showWarranty: true,
          warrantyColor: '#111827',
          tplFit: 'contain', tplScale: 1, tplX: 0, tplY: 0,
        })}>
          คืนค่าตำแหน่งเริ่มต้น
        </button>
      </div>
    </Card>
  );
}

// ทำให้ค่าใช้รอบๆ เป็นเลขสวย (กันเศษที่หลุดเข้ามาจากที่อื่น)
export { round3 };