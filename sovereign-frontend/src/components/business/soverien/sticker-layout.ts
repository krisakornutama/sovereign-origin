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

/**
 * กรอบภาพต้นแบบเมื่อเจ้าของกำหนดขนาดเป็นมิลลิเมตรเอง (16/10/69)
 *
 * เจ้าของถาม: "ผมสามารถกำหนดความกว้างและสูงของภาพได้มั้ย เพราะภาพมันเล็กกว่าที่ควรจะเป็น"
 *   → ต้องกำหนดเป็นมิลลิเมตร ไม่ใช่พิกเซล เพราะเจ้าของคิดเป็นมิลลิเมตรเสมอ (ขนาดป้ายก็เป็น มม.)
 *
 * @param exactW/exactH ขนาดภาพเป็น px (0 = ไม่ได้กำหนด → คำนวณอีกข้างจากสัดส่วนภาพ)
 * @param ox/oy เลื่อนภาพ (-1..1 คิดเป็นสัดส่วนของขนาดสติกเกอร์)
 */
export function exactRect(
  imgW: number, imgH: number, W: number, H: number,
  exactW: number, exactH: number, ox = 0, oy = 0,
): Rect {
  const aspect = imgW > 0 && imgH > 0 ? imgH / imgW : 1;
  // ใส่มาแค่ข้างเดียว → อีกข้างคำนวณตามสัดส่วนภาพ (ไม่ให้ภาพบิดถ้าไม่ได้ตั้งใจ)
  const w = exactW > 0 ? exactW : (exactH > 0 ? exactH / aspect : W);
  const h = exactH > 0 ? exactH : w * aspect;
  return {
    x: (W - w) / 2 + clamp(ox, -1, 1) * W,
    y: (H - h) / 2 + clamp(oy, -1, 1) * H,
    w, h,
  };
}

/**
 * จัดวางสติกเกอร์หลายใบลงกระดาษ 1 แผ่น (14/10/69)
 *
 * เจ้าของต้องการ: "เรียงเป็นไฟล์ภาพในกระดาษ 1 แผ่น พิมพ์ได้ 8-16 ภาพ หรือมากกว่านั้น"
 *   → ยิ่งขอบกระดาษเหลือเยอะและระยะห่างยิ่งน้อย ก็ยิ่งได้หลายใบ
 *   → ตัวอย่าง: A4 ขอบ 10 มม. ห่าง 2 มม. ป้าย 30×22.5 มม. → 6 × 11 = 66 ใบ
 */
export type SheetPlan = {
  cols: number; rows: number; capacity: number;
  pageWpx: number; pageHpx: number;
  cellWpx: number; cellHpx: number;
  originXpx: number; originYpx: number;
};

export function planSheet(o: {
  paperWMm: number; paperHMm: number; dpi: number;
  marginMm: number; gapMm: number; stickerWMm: number; stickerHMm: number;
}): SheetPlan {
  const dpi = o.dpi > 0 ? o.dpi : 300;
  const mm = (v: number) => (v / 25.4) * dpi;
  // กันค่า 0/ติดลบ — ไม่งั้นหารด้วย 0 ได้ Infinity แล้วลูปวนอนึบ (เทสต์จับได้ 14/10/69)
  const sw = o.stickerWMm > 0 ? o.stickerWMm : 1;
  const sh = o.stickerHMm > 0 ? o.stickerHMm : 1;
  const gap = o.gapMm >= 0 ? o.gapMm : 0;
  const usableW = Math.max(1, o.paperWMm - o.marginMm * 2);
  const usableH = Math.max(1, o.paperHMm - o.marginMm * 2);

  const cols = Math.max(1, Math.floor((usableW + gap) / (sw + gap)));
  const rows = Math.max(1, Math.floor((usableH + gap) / (sh + gap)));

  const cellWpx = mm(sw);
  const cellHpx = mm(sh);
  // จัดให้ชุดเรียงอยู่กลางกระดาษเสมอ (ขอบซ้ายขวาอาจเหลือไม่เท่ากัน)
  const usedW = cols * cellWpx + (cols - 1) * mm(gap);
  const usedH = rows * cellHpx + (rows - 1) * mm(gap);

  return {
    cols, rows, capacity: cols * rows,
    pageWpx: Math.round(mm(o.paperWMm)),
    pageHpx: Math.round(mm(o.paperHMm)),
    cellWpx: Math.round(cellWpx),
    cellHpx: Math.round(cellHpx),
    originXpx: Math.round((mm(o.paperWMm) - usedW) / 2),
    originYpx: Math.round((mm(o.paperHMm) - usedH) / 2),
  };
}

/** ตำแหน่งของชิ้นที่ i (เริ่มที่ 0) บนแผ่น */
export function sheetCellXY(plan: SheetPlan, i: number, gapPx: number) {
  const col = i % plan.cols;
  const row = Math.floor(i / plan.cols);
  return {
    x: plan.originXpx + col * (plan.cellWpx + gapPx),
    y: plan.originYpx + row * (plan.cellHpx + gapPx),
    col, row,
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