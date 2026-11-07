// src/services/consent.service.ts
//
// ── ความยินยอม (PDPA) + สิทธิ์ลบข้อมูล ──────────────────────────────────────
// ทำไมต้องมี: เก็บข้อมูลลูกค้าจริงโดยไม่มีบันทึกความยินยอม = ผิด PDPA และขายไม่ได้
//
// กติกา:
//   · 1 แถวต่อ (ผู้ใช้, วัตถุประสงค์) ใน user_consents — ตอบสถานะปัจจุบันได้เร็ว
//   · ทุกการเปลี่ยนแปลงเขียน consent_events (append-only) เป็นหลักฐานย้อนหลัง
//   · "จำเป็นต่อการให้บริการ" ปิดไม่ได้ (ฐานกฎหมายอื่น) แต่ยังแสดงให้ผู้ใช้เห็น
//   · ลบบัญชี = anonymize ไม่ใช่ DELETE แถว — audit log ต้องอ้างอิงผู้กระทำได้ต่อ
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { deleteUserHealthData } from './health-readings.service';
import { anonymizeChatActor } from './ai-chat.service';

/** เวอร์ชันนโยบายความเป็นส่วนตัว — เปลี่ยนเมื่อแก้ข้อความ/วัตถุประสงค์ ต้อง bump */
export const CONSENT_POLICY_VERSION = '2026-11-03';

export type ConsentPurposeKey = 'essential' | 'telemetry' | 'analytics' | 'marketing' | 'health';

/**
 * เวอร์ชันที่นโยบาย "ของวัตถุประสงค์นี้" เปลี่ยนครั้งล่าสุด
 *
 * bump `CONSENT_POLICY_VERSION` พร้อมแก้เฉพาะบางวัตถุประสงค์ → ขยับเฉพาะคีย์นั้น
 * ผู้ใช้ที่ยอมรับเวอร์ชัน >= ค่านี้แล้วไม่ต้องถูกถามซ้ำ — ถ้าไม่ทำแบบนี้ การแก้ข้อความ
 * จุดเดียวจะกลายเป็นการขอความยินยอมใหม่ทั้งระบบ ผู้ใช้จะกดยอมโดยไม่อ่าน (พิธีกรรม)
 *
 * ⚠️ ห้ามใส่เวอร์ชันล้ำหน้า `CONSENT_POLICY_VERSION` — มีเทสต์คุมที่
 * `tests/consentPolicyVersion.test.ts`
 */
export const CONSENT_PURPOSE_REVISED_IN: Record<ConsentPurposeKey, string> = {
  essential: '2026-11-03',
  telemetry: '2026-11-03',
  analytics: '2026-11-03',
  marketing: '2026-11-03',
  health: '2026-11-03',
};

const versionAt = (value: unknown): number => {
  const t = Date.parse(String(value ?? ''));
  return Number.isFinite(t) ? t : NaN;
};

/**
 * แถวความยินยอมที่เก็บไว้ยังใช้ได้กับวัตถุประสงค์นี้ไหม
 *
 * เทียบกับ "เวอร์ชันที่ถ้อยคำของวัตถุประสงค์นี้เปลี่ยนล่าสุด" ไม่ใช่เวอร์ชันรวม:
 * ถ้าวันหนึ่ง bump นโยบายเพราะแก้เฉพาะสุขภาพ ผู้ใช้ที่ยอมรับการตลาดไว้แล้ว
 * ไม่ต้องถูกถามซ้ำ — แต่สุขภาพต้องยืนยันใหม่
 *
 * @param revisedIn ใช้ในเทสต์/การย้ายข้อมูลเท่านั้น — ปกติอ่านจาก `CONSENT_PURPOSE_REVISED_IN`
 */
export function isConsentCurrent(
  purpose: ConsentPurposeKey,
  row: { granted?: boolean | null; policy_version?: string | null } | null | undefined,
  revisedIn: string = CONSENT_PURPOSE_REVISED_IN[purpose] ?? CONSENT_POLICY_VERSION
): boolean {
  if (!row || row.granted !== true) return false;
  const stored = versionAt(row.policy_version);
  const required = versionAt(revisedIn);
  if (!Number.isFinite(stored) || !Number.isFinite(required)) return false; // อ่านไม่ได้ = fail closed
  return stored >= required;
}

export interface ConsentPurposeSpec {
  key: ConsentPurposeKey;
  /** true = ปิดไม่ได้ (จำเป็นต่อการให้บริการ) */
  required: boolean;
  labelTh: string;
  labelEn: string;
  detailTh: string;
}

export const CONSENT_PURPOSES: ConsentPurposeSpec[] = [
  {
    key: 'essential',
    required: true,
    labelTh: 'จำเป็นต่อการให้บริการ',
    labelEn: 'Essential',
    detailTh: 'บัญชี การเข้าสู่ระบบ และการทำงานหลักของระบบ — ปิดไม่ได้เพราะระบบจะใช้งานไม่ได้',
  },
  {
    key: 'telemetry',
    required: false,
    labelTh: 'ข้อมูลการใช้งานและสุขภาพระบบ',
    labelEn: 'Telemetry',
    detailTh: 'บันทึกข้อผิดพลาดและค่าการทำงาน เพื่อให้ระบบเสถียรขึ้น (ไม่ระบุตัวตนเมื่อทำได้)',
  },
  {
    key: 'analytics',
    required: false,
    labelTh: 'การวิเคราะห์การใช้งาน',
    labelEn: 'Analytics',
    detailTh: 'สรุปว่ามีคนใช้ส่วนไหน เพื่อปรับปรุงผลิตภัณฑ์',
  },
  {
    key: 'marketing',
    required: false,
    labelTh: 'การติดต่อเพื่อการตลาด',
    labelEn: 'Marketing',
    detailTh: 'ข่าวสาร โปรโมชัน และข้อเสนอ — ถอนได้ทุกเมื่อโดยไม่กระทบการใช้งาน',
  },
  {
    key: 'health',
    required: false,
    labelTh: 'ข้อมูลสุขภาพ',
    labelEn: 'Health data',
    detailTh: 'ข้อมูลสุขภาพ/การรักษาที่คุณบันทึกเอง — ละเอียดอ่อนที่สุด ต้องยินยอมชัดเจน',
  },
];

export function isConsentPurpose(value: unknown): value is ConsentPurposeKey {
  return typeof value === 'string' && CONSENT_PURPOSES.some((p) => p.key === value);
}

export function purposeSpec(key: ConsentPurposeKey): ConsentPurposeSpec {
  const found = CONSENT_PURPOSES.find((p) => p.key === key);
  if (!found) throw new Error('unknown consent purpose: ' + key);
  return found;
}

export interface ConsentState {
  key: ConsentPurposeKey;
  required: boolean;
  granted: boolean;
  /** true = เคยยอมรับไว้ แต่ถ้อยคำของวัตถุประสงค์นี้เปลี่ยนแล้ว → ต้องยืนยันฉบับใหม่ */
  needsReconsent: boolean;
  /** เวอร์ชันที่นโยบายของวัตถุประสงค์นี้เปลี่ยนล่าสุด */
  revisedIn: string;
  updatedAt: Date | null;
  labelTh: string;
  labelEn: string;
  detailTh: string;
}

/** สถานะความยินยอมของผู้ใช้ + เวอร์ชันนโยบายที่ใช้อยู่ */
export async function listConsents(
  userId: string
): Promise<{ policyVersion: string; reconsentRequired: boolean; purposes: ConsentState[] }> {
  const rows = await prisma.userConsent.findMany({ where: { user_id: userId } });
  const byPurpose = new Map(rows.map((row) => [String(row.purpose), row]));
  const purposes: ConsentState[] = CONSENT_PURPOSES.map((spec) => {
    const row = byPurpose.get(spec.key);
    const revisedIn = CONSENT_PURPOSE_REVISED_IN[spec.key] ?? CONSENT_POLICY_VERSION;
    return {
      key: spec.key,
      required: spec.required,
      // วัตถุประสงค์จำเป็น = เปิดเสมอ ไม่ว่าแถวใน DB จะเป็นอะไร
      granted: spec.required ? true : Boolean(row?.granted),
      // "ขอใหม่" ใช้เฉพาะคนที่เคยยอมรับไว้แล้ว (คนที่ไม่เคยยอม = ครั้งแรก ไม่ใช่ขอใหม่)
      needsReconsent: !spec.required && Boolean(row?.granted) && !isConsentCurrent(spec.key, row),
      revisedIn,
      updatedAt: row?.updated_at ?? null,
      labelTh: spec.labelTh,
      labelEn: spec.labelEn,
      detailTh: spec.detailTh,
    };
  });
  return {
    policyVersion: CONSENT_POLICY_VERSION,
    reconsentRequired: purposes.some((p) => p.needsReconsent),
    purposes,
  };
}

export interface SetConsentInput {
  userId: string;
  purpose: string;
  granted: boolean;
  source?: string;
  ip?: string | null;
}

export type SetConsentResult =
  | { ok: true; purpose: ConsentPurposeKey; granted: boolean; policyVersion: string }
  | { ok: false; reason: 'unknown_purpose' | 'required_cannot_revoke' };

/** บันทึกความยินยอมหนึ่งวัตถุประสงค์ + เขียน event หลักฐาน */
export async function setConsent(input: SetConsentInput): Promise<SetConsentResult> {
  if (!isConsentPurpose(input.purpose)) return { ok: false, reason: 'unknown_purpose' };
  const spec = purposeSpec(input.purpose);
  if (spec.required && input.granted !== true) return { ok: false, reason: 'required_cannot_revoke' };

  const granted = spec.required ? true : input.granted === true;
  const source = String(input.source ?? 'web').slice(0, 32);
  const ip = input.ip ? String(input.ip).slice(0, 64) : null;
  const now = new Date();

  await prisma.userConsent.upsert({
    where: { user_id_purpose: { user_id: input.userId, purpose: spec.key } },
    create: {
      user_id: input.userId,
      purpose: spec.key,
      granted,
      policy_version: CONSENT_POLICY_VERSION,
      source,
      ip,
      granted_at: granted ? now : null,
      revoked_at: granted ? null : now,
    },
    update: {
      granted,
      policy_version: CONSENT_POLICY_VERSION,
      source,
      ip,
      granted_at: granted ? now : null,
      revoked_at: granted ? null : now,
    },
  });

  await prisma.consentEvent.create({
    data: {
      user_id: input.userId,
      purpose: spec.key,
      action: granted ? 'granted' : 'revoked',
      policy_version: CONSENT_POLICY_VERSION,
      source,
      ip,
    },
  });

  return { ok: true, purpose: spec.key, granted, policyVersion: CONSENT_POLICY_VERSION };
}

export interface ConsentEventView {
  purpose: string;
  action: string;
  policyVersion: string;
  source: string;
  at: Date;
}

/** ประวัติการให้/ถอนความยินยอม (ใหม่สุดก่อน) */
export async function listConsentEvents(userId: string, limit = 50): Promise<ConsentEventView[]> {
  const take = Math.min(Math.max(1, limit), 200);
  const rows = await prisma.consentEvent.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take,
  });
  return rows.map((row) => ({
    purpose: String(row.purpose),
    action: String(row.action),
    policyVersion: String(row.policy_version),
    source: String(row.source),
    at: row.created_at as Date,
  }));
}

export interface AnonymizeInput {
  userId: string;
  password: string;
  confirm: string;
}

export type AnonymizeResult =
  | { ok: true; username: string; anonymizedAt: Date }
  | { ok: false; reason: 'not_found' | 'already_deleted' | 'bad_password' | 'bad_confirm' | 'last_admin' };

/**
 * สิทธิ์ถูกลืม: ทำให้บัญชีไม่ระบุตัวตนได้ แต่ไม่ลบแถว
 * เหตุผล: audit log และ consent_events ต้องอ้างอิงผู้กระทำได้ตามกฎหมาย
 */
export async function anonymizeAccount(input: AnonymizeInput): Promise<AnonymizeResult> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) return { ok: false, reason: 'not_found' };
  if (user.deleted_at) return { ok: false, reason: 'already_deleted' };
  if (String(input.confirm ?? '').trim().toUpperCase() !== 'DELETE') return { ok: false, reason: 'bad_confirm' };

  const passwordOk = await bcrypt.compare(String(input.password ?? ''), String(user.password_hash ?? ''));
  if (!passwordOk) return { ok: false, reason: 'bad_password' };

  if (user.role === 'SUPERADMIN') {
    const admins = await prisma.user.count({ where: { role: 'SUPERADMIN', deleted_at: null } });
    if (admins <= 1) return { ok: false, reason: 'last_admin' };
  }

  const now = new Date();
  const username = 'deleted-' + String(user.id).slice(0, 8) + '-' + randomBytes(3).toString('hex');
  const randomHash = await bcrypt.hash(randomBytes(24).toString('hex'), 12);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      username,
      password_hash: randomHash,
      mfa_secret: null,
      pending_mfa_secret: null,
      mfa_backup_hash: null,
      must_change_password: true,
      token_version: Number(user.token_version ?? 0) + 1,
      deleted_at: now,
    },
  });

  // ── ลบข้อมูลส่วนบุคคลที่ผูกกับบัญชี (PDPA: สิทธิ์ถูกลืม) ──────────────────
  // anonymize แถว user อย่างเดียวไม่พอ: ข้อมูลสุขภาพและประวัติแชทคือข้อมูล
  // อ่อนไหวที่สุด และไม่มีใครต้องใช้ต่อหลังเจ้าของขอลบ
  // สิ่งที่ *ไม่* ลบโดยตั้งใจ: audit log + consent_events (หลักฐานทางกฎหมาย)
  // — แต่ผูกกับ user id ที่ไม่ระบุตัวตนแล้ว
  await deleteUserHealthData(user.id);
  // ChatMessage ผูกด้วยชื่อผู้ใช้ (actor) ไม่ใช่ id → ย้ายบทสนทนาไปยังชื่อนิรนาม
  await anonymizeChatActor(user.username, username);

  return { ok: true, username, anonymizedAt: now };
}
