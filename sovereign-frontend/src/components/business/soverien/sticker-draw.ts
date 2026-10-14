// components/business/soverien/sticker-draw.ts
// วาดสติกเกอร์ลง canvas — แยกจาก StickerStudio เพราะไฟล์นั้นชิดเพดาน 400 บรรทัด
// ใช้ร่วมกันทั้งหน้าตัวอย่างและไฟล์ที่ดาวน์โหลด (ต้องเป็นฟังก์ชันเดียวกันเสมอ
// ไม่งั้นสิ่งที่เห็นหน้าจอกับไฟล์ที่ได้จริงจะไม่ตรงกัน)
import type { StickerConfig } from './types';
import { fitImageRect, alignOffsetX, fitFontSize } from './sticker-layout';
import { getApiUrl } from '../../../lib/config';

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('โหลดภาพไม่สำเร็จ'));
    img.src = src;
  });
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

/** วางพื้นหลังโปร่งใสหลังข้อความ ให้อ่านออกแม้ทับภาพที่มีลายเข้ม (14/10/69) */
export function plate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  const padX = 6, padY = 4, r = 4;
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x - padX, y - h / 2 - padY, w + padX * 2, h + padY * 2, r);
  else ctx.rect(x - padX, y - h / 2 - padY, w + padX * 2, h + padY * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * วาดสติกเกอร์ 1 ใบลง canvas
 * @param warrantyText ข้อความวันสิ้นประกัน (ค่าว่าง = ยังไม่ออกใบ)
 * @param origin ที่อยู่เครื่อง ใช้ต่อท้าย URL ของ QR
 */
export async function paintSticker(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  cfg: StickerConfig, sn: string, warrantyText: string, origin: string,
) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ภาพต้นแบบ — ย่อ/ขยาย/เลื่อนได้ตามที่ตั้ง (เดิม hardcode cover → ตัดขอบจนเห็นแค่ส่วนกลาง)
  const tpl = cfg.templateDataUrl;
  if (tpl) {
    try {
      const img = await loadImage(tpl);
      const r = fitImageRect(img.width, img.height, W, H, cfg.tplFit, cfg.tplScale, cfg.tplX, cfg.tplY);
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } catch { /* ไม่มีภาพต้นแบบ = ใช้พื้นขาวล้วน */ }
  }

  const text = sn || 'S/N';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // ── S/N ──
  const fontPx = fitFontSize(text, W - 10, cfg.serialSize);
  ctx.font = `600 ${fontPx}px "JetBrains Mono", Consolas, monospace`;
  const tw = ctx.measureText(text).width;
  const bx = alignOffsetX(cfg.serialAlign, tw, W, cfg.serialX * W);
  const by = cfg.serialY * H;

  if (cfg.serialPlate) plate(ctx, bx, by, tw, fontPx, cfg.serialPlateColor);

  // เส้นคั่นช่วยจัดตำแหน่ง — วัดจากความกว้างจริงของข้อความ ไม่เดาเอง
  ctx.save();
  ctx.strokeStyle = 'rgba(16,185,129,.55)';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeRect(bx - 4, by - fontPx / 2 - 4, tw + 8, fontPx + 8);
  ctx.restore();

  ctx.fillStyle = cfg.serialColor;
  ctx.fillText(text, bx, by);

  // ── วันสิ้นสุดประกัน (มุมขวาล่าง) ──
  if (cfg.showWarranty && warrantyText) {
    const wf = Math.max(9, Math.round(H * 0.062));
    ctx.font = `${wf}px "Sarabun", sans-serif`;
    const ww = ctx.measureText(warrantyText).width;
    const wy = H - Math.round(H * 0.075);
    if (cfg.serialPlate) plate(ctx, W - 6 - ww, wy, ww, wf, cfg.serialPlateColor);
    ctx.textAlign = 'right';
    ctx.fillStyle = cfg.warrantyColor;
    ctx.fillText(warrantyText, W - 6, wy);
    ctx.textAlign = 'left';
  }

  // QR
  if (cfg.showQr && sn) {
    const base = (cfg.qrBaseUrl ?? '').trim() || origin;
    const qr = await getQr(`${base.replace(/\/+$/, '')}/warranty?sn=${encodeURIComponent(sn)}`, cfg.qrSize);
    if (qr) ctx.drawImage(qr, cfg.qrX * W, cfg.qrY * H, cfg.qrSize, cfg.qrSize);
  }
}