// components/business/post/post-clipboard.ts
// ────────────────────────────────────────────────────────────────────────────
// คัดลอกข้อความลงคลิปบอร์ดแบบ "ไม่ล้มหน้าจอ"
//
// ⚠ ทำไมรับ navigator เข้ามาเป็นพารามิเตอร์ ไม่เรียก window.navigator เอง:
//   - เทสต์ Node เรียกไฟล์นี้ตรง ๆ ได้ (ไม่มี window) → พฤติกรรมถูกตรึงด้วยเทสต์จริง
//   - ปุ่มคัดลอกพังเงียบเป็นความผิดพลาดที่ผู้ใช้เชื่อว่าสำเร็จแล้ว (แย่ที่สุด)
//     จึงต้องมีเทสต์คุม "พังแล้วต้องคืน false ให้ UI เตือนได้"
//   - Clipboard API ใช้ไม่ได้เมื่อไม่ใช่ https/ไม่ได้โฟกัส/ผู้ใช้ไม่ให้สิทธิ์ — ต้องคืน false ไม่ใช่ throw
//
// ⚠ pure logic ล้วน: import ได้แค่ `import type` (ดูเหตุผลใน post-model.ts)
// ────────────────────────────────────────────────────────────────────────────

/** รูปร่างของ navigator ที่เราต้องใช้ — รับแคบ ๆ เพื่อให้ส่งของปลอมเข้าเทสต์ได้ */
export interface ClipboardNavLike {
  clipboard?: {
    writeText?: (text: string) => unknown;
  };
}

/**
 * พยายามคัดลอก คืน true เมื่อสำเร็จเท่านั้น
 * - ข้อความว่าง/มีแต่ช่องว่าง → false และ "ไม่แตะคลิปบอร์ดเลย"
 *   (ถ้าคืน true ผู้ใช้จะไปวางแล้วเจอของเก่าค้างอยู่ = สับสน)
 * - ไม่มี Clipboard API / โยน error → false (ผู้ใช้จะได้คัดลอกเอง)
 */
export async function copyVia(nav: ClipboardNavLike | undefined, text: string): Promise<boolean> {
  const body = String(text ?? '');
  if (!body.trim()) return false;

  const write = nav?.clipboard?.writeText;
  if (typeof write !== 'function') return false;

  try {
    await write.call(nav!.clipboard, body);
    return true;
  } catch {
    return false;
  }
}
