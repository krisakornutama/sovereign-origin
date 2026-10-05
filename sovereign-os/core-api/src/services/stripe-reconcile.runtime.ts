// ────────────────────────────────────────────────────────────────────────────
// stripe-reconcile.runtime.ts — ต่อชิ้นจริงของการไล่เงิน: ยิง Stripe อ่านอย่างเดียว
// + ดึงสิ่งที่ DB บอก แล้วส่งเข้า pure logic ใน stripe-reconcile.service.ts
//
// กติกาที่บังคับ (ทำให้เชื่อได้ ไม่ใช่แค่ "มีโค้ดอยู่"):
//   1) **ปิดอยู่ = ต้องบอกเสียงดังว่าปิดอยู่เพราะอะไร** ห้ามเงียบเด็ดขาด
//      เหตุผล: งานนี้มีไว้จับช่องว่างที่ทำเงินหายเงียบ ถ้าตัวมันเองเงียบ
//      เมื่อปิด เราก็กลับไปอยู่ในสถานะเดิมที่เงินหายโดยไม่มีใครรู้
//      (นี่คือกับดับเดียวกับที่เพิ่งปิดไปเรื่อง webhook secret — ห้ามรู้แบบนั้นซ้ำ)
//   2) อ่านอย่างเดียว: ไม่เขียน DB ไม่คืนเงิน ไม่ยิง request ที่เปลี่ยนสถานะ
//   3) ยิง Stripe ได้ก็ต่อเมื่อมี live key + STRIPE_LIVE_ENABLED=true เท่านั้น
//      (เหตุผลเดียวกับ createLiveStripeTransport: อีกบัญชีคนละบัญชี = เงินจริง)
//   4) ห้ามโยน error ออกไป — worker ล้มต้องไม่ลากระบบทั้งหมดลง
// ────────────────────────────────────────────────────────────────────────────
import { config } from '../config';
import { prisma } from '../lib/prisma';
import {
  reconcilePaidSessions,
  formatReconciliationReport,
  type StripeCompletedSession,
  type LocalPaidRecord,
  type ReconciliationReport,
} from './stripe-reconcile.service';

/** ดึง session ที่จ่ายเสร็จจาก Stripe — อ่านอย่างเดียว (GET เท่านั้น) */
export type StripeSessionFetcher = (opts: { secretKey: string; since: Date }) => Promise<StripeCompletedSession[]>;

function thbToSatang(thb: number | null | undefined): number | null {
  if (thb === null || thb === undefined || !Number.isFinite(thb)) return null;
  return Math.round(Number(thb) * 100);
}

/**
 * ดึง checkout sessions ที่จ่ายสำเร็จจาก Stripe API (อ่านอย่างเดียว)
 *
 * ใช้ created gte + pagination เพราะช่วงเวลาคือสิ่งที่ทำให้ "ไม่เจอ"
 * แปลว่าอะไร — ถ้าดูแค่หน้าแรก 100 รายการ เงินที่หลุดอาจอยู่นอกหน้าต่าง
 * แล้วรายงานว่า "ไม่มีช่องว่าง" ซึ่งเป็นการโกหกที่อันตรายกว่าไม่รายงานเลย
 */
export const fetchStripeSessions: StripeSessionFetcher = async ({ secretKey, since }) => {
  const out: StripeCompletedSession[] = [];
  const url = new URL('https://api.stripe.com/v1/checkout/sessions');
  url.searchParams.set('limit', '100');
  url.searchParams.set('created[gte]', String(Math.floor(since.getTime() / 1000)));

  // เพดานจำนวนหน้า — กันดึงไม่รู้จบถ้า account ใหญ่ (อ่านอย่างเดียว แต่ก็ต้องมีที่สิ้นสุด)
  for (let page = 0; page < 10; page++) {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new Error(`Stripe list sessions ${res.status}: ${body}`);
    }
    const json = (await res.json()) as any;
    for (const s of json?.data ?? []) {
      out.push({
        id: String(s?.id ?? ''),
        clientReferenceId: s?.client_reference_id ?? null,
        amountTotal: s?.amount_total ?? null,
        currency: s?.currency ?? null,
        paymentStatus: s?.payment_status ?? null,
        livemode: Boolean(s?.livemode),
        createdAt: s?.created ? new Date(Number(s.created) * 1000) : null,
      });
    }
    if (!json?.has_more) break;
    const next = json?.next_page ?? null;
    if (!next) break;
    url.search = new URL(next).search; // เดินหน้าต่อด้วย cursor ของ Stripe เอง
  }
  return out;
};

/** สิ่งที่ DB บอกว่าจ่ายแล้ว — ทั้งสองทาง (TransferOrder + ร้าน) */
async function loadLocalPaid(): Promise<LocalPaidRecord[]> {
  const [transfers, payments] = await Promise.all([
    prisma.transferOrder.findMany({
      where: { status: 'VERIFIED' },
      select: { ref_code: true, txid: true, amount_thb: true },
      orderBy: { verified_at: 'desc' },
      take: 200,
    }),
    prisma.businessPayment.findMany({
      where: { rejectedAt: null },
      select: { reference: true, amount: true, order: { select: { publicToken: true } } },
      orderBy: { paidAt: 'desc' },
      take: 200,
    }),
  ]);

  const out: LocalPaidRecord[] = [];
  for (const t of transfers) {
    out.push({
      kind: 'transfer_order',
      key: String(t.ref_code),
      sessionId: t.txid ?? null,
      amountThb: thbToSatang(t.amount_thb),
    });
  }
  for (const p of payments) {
    // method อื่นที่ไม่ใช่ Stripe (โอน/เงินสด) ไม่ต้องเทียบกับ Stripe
    const sessionId = p.reference && String(p.reference).startsWith('cs_') ? String(p.reference) : null;
    if (!sessionId) continue;
    out.push({
      kind: 'business_payment',
      key: String(p.order?.publicToken ?? sessionId),
      sessionId,
      amountThb: thbToSatang(p.amount),
    });
  }
  return out;
}

export interface ReconcileOutcome {
  /** ทำงานจริงหรือไม่ */
  ran: boolean;
  /** เหตุผลที่ไม่ได้รัน (ต้องไม่ว่างเมื่อ ran=false) */
  reason?: string;
  report?: ReconciliationReport;
}

/**
 * ไล่เงินหนึ่งรอบ — คืนผลให้ทั้งเทสต์และผู้เรียกใช้
 *
 * คืน `reason` เสมอเมื่อยังไม่รัน เพื่อให้ผู้เรียก**แสดง** ได้ ไม่ใช่เดาเองว่า
 * ทำไม — ถ้าไม่คืน จะกลายเป็น worker ที่เงียบตอนปิด ซึ่งคือบั๊กที่ห้ามมี
 */
export async function runStripeReconcile(
  opts: { fetcher?: StripeSessionFetcher; sinceHours?: number } = {},
): Promise<ReconcileOutcome> {
  const fetcher = opts.fetcher ?? fetchStripeSessions;

  // ── ประตูข้อ 1: มี key จริงไหม ────────────────────────────────────────────
  const secretKey = String(config.stripe.secretKey ?? '').trim();
  if (!secretKey) {
    return {
      ran: false,
      reason:
        'ยังไม่ได้ตั้ง STRIPE_SECRET_KEY — ไล่เงินไม่ได้ (ไม่ใช่ "ตรวจแล้วไม่มีเงินหาย") ' +
        '⇒ ช่องว่างที่เงินหายเงียบยังไม่มีใครตรวจ',
    };
  }

  // ── ประตูข้อ 2: เปิดยิง Stripe จริงได้หรือยัง ───────────────────────────
  if (!config.stripe.liveEnabled) {
    return {
      ran: false,
      reason:
        'STRIPE_LIVE_ENABLED ยังไม่เป็น true — ตั้งใจไม่ยิง Stripe จริง ' +
        '(อีกบัญชีคือเงินจริง) ⇒ ยังไม่ได้ตรวจช่องว่างช่วงนี้',
    };
  }

  const sinceHours = Number(opts.sinceHours ?? 24 * 7);
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);

  try {
    const [sessions, localPaid] = await Promise.all([fetcher({ secretKey, since }), loadLocalPaid()]);
    const report = reconcilePaidSessions({ stripeSessions: sessions, localPaid });
    return { ran: true, report };
  } catch (err: any) {
    // ล้มต้องได้ยิน และต้องบอกด้วยว่าตรวจไม่สำเร็จ (ไม่ใช่ "ไม่มีเงินหาย")
    console.error(
      `[stripe-reconcile] ❌ ไล่เงินไม่สำเร็จ: ${err?.message ?? err} — ` +
      `ช่วง ${sinceHours} ชม. ยังไม่ได้ตรวจ อย่าเข้าใจว่า "ไม่มีเงินหาย"`,
    );
    return { ran: false, reason: `ไล่เงินล้ม: ${err?.message ?? err}` };
  }
}

/**
 * ตัวที่ worker เรียกตามเวลา — คืนข้อความเสมอ ไม่ว่าจะรันได้หรือไม่
 * เพื่อให้ log มีคำว่า "ปิดอยู่เพราะอะไร" ทุกรอบ ไม่ใช่เงียบเฉย ๆ
 */
export async function runAndReportStripeReconcile(
  opts: { fetcher?: StripeSessionFetcher; sinceHours?: number } = {},
): Promise<string> {
  const out = await runStripeReconcile(opts);
  if (!out.ran) {
    const msg = `⚠️ [stripe-reconcile] ข้ามรอบนี้: ${out.reason}`;
    console.warn(msg);
    return msg;
  }
  const text = formatReconciliationReport(out.report!);
  if (out.report!.consistent) console.log(text);
  else console.error(text); // ช่องว่าง = เงินหาย → ระดับ error ต้องเห็น
  return text;
}