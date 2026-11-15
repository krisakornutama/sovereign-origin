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

/**
 * ที่อยู่วงภายใน (LAN / link-local / ULA) หรือไม่ — ใช้เป็นด่าน "อนุญาตเฉพาะในบ้าน"
 *
 * ใช้คู่กับ isLoopbackPeer สำหรับ endpoint ที่อุปกรณ์ในบ้านต้องเรียกเองโดยไม่ต้องมี token
 * รับเฉพาะรูปแบบที่เขียนชัดเจน: IPv4 สี่ช่วง 0–255 หรือ IPv6 (ไม่รองรับ hostname)
 */
export function isPrivatePeer(raw: string | null | undefined): boolean {
  const address = normalizePeerAddress(raw);
  if (!address) return false;
  if (isLoopbackPeer(address)) return true;

  // IPv6: fe80::/10 (link-local) และ fc00::/7 (ULA)
  if (address.includes(':')) {
    return /^fe[89ab][0-9a-f]:/.test(address) || /^f[cd][0-9a-f]{2}:/.test(address);
  }

  const parts = address.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}
