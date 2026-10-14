"use client";
// components/business/soverien/StickerStudio.tsx
// ส่วนที่ 3 — สร้างภาพสติกเกอร์ประจำเครื่อง (14/10/69)
// ผู้ใช้อัปโหลดภาพต้นแบบที่พิมพ์เอง → ระบบ overlay S/N + วันสิ้นสุดประกัน + QR ทับ
// ดาวน์โหลดทีละภาพ (PNG) หรือทั้งหมด (.zip — เขียน ZIP เอง ไม่ต้องเพิ่ม dependency)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Db, StickerPreset } from './types';
import { modelById, thaiDate } from './store';
import { round3, clamp, stickerHeightFor } from './sticker-layout';
import { paintSticker, loadImage } from './sticker-draw';
import StickerControls from './StickerControls';
import StickerQuickPanel from './StickerQuickPanel';
import StickerSerialPicker from './StickerSerialPicker';
import { buildZip, downloadBlob, canvasToPngBytes } from './zip';
import { getApiUrl } from '../../../lib/config';
import { Card, inputCls, btnPrimary, btnGhost, Notice, Empty } from './ui';

const MAX_TEMPLATE_PX = 1200;   // ภาพต้นแบบเกินนี้ localStorage ไม่รับ (โควตา ~5 MB)
const MAX_TEMPLATE_BYTES = 900_000;
/** คุณภาพ JPEG ของภาพต้นแบบ — 85% ทำให้เส้นตาละเอียดเป็นหย่อม (14/10/69) */
const TEMPLATE_QUALITY = 0.92;
/** วาดภาพตัวอย่างที่ความละเอียดจอจริง ไม่ใช่ขนาดพิมพ์ (กันภาพเละตอนดู) */
const PREVIEW_SCALE = 2;

/** ขนาดสติกเกอร์เป็น px จากมิลลิเมตร @ dpi (40×20 มม. @300 = 472×236) */
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/** ย่อภาพต้นแบบให้เล็กลงก่อนเก็บลง localStorage */
async function normalizeTemplate(file: File): Promise<string> {
  const img = await loadImage(URL.createObjectURL(file));
  const scale = Math.min(1, MAX_TEMPLATE_PX / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', TEMPLATE_QUALITY);
}

/** ดึงภาพ QR จาก backend (frontend ไม่มี dependency สร้าง QR) พร้อม cache */
const qrCache = new Map<string, HTMLImageElement | null>();
async function getQr(text: string, px: number): Promise<HTMLImageElement | null> {
  const key = `${text}|${px}`;
  if (qrCache.has(key)) return qrCache.get(key) ?? null;
  try {
    const url = `${getApiUrl()}/api/util/qr?text=${encodeURIComponent(text)}&size=${px * 2}&margin=1`;
    const img = await loadImage(url);
    qrCache.set(key, img);
    return img;
  } catch {
    qrCache.set(key, null);
    return null;
  }
}

/** ช่องตัวเลขย่อสำหรับโหมดง่าย (ไม่ต้องเห็นสไลเดอร์ยาว ๆ) */
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

export default function StickerStudio({ db, setDb, presetSerials, onClearPreset }: {
  db: Db; setDb: (d: Db) => void; presetSerials?: string[]; onClearPreset?: () => void;
}) {
  const cfg = db.settings.sticker;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<string>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  // โหมดง่ายเป็นค่าเริ่มต้น (14/10/69) — ซ่อนตัวเลื่อน ~20 ตัวไว้ข้างใต้
  const [advanced, setAdvanced] = useState(false);

  // มาจากแท็บ "ออกออเดอร์" → เลือกให้อัตโนมัติ
  useEffect(() => {
    if (presetSerials?.length) { setPicked(new Set(presetSerials)); setCurrent(presetSerials[0]); onClearPreset?.(); }
  }, [presetSerials, onClearPreset]);

  const pool = useMemo(() => db.serials.filter((s) => s.status !== 'VOID'), [db.serials]);
  const active = current && pool.some((s) => s.sn === current) ? current : (picked.values().next().value ?? pool[0]?.sn ?? '');
  const activeSerial = pool.find((s) => s.sn === active);
  const activeOrder = activeSerial?.orderId ? db.orders.find((o) => o.id === activeSerial.orderId) : undefined;
  const W = mmToPx(cfg.widthMm, cfg.dpi);
  const H = mmToPx(cfg.heightMm, cfg.dpi);
  // ข้อความวันสิ้นประกันของใบที่กำลังดู (คำนวณครั้งเดียว แล้วส่งเข้าไปวาด)
  const warrantyText = activeOrder ? `ประกันถึง ${thaiDate(activeOrder.warrantyEnd)}` : 'ยังไม่ออกใบ';

  /** ปล่อยเมาส — ถ้าไม่ได้ลากเลย แปลว่าผู้ใช้คลิก ให้ยึดตำแหน่งที่คลิกทันที */
  function onRelease() {
    const d = downAt.current;
    if (d && !d.moved) {
      patch({ serialX: round3(clamp(d.x, 0, 1)), serialY: round3(clamp(d.y, 0, 1)) });
    }
    downAt.current = null;
    setDrag(null);
  }

  // ── วาดสติกเกอร์ (โค้ดวาดย้ายไป sticker-draw.ts) ──
// ⚠ 14/10/69 — ภาพเล่นไม่ใช่ภาพคุณ
//   ขนาดพิมพ์ที่ 30 มม. @300dpi = 354 px แต่จอแสดงประมาณ 760 px
//   ถ้าวาดที่ 354 แล้วปล่อยให้เบราว์เซอร์ขยาย → เบลอทั้งภาพ
//   → ภาพตัวอย่างวาดที่ PREVIEW_SCALE เท่า (ไฟล์ที่ดาวน์โหลดยังเป็นขนาดพิมพ์จริงเสมอ)
  const paint = useCallback(async (canvas: HTMLCanvasElement | null, sn: string, scale = 1) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const k = Math.max(1, scale);
    canvas.width = Math.round(W * k);
    canvas.height = Math.round(H * k);
    // ขยายขนาดที่เป็น "พิกเซลตายตัว" (ฟอนต์/QR) ตามสัดส่วน ไม่ให้หน้าจอกับไฟล์ที่พิมพ์ไม่ตรงกัน
    const drawCfg = k === 1 ? cfg : { ...cfg, serialSize: Math.round(cfg.serialSize * k), qrSize: Math.round(cfg.qrSize * k) };
    await paintSticker(ctx, canvas.width, canvas.height, drawCfg, sn, warrantyText, location.origin);
  }, [cfg, W, H, warrantyText]);

  useEffect(() => { void paint(canvasRef.current, active, PREVIEW_SCALE); }, [paint, active]);

  function patch(p: Partial<typeof cfg>) {
    // ⚠ ต้องสร้าง object ใหม่ทุกชั้น 14/10/69
    //   เดิม `const next = db; next.settings.sticker = {...}` ได้ object เดิมเป๊ะ
    //   → React เทียบ Object.is เห็นเหมือนกัน → ไม่วาด canvas ใหม่
    //   → เลื่อนสไลเดอร์แล้วไม่มีอะไรเกิดขึ้น ต้องไปคลิกที่ canvas ก่อน (อาการที่เจ้าของเจอ 14/10/69)
    setDb({ ...db, settings: { ...db.settings, sticker: { ...db.settings.sticker, ...p } } });
  }

  /**
   * จับขนาดป้ายให้ตรงกับภาพต้นแบบ (14/10/69)
   *
   * ปัญหาที่เจ้าของเจอ: "ผมไม่สามารถปรับภาพให้ตรงได้เลย"
   *   เพราะภาพต้นแบบมีสัดส่วนของมันเอง แต่ป้ายต้องตั้ง กว.x × ส.xxx มม. แยกกัน
   *   ต่างกันนิดเดียวภาพก็บิดหรือมีขอบขาว → ต้องเดาสุ่มจนตรง
   *   วิธีนี้: คงความกว้างที่ตั้งไว้ แล้วคำนวณส่วนสูงจากสัดส่วนภาพ → ตรงเป๊ะทันที
   */
  async function autoFitToTemplate() {
    const tpl = cfg.templateDataUrl;
    if (!tpl) { setMsg({ ok: false, text: 'ยังไม่มีภาพต้นแบบ — อัปโหลดก่อน' }); return; }
    try {
      const img = await loadImage(tpl);
      if (!img.width || !img.height) throw new Error('อ่านขนาดภาพไม่ได้');
      const wMm = cfg.widthMm;
      const hMm = stickerHeightFor(img.width, img.height, wMm);
      patch({ heightMm: hMm, tplFit: 'contain', tplScale: 1, tplX: 0, tplY: 0 });
      setMsg({
        ok: true,
        text: `จับขนาดเป็น ${wMm} × ${hMm} มม. ให้เท่าภาพแล้ว — ภาพเต็มพอดี ไม่ตัด ไม่มีขอบขาว`,
      });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? 'จับขนาดไม่สำเร็จ' });
    }
  }

  /** ขยับตำแหน่ง S/N ทีละไม่กี่มิลลิเมตร (ใช้จับช่องที่พิมพ์ไว้บนป้าย) */
  function nudge(dxMm: number, dyMm: number) {
    patch({
      serialX: round3(clamp(cfg.serialX + dxMm / cfg.widthMm, 0, 1)),
      serialY: round3(clamp(cfg.serialY + dyMm / cfg.heightMm, 0, 1)),
    });
  }

  // ── แม่แบบป้าย 14/10/69 ──
  //   ตั้งค่าครั้งเดียว ตั้งชื่อไว้ แล้วกดชื่อเดียวจบ
  //   (ตอนก่อนต้องจัดวางใหม่ทุกครั้ง — ซึ่งเจ้าของบอกว่า "ยากเกินไป")
  function savePreset(name: string) {
    const id = `p-${Date.now().toString(36)}`;
    setDb({ ...db, stickerPresets: [...db.stickerPresets, { id, name, cfg: { ...cfg } }] });
    setMsg({ ok: true, text: `บันทึกแม่แบบ "${name}" แล้ว · ครั้งหน้ากดชื่อนี้ได้เลย` });
  }
  function applyPreset(p: StickerPreset) {
    setDb({ ...db, settings: { ...db.settings, sticker: { ...p.cfg } } });
    setMsg({ ok: true, text: `ใช้แม่แบบ "${p.name}" แล้ว` });
  }
  function deletePreset(id: string) {
    setDb({ ...db, stickerPresets: db.stickerPresets.filter((p) => p.id !== id) });
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 12_000_000) { setMsg({ ok: false, text: 'ไฟล์ใหญ่เกิน 12 MB' }); return; }
    try {
      const dataUrl = await normalizeTemplate(file);
      if (dataUrl.length > MAX_TEMPLATE_BYTES) { setMsg({ ok: false, text: 'ย่อภาพแล้วยังใหญ่เกินไป — ลองภาพที่เล็กกว่า' }); return; }
      patch({ templateDataUrl: dataUrl });
      setMsg({ ok: true, text: 'อัปโหลดภาพต้นแบบแล้ว (เก็บในเครื่อง ไม่ออกไปไหน)' });
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message ?? 'อัปโหลดไม่สำเร็จ' });
    }
  }

  function toggle(sn: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(sn) ? next.delete(sn) : next.add(sn);
      return next;
    });
  }

  async function downloadOne(sn: string) {
    const c = document.createElement('canvas');
    await paint(c, sn);
    const bytes = await canvasToPngBytes(c);
    downloadBlob(new Blob([bytes as BlobPart], { type: 'image/png' }), `${sn}.png`);
  }

  async function downloadAll() {
    const list = [...picked];
    if (!list.length) { setMsg({ ok: false, text: 'ยังไม่ได้เลือก serial' }); return; }
    setBusy(true);
    try {
      const files: Array<{ name: string; data: Uint8Array }> = [];
      for (const sn of list) {
        const c = document.createElement('canvas');
        await paint(c, sn);
        files.push({ name: `${sn}.png`, data: await canvasToPngBytes(c) });
      }
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      downloadBlob(buildZip(files), `soverien-stickers-${stamp}.zip`);
      setMsg({ ok: true, text: `ดาวน์โหลด ${files.length} ไฟล์เป็น ZIP แล้ว` });
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message ?? 'สร้าง ZIP ไม่สำเร็จ' });
    } finally {
      setBusy(false);
    }
  }

  // ── คลิก/ลากวางตำแหน่ง S/N บนภาพ ──
  //
  // 14/10/69 — เจ้าของบอกว่างานจริงคือ "เปลี่ยน 000 เป็น 001" ไม่ใช่มานั่งจัดวางใหม่ทุกครั้ง
  //   เดิม: ต้องลากจับหัวข้อความไปวาง + ไล่ปรับสไลเดอร์ → ยากเกินไป
  //   ใหม่: **คลิกที่ไหน ข้อความยึดตรงนั้นทันที** ไม่ต้องลาก ไม่ต้องแม่นยำ
  //        (ลากยังได้เหมือนเดิมสำหรับคนที่อยากจัดละเอียด)
  const downAt = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  function onPointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    // ⚠ 14/10/69 — จับตำแหน่งไว้ "ทุกครั้งที่กดลง" ไม่ใช่หลังผ่านเงื่อนไขอื่น
    //   เคยตั้งไว้ใน else-if ที่ต้องมี activeSerial → ถ้าไม่มี serial ที่เลือก
    //   บรรทัดนั้นไม่ทำงาน → onRelease ไม่รู้ว่าผู้ใช้คลิกไว้ตรงไหน
    //   อาการที่เจอตอนทดสอบ: กดตรงไหนก็ไม่ขยับ เหมือนปุ่มไม่มีผล
    if (e.type === 'pointerdown' && e.button === 0) {
      downAt.current = { x: px, y: py, moved: false };
    } else if (downAt.current) {
      const d = downAt.current;
      if (Math.abs(px - d.x) > 0.002 || Math.abs(py - d.y) > 0.002) d.moved = true;
    }

    if (drag) {
      patch({
        serialX: round3(clamp(px - drag.x, 0, 1)),
        serialY: round3(clamp(py - drag.y, 0, 1)),
      });
    } else if (e.type === 'pointerdown' && e.button === 0) {
      setDrag({ x: px - cfg.serialX, y: py - cfg.serialY });
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer สังเคราะห์จากสคริปต์ */ }
    }
  }

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Notice>}

      {/* ── คู่มือ 3 ขั้นตอน 14/10/69 ──
          เจ้าของบอกว่าเครื่องมือ "ยากเกินไป ทั้งๆ ที่ควรจะง่าย"
          เพราะไม่มีใครบอกว่าต้องทำอะไรก่อน → บอกให้จบ ตั้งค่าครั้งเดียว ใช้ทั้งร้าน */}
      {cfg.templateDataUrl && (
        <div className="rounded-xl border border-emerald-600/30 bg-emerald-500/5 p-3 text-xs space-y-1">
          <div className="font-semibold text-emerald-200">ทำแค่ครั้งเดียว ที่เหลือทำให้อัตโนมัติ</div>
          <div className="text-gray-300">1. อัปโหลดภาพต้นแบบ (ทำครั้งเดียว)</div>
          <div className="text-gray-300">2. กด ⚡ จับขนาดให้ตรง → กดที่ช่อง Serial No. บนภาพ 1 ครั้ง</div>
          <div className="text-gray-300">3. กด &quot;ป้ายมี QR พิมพ์ไว้แล้ว&quot; ใต้ภาพ</div>
          <div className="pt-1 text-emerald-200">→ หลังจากนี้: เลือก serial → กด ดาวน์โหลด PNG จบเลย ไม่ต้องแตะค่าใดอีก</div>
        </div>
      )}

      <Card title="1) ภาพต้นแบบ" sub="อัปโหลดภาพที่คุณออกแบบไว้ — ระบบจะทับข้อความลงบนภาพนี้">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept="image/png,image/jpeg" onChange={onUpload} className="text-xs text-gray-400" aria-label="อัปโหลดภาพต้นแบบ" />
          {cfg.templateDataUrl && (
            <button type="button" className={btnGhost} onClick={() => patch({ templateDataUrl: undefined })}>เอาภาพต้นแบบออก</button>
          )}
          <span className="text-xs text-gray-500">
            {cfg.templateDataUrl ? 'มีภาพต้นแบบแล้ว' : 'ยังไม่มีภาพต้นแบบ (จะได้พื้นขาว + ข้อความ)'}
          </span>
        </div>
        {/* คำถามเกิด "ทันทีหลังอัปโหลด" ที่สุด 14/10/69 — ต้องตอบตรงนี้
            ไม่ใช่ปล่อยให้ไปเจอท้ายแถบตั้งค่าแล้วเดาว่าต้องกดอะไร */}
        {cfg.templateDataUrl && (
          <div className="mt-2 rounded-lg border border-slate-700 p-2 space-y-1.5">
            <div className="text-xs text-gray-400">ป้ายนี้มีอะไรพิมพ์มาก่อนแล้วไหม?</div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={btnGhost}
                onClick={() => patch({ showQr: false, showWarranty: false })}>
                มี QR พิมพ์ไว้แล้ว → ใส่แค่เลข
              </button>
              <button type="button" className={btnGhost}
                onClick={() => patch({ showQr: true, showWarranty: true })}>
                ไม่มี → ให้ใส่ QR + วันสิ้นประกัน
              </button>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card title="2) ภาพตัวอย่าง" sub={`👆 คลิกที่ช่องว่าง 1 ครั้ง — จัดให้ตรงแล้วจำไว้ทุกใบ · ขนาดจริง ${cfg.widthMm}×${cfg.heightMm} มม.`}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointer}
            onPointerMove={(e) => { if (drag) onPointer(e); }}
            onPointerUp={onRelease}
            tabIndex={0}
            aria-label="ภาพสติกเกอร์ — คลิกเพื่อวางเลข หรือกดลูกศรเพื่อขยับทีละ 0.5 มิลลิเมตร"
            onKeyDown={(e) => {
              // 14/10/69: เจ้าของบอกว่าปรับให้ตรงช่องที่พิมพ์ไว้ยาก
              //   ลากด้วยเมาสตระละเอียดไม่พอ ต้องขยับทีละน้อยได้
              const step = e.shiftKey ? 2 : 0.5;
              const map: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                ArrowUp: [0, -step], ArrowDown: [0, step],
              };
              const d = map[e.key];
              if (!d) return;
              e.preventDefault();
              nudge(d[0], d[1]);
            }}
            className="w-full rounded-lg border border-slate-700 bg-white cursor-move touch-none"
            style={{ aspectRatio: `${W} / ${H}` }}
          />
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" className={btnPrimary} onClick={() => active && downloadOne(active)} disabled={!active}>
              ดาวน์โหลด PNG ({active || '—'})
            </button>
            <button type="button" className={btnGhost} onClick={downloadAll} disabled={busy || picked.size === 0}>
              {busy ? 'กำลังสร้าง…' : `ดาวน์โหลดทั้งหมด (.zip) · ${picked.size} ภาพ`}
            </button>
            <button type="button" className={btnGhost} onClick={() => setPicked(new Set(pool.map((s) => s.sn)))}>เลือกทั้งหมด</button>
            <button type="button" className={btnGhost} onClick={() => setPicked(new Set())}>ล้างการเลือก</button>
          </div>
        </Card>

        <div className="space-y-4">
          {/* ── โหมดง่าย/ขั้นสูง 14/10/69 ──
              เจ้าของบอกว่าหน้านี้ "ยุ่งยาก" ทั้งๆ ที่ควรจะง่าย
              เพราะมีตัวเลื่อน ~20 ตัว ทั้งที่งานจริงมีแค่ 3 คลิก
              → ค่าเริ่มต้นโหมดง่าย ซ่อนของที่ไม่เกี่ยวกับงานไว้ข้างใต้ */}
          <Card title={advanced ? '3) ตั้งค่าทั้งหมด' : '3) ทำให้เสร็จครั้งเดียว'}>
            {advanced ? (
              <>
                <div className="flex justify-end pb-2">
                  <button type="button" className="text-[11px] text-gray-500 hover:text-gray-300"
                    onClick={() => setAdvanced(false)}>
                    ← กลับไปโหมดง่าย
                  </button>
                </div>
                <StickerControls cfg={cfg} patch={patch} hasTemplate={!!cfg.templateDataUrl} pxW={W} pxH={H}
                  onAutoFit={autoFitToTemplate} onNudge={nudge} />
              </>
            ) : (
              <StickerQuickPanel
                cfg={cfg}
                presets={db.stickerPresets}
                onPatch={patch}
                onAutoFit={autoFitToTemplate}
                onSavePreset={savePreset}
                onApplyPreset={applyPreset}
                onDeletePreset={deletePreset}
                onGoAdvanced={() => setAdvanced(true)}
              />
            )}
          </Card>
        </div>
      </div>

      <StickerSerialPicker
        db={db}
        pool={pool}
        picked={picked}
        activeSerial={activeSerial}
        onToggle={toggle}
        onPreview={setCurrent}
        onPickAll={() => setPicked(new Set(pool.map((s) => s.sn)))}
        onClearAll={() => setPicked(new Set())}
      />
    </div>
  );
}
