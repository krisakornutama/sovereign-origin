// ──────────────────────────────────────────────────────────��─────────────────
// Stripe webhook signature verification — pure functions (ไม่พึ่ง lib)
// ทำตามแบบเดียวกับ dms.service.ts: HMAC-SHA256 + crypto.timingSafeEqual
// เพราะการเชื่อ body ของ webhook เปล่า = ใครก็ยิงมาบอกว่า "จ่ายแล้ว" ได้
//
// รูปแบบ header ของ Stripe:  stripe-signature: t=<unix>,v1=<hex>,v1=<hex>
// สิ่งที่เซ็นคือ "<timestamp>.<raw body>" — ต้องเป็น BYTE ต้นฉบับ ห้าม parse
// แล้ว stringify ใหม่ เพราะ byte ที่ต่างกันแม้แต่นิดเดียวก็คนละลายเซ็น
// ────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';

/** Stripe แนะนำให้ยอมความต่างของ timestamp ได้ 5 นาที (default 300 วินาที) */
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;

export type SignatureFailure =
  | 'missing_header'
  | 'malformed_header'
  | 'bad_timestamp'
  | 'stale_timestamp'
  | 'bad_signature';

export type SignatureResult = { ok: true } | { ok: false; reason: SignatureFailure };

export interface ParsedStripeSignature {
  ts: number;
  v1: string[];
}

/** แยก header "t=123,v1=abc,v1=def" → { ts, v1[] } · ผิดรูปคืน null */
export function parseStripeSignature(header: string): ParsedStripeSignature | null {
  const tsRaw: string[] = [];
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') tsRaw.push(value);
    else if (key === 'v1') v1.push(value);
  }
  if (tsRaw.length !== 1 || v1.length === 0) return null;
  const ts = Number(tsRaw[0]);
  if (!Number.isFinite(ts) || !Number.isInteger(ts)) return null;
  if (v1.some((s) => !/^[0-9a-f]{64}$/i.test(s))) return null;
  return { ts, v1 };
}

/** คำนวณลายเซ็นที่ถูกต้องของ Stripe (เปิดเผยเพื่อให้เทสต์/เครื่องมือใช้คำนวณคาดหวังได้) */
export function signStripePayload(payload: string, secret: string, ts: number): string {
  return crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
}

export interface VerifyOptions {
  header: string | undefined | string[];
  rawBody: string;
  /** signing secret ของ webhook endpoint (whsec_…) — คนละตัวกับ STRIPE_SECRET_KEY */
  secret: string;
  toleranceSec?: number;
  nowMs?: number;
}

/**
 * ตรวจลายเซ็น Stripe — คืน ok:true เฉพาะเมื่อ t อยู่ใน tolerance และ
 * มี v1 สักตัวที่ตรงกับ HMAC ของ "<ts>.<rawBody>" แบบ constant-time
 */
export function verifyStripeSignature(opts: VerifyOptions): SignatureResult {
  if (!opts.secret) return { ok: false, reason: 'bad_signature' };
  const header = Array.isArray(opts.header) ? opts.header[0] : opts.header;
  if (!header) return { ok: false, reason: 'missing_header' };

  const parsed = parseStripeSignature(header);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  const tolerance = opts.toleranceSec ?? STRIPE_SIGNATURE_TOLERANCE_SEC;
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - parsed.ts) > tolerance) return { ok: false, reason: 'stale_timestamp' };

  const expected = Buffer.from(signStripePayload(opts.rawBody, opts.secret, parsed.ts), 'hex');
  for (const candidate of parsed.v1) {
    const actual = Buffer.from(candidate, 'hex');
    // timingSafeEqual จะ throw ถ้าความยาวไม่เท่ากัน — กันไว้ก่อน
    if (actual.length !== expected.length) continue;
    if (crypto.timingSafeEqual(expected, actual)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}
