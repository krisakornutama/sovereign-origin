// components/business/soverien/sticker-frame.ts
// วาดกรอบประกอบตำแหน่ง S/N (16/10/69)
//
// แยกไฟล์เดี่ยว ๆ โดยไม่ import อะไรเลย เพราะ:
//   1. Node เรียก .ts ที่ import แบบไม่มีนามสกุลไฟล์ไม่ได้ → เทสต์จะ import sticker-draw.ts ไม่ขึ้น
//      (sticker-layout.ts / store.ts ใช้ได้เพราะไม่มี import จริง)
//   2. จะได้พิสูจน์พฤติกรรมการวาดกรอบได้จริงใน Node แทนที่จะไปนับสีพิกเซล
//
// ⚠ ข้อผิดพลาดเดิม: เคยเขียนกรอบนี้ใน sticker-draw.ts แล้ววาด**ทุกครั้ง** รวมทั้งตอนดาวน์โหลด
//   เจ้าของเจอ 14/10/69: "แถมมีกรอบด้วย…ไม่ให้ผลลัพธ์มีกรอบด้วยดีกว่า"
export const GUIDE_COLOR = 'rgba(16,185,129,.55)';

/** วางกรอบประกอบรอบกล่องข้อความ — เรียกเฉพาะตอนดูหน้าจอเท่านั้น */
export function drawGuideFrame(
  ctx: CanvasRenderingContext2D, x: number, y: number, textW: number, fontPx: number,
): void {
  ctx.save();
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 4, y - fontPx / 2 - 4, textW + 8, fontPx + 8);
  ctx.restore();
}
