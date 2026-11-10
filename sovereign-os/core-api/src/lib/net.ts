// ─────────────────────────────────────────────────────────────
// net.ts — ความจริงเรื่อง "ใครคือผู้เรียก" ที่ header ปลอมไม่ได้
//
// ทำไมต้องมี: Express ตัดสิน `req.ip` จาก X-Forwarded-For เมื่อเปิด `trust proxy`
// ซึ่ง header นี้ client เป็นคนใส่เอง ⇒ ถ้า API เข้าถึงได้ตรง (ไม่มี reverse proxy
// คั่นจริง) ผู้เรียกเลือกได้ว่าจะเป็นใคร: เปลี่ยน IP ทุกครั้งเพื่อหลบ rate limit,
// ปลอม IP ใน audit log, หรืออ้างว่าเป็น 127.0.0.1 เพื่อผ่านด่าน loopback
//
// กติกาที่ไฟล์นี้บังคับ:
//   1) ค่าเริ่มต้น = ไม่เชื่อ proxy (false) — ปลอดภัยไว้ก่อน ผู้ดูแลต้องเปิดเอง
//   2) ค่าที่ไม่รู้จัก/กำกวม = ปิด (fail closed) ไม่ใช่ "เชื่อทุก hop"
//      ('true' ใน Express แปลว่าเชื่อทุก hop — อันตรายกว่าการปิด จึงไม่รับ)
//   3) ด่าน loopback ตัดสินจาก peer ของ TCP (socket.remoteAddress) ไม่ใช่ req.ip
//      และเมื่อเปิด trust proxy แล้วจะไม่ถือว่า loopback เลย เพราะ peer ทุกคนคือ proxy
// ─────────────────────────────────────────────────────────────
import type { Request } from 'express';

/** ค่าที่ Express รับได้สำหรับ `app.set('trust proxy', …)` */
export type TrustProxySetting = false | number | 'loopback';

/**
 * แปลงค่า TRUST_PROXY จาก env เป็นค่าที่ปลอดภัย
 *
 * - ไม่ตั้ง / ว่าง / 0 / false / off / no / none → false (ไม่เชื่อ header)
 * - ตัวเลขบวก (จำนวน hop) → number
 * - loopback → 'loopback' (เชื่อเฉพาะ proxy ที่มาจาก loopback)
 * - อย่างอื่น (รวม 'true', '*', 'all', ตัวเลขติดลบ/ทศนิยม) → false
 */
export function resolveTrustProxy(raw: string | null | undefined): TrustProxySetting {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return false;
  if (['0', 'false', 'off', 'no', 'none'].includes(value)) return false;
  if (value === 'loopback') return 'loopback';
  // เฉพาะจำนวนเต็มบวก — '1.5'/'-1'/'01x' ตกไปที่ false
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops > 0 ? hops : false;
  }
  return false;
}

/** ตัดรูป `::ffff:127.0.0.1` / `[::1]` ให้เหลือที่อยู่เทียบได้ */
export function normalizePeerAddress(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().replace(/^\[|\]$/g, '');
  return value.toLowerCase().startsWith('::ffff:') ? value.slice(7) : value.toLowerCase();
}

/** ที่อยู่ของ peer เป็น loopback จริงหรือไม่ (127.0.0.0/8 หรือ ::1) */
export function isLoopbackPeer(raw: string | null | undefined): boolean {
  const address = normalizePeerAddress(raw);
  if (!address) return false;
  if (address === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}

/**
 * คำขอนี้มาจาก loopback โดยตรงหรือไม่ — ใช้เป็นด่าน "ให้ผ่านเฉพาะเครื่องตัวเอง"
 *
 * ตัดสินจาก peer ของ TCP เท่านั้น (header ปลอมไม่ได้) และเมื่อผู้ดูแลเปิด trust proxy
 * แปลว่ามี proxy อยู่ข้างหน้า ⇒ peer ที่เห็นคือ proxy ไม่ใช่ผู้เรียกจริง จึงคืน false
 * เพื่อบังคับให้ใช้ token แทนการเดาจาก IP
 */
export function isLoopbackClient(req: Request, trustProxy: TrustProxySetting): boolean {
  if (trustProxy !== false) return false;
  return isLoopbackPeer(req.socket?.remoteAddress);
}
