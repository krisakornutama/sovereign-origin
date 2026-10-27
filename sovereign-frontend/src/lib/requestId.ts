// src/lib/requestId.ts
// ── request-id ฝั่งเบราว์เซอร์ ────────────────────────────────────────────────
// ทุกคำขอที่ออกจากหน้ามีเลขประจำตัว → backend เก็บเลขเดียวกันใน log
// ⇒ ผู้ใช้แจ้ง "หน้าพังตอนกดบันทึก" มา เราหา log บรรทัดนั้นเจอทันที (ไม่ต้องเดาจากเวลา)
//
// ห้าม throw: WebView เก่า ๆ (LINE/Facebook in-app) ปิด crypto บางตัว
// ถ้าสร้างไม่ได้จริง ๆ ยังต้องคืนค่ารูปแบบที่ปลอดภัย (backend รับได้)
export function newRequestId(): string {
  try {
    const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // ตกไปใช้ fallback ด้านล่าง
  }
  // ตัวอักษรที่ใช้ได้ตามกติกาของ backend: A-Z a-z 0-9 . _ : - (ยาวไม่เกิน 64)
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── idempotency-key ฝั่งเบราว์เซอร์ ──────────────────────────────────────────
// 1 คีย์ = 1 "การกระทำของผู้ใช้" (กดบันทึก 1 ครั้ง) ไม่ใช่ 1 request
// ⇒ ถ้าเน็ตหลุดแล้วระบบส่งซ้ำ/คิวออฟไลน์ replay ภายหลัง backend รู้ว่าเป็นงานเดียวกัน
// รูปแบบต้องผ่านกติกา backend: 8-200 ตัว จาก A-Z a-z 0-9 . _ : -
export function newIdempotencyKey(): string {
  try {
    const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined;
    if (c && typeof c.randomUUID === 'function') return `idem-${c.randomUUID()}`;
  } catch {
    // ตกไปใช้ fallback ด้านล่าง
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
