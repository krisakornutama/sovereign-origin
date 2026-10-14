"use client";
// components/business/soverien/StickerStudio.tsx
// ส่วนที่ 3 — สร้างภาพสติกเกอร์ประจำเครื่อง (14/10/69)
// ผู้ใช้อัปโหลดภาพต้นแบบที่พิมพ์เอง → ระบบ overlay S/N + วันสิ้นสุดประกัน + QR ทับ
// ดาวน์โหลดทีละภาพ (PNG) หรือทั้งหมด (.zip — เขียน ZIP เอง ไม่ต้องเพิ่ม dependency)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Db } from './types';
import { modelById, thaiDate } from './store';
import { buildZip, downloadBlob, canvasToPngBytes } from './zip';
import { getApiUrl } from '../../../lib/config';
import { Card, inputCls, btnPrimary, btnGhost, Notice, Empty } from './ui';

const MAX_TEMPLATE_PX = 1400;   // ภาพต้นแบบเกินนี้ localStorage ไม่รับ (โควตา ~5 MB)
const MAX_TEMPLATE_BYTES = 900_000;

/** ขนาดสติกเกอร์เป็น px จากมิลลิเมตร @ dpi (40×20 มม. @300 = 472×236) */
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('โหลดภาพไม่สำเร็จ'));
    img.src = src;
  });
}

/** ย่อภาพต้นแบบให้เล็กลงก่อนเก็บลง localStorage */
async function normalizeTemplate(file: File): Promise<string> {
  const img = await loadImage(URL.createObjectURL(file));
  const scale = Math.min(1, MAX_TEMPLATE_PX / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
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

  // ── วาดสติกเกอร์ลง canvas (preview + ไฟล์ดาวน์โหลดใช้ฟังก์ชันเดียวกัน) ──
  const paint = useCallback(async (canvas: HTMLCanvasElement | null, sn: string) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = W;
    canvas.height = H;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const tpl = cfg.templateDataUrl;
    if (tpl) {
      try {
        const img = await loadImage(tpl);
        // ครอบเป็นภาพทั้งหน้า (cover) ไม่ยืดสัดส่วนจนเบี้ยว
        const s = Math.max(W / img.width, H / img.height);
        const dw = img.width * s, dh = img.height * s;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      } catch { /* ไม่มีภาพต้นแบบ = ใช้พื้นขาวล้วน */ }
    }

    // เส้นคั่นช่วยจัดตำแหน่งตอนยังไม่ได้พิมพ์จริง
    ctx.save();
    ctx.strokeStyle = 'rgba(16,185,129,.55)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(cfg.serialX * W - 2, cfg.serialY * H - 2, Math.max(60, cfg.serialSize * sn.length * 0.62), cfg.serialSize + 4);
    ctx.restore();

    // S/N
    ctx.fillStyle = cfg.serialColor;
    ctx.font = `600 ${cfg.serialSize}px "JetBrains Mono", Consolas, monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText(sn || 'S/N', cfg.serialX * W, cfg.serialY * H);

    // วันสิ้นสุดประกัน (มุมขวาล่าง)
    ctx.font = `${Math.max(9, Math.round(H * 0.062))}px "Sarabun", sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(
      activeOrder ? `ประกันถึง ${thaiDate(activeOrder.warrantyEnd)}` : 'ยังไม่ออกใบ',
      W - 6, H - Math.round(H * 0.075),
    );
    ctx.textAlign = 'left';

    // QR
    if (cfg.showQr && sn) {
      const qr = await getQr(`${location.origin}/warranty?sn=${encodeURIComponent(sn)}`, cfg.qrSize);
      if (qr) ctx.drawImage(qr, cfg.qrX * W, cfg.qrY * H, cfg.qrSize, cfg.qrSize);
    }
  }, [cfg, W, H, activeOrder]);

  useEffect(() => { void paint(canvasRef.current, active); }, [paint, active]);

  function patch(p: Partial<typeof cfg>) {
    const next = db;
    next.settings.sticker = { ...next.settings.sticker, ...p };
    setDb(next);
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

  // ลากย้ายตำแหน่ง S/N บนภาพ
  function onPointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    if (drag) {
      patch({ serialX: Math.min(0.95, Math.max(0, px - drag.x)), serialY: Math.min(0.95, Math.max(0, py - drag.y)) });
    } else if (activeSerial && e.button === 0) {
      setDrag({ x: px - cfg.serialX, y: py - cfg.serialY });
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.ok ? 'ok' : 'err'}>{msg.text}</Notice>}

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
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card title="2) Preview" sub="ลากบนภาพเพื่อย้ายตำแหน่ง S/N · ขนาดจริง {cfg.widthMm}×{cfg.heightMm} มม. @ {cfg.dpi} dpi = {W}×{H} px">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointer}
            onPointerMove={(e) => { if (drag) onPointer(e); }}
            onPointerUp={() => setDrag(null)}
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
          <Card title="3) ตั้งค่า" >
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1"><span className="text-xs text-gray-400">กว้าง (มม.)</span>
                <input type="number" min={10} max={200} className={inputCls} value={cfg.widthMm} onChange={(e) => patch({ widthMm: Number(e.target.value) || 40 })} /></label>
              <label className="space-y-1"><span className="text-xs text-gray-400">สูง (มม.)</span>
                <input type="number" min={5} max={200} className={inputCls} value={cfg.heightMm} onChange={(e) => patch({ heightMm: Number(e.target.value) || 20 })} /></label>
              <label className="space-y-1"><span className="text-xs text-gray-400">DPI</span>
                <input type="number" min={96} max={600} className={inputCls} value={cfg.dpi} onChange={(e) => patch({ dpi: Number(e.target.value) || 300 })} /></label>
              <label className="space-y-1"><span className="text-xs text-gray-400">ขนาดฟอนต์ S/N</span>
                <input type="number" min={8} max={120} className={inputCls} value={cfg.serialSize} onChange={(e) => patch({ serialSize: Number(e.target.value) || 26 })} /></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1"><span className="text-xs text-gray-400">สีตัวอักษร</span>
                <input type="color" className="w-full h-9 rounded bg-slate-900 border border-slate-700" value={cfg.serialColor}
                  onChange={(e) => patch({ serialColor: e.target.value })} /></label>
              <label className="space-y-1"><span className="text-xs text-gray-400">X (0–1)</span>
                <input type="number" step={0.01} min={0} max={1} className={inputCls} value={cfg.serialX} onChange={(e) => patch({ serialX: Number(e.target.value) })} /></label>
              <label className="space-y-1"><span className="text-xs text-gray-400">Y (0–1)</span>
                <input type="number" step={0.01} min={0} max={1} className={inputCls} value={cfg.serialY} onChange={(e) => patch({ serialY: Number(e.target.value) })} /></label>
              <label className="space-y-1"><span className="text-xs text-gray-400">ขนาด QR (px)</span>
                <input type="number" min={24} max={240} className={inputCls} value={cfg.qrSize} onChange={(e) => patch({ qrSize: Number(e.target.value) || 64 })} /></label>
              <label className="space-y-1"><span className="text-xs text-gray-400">QR X (0–1)</span>
                <input type="number" step={0.01} min={0} max={1} className={inputCls} value={cfg.qrX} onChange={(e) => patch({ qrX: Number(e.target.value) })} /></label>
              <label className="space-y-1"><span className="text-xs text-gray-400">QR Y (0–1)</span>
                <input type="number" step={0.01} min={0} max={1} className={inputCls} value={cfg.qrY} onChange={(e) => patch({ qrY: Number(e.target.value) })} /></label>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={cfg.showQr} onChange={(e) => patch({ showQr: e.target.checked })} />
              ใส่ QR Code (สแกนแล้วเปิดหน้าตรวจประกันพร้อม S/N)
            </label>
            <button type="button" className={btnGhost} onClick={() => patch({ serialX: 0.06, serialY: 0.38, serialSize: 26, serialColor: '#111827', qrX: 0.76, qrY: 0.18, qrSize: 64 })}>
              คืนค่าตำแหน่งเริ่มต้น
            </button>
          </Card>
        </div>
      </div>

      <Card title="4) เลือก Serial" sub={`เลือกแล้ว ${picked.size} / ${pool.length}`}>
        {pool.length === 0 ? <Empty>ยังไม่มี serial — ไปที่แท็บ “ออก Serial” ก่อน</Empty> : (
          <div className="grid gap-1.5 max-h-64 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {pool.map((s) => {
              const on = picked.has(s.sn);
              return (
                <label key={s.sn} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs cursor-pointer ${on ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-slate-700 hover:bg-slate-800/40'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(s.sn)} />
                  <span className="mono text-gray-100 flex-1 truncate">{s.sn}</span>
                  <span className="text-[10px] text-gray-500">{s.status === 'SOLD' ? 'ขายแล้ว' : 'ในคลัง'}</span>
                  <button type="button" className="text-[10px] text-cyan-400 hover:underline" onClick={(e) => { e.preventDefault(); setCurrent(s.sn); }}>
                    ดู
                  </button>
                </label>
              );
            })}
          </div>
        )}
        {activeSerial && (
          <p className="text-xs text-gray-500">
            กำลังดู: <span className="mono text-gray-200">{activeSerial.sn}</span>
            {' · '}{modelById(db, activeSerial.modelId)?.name}
            {' · '}วันที่ออก serial {thaiDate(activeSerial.issuedAt)}
          </p>
        )}
      </Card>
    </div>
  );
}