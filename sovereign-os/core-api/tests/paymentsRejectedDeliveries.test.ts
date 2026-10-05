// ────────────────────────────────────────────────────────────────────────────
// หลักฐานการจ่ายเงินที่ถูกปฏิเสธถาวร — ช่องเงินหายเงียบที่สุดของระบบ
//
// เรื่องที่เทสต์ชุดนี้จับ: มี 3 เหตุผลที่ webhook ตอบ 2xx โดย *ไม่มีแถวเงินเลย*
//   currency_mismatch · amount_mismatch · order_amount_unusable
// คือกรณี "เงินเข้าจริง แต่ระบบปฏิเสธ" — Stripe เห็น 2xx ก็เลิกส่ง event นั้นถาวร
// จากหน้า Stripe (ไม่มีใครเห็นอีก) และ retry ก็ไม่ช่วย เพราะส่งซ้ำก็ยังไม่ตรง
// แถวเดิมอีก (ไม่มี state ที่จะเปลี่ยนระหว่าง delivery) ⇒ การ retry เป็นไปเปล่า
//
// สิ่งที่ต้องเป็นจริง (ทุกข้อมีเทสต์ด้านล่าง):
//   1) มีหลักฐานให้คนตามได้ — event id / type / refCode / ยอด / สกุลเงิน / เหตุผล / เวลา
//   2) ไม่มี PII และไม่มี payload ดิบ (ข้อมูลลูกค้า/บัตรต้องไม่ไปโผล่ในไฟล์หลักฐาน)
//   3) ยังไม่มีแถวเงิน/ออเดอร์ถูกแตะ — หลักฐานคือ "บันทึก" ไม่ใช่ "จ่ายเงิน"
//   4) การบันทึกหลักฐานล้มเอง → webhook ต้องตอบเหมือนเดิมทุก byte (ห้ามเปลี่ยนสัญญา)
//   5) เหตุผลที่ *ไม่ใช่* เงินหายถาวร (order_not_found / unsupported) ห้ามเขียนหลักฐาน
//      มิฉะนั้นไฟล์หลักฐานจะรกจนคนอ่านไม่ออกว่าอันไหนคือเงินจริง
//
// ทำไมเป็นไฟล์แยกจาก paymentsWebhook.test.ts: ไฟล์นั้นคือ "สัญญาการตอบของ
// webhook" (401/400/422/409/200/atomicity) และยาวเกือบเตะเพดานไฟล์ 800 บรรทัด
// ของ arch-gate การแตะทั้งสองเรื่องพร้อมกันทำให้ตรวจไม่ได้ว่าอันไหนพัง
// ────────────────────────────────────────────────────────────────────────────
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { createPaymentsRouter } from '../src/modules/payments/payments.routes';
import { createFakeStripeTransport } from '../src/services/stripe-checkout';

const API = '/api/payments';
const WEBHOOK_SECRET = 'whsec_test_evidence_value_do_not_use_in_prod';

/** โฟลเดอร์หลักฐานที่เทสต์บังคับให้เขียน — ไม่แตะ data/ ของของจริง */
let evidenceDir = '';

// ── prisma ปลอม (เหมือน paymentsWebhook.test.ts — แยกไฟล์กันเพื่อให้แต่ละเรื่อง
//    ตรวจได้เดี่ยว ๆ และไม่ต้องแก้ชุดเดิมที่พิสูจน์สัญญาไว้แล้ว) ─────────────────
interface Row { ref_code: string; status: string; amount_thb: number | null }
const orders = new Map<string, Row>();
interface StoreRow { id: string; publicToken: string; status: string; total: number; paidAmount: number }
const storefront = new Map<string, StoreRow>();
const payments: any[] = [];
let appliedCount = 0;
let storefrontApplied = 0;

const prisma: any = {
  transferOrder: {
    findFirst: async ({ where }: any) => orders.get(where?.ref_code) ?? null,
    updateMany: async ({ where, data }: any) => {
      const row = orders.get(where?.ref_code);
      if (!row || (where?.status && row.status !== where.status)) return { count: 0 };
      Object.assign(row, data);
      appliedCount += 1;
      return { count: 1 };
    },
  },
  businessOrder: {
    findFirst: async ({ where }: any) => storefront.get(where?.publicToken) ?? null,
    updateMany: async ({ where, data }: any) => {
      const row = storefront.get(where?.publicToken);
      if (!row) return { count: 0 };
      const want = where?.status;
      const list = Array.isArray(want) ? want : Array.isArray(want?.in) ? want.in : null;
      const ok = list ? list.includes(row.status) : row.status === want;
      if (!ok) return { count: 0 };
      Object.assign(row, data);
      storefrontApplied += 1;
      return { count: 1 };
    },
  },
  businessPayment: {
    create: async ({ data }: any) => {
      payments.push({ ...data });
      return { id: `pay_${payments.length}`, ...data };
    },
  },
  $transaction: async (fn: any) => fn(prisma),
};

// ── ตัวจับหลักฐานที่แทรกเข้าไปใน route (แทนการเขียนไฟล์จริง) ────────────────
// จับข้อมูลดิบที่ route *พยายาม* บันทึก เพื่อพิสูจน์ว่า field ตรงตามที่วางแผน
const evidence: any[] = [];
let evidenceWriteError: Error | null = null;
const collectingWriter = async (entry: any) => {
  evidence.push(entry);
  if (evidenceWriteError) throw evidenceWriteError;
};

let server: Server;
let baseUrl: string;
const transport = createFakeStripeTransport();

before(async () => {
  evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-payment-evidence-'));
  const app: Express = express();
  app.use(`${API}/webhook`, express.raw({ type: 'application/json', limit: '256kb' }));
  app.use(express.json());
  app.use(API, createPaymentsRouter({
    transport,
    prisma,
    webhookSecret: WEBHOOK_SECRET,
    evidenceWriter: collectingWriter,
  } as any));
  server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  try { fs.rmSync(evidenceDir, { recursive: true, force: true }); } catch { /* ไม่ว่างก็ปล่อย */ }
});

beforeEach(() => {
  orders.clear();
  storefront.clear();
  payments.length = 0;
  appliedCount = 0;
  storefrontApplied = 0;
  expectedTransferOrders = 0;
  expectedStorefrontOrders = 0;
  evidence.length = 0;
  evidenceWriteError = null;
});

// ── ช่วยสร้าง event ─────────────────────────────────────────────────────────
function sign(payload: string, ts = Math.floor(Date.now() / 1000)): string {
  const v1 = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

/**
 * event ที่มีข้อมูลส่วนบุคคลปนอยู่ด้วยโดยตั้งใจ — ถ้าบันทึกหลักฐานด้วย payload ดิบ
 * ค่าเหล่านนี้จะไปโผล่ในไฟล์ และเทสต์ข้างล่างจะจับได้
 */
function completion(refCode: string, sessionId: string, amountTotal: number, currency = 'thb') {
  return JSON.stringify({
    id: 'evt_evidence_001',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: sessionId,
        client_reference_id: refCode,
        amount_total: amountTotal,
        currency,
        customer_email: 'somchai.test@example.invalid',
        customer: { name: 'ทดสอบ สมมติ', phone: '+66800000000' },
        payment_method: { card: { number: '4242424242424242', cvc: '999' } },
      },
    },
  });
}

async function deliver(payload: string, header?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (header !== undefined) headers['stripe-signature'] = header;
  const res = await fetch(`${baseUrl}${API}/webhook`, { method: 'POST', headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

/** ส่งแบบมีเวลาจำกัด — ถ้าหลักฐานทำให้ handler ค้าง เทสต์ต้องตายเร็ว ไม่ใช่แขวน runner */
async function deliverWithTimeout(payload: string, header?: string, ms = 3000) {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`ไม่ได้ response ภายใน ${ms}ms — handler ค้าง`)), ms);
  });
  try {
    return await Promise.race([deliver(payload, header), guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// จำนวน order ที่ควรมีหลัง seed — ใช้ยืนยันว่า webhook ไม่ได้ *สร้าง* order
// ขึ้นมาเอง (การปฏิเสธห้ามเดา/เดาสร้าง order: จะทำให้มี order ปลอมที่ไม่มีเงินจริง)
//
// ต้องแยกตัวนับต่อหนึ่ง map (transfer กับ storefront) — ถ้าใช้ตัวเดียวจะเทียบ
// ข้าม map กันเองแล้ว fail ทั้งที่โค้ดถูก
let expectedTransferOrders = 0;
let expectedStorefrontOrders = 0;

function seedOrder(refCode: string, amountThb: number | null, status = 'PENDING') {
  orders.set(refCode, { ref_code: refCode, status, amount_thb: amountThb });
  expectedTransferOrders = orders.size;
  return refCode;
}
function seedStorefront(publicToken: string, total: number, status = 'ORDERED') {
  storefront.set(publicToken, { id: `bo_${publicToken}`, publicToken, status, total, paidAmount: 0 });
  expectedStorefrontOrders = storefront.size;
  return publicToken;
}

/** ข้อเท็จจริงร่วมที่ต้องเป็นจริงทุกกรณีที่ปฏิเสธถาวร */
function assertNoMoneyWritten(label: string) {
  assert.strictEqual(payments.length, 0, `${label}: ห้ามมีแถวเงิน (ลูกค้าจ่ายจริงแต่ยอดไม่ตรง = ยังจ่ายไม่ได้)`);
  assert.strictEqual(appliedCount, 0, `${label}: ห้ามแตะ TransferOrder`);
  assert.strictEqual(storefrontApplied, 0, `${label}: ห้ามแตะ BusinessOrder`);
  // ห้าม *สร้าง* order ขึ้นมาเองด้วย — order ที่ระบบเดา/สร้างเองจะเป็น order ปลอม
  // ที่ไม่มีเงินจริง ทำให้เจ้าของเห็นออเดอร์ที่ไม่มีที่มา และไปแก้ผิดที่
  assert.strictEqual(orders.size, expectedTransferOrders, `${label}: ห้ามสร้าง TransferOrder ใหม่`);
  assert.strictEqual(storefront.size, expectedStorefrontOrders, `${label}: ห้ามสร้าง BusinessOrder ใหม่`);
}

// ────────────────────────────────────────────────────────────────────────────
// 1) หลักฐานต้องเขียนจริง + ครบทุกช่องที่คนตามเงินต้องใช้
// ────────────────────────────────────────────────────────────────────────────

test('currency_mismatch → ต้องมีหลักฐานบอกว่าเงินเข้ามาแต่ปฏิเสธเพราะสกุลเงิน', async () => {
  const ref = seedOrder('XFR-EV-CUR', 250);
  const p = completion(ref, 'cs_ev_cur', 25000, 'usd');
  const r = await deliver(p, sign(p));

  assert.strictEqual(r.status, 200, 'สัญญาเดิม: 2xx (retry ซ้ำก็ไม่ช่วย)');
  assert.strictEqual(r.body.reason, 'currency_mismatch');
  assertNoMoneyWritten('currency_mismatch');
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');

  assert.strictEqual(evidence.length, 1, 'ต้องมีหลักฐาน 1 บรรทัด');
  const e = evidence[0];
  assert.strictEqual(e.reason, 'currency_mismatch');
  assert.strictEqual(e.eventId, 'evt_evidence_001', 'ต้องมี event id ไว้ไปหาในหน้า Stripe');
  assert.strictEqual(e.eventType, 'checkout.session.completed');
  assert.strictEqual(e.refCode, ref, 'ต้องมี refCode ไว้ไปหา order มาแก้');
  assert.strictEqual(e.receivedAmountSatang, 25000, 'ต้องมียอดที่ Stripe ส่งมาจริง');
  assert.strictEqual(e.receivedCurrency, 'usd', 'ต้องมีสกุลเงินที่มาจริง (ต่างจากที่ระบบเก็บ)');
  assert.strictEqual(e.expectedCurrency, 'thb', 'ต้องบอกด้วยว่าคาดไว้เท่าไร');
  assert.ok(typeof e.receivedAt === 'string' && !Number.isNaN(Date.parse(e.receivedAt)),
    `receivedAt ต้องเป็นเวลาที่อ่านได้ แต่ได้ ${JSON.stringify(e.receivedAt)}`);
  assert.match(String(e.receivedAt), /Z$|T\d{2}:\d{2}/, 'ต้องมีเวลาจริง ไม่ใช่แค่สัญลักษณ์');
});

test('amount_mismatch → ต้องมีหลักฐานพร้อมยอดที่คาดไว้เทียบกับยอดที่ได้จริง', async () => {
  const ref = seedOrder('XFR-EV-AMT', 250);   // order คาด 250 บาท = 25000 สตางค์
  const p = completion(ref, 'cs_ev_amt', 100);  // จ่ายมาแค่ 100 สตางค์ = 1 บาท
  const r = await deliver(p, sign(p));

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.reason, 'amount_mismatch');
  assertNoMoneyWritten('amount_mismatch');

  assert.strictEqual(evidence.length, 1);
  const e = evidence[0];
  assert.strictEqual(e.reason, 'amount_mismatch');
  assert.strictEqual(e.refCode, ref);
  assert.strictEqual(e.receivedAmountSatang, 100);
  assert.strictEqual(e.expectedAmountSatang, 25000, 'ต้องมียอดที่ order คาดไว้ ไม่ใช่แค่ยอดที่มา');
});

test('order_amount_unusable → ต้องมีหลักฐานบอกว่ายอดของ order ใช้ไม่ได้ (ไม่ใช่ยอดของ Stripe ผิด)', async () => {
  const ref = seedOrder('XFR-EV-UNU', 0); // 0 บาท = ใช้ไม่ได้ (ไม่ใช่ความผิดของ Stripe)
  const p = completion(ref, 'cs_ev_unu', 25000);
  const r = await deliver(p, sign(p));

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.reason, 'order_amount_unusable');
  assertNoMoneyWritten('order_amount_unusable');

  assert.strictEqual(evidence.length, 1);
  const e = evidence[0];
  assert.strictEqual(e.reason, 'order_amount_unusable');
  assert.strictEqual(e.refCode, ref);
  assert.strictEqual(e.orderAmountRaw, 0, 'ต้องเห็นว่ายอดของ order เป็นอะไร (คนต้องไปแก้ที่ order)');
});

test('หน้าร้าน (BusinessOrder) ที่ปฏิเสธถาวร → ต้องมีหลักฐานด้วย (ไม่ใช่เฉพาะทางคำสั่งโอน)', async () => {
  const tok = seedStorefront('66666666-6666-4666-8666-666666666666', 9900);
  const p = completion(tok, 'cs_ev_shop', 100);
  const r = await deliver(p, sign(p));

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.reason, 'amount_mismatch');
  assertNoMoneyWritten('หน้าร้าน');
  assert.strictEqual(storefront.get(tok)!.status, 'ORDERED', 'ออเดอร์ต้องยังรอชำระ');

  assert.strictEqual(evidence.length, 1, 'เส้นทางหน้าร้านต้องบันทึกหลักฐานด้วย');
  assert.strictEqual(evidence[0].refCode, tok);
  assert.strictEqual(evidence[0].reason, 'amount_mismatch');
});

// ────────────────────────────────────────────────────────────────────────────
// 2) ไม่มี PII · ไม่มี payload ดิบ (กฎข้อ 2 ของเจ้าของงานนี้)
// ────────────────────────────────────────────────────────────────────────────

test('หลักฐานห้ามมีข้อมูลลูกค้า/บัตร และห้ามเป็น payload ดิบ', async () => {
  const ref = seedOrder('XFR-EV-PII', 250);
  const p = completion(ref, 'cs_ev_pii', 1);
  await deliver(p, sign(p));

  assert.strictEqual(evidence.length, 1);
  const raw = JSON.stringify(evidence[0]);
  assert.ok(!raw.includes('somchai.test@example.invalid'), 'ห้ามเก็บอีเมลลูกค้า');
  assert.ok(!raw.includes('ทดสอบ สมมติ'), 'ห้ามเก็บชื่อลูกค้า');
  assert.ok(!raw.includes('4242424242424242'), 'ห้ามเก็บเลขบัตรแม้แต่ตัวอย่าง');
  assert.ok(!raw.includes('cvc'), 'ห้ามเก็บข้อมูลบัตร');
  for (const banned of ['customer', 'payment_method', 'data', 'object', 'payload', 'raw']) {
    assert.ok(!(banned in evidence[0]), `ห้ามมีคีย์ "${banned}" ในหลักฐาน (พิสูจน์ว่าไม่ใช่ payload ดิบ)`);
  }
  // allowlist: ทุกคีย์ที่เขียนต้องเป็นคีย์ที่วางแจ๊งไว้ ไม่มีคีย์แปลกโดยไม่ตั้งใจ
  const allowed = new Set([
    'reason', 'eventId', 'eventType', 'refCode', 'receivedAmountSatang', 'receivedCurrency',
    'expectedAmountSatang', 'expectedCurrency', 'orderAmountRaw', 'receivedAt', 'livemode', 'message',
  ]);
  for (const k of Object.keys(evidence[0])) {
    assert.ok(allowed.has(k), `พบคีย์นอก allowlist: "${k}" — ห้ามเขียนอะไรที่ไม่จำเป็นต่อการตามเงิน`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 3) การบันทึกหลักฐานล้มเอง → ห้ามทำให้ webhook เปลี่ยนคำตอบ (ข้อ 4)
// ────────────────────────────────────────────────────────────────────────────

test('บันทึกหลักฐานล้ม → webhook ต้องตอบเหมือนเดิมทุก field + ยังไม่มีแถวเงิน', async () => {
  const ref = seedOrder('XFR-EV-FAIL', 250);
  const p = completion(ref, 'cs_ev_fail', 100);
  const r0 = await deliverWithTimeout(p, sign(p));

  evidenceWriteError = new Error('หลักฐานบันทึกไม่ได้ (จำลองดิสก์เต็ม)');
  const p2 = completion(ref, 'cs_ev_fail', 100);
  const seen: string[] = [];
  const realErr = console.error;
  console.error = (...a: any[]) => { seen.push(a.map(String).join(' ')); };
  let r1: { status: number; body: any };
  try {
    r1 = await deliverWithTimeout(p2, sign(p2));
  } finally {
    console.error = realErr;
  }
  evidenceWriteError = null;

  // คำตอบต้องเหมือนกันทุกประการ — ถ้าต่างแม้แต่ field เดียว แปลว่าเราให้หลักฐาน
  // มีอิทธิพลต่อสัญญาการตอบ ซึ่งคือเงินหายเงียบรูปแบบใหม่
  assert.strictEqual(r1.status, r0.status, 'สถานะต้องเหมือนเดิม');
  assert.deepStrictEqual(r1.body, r0.body, 'body ต้องเหมือนเดิมทุก field');
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r1.body.reason, 'amount_mismatch');
  assert.strictEqual(r1.body.applied, false);
  assertNoMoneyWritten('หลักฐานล้ม');
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');

  // หลักฐานล้ม = หายไปเงียบ → ต้องมีเสียงดังใน log ไม่ใช่เงียบ ๆ
  assert.ok(
    seen.some((s) => /หลักฐาน|หลักฐานบันทึกไม่ได้|evidence/i.test(s)),
    `การบันทึกหลักฐานล้มต้องถูกรายงาน ไม่ใช่กลืนทิ้ง — log ที่ได้: ${JSON.stringify(seen)}`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 4) เหตุผลที่ไม่ใช่ "เงินหายถาวร" ห้ามเขียนหลักฐาน (ไฟล์ต้องอ่านรู้เรื่อง)
// ────────────────────────────────────────────────────────────────────────────

test('order_not_found (409 ให้ Stripe retry) → ห้ามเขียนหลักฐาน เพราะยังไม่หายถาวร', async () => {
  const p = completion('77777777-7777-4777-8777-777777777777', 'cs_ev_nf', 25000);
  const r = await deliverWithTimeout(p, sign(p));
  assert.strictEqual(r.status, 409, 'ยัง retry ได้ = ยังไม่ใช่เงินหายถาวร');
  assert.strictEqual(r.body.retryable, true);
  assert.strictEqual(evidence.length, 0, 'เขียนแล้วไฟล์หลักฐานจะรกด้วยเรื่องที่ยังแก้เองได้');
});

test('unsupported_event_type (200 เฉย ๆ) → ห้ามเขียนหลักฐาน (ไม่ใช่เงินของเราที่หาย)', async () => {
  const ref = seedOrder('XFR-EV-UNSUP', 250);
  const p = JSON.stringify({
    id: 'evt_evidence_002',
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_1', client_reference_id: ref, amount_total: 25000, currency: 'thb' } },
  });
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.reason, 'unsupported_event_type');
  assert.strictEqual(evidence.length, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// 5) ตัว default ต้องเขียนไฟล์จริง — คนตามเงินเปิดอ่านด้��ด้วยตาเปล่า
//    (เทสต์ข้างบนใช้ตัวแทนซึ่งโกงได้ ข้อนี้คือของจริง)
// ────────────────────────────────────────────────────────────────────────────

test('ตัวจริง (ไม่ใส่ evidenceWriter) → ต้องเขียน JSONL ลง data/ ให้เปิดอ่านได้จริง', async () => {
  process.env.PAYMENT_EVIDENCE_DIR = evidenceDir;
  const app: Express = express();
  app.use(`${API}/webhook`, express.raw({ type: 'application/json', limit: '256kb' }));
  app.use(express.json());
  app.use(API, createPaymentsRouter({
    transport: createFakeStripeTransport(),
    prisma,
    webhookSecret: WEBHOOK_SECRET,
  } as any));
  const s = await new Promise<Server>((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  const addr = s.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  try {
    const ref = seedOrder('XFR-EV-FILE', 250);
    const p = completion(ref, 'cs_ev_file', 100);
    const res = await fetch(`${url}${API}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(p) },
      body: p,
    });
    assert.strictEqual(res.status, 200, 'ตัวจริงต้องตอบเหมือนเดิม');
    await res.json();

    const file = path.join(evidenceDir, 'payments-rejected-deliveries.jsonl');
    assert.ok(fs.existsSync(file), `ต้องมีไฟล์หลักฐานที่ ${file} — คนตามเงินต้องเปิดอ่านได้`);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1, 'หนึ่ง delivery ที่ปฏิเสธ = หนึ่งบรรทัด (append-only)');

    const parsed = JSON.parse(lines[0]);
    assert.strictEqual(parsed.reason, 'amount_mismatch');
    assert.strictEqual(parsed.refCode, ref);
    assert.strictEqual(parsed.eventId, 'evt_evidence_001');
    assert.ok(!lines[0].includes('somchai.test@example.invalid'), 'ไฟล์จริงก็ห้ามมีอีเมลลูกค้า');

    // บรรทัดที่สองต้องต่อท้าย ไม่ใช่ทับของเดิม — หลักฐานต้องสะสม ไม่ใช่แค่เหลือรายการเดียว
    const ref2 = seedOrder('XFR-EV-FILE2', 250);
    const p2 = completion(ref2, 'cs_ev_file2', 999);
    const res2 = await fetch(`${url}${API}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'stripe-signature': sign(p2) },
      body: p2,
    });
    await res2.json();
    const lines2 = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines2.length, 2, 'หลักฐานต้องสะสมทีละบรรทัด');
    assert.strictEqual(JSON.parse(lines2[1]).refCode, ref2);
  } finally {
    await new Promise<void>((r) => s.close(() => r()));
    // คืนค่าเดิม (setup-env ชี้ไปที่ tmp) ไม่ใช่ delete — เพราะ delete ทำให้
    // เทสต์อื่นในไฟล์เดียวกันไปเขียนลง data/ ของของจริง
    process.env.PAYMENT_EVIDENCE_DIR = evidenceDir;
  }
});