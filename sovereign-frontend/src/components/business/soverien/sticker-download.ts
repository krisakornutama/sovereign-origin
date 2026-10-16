// components/business/soverien/sticker-download.ts
// ดาวน์โหลดสติกเกอร์ 1 ใบ หรือทั้งชุดเป็น ZIP (16/10/69)
//
// แยกจาก StickerStudio เพราะไฟล์นั้นชิดเพดาน 400 บรรทัดทุกรอบที่เพิ่มฟีเจอร์
// ⚠ paint ที่ส่งเข้ามาต้องเรียก paintSticker โดย **ไม่ส่ง showGuide** (ค่าว่าง = ไม่วาดกรอบ)
//   เจ้าของเจอ 14/10/69: "แถมมีกรอบด้วย…ไม่ให้ผลลัพธ์มีกรอบด้วยดีกว่า"
import { buildZip, downloadBlob, canvasToPngBytes } from './zip';

export type PaintFn = (canvas: HTMLCanvasElement, sn: string, scale: number) => Promise<void>;

/** ดาวน์โหลด 1 ใบ */
export async function downloadOne(paint: PaintFn, sn: string, dlScale: number): Promise<void> {
  const c = document.createElement('canvas');
  await paint(c, sn, dlScale);
  downloadBlob(new Blob([await canvasToPngBytes(c) as BlobPart], { type: 'image/png' }), `${sn}.png`);
}

/** ดาวน์โหลดทั้งชุดรวมเป็น ZIP ไฟล์เดียว — คืนจำนวนไฟล์ที่ทำได้ */
export async function downloadZip(paint: PaintFn, sns: string[], dlScale: number): Promise<number> {
  const files: Array<{ name: string; data: Uint8Array }> = [];
  for (const sn of sns) {
    const c = document.createElement('canvas');
    await paint(c, sn, dlScale);
    files.push({ name: `${sn}.png`, data: await canvasToPngBytes(c) });
  }
  if (!files.length) throw new Error('ยังไม่ได้เลือก serial');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  downloadBlob(buildZip(files), `soverien-stickers-${stamp}.zip`);
  return files.length;
}
