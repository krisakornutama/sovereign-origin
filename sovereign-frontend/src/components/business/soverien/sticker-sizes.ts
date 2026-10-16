// components/business/soverien/sticker-sizes.ts
// ขนาดป้ายที่เลือกได้แบบคลิกเดียว (16/10/69)
//
// เจ้าของวัดกรอบอุปกรณ์เองได้ 8.1 × 5.5 ซม. → 81 × 55 มม.
//   ปัญหาคือถ้าเปลี่ยนแค่ widthMm/heightMm แล้วลืม serialSize
//   ขนาดป้ายจะใหญ่ขึ้น 1.6 เท่า แต่ตัวเลขยังเล็กเท่าเดิม = อ่านไม่ออก
//   → ทุกขนาดต้องผูก serialSize ไว้ด้วย (คิดเป็น % ของความกว้างป้าย จะได้ผลเหมือนกันทุกขนาด)

export type StickerSize = {
  key: string;
  label: string;
  widthMm: number;
  heightMm: number;
};

/** ขนาดป้ายที่เสนอให้ — เรียงตามที่ใช้จริงบ่อยที่สุด */
export const STICKER_SIZES: StickerSize[] = [
  { key: 'device-81x55', label: 'กรอบอุปกรณ์ 81×55', widthMm: 81, heightMm: 55 },
  { key: 'label-50x30', label: 'ป้าย 50×30', widthMm: 50, heightMm: 30 },
  { key: 'label-40x20', label: 'ป้าย 40×20', widthMm: 40, heightMm: 20 },
  { key: 'label-90x50', label: 'ป้ายใหญ่ 90×50', widthMm: 90, heightMm: 50 },
];

/** สัดส่วนความสูงตัวอักษรเทียบความกว้างป้าย — 5% ดูสมส่วนทุกขนาด */
export const SERIAL_SIZE_RATIO = 0.05;

/** ขนาดตัวอักษร (px) ที่เหมาะกับป้ายกว้างเท่านี้ที่ 300 dpi */
export function serialSizeFor(widthMm: number, dpi: number): number {
  const px = ((widthMm / 25.4) * dpi) * SERIAL_SIZE_RATIO;
  return Math.max(8, Math.min(400, Math.round(px)));
}

/** ค่าที่ต้อง patch เวลาเปลี่ยนขนาดป้าย (รวมขนาดตัวอักษรให้ตรงกัน) */
export function sizePatch(size: StickerSize, dpi: number) {
  return {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    serialSize: serialSizeFor(size.widthMm, dpi),
  };
}

/** ขนาดที่เจ้าของใช้จริงถูกอยู่ในรายการไหม (ใช้ไฮไลต์ปุ่ม) */
export function matchSize(widthMm: number, heightMm: number): string | null {
  return STICKER_SIZES.find((s) => s.widthMm === widthMm && s.heightMm === heightMm)?.key ?? null;
}
