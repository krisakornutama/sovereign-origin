// components/business/soverien/sticker-fonts.ts
// ฟอนต์สำหรับข้อความบนป้าย (16/10/69)
//
// เจ้าของบอก: "Font ของผมคือ font Garuda … ถ้าคุณไม่ปรับ font เป็นแบบนี้
//                งั้นก็ควรมี font ให้ผมเลือก เพื่อที่ผมจะได้ปรับต้นแบบกับ font ให้เป็นรูปแบบเดียวกัน"
//   → Garuda มีอยู่จริงในเครื่อง (C:\Windows\Fonts\GARA.TTF) ใช้ได้เลย
//   → แต่ยังให้เลือกได้ เผื่อเจ้าของอยากใช้ฟอนต์อื่น หรือเครื่องอื่นไม่มี Garuda
//
// ⚠ กับดักสำคัญ: canvas ไม่บอกว่าฟอนต์หาย — ถ้าฟอนต์ไม่มีในเครื่อง
//   มันจะเงียบ ๆ ไปใช้ฟอนต์สำรอง ผู้ใช้เห็นป้ายออกมาเป็นฟอนต์ผิดแต่ไม่รู้ว่าสาเหตุ
//   → ต้องเช็ค isFontAvailable() ก่อนเสมอ (see below)

export type StickerFont = {
  /** ชื่อที่ใช้กับ ctx.font — ต้องตรงกับชื่อที่ระบบติดตั้งไว้พอดี */
  css: string;
  /** ชื่อที่แสดงให้เจ้าของเห็น */
  label: string;
  /** หมายเหตุสั้น ๆ ว่าฟอนต์นี้เหมาะกับอะไร */
  note: string;
};

/**
 * รายการฟอนต์ที่เสนอให้เลือก — เรียงตามที่เจ้าของใช้จริงก่อน
 * ทั้งหมดนี้เป็นฟอนต์ที่ติดมากับ Windows ไม่ต้องดาวน์โหลดอะไรเพิ่ม
 * (ฟอนต์เว็บอย่าง Sarabun/Inter ที่ ยังทำงานอยู่ ถ้าออกจากเครื่องนี้จะไม่มีให้ใช้)
 */
export const STICKER_FONTS: StickerFont[] = [
  { css: 'Garuda', label: 'Garuda', note: 'ฟอนต์ที่เจ้าของใช้ (ค่าเริ่มต้น)' },
  { css: 'Tahoma', label: 'Tahoma', note: 'อ่านง่าย มีทุกเครื่อง' },
  { css: 'Leelawadee UI', label: 'Leelawadee UI', note: 'ฟอนต์มาตรฐาน Windows 10 ขึ้นไป' },
  { css: 'Cordia New', label: 'Cordia New', note: 'หน้าตาแบบเอกสารราชการ' },
  { css: 'Angsana New', label: 'Angsana New', note: 'หยาบ ใช้เวลาต้องการขนาดเล็ก' },
  { css: 'Segoe UI', label: 'Segoe UI', note: 'ฟอนต์มาตรฐาน Windows' },
  { css: 'Consolas', label: 'Consolas', note: 'ตัวเลขเรียงตรง เหมาะกับ S/N' },
  { css: 'monospace', label: 'Mono (สำรอง)', note: 'ใช้ได้แน่นอนทุกเครื่อง แต่ไม่ใช่ Garuda' },
];

/** ฟอนต์ที่ใช้ถ้าเจ้าของยังไม่ได้เลือกอะไร */
export const DEFAULT_FONT = 'Garuda';

/**
 * ประกอบเป็นค่า ctx.font
 *
 * ⚠ ชื่อฟอนต์มีช่องว่างได้ (เช่น "Leelawadee UI") ต้องห่อด้วยอัญประกาศเสมอ
 *   ไม่งั้น canvas จะตัดที่ช่องว่างแล้วหาไม่เจอ → กลายเป็นฟอนต์สำรองเงียบ ๆ
 */
export function fontCss(family: string, sizePx: number, bold: boolean): string {
  const px = Number.isFinite(sizePx) && sizePx > 0 ? Math.round(sizePx) : 16;
  const name = family && family.trim() ? family.trim() : DEFAULT_FONT;
  return `${bold ? '700' : '400'} ${px}px "${name}"`;
}

/** กันชื่อฟอนต์แอบอักขระ — ใส่ลงใน ctx.font ได้เท่านั้น (กันโค้ดประกอบ CSS ที่เพี้ยน) */
export function safeFontName(family: string): string {
  const name = family && family.trim() ? family.trim() : DEFAULT_FONT;
  return name.replace(/["\\;{}]/g, '').slice(0, 64) || DEFAULT_FONT;
}

/**
 * ฟอนต์นี้มีอยู่จริงในเครื่องนี้ไหม
 *
 * `document.fonts.check()` คืนค่า true เสมอถ้าเป็นฟอนต์ที่ระบบติดตั้งไว้แล้ว
 * แต่คืน false ถ้าเป็นฟอนต์เว็บที่ยังไม่โหลด — ซึ่งคือสิ่งที่เราอยากรู้
 * เรียกฝั่งเบราว์เซอร์เท่านั้น (ฝั่งเซิร์ฟเวอร์ไม่มี document)
 */
export function isFontAvailable(family: string): boolean {
  if (typeof document === 'undefined' || !document.fonts?.check) return false;
  const name = safeFontName(family);
  // monospace/sans-serif เป็นค่าสำรองของ CSS ไม่ต้องเช็ค
  if (['monospace', 'sans-serif', 'serif'].includes(name.toLowerCase())) return true;
  try {
    return document.fonts.check(`16px "${name}"`);
  } catch {
    return false;
  }
}
