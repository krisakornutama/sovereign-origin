// components/business/soverien/sticker-layout.ts
// สูตรจัดวางสติกเกอร์ทั้งหมด — ของบริสุทธิ์ ไม่แตะ DOM เลย (ทดสอบได้ครบทุกเคส)
//
// แยกจาก store.ts เพราะ store.ts ชิดเพดาน 400 บรรทัดแล้ว (14/10/69)
// และเพราะส่วนนี้เป็น "คณิตศาสตร์" ล้วน ไม่เกี่ยวกับการอ่าน/เขียน localStorage
import type { StickerAlign, StickerFit } from './types';

/** ปัดทศนิยมให้เหลือ 3 ตำแหน่ง — กันเลขยาวอย่าง 0.3787364104 ในช่องกรอก */
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * กรอบที่ใช้วาดภาพต้นแบบลงบนสติกเกอร์
 * @param fit   cover = เต็มจอแล้วตัดขอบ · contain = เห็นทั้งภาพมีขอบว่าง · stretch = ยืดเต็มจอ
 * @param scale ตัวคูณขยาย/ย่อเพิ่ม (1 = ตามโหมด)
 * @param ox/oy เลื่อนภาพ (-1..1 คิดเป็นสัดส่วนของขนาดสติกเกอร์)
 */
export function fitImageRect(
  imgW: number, imgH: number, W: number, H: number,
  fit: StickerFit, scale = 1, ox = 0, oy = 0,
): Rect {
  if (imgW <= 0 || imgH <= 0 || W <= 0 || H <= 0) return { x: 0, y: 0, w: W, h: H };
  if (fit === 'stretch') return { x: ox * W * 0.5, y: oy * H * 0.5, w: W, h: H };

  const base = fit === 'cover'
    ? Math.max(W / imgW, H / imgH)
    : Math.min(W / imgW, H / imgH);

  const k = base * clamp(scale, 0.2, 3);
  const w = imgW * k;
  const h = imgH * k;
  return {
    x: (W - w) / 2 + clamp(ox, -1, 1) * W,
    y: (H - h) / 2 + clamp(oy, -1, 1) * H,
    w, h,
  };
}

/** ตำแหน่งเริ่มต้นของข้อความ ตามการจัดวาง (x คือขอบซ้ายของกล่องข้อความ) */
export function alignOffsetX(align: StickerAlign, boxW: number, W: number, anchorX: number): number {
  if (align === 'center') return anchorX - boxW / 2;
  if (align === 'right') return anchorX - boxW;
  return anchorX;
}

/** ขนาดฟอนต์ที่พอดีกับช่องว่างที่ให้ไว้ (กันตัวอักษรล้นขอบสติกเกอร์) */
export function fitFontSize(text: string, maxW: number, want: number, min = 8): number {
  if (!text || maxW <= 0) return want;
  // ตัวอักษร monospace กว้าง ≈ 0.62em ต่อตัวอักษร
  const perChar = 0.62 * want;
  const need = perChar * text.length;
  if (need <= maxW) return want;
  return Math.max(min, Math.round((want * maxW) / need));
}

/**
 * ส่วนสูงของป้ายที่ทำให้พอดีกับสัดส่วนภาพต้นแบบ (14/10/69)
 * คงความกว้างไว้ แล้วคำนวณส่วนสูง — ทำให้ "จับขนาดให้ตรง" ได้ในปุ่มเดียว
 * แทนที่จะให้ผู้ใช้เดาค่าสองตัวจนภาพพอดี
 */
export function stickerHeightFor(imgW: number, imgH: number, widthMm: number): number {
  if (!Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0) return widthMm;
  if (!Number.isFinite(widthMm) || widthMm <= 0) return 1;
  const h = (widthMm * imgH) / imgW;
  if (!Number.isFinite(h) || h <= 0) return 1;
  return Math.round(h * 10) / 10;
}