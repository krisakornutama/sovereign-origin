/**
 * ตรวจสลิปโอนเงิน — "แกนตัดสิน" ที่ไม่ผูกผู้ให้บริการและไม่แตะฐานข้อมูล
 *
 * ทำไมต้องมี: ร้านค้าปัจจุบันให้ลูกค้า "แจ้งยอด" เอง (payPublicOrderByToken) แล้วเจ้าของ
 * กดยืนยันด้วยมือทุกครั้ง — เสี่ยงรับเงินไม่ตรง/สลิปซ้ำ/สลิปปลอม
 * โมดูลนี้แยก "กติกาการตัดสิน" ออกมาจากผู้ให้บริการอ่านสลิป (SlipOK / EasySlip / อื่น ๆ)
 * เพื่อให้ทดสอบได้ด้วยข้อมูลล้วน ๆ และเปลี่ยนผู้ให้บริการได้โดยไม่แตะกติกา
 *
 * ขอบเขต (ตั้งใจ): รับ "ข้อเท็จจริงที่อ่านได้จากสลิป" แล้วตอบว่าจะรับ/ไม่รับ เพราะอะไร
 *   - ไม่เรียกเครือข่าย (ผู้เรียกเป็นคนไปขอข้อมูลจาก provider)
 *   - ไม่บันทึก DB (ผู้เรียกเอา `slipKey()` ไปทำ unique index กันใช้สลิปซ้ำ)
 *   - ไม่ได้ยืนยันความถูกต้องของภาพสลิปเอง — นั่นคือหน้าที่ของ provider ที่อ่านสลิป
 *
 * กติกาหลัก: เทียบเงินเป็น "สตางค์" (จำนวนเต็ม) เสมอ เพื่อกัน 0.1+0.2 เพี้ยน
 */

export const SLIP_REASONS = [
  'MISSING_TRANS_REF',
  'INVALID_AMOUNT',
  'INVALID_DATE',
  'FUTURE_DATED',
  'DUPLICATE',
  'STALE',
  'PAYEE_ACCOUNT_MISMATCH',
  'PAYEE_NAME_MISMATCH',
  'PAYEE_UNVERIFIED',
  'UNDERPAID',
  'OVERPAID',
] as const;

export type SlipReason = (typeof SLIP_REASONS)[number];

export type SlipStatus =
  | 'ACCEPTED'
  | 'INVALID'
  | 'DUPLICATE'
  | 'STALE'
  | 'PAYEE_MISMATCH'
  | 'PAYEE_UNVERIFIED'
  | 'AMOUNT_MISMATCH';

export type SlipFacts = {
  /** เลขอ้างอิงธุรกรรมจากสลิป — ต้องมีเสมอ ไม่งั้นกันสลิปซ้ำไม่ได้ */
  transRef?: string | null;
  /** ยอดที่โอนจริง (บาท) */
  amount?: number | null;
  /** เวลาที่โอน (Date หรือ ISO string) */
  transDate?: Date | string | null;
  /** ชื่อบัญชีผู้รับตามที่สลิปแสดง */
  receiverName?: string | null;
  /** เลขบัญชีผู้รับ (ใช้แค่ 4 หลักท้าย) */
  receiverAccountTail?: string | null;
  /** ผู้ให้บริการที่อ่านสลิป (ใช้ทำกุญแจกันซ้ำ) */
  provider?: string | null;
};

export type SlipExpectation = {
  /** ยอดที่ต้องได้รับ (บาท) */
  amountDue: number;
  /** ชื่อบัญชีผู้รับที่ร้านตั้งไว้ */
  payeeName?: string | null;
  /** 4 หลักท้ายบัญชีผู้รับของร้าน */
  payeeAccountTail?: string | null;
  /** สลิปต้องใหม่กว่านี้ (ปกติ = เวลาสร้างออเดอร์) */
  notBefore?: Date | string | null;
  /** เวลาอ้างอิง (สำหรับเทสต์) — ค่าเริ่มต้น = now */
  now?: Date;
  /** เผื่อปัดเศษธนาคาร (บาท) — ค่าเริ่มต้น 0.01 */
  amountTolerance?: number;
  /** transRef ที่เคยใช้แล้ว (จาก DB) */
  seenTransRefs?: Iterable<string>;
  /** เผื่อเวลานาฬิกาเครื่องผู้ให้บริการเร็ว (ms) — ค่าเริ่มต้น 5 นาที */
  maxClockSkewMs?: number;
};

export type SlipDecision = {
  accepted: boolean;
  status: SlipStatus;
  reasons: SlipReason[];
  /** ยอดที่ยอมรับได้ (บาท, ปัดเป็นสตางค์) */
  matchedAmount: number;
  /** กุญแจกันสลิปซ้ำ — null เมื่อไม่มีเลขอ้างอิง */
  transRef: string | null;
};

const DEFAULT_TOLERANCE_THB = 0.01;
const DEFAULT_SKEW_MS = 5 * 60 * 1000;

/** แปลงบาท → สตางค์ (จำนวนเต็ม) แบบกันเศษลอย */
export function toSatang(amount: number): number {
  return Math.round(Number(amount) * 100);
}

/** แปลงสตางค์ → บาท (ทศนิยม 2 ตำแหน่ง) */
export function fromSatang(satang: number): number {
  return Math.round(satang) / 100;
}

/**
 * ชื่อบัญชีไทยมักต่างกันแค่คำนำหน้า/คำลงท้าย/ช่องว่าง เช่น
 * "นางสาว สมชาย ใจดี" กับ "สมชาย ใจดี" หรือ "บริษัท เอบีซี จำกัด" กับ "เอบีซี"
 * ⇒ ตัดคำนำหน้า/คำลงท้าย/ช่องว่าง/จุด ก่อนเทียบ
 */
export function normalizePayeeName(name: unknown): string {
  let s = String(name ?? '').normalize('NFC');
  s = s.replace(/[\s.·•()]/g, '').toLowerCase();
  s = s.replace(/^(นางสาว|นาง|นาย|นส|ดช|ดญ)/, '');
  s = s.replace(/^(บริษัท|บจก|บมจ|ห้างหุ้นส่วนจำกัด|หจก)/, '');
  s = s.replace(/(จำกัดมหาชน|จำกัด|มหาชน)$/, '');
  return s;
}

/** เอา 4 หลักท้ายของเลขบัญชี (ทนรูปแบบ 123-4-56789-0) */
export function accountTail(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

/** กุญแจกันสลิปซ้ำ — ผู้เรียกควรมี unique index บนคู่นี้ */
export function slipKey(facts: Pick<SlipFacts, 'provider' | 'transRef'>): string | null {
  const ref = String(facts.transRef ?? '').trim();
  if (!ref) return null;
  const provider = String(facts.provider ?? '').trim().toLowerCase() || 'unknown';
  return `${provider}:${ref}`;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function samePayeeName(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // ชื่อร้านอาจมีคำต่อท้าย/สาขา — ยอมรับเมื่อฝั่งหนึ่งมีอีกฝั่งอยู่ครบ (ขั้นต่ำ 3 ตัวอักษรกัน match มั่ว)
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.includes(short);
}

/**
 * ตัดสินว่าสลิปนี้ใช้ปิดยอดของออเดอร์ได้หรือไม่
 * คืน "เหตุผลทั้งหมด" ที่พบ (ไม่หยุดที่ข้อแรก) เพื่อให้ UI/เจ้าของเห็นภาพจริง
 */
export function evaluateSlip(facts: SlipFacts, expectation: SlipExpectation): SlipDecision {
  const reasons: SlipReason[] = [];
  const now = expectation.now ?? new Date();
  const toleranceSatang = Math.max(0, toSatang(Number(expectation.amountTolerance ?? DEFAULT_TOLERANCE_THB)));

  // ── 1) เลขอ้างอิง + ยอด + เวลา ต้องใช้ได้ ──────────────────────────────
  const transRef = String(facts.transRef ?? '').trim();
  if (!transRef) reasons.push('MISSING_TRANS_REF');

  const amountNumber = Number(facts.amount);
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  if (!amountValid) reasons.push('INVALID_AMOUNT');

  const transDate = parseDate(facts.transDate);
  if (!transDate) reasons.push('INVALID_DATE');

  const skew = Math.max(0, Number(expectation.maxClockSkewMs ?? DEFAULT_SKEW_MS));
  if (transDate && transDate.getTime() > now.getTime() + skew) reasons.push('FUTURE_DATED');

  const notBefore = parseDate(expectation.notBefore);
  if (transDate && notBefore && transDate.getTime() < notBefore.getTime() - skew) reasons.push('STALE');

  // ── 2) สลิปซ้ำ ─────────────────────────────────────────────────────────
  if (transRef && expectation.seenTransRefs) {
    const seen = new Set(Array.from(expectation.seenTransRefs, (r) => String(r).trim()).filter(Boolean));
    if (seen.has(transRef)) reasons.push('DUPLICATE');
  }

  // ── 3) ผู้รับเงิน ──────────────────────────────────────────────────────
  const wantName = normalizePayeeName(expectation.payeeName);
  const haveName = normalizePayeeName(facts.receiverName);
  const wantTail = accountTail(expectation.payeeAccountTail);
  const haveTail = accountTail(facts.receiverAccountTail);

  if (wantTail && haveTail && wantTail !== haveTail) reasons.push('PAYEE_ACCOUNT_MISMATCH');
  if (wantName && haveName && !samePayeeName(haveName, wantName)) reasons.push('PAYEE_NAME_MISMATCH');
  // ร้านตั้งชื่อ/บัญชีไว้ แต่สลิปไม่มีข้อมูลผู้รับเลย ⇒ ตัดสินแทนไม่ได้ ต้องให้คนดู
  const payeeExpected = Boolean(wantName || wantTail);
  const payeeObserved = Boolean(haveName || haveTail);
  if (payeeExpected && !payeeObserved) reasons.push('PAYEE_UNVERIFIED');

  // ── 4) ยอดเงิน (สตางค์) ───────────────────────────────────────────────
  const dueSatang = toSatang(Number(expectation.amountDue));
  const paidSatang = amountValid ? toSatang(amountNumber) : 0;
  if (amountValid) {
    if (paidSatang < dueSatang - toleranceSatang) reasons.push('UNDERPAID');
    else if (paidSatang > dueSatang + toleranceSatang) reasons.push('OVERPAID');
  }

  // ── 5) สรุปสถานะ (เรียงตามความร้ายแรง: ข้อมูลใช้ไม่ได้ → ซ้ำ → เวลา → ผู้รับ → ยอด) ──
  let status: SlipStatus = 'ACCEPTED';
  if (reasons.some((r) => r === 'MISSING_TRANS_REF' || r === 'INVALID_AMOUNT' || r === 'INVALID_DATE' || r === 'FUTURE_DATED')) {
    status = 'INVALID';
  } else if (reasons.includes('DUPLICATE')) {
    status = 'DUPLICATE';
  } else if (reasons.includes('STALE')) {
    status = 'STALE';
  } else if (reasons.includes('PAYEE_ACCOUNT_MISMATCH') || reasons.includes('PAYEE_NAME_MISMATCH')) {
    status = 'PAYEE_MISMATCH';
  } else if (reasons.includes('PAYEE_UNVERIFIED')) {
    status = 'PAYEE_UNVERIFIED';
  } else if (reasons.includes('UNDERPAID') || reasons.includes('OVERPAID')) {
    status = 'AMOUNT_MISMATCH';
  }

  return {
    accepted: status === 'ACCEPTED',
    status,
    reasons,
    matchedAmount: amountValid ? fromSatang(paidSatang) : 0,
    transRef: transRef || null,
  };
}
