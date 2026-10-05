// ────────────────────────────────────────────────────────────────────────────
// stripe-reconcile.service.ts — ไล่เงินจริงที่ Stripe บอกว่า "จ่ายแล้ว"
// กับสิ่งที่ฐานข้อมูลของเราบอกว่า "ยังไม่ได้จ่าย"
//
// ทำไมต้องมี (เหตุการณ์ที่เกิดได้จริง ไม่ใช่ทฤษฎี):
//   webhook คือช่องทางที่ Stripe *ดึง* เข้ามาเอง — ถ้ามันหลุด ไม่มีใครดัน
//   เงินจริงจะอยู่ที่ Stripe อย่างเดียว ฝั่งเรายังโชว์ "ค้างชำระ" เต็มจำนวน
//   และไม่มีอะไรเตือน เพราะทุกอย่าง "ปกติ" จนกว่าจะมานั่งเช็ค
//   เคยเกิดแล้วจริงในรอบที่ secret หลุด: หน้าเว็บปกติ · webhook 401 ทุก delivery
//   · ลูกค้าจ่ายเงินจริงแล้วระบบไม่รู้
//
//   การไล่รายการที่ Stripe "จ่ายแล้ว" แล้วเอามาเทียบกับฐานข้อมูลเรา คือวิธีเดียว
//   ที่จับช่องว่างนี้ได้โดยไม่ต้องรอใครสังเกต
//
// ขอบเขตที่ตั้งใจ (สำคัญ — ไฟล์นี้อ่านอย่างเดียว):
//   · ไม่เขียนฐานข้อมูล · ไม่คืนเงิน · ไม่ยิง Stripe ทิ้งอะไร
//   เพราะการ "แก้ทับ" อัตโนมัติโดยไม่มีคนสั่งคืออีกช่องที่ทำให้เงินหาย
//   ทางที่ปลอดภัยกว่าคือ **บอกให้เห็น** แล้วให้คนตัดสินใจ
//
// ไฟล์นี้เป็น pure (ไม่แตะ I/O) ⇒ เทสต์ได้ครบทุกกรณีโดยไม่ต้องมี Stripe จริง
// ส่วนการยิง Stripe/อ่าน DB อยู่ใน stripe-reconcile.runtime.ts
// ────────────────────────────────────────────────────────────────────────────

/** session ฝั่ง Stripe ที่เราดึงมาได้ (หุ่นข้อมูลเท่าที่ต้องใช้เท่านั้น) */
export interface StripeCompletedSession {
  /** cs_… — เก็บลง business_payments.reference / transfer_orders.txid */
  id: string;
  /** ค่าที่เราส่งไปตอนสร้าง session = refCode (TransferOrder) หรือ publicToken (ร้าน) */
  clientReferenceId: string | null;
  /** ยอดสตาง (หน่วยเล็กสุดของสกุลเงิน) */
  amountTotal: number | null;
  currency: string | null;
  /** จ่ายสำเร็จจริงหรือยัง (Stripe: paid / unpaid / no_payment_required) */
  paymentStatus: string | null;
  /** true = เงินจริง (false = test mode — ห้ามนับเป็นเงินจริง) */
  livemode: boolean;
  createdAt: Date | null;
}

/** สิ่งที่ฐานข้อมูลเราบอกว่า "จ่ายแล้ว" — รวมทั้งสองทางของระบบ */
export interface LocalPaidRecord {
  /** ทางของระบบ (เพื่อบอกคนว่าไปดูที่ไหน) */
  kind: 'transfer_order' | 'business_payment';
  /** ref_code หรือ publicToken — คีย์ที่จับคู่กับ client_reference_id */
  key: string;
  /** session id ที่ถูกบันทึกไว้ (cs_…) — ค่าว่าง = ไม่รู้ว่าจ่ายผ่านอะไร */
  sessionId: string | null;
  /** ยอดที่บันทึกไว้ */
  amountThb: number | null;
}

/** สถานะที่ Stripe ถือว่า "เงินเข้าแล้วจริง" */
const PAID_STATUSES = new Set(['paid', 'no_payment_required']);

/**
 * session ฝั่ง Stripe ที่ถือว่า "ลูกค้าจ่ายเงินจริงแล้ว"
 *
 * กรอง `livemode` ออกเพราะ session ใน test mode ไม่ใช่เงินจริง — ถ้านับรวม
 * รายงานจะขึ้น "เงินหาย" ทั้งที่ไม่มีเงินจริง ทำให้สัญญาณเชื่อถือได้ไม่ได้
 */
export function isRealPaidSession(s: StripeCompletedSession): boolean {
  if (!s || !s.id) return false;
  if (!s.livemode) return false;
  return PAID_STATUSES.has(String(s.paymentStatus ?? '').toLowerCase());
}

/** ช่องว่าง 1 รายการ — พร้อมบอกว่า "ต้องไปดูที่ไหน" */
export interface ReconciliationGap {
  kind: 'paid_in_stripe_missing_locally' | 'paid_locally_missing_in_stripe';
  /** ตัวระบุที่คนใช้ค้นได้จริง (refCode / publicToken / session id) */
  key: string;
  /** cs_… ถ้ารู้ — ไม่รู้ก็ไม่ต้องมี */
  sessionId: string | null;
  /** ยอดสตางจาก Stripe (null = ไม่ทราบ) */
  stripeAmount: number | null;
  /** ยอดบาทที่บันทึกไว้ใน DB (null = ไม่ทราบ) */
  localAmountThb: number | null;
  /** ข้อความอ่านเข้าใจได้ทันทีว่าเงินอยู่ไหน */
  explanation: string;
}

export interface ReconciliationReport {
  /** session ที่ Stripe บอกว่าจ่ายแล้ว (จริง) */
  stripePaidCount: number;
  /** แถวใน DB ที่บอกว่าจ่ายแล้ว */
  localPaidCount: number;
  matchedCount: number;
  /** ช่องว่างทั้งหมด — ว่างแปลว่าไม่มีเงินหาย */
  gaps: ReconciliationGap[];
  /** true = ไม่มีช่องว่าง (ปกติ) */
  consistent: boolean;
}

/**
 * เทียบสองฝั่ง — หัวใจของงานนี้
 *
 * จับคู่ด้วย *สอง* ทางเสมอ ไม่ใช่ทางเดียว เพราะข้อมูลจริงไม่สมบูรณ์:
 *   1) session id  → ตรงกันก็ถือว่าจับได้แน่นอน (เก็บไว้ตอน apply)
 *   2) client_reference_id ↔ key → จับได้แม้ session id หายไปใน DB
 *      (เช่นแถวที่เขียนด้วยมือ) — สำคัญมาก เพราะถ้าจับได้แค่ทางเดียว
 *      ระบบจะรายงาน "เงินหาย" เต็มไปหมดจากแถวที่ปกติ
 */
export function reconcilePaidSessions(input: {
  stripeSessions: StripeCompletedSession[];
  localPaid: LocalPaidRecord[];
}): ReconciliationReport {
  const stripePaid = (input.stripeSessions ?? []).filter(isRealPaidSession);
  const localPaid = input.localPaid ?? [];

  const localBySession = new Map<string, LocalPaidRecord>();
  const localByKey = new Map<string, LocalPaidRecord>();
  for (const rec of localPaid) {
    if (rec.sessionId) localBySession.set(rec.sessionId, rec);
    if (rec.key) localByKey.set(rec.key, rec);
  }

  const gaps: ReconciliationGap[] = [];
  const seenSessions = new Set<string>();
  const seenLocalKeys = new Set<string>();
  let matchedCount = 0;

  // ฝั่ง Stripe: จ่ายแล้ว แต่เราไม่มีแถวไหนบอกว่าจ่าย → เงินอยู่ที่ Stripe อย่างเดียว
  for (const s of stripePaid) {
    const hit =
      localBySession.get(s.id) ?? (s.clientReferenceId ? localByKey.get(s.clientReferenceId) : undefined);
    if (hit) {
      matchedCount++;
      seenSessions.add(s.id);
      seenLocalKeys.add(hit.key);
      continue;
    }
    gaps.push({
      kind: 'paid_in_stripe_missing_locally',
      key: s.clientReferenceId ?? '(ไม่มี client_reference_id)',
      sessionId: s.id,
      stripeAmount: s.amountTotal,
      localAmountThb: null,
      explanation:
        `Stripe ยืนยันว่าจ่ายแล้ว (${s.id}) แต่ฐานข้อมูลเราไม่มีแถวที่จ่าย` +
        `${s.clientReferenceId ? ` สำหรับ ${s.clientReferenceId}` : ' และ session นี้ไม่มี client_reference_id จึงจับคู่ไม่ได้'}` +
        ` ⇒ ลูกค้าจ่ายเงินจริงแล้ว ระบบยังโชว์ว่าค้างชำระ — ต้องไปแก้ด้วยมือ`,
    });
  }

  // ฝั่งเรา: DB บอกว่าจ่ายแล้ว แต่ Stripe ไม่มี session ตรงกันในช่วงที่ดู
  // (อาจเป็นของเก่ากว่าช่วงที่ดู หรือถูกลบใน Stripe — ต้องให้คนตัดสินใจ ไม่ใช่ "แก้ทับ")
  for (const rec of localPaid) {
    if (seenLocalKeys.has(rec.key)) continue;
    if (rec.sessionId && seenSessions.has(rec.sessionId)) continue;
    gaps.push({
      kind: 'paid_locally_missing_in_stripe',
      key: rec.key,
      sessionId: rec.sessionId,
      stripeAmount: null,
      localAmountThb: rec.amountThb,
      explanation:
        `ฐานข้อมูลบอกว่าจ่ายแล้ว (${rec.kind} ${rec.key}` +
        `${rec.sessionId ? ` · session ${rec.sessionId}` : ' · ไม่ได้บันทึก session id'})` +
        ` แต่ไม่พบในรายการที่ดึงจาก Stripe ⇒ อาจเป็นของเก่ากว่าช่วงที่ดู หรือถูกลบใน Stripe` +
        ` — ต้องให้คนตัดสินใจ ไม่แก้ทับอัตโนมัติ`,
    });
  }

  return {
    stripePaidCount: stripePaid.length,
    localPaidCount: localPaid.length,
    matchedCount,
    gaps,
    consistent: gaps.length === 0,
  };
}

/**
 * ข้อความรายงาน — เขียนให้คนที่ไม่ใช่ผู้เขียนโค้ดอ่านรู้เรื่อง
 *
 * กติกา: พิมพ์ยอดเงินได้ (ไม่ใช่ค่าลับ) · ไม่พิมพ์อะไรที่เป็นคีย์/โทเคน
 * และ**ต้องบอกด้วยว่าตอนนี้เชื่อได้แค่ไหน** — คำสั่งนี้อาจรันแบบยังไม่มี
 * Stripe key เลย ถ้าไม่บอก ผู้ดูแลจะเข้าใจว่า "ตรวจแล้วไม่มีเงินหาย" ทั้งที่
 * จริง ๆ คือยังตรวจไม่ได้ ซึ่งเป็นกับดักแบบเดียวกันที่เพิ่งปิดไป
 */
export function formatReconciliationReport(report: ReconciliationReport): string {
  const lines: string[] = [];
  lines.push(
    `🔎 Stripe reconcile — Stripe จ่ายแล้ว ${report.stripePaidCount} · ในระบบบันทึกแล้ว ${report.localPaidCount} · ตรงกัน ${report.matchedCount}`,
  );
  if (report.consistent) {
    lines.push('   ✅ ไม่พบช่องว่างในช่วงที่ดู');
    return lines.join('\n');
  }
  lines.push(`   ⚠️ พบช่องว่าง ${report.gaps.length} รายการ:`);
  for (const g of report.gaps) {
    lines.push(`   · [${g.kind}] ${g.explanation}`);
  }
  lines.push('   ⇒ เงินจริงอาจอยู่คนละฝั่งกับที่ระบบบันทึก — ต้องให้คนตรวจและแก้ด้วยมือ');
  return lines.join('\n');
}