// ─────────────────────────────────────────────────────────────────────────────
// license.service.ts — ไลเซนส์ออฟไลน์: เจ้าของเซ็น, เครื่องลูกค้าตรวจเอง
//
// ทำไมต้องมี: docs/SELL-SOURCE-CODE-AGENT-PROMPT.md §2 ระบุว่า "ระบบ license /
// activation / download ไม่มีแม้แต่บรรทัดเดียว" — ขายซอร์สโค้ดแล้วไม่มีอะไรผูกสิทธิ์
// ระบบนี้จึงเป็นชั้นล่างสุดที่ทำให้ "ขายเองได้": ซื้อ → ได้ token → ใส่ .env → ตรวจในเครื่อง
//
// กติกาที่บังคับ (fail-closed ทุกข้อ):
//   1) อ่าน token ผิดรูป/ลายเซ็นไม่ตรง = ไม่ผ่าน ห้ามเดาต่อ
//   2) ผูกเครื่อง: machineHashes ไม่ว่าง → ต้องมี machineId ที่ hash ตรงเท่านั้น
//   3) หมดอายุ = ไม่ผ่าน (ของที่ซื้อขาด = expiresAt null)
//   4) ไม่มี public key = ไม่ผ่าน (ไม่มีทางตรวจ = ไม่ไว้ใจ)
//
// สิ่งที่ไม่ทำโดยเจตนา: ต่อเน็ต, เก็บ private key, revoke ออนไลน์.
// การ revoke ทำด้วย "อายุสั้น + ต่ออายุ" (ดู docs/LICENSE-SELLING.md §5)
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

export type LicenseTier = 'home' | 'business' | 'pro';

export const LICENSE_TIERS: readonly LicenseTier[] = ['home', 'business', 'pro'] as const;
export const LICENSE_VERSION = 1;
/** feature พิเศษ = ทุกอย่างใน tier นั้น */
export const LICENSE_WILDCARD = '*';
/** ชื่อ env ที่แอปอ่าน (ค่า token + public key) */
export const LICENSE_ENV_TOKEN = 'SOVEREIGN_LICENSE';
export const LICENSE_ENV_PUBLIC_KEY = 'SOVEREIGN_LICENSE_PUBLIC_KEY';

export interface LicensePayload {
  v: number;
  id: string;
  licensee: string;
  tier: LicenseTier;
  features: string[];
  issuedAt: string;
  /** null = ซื้อขาด ไม่มีวันหมดอายุ */
  expiresAt: string | null;
  /** จำนวนเครื่องสูงสุดที่อนุญาต (ข้อมูลไว้แสดง/ตรวจตอนออก ไม่ใช่การบังคับที่เครื่องลูกค้า) */
  maxMachines: number;
  /** sha256(machineId) แบบ hex — ว่าง = ไม่ผูกเครื่อง */
  machineHashes: string[];
}

export type LicenseReason =
  | 'ok'
  | 'malformed'
  | 'bad-payload'
  | 'bad-signature'
  | 'no-public-key'
  | 'wrong-machine'
  | 'expired';

export interface LicenseStatus {
  valid: boolean;
  reason: LicenseReason;
  payload: LicensePayload | null;
  tier: LicenseTier | null;
  features: string[];
  expiresAt: string | null;
  machineBound: boolean;
  daysLeft: number | null;
}

export interface VerifyOptions {
  publicKey: string | Buffer;
  /** ค่าดิบของเครื่องนี้ (จะถูก hash ให้เอง) — ไม่ส่ง = ตรวจได้เฉพาะไลเซนส์ที่ไม่ผูกเครื่อง */
  machineId?: string | null;
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HEX64 = /^[0-9a-f]{64}$/;

function invalid(reason: LicenseReason): LicenseStatus {
  return {
    valid: false,
    reason,
    payload: null,
    tier: null,
    features: [],
    expiresAt: null,
    machineBound: false,
    daysLeft: null,
  };
}

export function base64urlEncode(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(text: string): Buffer {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

/** hash ของ machine id — เก็บเฉพาะ hash ไม่เก็บค่าดิบของเครื่องลูกค้า */
export function hashMachineId(raw: string): string {
  return createHash('sha256').update(String(raw).trim(), 'utf8').digest('hex');
}

/**
 * สร้าง token = base64url(payloadJson) + "." + base64url(signature ของส่วน payloadJson)
 * ลงนามบน "ตัวอักษรของ segment" ตรง ๆ → ไม่มีปัญหา canonical JSON
 */
export function encodeLicenseToken(
  payload: LicensePayload,
  sign: (data: Buffer) => Buffer
): string {
  const body = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = sign(Buffer.from(body, 'utf8'));
  return `${body}.${base64urlEncode(signature)}`;
}

function normalisePayload(raw: unknown): LicensePayload | null {
  if (raw === null || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;

  if (p.v !== LICENSE_VERSION) return null;
  if (typeof p.id !== 'string' || p.id.trim() === '') return null;
  if (typeof p.licensee !== 'string' || p.licensee.trim() === '') return null;
  if (typeof p.tier !== 'string' || !LICENSE_TIERS.includes(p.tier as LicenseTier)) return null;
  if (!Array.isArray(p.features) || !p.features.every((f) => typeof f === 'string' && f !== '')) return null;
  if (typeof p.issuedAt !== 'string' || !Number.isFinite(Date.parse(p.issuedAt))) return null;
  if (p.expiresAt !== null && (typeof p.expiresAt !== 'string' || !Number.isFinite(Date.parse(p.expiresAt)))) {
    return null;
  }
  if (!Number.isInteger(p.maxMachines) || (p.maxMachines as number) < 0) return null;
  if (!Array.isArray(p.machineHashes) || !p.machineHashes.every((h) => typeof h === 'string' && HEX64.test(h))) {
    return null;
  }

  return {
    v: LICENSE_VERSION,
    id: p.id,
    licensee: p.licensee,
    tier: p.tier as LicenseTier,
    features: [...new Set(p.features as string[])],
    issuedAt: p.issuedAt,
    expiresAt: (p.expiresAt as string | null) ?? null,
    maxMachines: p.maxMachines as number,
    machineHashes: p.machineHashes as string[],
  };
}

export function verifyLicenseToken(token: string, opts: VerifyOptions): LicenseStatus {
  if (typeof token !== 'string') return invalid('malformed');
  // อีเมล/แชทมักตัดบรรทัด token — ช่องว่างทั้งหมดไม่มีความหมายใน base64url
  const compact = token.trim().replace(/\s+/g, '');
  const parts = compact.split('.');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return invalid('malformed');

  const [body, signature] = parts;

  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(opts.publicKey);
  } catch {
    return invalid('no-public-key');
  }

  let signatureOk = false;
  try {
    signatureOk = verifySignature(null, Buffer.from(body, 'utf8'), publicKey, base64urlDecode(signature));
  } catch {
    return invalid('malformed');
  }
  if (!signatureOk) return invalid('bad-signature');

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlDecode(body).toString('utf8'));
  } catch {
    return invalid('malformed');
  }

  const payload = normalisePayload(parsed);
  if (!payload) return invalid('bad-payload');

  const machineBound = payload.machineHashes.length > 0;
  if (machineBound) {
    const machineId = opts.machineId;
    if (typeof machineId !== 'string' || machineId.trim() === '') return invalid('wrong-machine');
    if (!payload.machineHashes.includes(hashMachineId(machineId))) return invalid('wrong-machine');
  }

  const now = (opts.now ?? new Date()).getTime();
  const expiresAt = payload.expiresAt;
  const daysLeft = expiresAt === null ? null : Math.ceil((Date.parse(expiresAt) - now) / DAY_MS);

  if (expiresAt !== null && Date.parse(expiresAt) < now) {
    return {
      valid: false,
      reason: 'expired',
      payload,
      tier: payload.tier,
      features: [],
      expiresAt,
      machineBound,
      daysLeft: 0,
    };
  }

  return {
    valid: true,
    reason: 'ok',
    payload,
    tier: payload.tier,
    features: payload.features,
    expiresAt,
    machineBound,
    daysLeft,
  };
}

/** สิทธิ์ระดับฟีเจอร์ — ไลเซนส์ไม่ผ่าน = ไม่มีสิทธิ์อะไรเลย (fail-closed) */
export function hasFeature(status: LicenseStatus | null | undefined, feature: string): boolean {
  if (!status || !status.valid) return false;
  if (typeof feature !== 'string' || feature === '') return false;
  return status.features.includes(LICENSE_WILDCARD) || status.features.includes(feature);
}

/**
 * อ่านจาก env ของแอป (ค่า public key ที่มี \n แบบ escape ก็รับได้)
 * คืน null เมื่อยังไม่ได้ตั้งไลเซนส์เลย — ให้ผู้เรียกตัดสินเองว่าจะปิดระบบหรือรันโหมด CE
 */
export function licenseStatusFromEnv(
  env: Record<string, string | undefined>,
  machineId?: string | null,
  now?: Date
): LicenseStatus | null {
  const token = env[LICENSE_ENV_TOKEN];
  if (!token) return null;
  const publicKey = env[LICENSE_ENV_PUBLIC_KEY];
  if (!publicKey) return invalid('no-public-key');
  return verifyLicenseToken(token, {
    publicKey: publicKey.includes('\\n') ? publicKey.replace(/\\n/g, '\n') : publicKey,
    machineId: machineId ?? null,
    now,
  });
}
