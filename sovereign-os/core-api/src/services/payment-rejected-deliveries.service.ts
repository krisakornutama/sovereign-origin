// ────────────────────────────────────────────────────────────────────────────
// payment-rejected-deliveries.service.ts — หลักฐานของเงินที่เข้ามาแต่ระบบปฏิเสธ
//
// ช่องเงินหายเงียบที่แก้ด้วยการ retry ไม่ได้ มีช่องเดียว: delivery ที่ "ไม่มีทางสำเร็จ"
// webhook ตอบ 2xx → Stripe ถือว่าสำเร็จ เลิกส่ง event นั้นถาวร (หายจากหน้า Stripe)
// และไม่มีแถวเงิน ลูกค้าจ่ายจริงเข้ามาแล้วแต่ระบบไม่มีที่ไหนเก็บ
// การให้ Stripe retry ก็ไม่ช่วย เพราะส่งชุดเดิมซ้ำก็ยังไม่ตรงอีก (ไม่มี state
// ที่เปลี่ยนระหว่าง delivery) ⇒ ต้องมี "ร่องรอยที่คนตามได้" แทน
//
// สิ่งที่ไฟล์นี้ตั้งใจ *ไม่* ทำ:
//   · ไม่แตะ DB — งานของ payment-apply.service (ถ้าหลักฐานเขียนลงฐานข้อมูล
//     เส้นทางนี้จะกลายเป็นอีกชั้นที่ล้มพร้อมกับเงิน ซึ่งแย่กว่าเดิม)
//   · ไม่เก็บ payload ดิบ ไม่เก็บอีเมล/ชื่อ/เลขบัตรลูกค้า — เก็บเท่าที่
//     จำเป็นต่อการตามเงินเท่านั้น (ดู buildRejectedDeliveryEvidence)
//   · ไม่เปลี่ยนคำตอบของ webhook — ผู้เรียกอยู่ที่ payments.routes.ts
//
// เจ้าของจะอ่านที่ไหน: <core-api>/data/payments-rejected-deliveries.jsonl
// (ไฟล์คือ JSON ต่อบรรทัด — grep/ตัวแก้ไขธรรมดาอ่านได้ ไม่ต้องมีเครื่องมือพิเศษ)
// ────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NotAppliedReason } from './payment-verification.service';

/**
 * เหตุผลที่ "เงินเข้าจริง แต่ระบบปฏิเสธถาวร ไม่มีทางแก้เองด้วยการส่งซ้ำ"
 *
 * เกณฑ์การเลือก: retry แล้วคำตอบต้อง *ยังเหมือนเดิม* คือ ตรวจแล้วไม่มีทางผ่าน
 *   currency_mismatch         — session จ่ายสกุลอื่นที่ระบบไม่รู้จัก/เก็บไม่ได้
 *   amount_mismatch           — ยอดที่จ่ายจริงไม่เท่าที่ order คาดไว้ (คนต้องไปแก้เอง)
 *   order_amount_unusable     — ยอดของ order เราเองใช้ไม่ได้ (ของเราผิด ไม่ใช่ของ Stripe)
 *
 * ไม่รวมโดยเด็ดขาด:
 *   order_not_found      — 409 ให้ Stripe retry อยู่แล้ว ยังไม่หายถาวร
 *   missing_client_reference_id / unsupported_event_type — ไม่ใช่ธุระเงินของเรา
 *   order_not_pending    — มีคนจ่าย/จัดการ order นั้นไปแล้ว ไม่ใช่เงินหาย
 *
 * ถ้าวันหนึ่งเพิ่ม reason ที่ถาวร ให้เพิ่มในชุดนี้พร้อมกัน — ไม่ใช่ที่ route
 */
export const PERMANENT_REJECTION_REASONS: ReadonlySet<NotAppliedReason> = new Set<NotAppliedReason>([
  'currency_mismatch',
  'amount_mismatch',
  'order_amount_unusable',
]);

/** เหตุผลนี้ทำให้เงินหายถาวรหรือไม่ (ใช้เป็นเงื่อนไขเดียวทั้งระบบ) */
export function isPermanentRejection(reason: NotAppliedReason): boolean {
  return PERMANENT_REJECTION_REASONS.has(reason);
}

/**
 * รูปของหลักฐาน 1 บรรทัด — allowlist แบบเปิด (เพิ่มฟิลด์ต้องตั้งใจ)
 *
 * ไม่ใช่ payload ของ Stripe: ทุกฟิลด์ได้มาจาก "สิ่งที่ตัดสินใจแล้ว" หรือ
 * "ตัวเลขที่ต้องตามเงิน" เท่านั้น ไม่มี customer/payment_method/card/email ฯลฯ
 */
export interface RejectedDeliveryEvidence {
  reason: NotAppliedReason;
  eventId: string | null;
  eventType: string | null;
  refCode: string | null;
  /** ยอด (สตางค์) ที่ Stripe ส่งมา — ตัวเลขที่ลูกค้าจ่ายจริง */
  receivedAmountSatang: number | null;
  receivedCurrency: string | null;
  /** ยอด (สตางค์) ที่ order คาดไว้ — ขาดเมื่อ order ใช้ยอดไม่ได้อยู่แล้ว */
  expectedAmountSatang: number | null;
  /** สกุลเงินที่ระบบเก็บ/รองรับ */
  expectedCurrency: string | null;
  /** ค่ายอดดิบของ order ตอนที่ใช้ไม่ได้ — คนต้องไปแก้ที่ order ตัวนี้ */
  orderAmountRaw: number | string | null;
  livemode: boolean | null;
  receivedAt: string;
  message: string;
}

const str = (v: unknown): string | null => {
  const s = v === undefined || v === null ? '' : String(v);
  return s.length > 0 ? s : null;
};
const num = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * แปลง delivery ที่ถูกปฏิเสธเป็นหนึ่งบรรทัดหลักฐาน
 *
 * pure: ไม่อ่านไฟล์ ไม่แตะ DB — เทสต์ชุดเดิมของ webhook จึงตรวจ "รูปของข้อมูล"
 * ได้โดยไม่ต้องรอ I/O (และรูปข้อมูลคือสิ่งที่พิสูจน์เรื่อง PII ได้)
 *
 * คืน null เมื่อเหตุผลไม่ใช่ถาวร — ไฟล์หลักฐานต้องแยกของจริงออกจากของแก้ได้
 * ไม่ใช่ทุก event ที่ไม่ได้ apply
 */
export function buildRejectedDeliveryEvidence(input: {
  // event เป็น optional โดยตั้งใจ: ถ้าไม่มี event ก็ยังต้องเขียนหลักฐาน (ด้วยค่าที่
  // ไม่รู้เป็น null) เพราะ "ร่องรอยว่ามีเงินเข้ามาแต่ปฏิเสธ" สำคัญกว่าความครบ
  // ของทุกช่อง — หลักฐานที่ไม่มียอดยังไปตามต่อได้ด้วย event id
  event?: any;
  reason: NotAppliedReason;
  message: string;
  detail?: Record<string, unknown>;
  receivedAt?: Date;
}): RejectedDeliveryEvidence | null {
  const { event, reason, message, detail = {} } = input;
  if (!isPermanentRejection(reason)) return null;

  const session = event?.data?.object ?? {};
  // key ของ order: TransferOrder ใช้ refCode · BusinessOrder ใช้ publicToken
  const refCode = str(detail.refCode) ?? str(detail.publicToken) ?? str(session.client_reference_id);

  return {
    reason,
    eventId: str(event?.id),
    eventType: str(event?.type),
    refCode,
    receivedAmountSatang: num(session.amount_total),
    receivedCurrency: str(session.currency),
    expectedAmountSatang: num(detail.expectedSatang),
    expectedCurrency: str(detail.expectedCurrency),
    // order_amount_unusable เก็บค่าดิบไว้ (amountThb ของ TransferOrder / total
    // ของ BusinessOrder) เพราะคนต้องไปแก้ order ตัวนั้น ไม่ใช่แก้ที่ webhook
    orderAmountRaw: (detail.amountThb ?? detail.total ?? null) as number | string | null,
    livemode: typeof event?.livemode === 'boolean' ? event.livemode : null,
    receivedAt: (input.receivedAt ?? new Date()).toISOString(),
    message: String(message ?? ''),
  };
}

/** ชื่อไฟล์หลักฐาน (คนตามเงินเปิดดูได้ด้วยตาเปล่า) */
export const EVIDENCE_FILE_NAME = 'payments-rejected-deliveries.jsonl';

/**
 * โฟลเดอร์เก็บหลักฐาน
 *
 * ค่า default คือ data/ ของ core-api ซึ่ง docker-compose mount เข้า container
 * แบบอ่านเขียนได้และข้อมูลยังอยู่บน MAIN (ไม่หายตอน rebuild)
 * ทับได้ด้วย PAYMENT_EVIDENCE_DIR เพื่อให้เทสต์เขียนลงที่ชั่วคราว
 */
export function evidenceDir(): string {
  const override = (process.env.PAYMENT_EVIDENCE_DIR ?? '').trim();
  return override.length > 0 ? override : path.resolve(process.cwd(), 'data');
}

/** ที่อยู่ไฟล์เต็ม — ใช้ในข้อความ log ให้คนรู้ว่าไปดูที่ไหน */
export function evidenceFilePath(): string {
  return path.join(evidenceDir(), EVIDENCE_FILE_NAME);
}

/**
 * เขียนหลักฐานหนึ่งบรรทัด (append) — โยน error ได้ถ้าเขียนไม่ได้
 *
 * แยกจาก safeRecordRejectedDelivery เพราะชั้นบนต้องการ "รู้ว่าล้ม"
 * เพื่อรายงานออกไป ไม่ใช่กลืนเงียบ
 *
 * ทำไมเป็น append บรรทัดเดียว (JSONL) ไม่ใช่ JSON เดียว:
 *   · เขียนทับไฟล์เดิม = หลักฐานที่แล้วหาย (ตรงข้ามกับเจ้าหน้าที่)
 *   · ไฟล์เสียกลางทาง (ดิสก์เต็ม/ตัดไฟล์) ยังอ่านบรรทัดก่อนหน้าได้
 *   · grep ได้ทันทีโดยไม่ต้องมี jq
 */
export async function appendRejectedDeliveryEvidence(
  evidence: RejectedDeliveryEvidence,
): Promise<void> {
  const file = evidenceFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(evidence)}\n`, 'utf8');
}

/**
 * เขียนหลักฐานโดยไม่มีวันทำให้ผู้เรียกล้ม และไม่มีวันค้าง
 *
 * นี่คือ "การันตีที่หลักฐานไม่ได้ทำให้เงินหายเพิ่ม" — เพราะถ้าหลักฐานล้มเอง
 * แล้วเรายังตอบ 2xx เหมือนเดิม เงินก็หายเงียบเหมือนเดิม (แย่กว่าไม่มีระบบหลักฐาน
 * แต่ไม่แย่กว่า) ⇒ จึงต้อง *รายงาน* เสียงดัง ไม่ใช่กลืน
 *
 * timeout จำเป็นเพราะ: ถ้าดิสก์ที่เก็บหลักฐานค้าง (network mount มีปัญหา)
 * แล้ว await ค้างไว้ หน้า webhook จะไม่ตอบ → Stripe timeout → เงินหายเพราะ
 * เรื่องที่ควรจะเป็นแค่ "บันทึกหลักฐาน" ซึ่งแย่กว่าการไม่มีระบบหลักฐานมาก
 */
export async function safeRecordRejectedDelivery(
  evidence: RejectedDeliveryEvidence,
  timeoutMs = 2000,
): Promise<{ ok: boolean; error?: string }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const guard = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`บันทึกหลักฐานไม่ทันใน ${timeoutMs}ms`)), timeoutMs);
    });
    await Promise.race([appendRejectedDeliveryEvidence(evidence), guard]);
    return { ok: true };
  } catch (err: any) {
    const error = String(err?.message ?? err);
    // เสียงดัง + บอกด้วยว่าหลักฐานหาย (คนต้องไปไล่จาก event id ที่ log เดิมบอก)
    console.error(
      `[payments] บันทึกหลักฐานการปฏิเสธไม่สำเร็จ (${evidence.reason}) — ${error} · ` +
      `event ${evidence.eventId ?? 'ไม่รู้'} ref ${evidence.refCode ?? 'ไม่รู้'} · ` +
      'เงินจริงอาจเข้าแล้วแต่ระบบไม่บันทึก: ให้เปิดหน้า Stripe ที่ event นี้แล้วจ่าย/คืนด้วยมือ',
    );
    return { ok: false, error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}