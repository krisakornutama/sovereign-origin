// ────────────────────────────────────────────────────────────────────────────
// payment-verification.service.ts — กฎเดียว: delivery ของ Stripe ตรงกับ order ที่เราถือไหม
//
// pure ทั้งไฟล์: ไม่แตะ HTTP · ไม่แตะ DB · ไม่อ่าน config/env · ไม่ยิงเน็ต
// รับ event ดิบ → คืนคำตัดสิน (เขียนลง DB เป็นหน้าที่ของ payment-apply.service)
//
// โครงสร้าง: กฎเดียว (checkCompletion) ใช้กับ order สองชนิด แล้วห่อเป็นคำสั่งที่
// แต่ละทางเรียกใช้เอง — ทางเรียกเห็นแค่ type ของตัวเอง ไม่ต้องรู้ชื่อคอลัมน์ของอีกตาราง
//
//   TransferOrder  (คำสั่งโอน/รับเงินในกระเป๋าเงิน)  → decideCompletion
//   BusinessOrder  (ออเดอร์หน้าร้าน)                 → decideStorefrontCompletion
//
// เจ้าของของศัพท์เหล่านี้อยู่ที่นี่ที่เดียว: NotAppliedReason (reason code ที่ route
// ส่งกลับและ log) และลำดับการตรวจใน checkCompletion (branch แรกที่ match คือคำตอบ)
//
// สิ่งที่ "ไม่" อยู่ที่นี่โดยเจตนา: การเขียน DB (CAS) เพราะต้องรู้ว่าเขียนสำเร็จไหม
// จึงอยู่ที่ payment-apply.service ส่วนรูปร่าง response เป็นเรื่องการนำเสนอ
// จึงอยู่ที่ route
// ────────────────────────────────────────────────────────────────────────────

import { normalizeRefCode, toThbMinorUnit, THB_CURRENCY_CODE } from './stripe-checkout';

/** รหัสเหตุผลที่ delivery นั้น "ไม่ถูก apply" — คำตอบของ API + ข้อความใน log */
export type NotAppliedReason =
  | 'unsupported_event_type'
  | 'missing_client_reference_id'
  | 'order_not_found'
  | 'currency_mismatch'
  | 'order_amount_unusable'
  | 'amount_mismatch'
  /** order ไม่ได้อยู่ PENDING อีกแล้ว — คำตัดสินหลัง CAS ไม่สำเร็จ */
  | 'order_not_pending';

/**
 * reason ที่ route ผลิตเองหลัง CAS ไม่สำเร็จ (order ไม่อยู่ในสถานะที่รับได้อีก)
 *
 * ให้มาเป็น "ค่าคงที่ที่มีชนิด" แทน string ตรง ๆ เพื่อให้:
 *   · จุดเขียนใน route ถูกบังคับด้วยชนิด NotAppliedReason เสมอ
 *   · สะกดผิดแล้วคอมไพล์ไม่ผ่าน ไม่ใช่คอมไพล์ผ่านแล้วพังตอนรัน
 * ถ้าวันหนึ่งต้องการเพิ่ม reason ที่ route ผลิตเอง ให้เพิ่มใน union ข้างบนก่อนเสมอ
 */
export const REASON_ORDER_NOT_PENDING: NotAppliedReason = 'order_not_pending';

export interface NotAppliedDecision {
  kind: 'not_applied';
  reason: NotAppliedReason;
  /** ข้อความสำหรับคนอ่าน — ต้องบอกได้ว่าอะไรผิดและตัวเลขเท่าไร */
  message: string;
  /** ข้อมูลประกอบการแก้ไข (key/ตัวเลข) — เข้าไปอยู่ใน log ด้วย */
  detail?: Record<string, unknown>;
}

export interface ApplyDecision {
  kind: 'apply';
  refCode: string;
  sessionId: string;
  /** ยอดที่ order คาดไว้ (สตางค์) — ให้ผู้เขียน DB ใช้ตรวจซ้ำตอนเขียนได้ */
  expectedSatang: number;
}

export type CompletionDecision = ApplyDecision | NotAppliedDecision;

export interface StorefrontApplyDecision {
  kind: 'apply';
  /** publicToken ของ order (UUID @unique ทั้งระบบ) — ใช้เป็น where ตอน CAS */
  publicToken: string;
  orderId: string;
  sessionId: string;
  /** ยอดที่ order คาดไว้ (สตางค์) */
  expectedSatang: number;
}

export type StorefrontCompletionDecision = StorefrontApplyDecision | NotAppliedDecision;

/** event type ที่เราดูแล — ที่เหลือคือ "ไม่ใช่ธุระของเรา" */
const HANDLED_EVENT_TYPE = 'checkout.session.completed';

/** สถานะ BusinessOrder ที่ยังรอชำระ — เขียนทับได้เฉพาะสถานะเหล่านี้เท่านั้น */
export const STOREFRONT_PAYABLE_STATUSES = ['QUOTE', 'ORDERED'] as const;

/**
 * method ที่บันทึกลง business_payments เมื่อจ่ายผ่าน Stripe
 *
 * ทำไมต้องแยกจาก PROMPTPAY: buildMorningDigest กรอง
 * `businessPayment.findMany({ where: { method: 'PROMPTPAY' } })`
 * เพื่อสรุปยอด "แจ้งชำระรอยืนยัน" — ถ้าใส่ PROMPTPAY
 * เงินที่จ่ายด้วยบัตรจะไปปนในยอดโอน QR ของจริง (ตัวเลขคนละเรื่องกัน)
 * บัตรเป็นเงินเข้าทันที ไม่ต้องรอร้านยืนยัน
 */
export const STRIPE_PAYMENT_METHOD = 'CARD';

// ──────────────────────────────────────────────────────────────────────────────
// กฎเดียวสำหรับ order สองชนิด
//
// ตารางต่างกัน (ชื่อคอลัมน์/ชื่อ key/ถ้อยคำใน log ต่างกัน) แต่ "จะยืนยันว่าจ่ายจริงไหม"
// คือคำถามเดียวกันและลำดับการตรวดเดียวกัน → กฎอยู่ที่เดียว (checkCompletion)
// ส่วนที่ต่างกันถูกย้ายไปเป็น "คำในบริบท" ของแต่ละตาราง (OrderRules) ไม่ใช่โค้ดซ้ำ
//
// ทำไมไม่รวมเป็นฟังก์ชันเดียวที่รับ order สองชนิด: union จะทำให้จุดที่อ่าน
// `amount_thb` กลายเป็น `number | undefined` โดยไม่มีใครเห็นตอน compile
// (เหตุผลเดียวกับที่ reason ถูกพิมพ์เป็น NotAppliedReason ไม่ใช่ string)
// ──────────────────────────────────────────────────────────────────────────────

interface OrderRules {
  /** คอลัมน์ที่เก็บยอดบาทที่เชื่อได้ — ตัวเลขของ ORDER ไม่ใช่ของ session */
  amountField: string;
  /** ชื่อ field ยอดใน detail ของ order_amount_unusable (ให้ตรงคอลัมน์จริง) */
  amountDetailKey: string;
  /** ชื่อ key ใน detail — คนอ่าน log ต้องรู้ว่าจับคู่ด้วยอะไร */
  keyName: string;
  text: {
    missingKey: string;
    notFound: (key: string) => string;
    currency: (key: string, received: unknown) => string;
    amountUnusable: (key: string, raw: unknown) => string;
    amountMismatch: (key: string, expectedSatang: number, received: unknown) => string;
  };
}

const TRANSFER_RULES: OrderRules = {
  amountField: 'amount_thb',
  amountDetailKey: 'amountThb',
  keyName: 'refCode',
  text: {
    missingKey: 'ไม่มี client_reference_id — จับคู่ order ไม่ได้ (ไม่เดา ไม่สร้าง order ใหม่)',
    notFound: (key) => `ไม่พบ order สำหรับ ref_code ${key} — ตรวจว่า client_reference_id ถูกต้องไหม`,
    currency: (key, received) => `สกุลเงินไม่ตรง: order เป็น ${THB_CURRENCY_CODE} แต่ session จ่าย ${received}`,
    amountUnusable: (key, raw) => `order ${key} ไม่มียอดบาทที่ใช้ได้ (${raw})`,
    amountMismatch: (key, expectedSatang, received) =>
      `ยอดไม่ตรง: order ${key} คาด ${expectedSatang} สตางค์ ` +
      `(THB ${(expectedSatang / 100).toFixed(2)}) แต่จ่ายมา ${received}`,
  },
};

const STOREFRONT_RULES: OrderRules = {
  amountField: 'total',
  amountDetailKey: 'total',
  keyName: 'publicToken',
  text: {
    missingKey: 'ไม่มี client_reference_id — จับคู่ออเดอร์ไม่ได้ (ไม่เดา ไม่สร้างออเดอร์ใหม่)',
    notFound: (key) => `ไม่พบออเดอร์หน้าร้านสำหรับ publicToken ${key} — ตรวจว่า client_reference_id ถูกต้องไหม`,
    currency: (key, received) => `สกุลเงินไม่ตรง: ออเดอร์เป็น ${THB_CURRENCY_CODE} แต่ session จ่าย ${received}`,
    amountUnusable: (key, raw) => `ออเดอร์ ${key} ไม่มียอดรวมที่ใช้ได้ (${raw})`,
    amountMismatch: (key, expectedSatang, received) =>
      `ยอดไม่ตรง: ออเดอร์ ${key} คาด ${expectedSatang} สตางค์ ` +
      `(THB ${(expectedSatang / 100).toFixed(2)}) แต่จ่ายมา ${received}`,
  },
};

/** ผลตัดสินกลาง ๆ ก่อนแปลงชื่อ key ให้เป็นของแต่ละตาราง */
type CoreDecision =
  | { kind: 'apply'; key: string; sessionId: string; expectedSatang: number }
  | NotAppliedDecision;

/**
 * กฎเดียวของการยืนยันออเดอร์ — pure: ไม่แตะ HTTP/DB/config
 *
 * ลำดับการตรวจสำคัญ: branch แรกที่ match คือคำตอบ การสลับลำดับเปลี่ยน
 * reason ที่ลูกค้าเห็นและที่ log ได้ → ถ้าจะเพิ่มเงื่อนไข ให้คิดว่าทำไม
 * ต้องมาก่อน/หลังของเดิม
 */
function checkCompletion(event: any, order: any, rules: OrderRules): CoreDecision {
  // 1) ไม่ใช่ event ที่เราดูแล — ไม่มีทางกลายเป็นจริงในการส่งครั้งหนึง
  if (event?.type !== HANDLED_EVENT_TYPE) {
    return {
      kind: 'not_applied',
      reason: 'unsupported_event_type',
      message: `ไม่ใช่ event ที่เราดูแล: ${event?.type ?? 'ไม่ระบุ'}`,
      detail: { type: event?.type ?? null },
    };
  }

  const session = event?.data?.object ?? {};

  // 2) ไม่มี key จับคู่ order — เดาไม่ได้ และห้ามสร้าง order ใหม่
  const key = normalizeRefCode(session.client_reference_id);
  if (!key) {
    return {
      kind: 'not_applied',
      reason: 'missing_client_reference_id',
      message: rules.text.missingKey,
      detail: { sessionId: String(session.id ?? '') || null },
    };
  }

  const keyed = (extra: Record<string, unknown> = {}) => ({ [rules.keyName]: key, ...extra });

  // 3) order ต้องมีอยู่ก่อนชำระเงินเสมอ — ไม่มีอยู่ = ไม่มีทางสำเร็จในการส่งครั้งหนึง
  if (!order) {
    return {
      kind: 'not_applied',
      reason: 'order_not_found',
      message: rules.text.notFound(key),
      detail: keyed(),
    };
  }

  // 4) สกุลเงินต้องตรงกับที่ระบบเก็บ
  if (String(session.currency) !== THB_CURRENCY_CODE) {
    return {
      kind: 'not_applied',
      reason: 'currency_mismatch',
      message: rules.text.currency(key, session.currency),
      detail: keyed({ expectedCurrency: THB_CURRENCY_CODE, receivedCurrency: session.currency ?? null }),
    };
  }

  // 5) ตัวเลขที่เชื่อได้คือยอดของ ORDER ไม่ใช่ของ session
  //    (session.amount_total มาจากฝั่ง Stripe และแก้เองได้ถ้าไม่ตรวจลายเซ็น)
  const amountBaht = order[rules.amountField];
  let expectedSatang: number;
  try {
    expectedSatang = toThbMinorUnit(Number(amountBaht));
  } catch {
    return {
      kind: 'not_applied',
      reason: 'order_amount_unusable',
      message: rules.text.amountUnusable(key, amountBaht),
      detail: keyed({ [rules.amountDetailKey]: amountBaht ?? null }),
    };
  }
  if (Number(session.amount_total) !== expectedSatang) {
    return {
      kind: 'not_applied',
      reason: 'amount_mismatch',
      message: rules.text.amountMismatch(key, expectedSatang, session.amount_total),
      detail: keyed({ expectedSatang, receivedSatang: session.amount_total ?? null }),
    };
  }

  // 6) ผ่านทุกอย่าง → อนุญาตให้เขียน (CAS ที่ payment-apply.service ทำต่อ)
  return { kind: 'apply', key, sessionId: String(session.id ?? ''), expectedSatang };
}

/**
 * ตัดสินใจว่าจะ apply delivery นี้ไหม — TransferOrder (คำสั่งโอน/รับเงิน)
 *
 * order ที่รับได้มีแค่ ref_code/amount_thb ของตารางนี้ ไม่ต้องรู้รูปร่างของตารางอื่น
 */
export function decideCompletion(
  event: any,
  order: { ref_code?: unknown; status?: unknown; amount_thb?: unknown } | null,
): CompletionDecision {
  const d = checkCompletion(event, order, TRANSFER_RULES);
  return d.kind === 'apply' ? { kind: 'apply', refCode: d.key, sessionId: d.sessionId, expectedSatang: d.expectedSatang } : d;
}

/**
 * ตัดสินใจว่าจะ mark ออเดอร์หน้าร้านเป็น PAID ไหม — BusinessOrder
 *
 * ต่างจาก TransferOrder แค่คอลัมน์ (publicToken/total แทน ref_code/amount_thb)
 * และคำในข้อความ แต่ใช้กฎเดียวกันทุกข้อ เพราะความหมายเดียวกัน:
 * เราเชื่อตัวเลขของ ORDER ไม่ใช่ของ session (session.amount_total แก้เองได้
 * ถ้าไม่เช็คลายเซ็น) และไม่เดา order ที่ไม่มีอยู่จริง
 */
export function decideStorefrontCompletion(
  event: any,
  order: { id?: unknown; publicToken?: unknown; status?: unknown; total?: unknown } | null,
): StorefrontCompletionDecision {
  const d = checkCompletion(event, order, STOREFRONT_RULES);
  if (d.kind === 'not_applied') return d;
  return {
    kind: 'apply',
    publicToken: d.key,
    orderId: String(order?.id ?? ''),
    sessionId: d.sessionId,
    expectedSatang: d.expectedSatang,
  };
}