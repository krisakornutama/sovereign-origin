// src/services/machine-enroll.service.ts
//
// ── ทำไมต้องมี ────────────────────────────────────────────────────────
// เดิมการเพิ่มเครื่องใหม่ = ต้อง "ออกชุดทีละเครื่อง" (node MAKE-MACHINE.mjs --name=...)
//   ซึ่งฝัง machineToken ลง join.json ของเครื่องนั้น เพราะ HUB ระบุตัวเครื่อง
//   จาก token (authenticateToken → WHERE token_hash = ...)
//   ⇒ ก๊อปชุดเดียวไป 10 เครื่อง = HUB มองเป็นเครื่องเดียว แยกไม่ออก ถอนไม่ได้รายเครื่อง
//
// เจ้าของสั่ง 11/10/69: "ไฟล์เดียวจบ ไม่ต้องทำทีละเครื่อง"
//   ⇒ เปลี่ยนเป็น "ลงทะเบียนเอง": เครื่องใหม่เอา "รหัสเชิญ" ไปขอ token ของตัวเองจาก HUB
//   ตัว HUB ยังจำเป็นต้องรู้ว่าใครขอ และห้ามเปิดให้ทุกคน — รหัสเชิญคือกุญแจ
//
// ── หลักการที่ฝังไว้ ────────────────────────────────────────────────
// • ไม่ตั้งรหัสเชิญ = ปิดช่องนี้ทิ้ง (fail-closed) ไม่ใช่ "อนุญาตทุกคน"
// • เครื่องที่ลงทะเบียนใหม่ได้ role = USER เสมอ (ข้อ 1 ของ machine-access.service)
//   เครื่องที่ยังไม่ผูกเจ้าของ ใครก็คุมไม่ได้ — ต้องไปกดยืนยันในหน้าเว็บอีกที
// • เทียบรหัสแบบคงเวลา (constant-time) + จำกัดจำนวนครั้งที่ล้มเหลว
//   เพื่อไม่ให้เดารหัสทีละตัวผ่านทางลัด
// • ชั้นนี้ตัดสินใจล้วน ไม่แตะ DB ⇒ เทสต์ได้เร็ว (แยกเป็นชั้นแบบ machine-access.service.ts)

import crypto from 'node:crypto';

/** ผลการตัดสินใจรับ/ไม่รับการลงทะเบียน */
export type EnrollDecision = 'accepted' | 'disabled' | 'bad_code' | 'rate_limited' | 'bad_request';

export interface EnrollVerdict {
  decision: EnrollDecision;
  /** ข้อความสั้นสำหรับ log ฝั่ง HUB — ห้ามมีรหัสเชิญหลุด */
  reason: string;
  /** จำนวนครั้งที่ล้มเหลวหลังคำขอนี้ (สำหรับ rate limit) */
  failures: number;
}

export interface EnrollInput {
  /** รหัสเชิญที่ตั้งไว้ฝั่ง HUB (ว่าง/ไม่ตั้ง = ปิดช่องนี้) */
  expectedCode?: string | null;
  /** รหัสที่เครื่องใหม่ส่งมา */
  code?: string | null;
  /** ชื่อเครื่องที่ขอลงทะเบียน */
  name?: string | null;
  os?: string | null;
  executors?: readonly string[] | null;
  version?: string | null;
  /** จำนวนครั้งที่ล้มเหลวก่อนหน้านี้ของ IP/ผู้เรียก (ถ้าไม่รู้ = 0) */
  priorFailures?: number;
  /** จำนวนครั้งล้มเหลวสูงสุดก่อนที่จะพักการลองชั่วคราว */
  maxFailures?: number;
}

/** ชื่อเครื่องสูงสุดกี่ตัวอักษร — กันยัดเยอะ/ข้อความบอกทาง */
export const MAX_NAME_LENGTH = 64;

/** ล้มเหลวกี่ครั้งแล้วจะพัก (ต่อผู้เรียก) */
export const DEFAULT_MAX_FAILURES = 8;

/** อักขระควบคุมที่ห้ามโผล่ในชื่อเครื่อง (ทำให้ log/UI พัง) */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/** เทียบสตริงแบบคงเวลา — กันเดาโดยวัดเวลาตอบกลับ */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export type EnrollAttemptAction =
  | 'disabled'
  | 'rate_limited'
  | 'bad_request'
  | 'bad_code'
  | 'legacy'
  | 'fleet';

export interface EnrollAttemptInput {
  /** รหัสเดิมฝั่ง HUB (MACHINE_ENROLL_CODE) */
  expectedCode?: string | null;
  /** รหัสที่เครื่องส่งมา */
  code?: string | null;
  name?: string | null;
  priorFailures?: number;
  maxFailures?: number;
  /** true = รหัสที่ส่งมามีรูปแบบ enr_... (ให้ชั้น route ตรวจด้วย isEnrollTokenFormat) */
  fleetTokenFormat?: boolean;
}

export interface EnrollAttempt {
  action: EnrollAttemptAction;
  failures: number;
  reason: string;
  /** ชื่อที่ sanitize แล้ว — มีเมื่อ action เป็น legacy/fleet */
  name?: string;
  maxFailures?: number;
}

/**
 * ตัดสิน "จะลองทางไหน" โดยไม่แตะ DB/ไฟล์
 *
 * แยกจาก decideEnroll เพราะ /enroll สมัยใหม่รับได้สองทาง:
 *   1) รหัสเดิม MACHINE_ENROLL_CODE
 *   2) รหัสฝูง enr_... (ไป consume จาก fleet-enrollment.service)
 *
 * ลำดับ: disabled → rate limit → ชื่อผิด → legacy → fleet → bad_code
 * (ชื่อผิดไม่นับเป็นครั้งล้ม เพื่อไม่ให้ผู้ใช้ที่พิมพ์ชื่อผิดถูกพัก)
 */
export function decideEnrollAttempt(input: EnrollAttemptInput): EnrollAttempt {
  const maxFailures = Number.isFinite(input.maxFailures) ? Number(input.maxFailures) : DEFAULT_MAX_FAILURES;
  const prior = Math.max(0, Number(input.priorFailures ?? 0));
  const expected = String(input.expectedCode ?? '').trim();
  const given = String(input.code ?? '').trim();
  const fleetTokenFormat = input.fleetTokenFormat === true;
  const rawName = String(input.name ?? '').trim();

  // ไม่ได้ตั้งรหัสเดิมและไม่ได้ส่งรหัสฝูง = ปิดช่องทาง (fail-closed)
  if (!expected && !fleetTokenFormat) {
    return {
      action: 'disabled',
      failures: prior,
      reason: 'HUB ไม่ได้ตั้งรหัสเชิญ (MACHINE_ENROLL_CODE) — ปิดการลงทะเบียนอัตโนมัติ',
    };
  }

  if (prior >= maxFailures) {
    return {
      action: 'rate_limited',
      failures: prior,
      maxFailures,
      reason: `ล้มเหลวเกิน ${maxFailures} ครั้ง — พักชั่วคราว`,
    };
  }

  if (!rawName) {
    return { action: 'bad_request', failures: prior, reason: 'ไม่พบชื่อเครื่อง' };
  }
  if (rawName.length > MAX_NAME_LENGTH) {
    return {
      action: 'bad_request',
      failures: prior,
      reason: `ชื่อเครื่องยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร`,
    };
  }

  const name = sanitizeMachineName(rawName);
  if (expected && safeEqual(given, expected)) {
    return { action: 'legacy', failures: 0, reason: 'รหัสเชิญถูกต้อง', name };
  }
  if (fleetTokenFormat) {
    return { action: 'fleet', failures: 0, reason: 'รหัสเชิญฝูงพร้อมตรวจ', name };
  }
  return { action: 'bad_code', failures: prior + 1, reason: 'รหัสเชิญไม่ถูกต้อง' };
}

/**
 * ตัดสินว่าจะให้ลงทะเบียนไหม (รหัสเดิมอย่างเดียว — คงไว้ให้เทสต์/ผู้เรียกเก่า)
 * คืนเฉพาะการตัดสิน — การเขียน DB อยู่ชั้น agent-machines.service
 */
export function decideEnroll(input: EnrollInput): EnrollVerdict {
  const attempt = decideEnrollAttempt({ ...input, fleetTokenFormat: false });
  const decision: EnrollDecision =
    attempt.action === 'legacy' ? 'accepted'
    : attempt.action === 'fleet' ? 'bad_code'
    : attempt.action;
  return { decision, reason: attempt.reason, failures: attempt.failures };
}

/** ตัดชื่อเครื่องให้ปลอดภัยก่อนบันทึกลง DB (ตัดอักขระควบคุม/ช่องว่างซ้ำ) */
export function sanitizeMachineName(raw: string): string {
  return String(raw ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

/** executors ที่รับได้ — ว่าง = ใช้ค่าเดียว (runner ไม่มี agent ก็ยังลงทะเบียนได้) */
export function normalizeExecutors(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  const out = list.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 16);
  return out.length ? out : ['echo'];
}