// ─────────────────────────────────────────────────────────────
// ota.access.ts — กติกา "ใครโหลดเฟิร์มแวร์ได้" และ "ให้ deploy ไปที่ URL แบบไหน"
//
// แยกออกมาเป็นฟังก์ชันล้วน เพื่อให้ทดสอบได้โดยไม่ต้องมี network/DB
// และเพื่อไม่ให้กติกาความปลอดภัยกระจัดกระจายอยู่ใน handler
// ─────────────────────────────────────────────────────────────
import { timingSafeEqual } from 'node:crypto';
import { isPrivatePeer, normalizePeerAddress } from '../../lib/net';

/**
 * เทียบค่าลับแบบคงเวลา — ไม่ตั้งค่า (expected ว่าง) = ไม่ผ่านเสมอ
 *
 * ใช้แทน `provided !== expected` ที่เทียบทีละไบต์จนเจอความต่าง (จับเวลาเดาได้)
 */
export function secureTokenMatch(provided: unknown, expected: unknown): boolean {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // ความยาวต่างกันไม่ใช่ความลับ (รู้ได้จาก request อยู่แล้ว) — กัน timingSafeEqual โยน error
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * อนุญาตให้ดาวน์โหลดเฟิร์มแวร์หรือไม่
 *
 * - ตั้ง OTA_TOKEN แล้ว → ต้องส่ง token มาตรง (ไม่ว่ามาจาก IP ไหน)
 * - ไม่ได้ตั้ง (ค่าเริ่มต้น) → เปิดเฉพาะ peer ที่อยู่ในวงภายใน/loopback
 *   เพื่อให้ ESP ในบ้านอัปเดตได้โดยไม่ต้องมี token แต่ปิดประตูสู่ IP สาธารณะ
 */
export function isDownloadAllowed(input: {
  peer: string | null | undefined;
  configuredToken: string;
  providedToken: unknown;
}): boolean {
  if (input.configuredToken) return secureTokenMatch(input.providedToken, input.configuredToken);
  const peer = normalizePeerAddress(input.peer);
  return peer.length > 0 && isPrivatePeer(peer);
}

export type DeployUrlCheck = { ok: true } | { ok: false; reason: string };

/**
 * URL ที่ส่งให้อุปกรณ์ไปโหลดต้องไม่วิ่งแบบอ่านได้กลางทางข้ามอินเทอร์เน็ต
 *
 * ตัว firmware ไม่มีลายเซ็นให้อุปกรณ์ตรวจ (ข้อจำกัดที่บันทึกไว้ในคิว) ⇒ ถ้าให้ ESP
 * ดาวน์โหลดผ่าน http สาธารณะ ใครก็ตามบนเส้นทางเสิร์ฟ .bin ปลอมแทนได้
 * จึงยอมรับ: https ทุกที่, http เฉพาะ host ที่เป็น loopback/วงภายใน
 */
export function checkDeployBaseUrl(baseUrl: string): DeployUrlCheck {
  const raw = (baseUrl || '').trim();
  if (!raw) return { ok: false, reason: 'OTA_BASE_URL ว่าง — ต้องตั้ง URL ที่อุปกรณ์เข้าถึงได้' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'OTA_BASE_URL ไม่ใช่ URL ที่ถูกต้อง' };
  }
  if (url.protocol === 'https:') return { ok: true };
  if (url.protocol !== 'http:') {
    return { ok: false, reason: 'OTA_BASE_URL ต้องเป็น http หรือ https เท่านั้น' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || isPrivatePeer(host)) return { ok: true };
  return {
    ok: false,
    reason: 'http ไปยัง host สาธารณะไม่ได้ — token และเฟิร์มแวร์จะวิ่งแบบอ่านได้กลางทาง; ใช้วงภายในหรือ https',
  };
}

/** อ่านสวิตช์ OTA_ALLOW_QUERY_TOKEN — เปิดเฉพาะค่าที่ชัดเจน ค่าอื่น/ไม่ตั้ง = ปิด (fail closed) */
export function parseAllowQueryToken(raw: string | null | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

/**
 * เลือก token ที่จะใช้ตรวจการดาวน์โหลด
 *
 * - header มาก่อนเสมอ (ไม่ติด log/ประวัติ URL)
 * - query ใช้ได้เฉพาะเมื่อผู้ดูแลเปิดสวิตช์ชั่วคราวให้อุปกรณ์รุ่นเดิม
 * - ไม่มีทางได้ token ⇒ null (ผู้เรียกตอบ 401)
 */
export function resolveDownloadToken(input: {
  headerToken: unknown;
  queryToken: unknown;
  allowQueryToken: boolean;
}): string | null {
  const header = typeof input.headerToken === 'string' ? input.headerToken.trim() : '';
  if (header) return header;
  if (!input.allowQueryToken) return null;
  const query = typeof input.queryToken === 'string' ? input.queryToken.trim() : '';
  return query || null;
}
