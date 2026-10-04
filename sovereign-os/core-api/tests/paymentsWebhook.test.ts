// ────────────────────────────────────────────────────────────────────────────
// POST /api/payments/webhook — ยืนยันว่า Checkout Session "จ่ายแล้ว" จริง
//
// สามข้อที่ต้องถูก และแต่ละข้อมีเทสต์:
//   1) ตรวจลายเซ็น Stripe (ไม่เชื่อ body) — ขาด/ผิดรูป/ผิด secret/เก่าเกิน = ไม่รับ
//   2) เชื่อจำนวนเงินของ order ไม่ใช่ของ session — ถ้าไม่ตรง = ไม่จ่าย และไม่เงียบ
//   3) กันส่งซ้ำด้วย conditional update แบบ claimPending ของ transfer.service
//
// หมายเหตุเรื่อง raw body: server.ts ตั้ง express.json() ทั้งแอป ทำให้ byte
// ต้นฉบับหายไป ลายเซ็นจึงต้องคำนวณจาก byte จริง → เทสต์นี้ mount raw parser
// ตัวเดียวกับที่ production ใช้ (ดู comments ใน payments.routes.ts)
// ────────────────────────────────────────────────────────────────────────────
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { createPaymentsRouter } from '../src/modules/payments/payments.routes';
import { createFakeStripeTransport } from '../src/services/stripe-checkout';
import { makeToken } from './helpers';

const API = '/api/payments';
const WEBHOOK_SECRET = 'whsec_test_injected_value_do_not_use_in_prod';
const AUTH = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('SUPERADMIN')}` });

// ── prisma ปลอม: เก็บ order ใน memory ตามรูปแบบเทสต์อื่นของระบบ ─────────────
interface Row { ref_code: string; status: string; amount_thb: number | null; amount_usd: number; txid?: string | null; verified_by?: string | null; verified_at?: Date | null }
const orders = new Map<string, Row>();
// ── ออเดอร์หน้าร้าน (BusinessOrder) — จับคู่ด้วย publicToken (UUID @unique ทั้งระบบ)
//    ไม่ใช้ orderNo เพราะ orderNo ไม่ unique ข้ามร้าน (B20261004-0001 ซ้ำได้ทุกร้าน)
interface StoreRow { id: string; publicToken: string; status: string; total: number; paidAmount: number }
const storefront = new Map<string, StoreRow>();
let storefrontApplied = 0;
let updateManyCalls = 0;
// แถวที่ถูกเขียนลง business_payments — ใช้พิสูจน์ว่า "จ่ายครั้งเดียว = แถวเดียว"
const payments: any[] = [];
// นับเฉพาะครั้งที่ "เขียนจริง" (count===1) — ไม่ใช่จำนวนครั้งที่เรียก
// เพราะการเรียก updateMany ซ้ำเป็นเรื่องปกติของ conditional update (แบบ claimPending)
// สิ่งที่ต้องพิสูจน์คือ "ใช้ได้ผลจริงครั้งเดียว" ไม่ใช่ "เรียกครั้งเดียว"
let appliedCount = 0;

const prisma: any = {
  transferOrder: {
    findFirst: async ({ where }: any) => orders.get(where?.ref_code) ?? null,
    updateMany: async ({ where, data }: any) => {
      updateManyCalls += 1;
      const row = orders.get(where?.ref_code);
      // conditional update: เขียนได้ก็ต่อเมื่อยัง PENDING (แบบ claimPending)
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
      // conditional update: เขียนได้ก็ต่อเมื่อยังรอชำระ (QUOTE/ORDERED) — กันส่งซ้ำเหมือน claimPending
      // รองรับทั้งรูปแบบ Prisma จริง ({ in: [...] }) และแบบเท่าตรง ๆ (สตริง/อาร์เรย์)
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
  // prisma จริงมี $transaction — จำลองเป็นเรียกตรง ๆ (จุดเดียวที่ต้อง atomic คือ CAS + บันทึกเงิน)
  $transaction: async (fn: any) => fn(prisma),
};

let server: Server;
let baseUrl: string;
let transport: ReturnType<typeof createFakeStripeTransport>;

before(async () => {
  transport = createFakeStripeTransport();
  const app: Express = express();
  // raw parser ตัวเดียวกับ production: ต้องได้ byte ต้นฉบับเพื่อคำนวณลายเซ็น
  app.use(`${API}/webhook`, express.raw({ type: 'application/json', limit: '256kb' }));
  app.use(express.json());
  app.use(API, createPaymentsRouter({ transport, prisma, webhookSecret: WEBHOOK_SECRET }));
  server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
after(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => { orders.clear(); storefront.clear(); payments.length = 0; updateManyCalls = 0; appliedCount = 0; storefrontApplied = 0; });

// ── ช่วยสร้างลายเซ็นแบบ Stripe ──────────────────────────────────────────────
function sign(payload: string, secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

function completion(refCode: string, sessionId: string, amountTotal: number, currency = 'thb') {
  return JSON.stringify({
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    data: { object: { id: sessionId, client_reference_id: refCode, amount_total: amountTotal, currency } },
  });
}

async function deliver(payload: string, header?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (header !== undefined) headers['stripe-signature'] = header;
  const res = await fetch(`${baseUrl}${API}/webhook`, { method: 'POST', headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

function seedOrder(refCode: string, amountThb: number, status = 'PENDING') {
  orders.set(refCode, { ref_code: refCode, status, amount_thb: amountThb, amount_usd: amountThb / 35 });
  return refCode;
}

function seedStorefront(publicToken: string, total: number, status = 'ORDERED') {
  storefront.set(publicToken, { id: `bo_${publicToken}`, publicToken, status, total, paidAmount: 0 });
  return publicToken;
}

// ── 1) ลายเซ็น ────────────────────────────────────────────────────────────────

test('ลายเซ็นถูกต้อง → ผ่านการตรวจ (คืนค่า verified ไม่ใช่ error)', async () => {
  const ref = seedOrder('XFR-SIG1', 250);
  const p = completion(ref, 'cs_test_0001', 25000);
  const r = await deliver(p, sign(p));
  assert.notStrictEqual(r.status, 400);
  assert.strictEqual(r.body.error, undefined);
});

test('ไม่มี header stripe-signature → ต้องปฏิเสธ (rejected = non-2xx)', async () => {
  const ref = seedOrder('XFR-SIG2', 250);
  const r = await deliver(completion(ref, 'cs_1', 25000));
  assert.ok(r.status >= 400, 'ลายเซ็นไม่ผ่าน = ต้อง non-2xx ให้ Stripe ส่งต่อ');
  assert.strictEqual(r.body.rejected, true);
  assert.match(String(r.body.error), /signature/i);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING', 'order ต้องไม่ถูกแตะ');
});

test('ลายเซ็นผิดรูปแบบ → ต้องปฏิเสธ', async () => {
  const ref = seedOrder('XFR-SIG3', 250);
  const p = completion(ref, 'cs_1', 25000);
  for (const bad of ['garbage', 't=123', 'v1=abc', 't=notanumber,v1=abc']) {
    const r = await deliver(p, bad);
    assert.ok(r.status >= 400, `ควรปฏิเสธ: ${bad}`);
  }
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

test('ลายเซ็นที่เซ็นด้วย secret อื่น → ต้องปฏิเสธ (กันปลอมเป็น Stripe)', async () => {
  const ref = seedOrder('XFR-SIG4', 250);
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p, 'whsec_someone_elses_secret'));
  assert.ok(r.status >= 400);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

test('ลายเซ็นเก่าเกิน tolerance → ต้องปฏิเสธ (กัน replay)', async () => {
  const ref = seedOrder('XFR-SIG5', 250);
  const p = completion(ref, 'cs_1', 25000);
  const stale = Math.floor(Date.now() / 1000) - 4000;
  const r = await deliver(p, sign(p, WEBHOOK_SECRET, stale));
  assert.ok(r.status >= 400);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

test('แก้ body หลังเซ็น → ต้องปฏิเสธ (กันแก้ยอดเงิน)', async () => {
  const ref = seedOrder('XFR-SIG6', 250);
  const p = completion(ref, 'cs_1', 25000);
  const header = sign(p);
  const tampered = p.replace('25000', '100');   // ลดยอดให้ถูกลง แต่ใช้ลายเซ็นเดิม
  const r = await deliver(tampered, header);
  assert.ok(r.status >= 400);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

// ── 2) ยอดเงินต้องตรงกับ order ───────────────────────────────────────────────

test('ยอดใน session ต่ำกว่าที่ order คาดไว้ → ต้อง "ไม่จ่ายเงิน" แต่ตอบ 2xx (ห้ามให้ Stripe retry)', async () => {
  const ref = seedOrder('XFR-AMT1', 250);        // order คาด 250 บาท = 25000 สตางค์
  const p = completion(ref, 'cs_1', 100);          // แต่ Stripe ส่งมาแค่ 100 สตางค์ = 1 บาท
  const r = await deliver(p, sign(p));
  // 2xx เพราะ "ไม่มีวันกลายเป็นจริง" — ยอดที่ไม่ตรงจะไม่ตรงในการส่งครั้งถัดไปเช่นกัน
  assert.strictEqual(r.status, 200, '4xx ทำให้ Stripe retry 3 วัน แล้วปิด endpoint ทิ้ง');
  assertNotApplied(r.body, 'amount_mismatch', 'ยอดไม่ตรง');
  assert.strictEqual(orders.get(ref)!.status, 'PENDING', 'ห้ามจ่ายเงินให้ order ที่ยังไม่ครบ');
});

test('สกุลเงินไม่ใช่ thb → ต้อง "ไม่จ่ายเงิน" แต่ตอบ 2xx', async () => {
  const ref = seedOrder('XFR-AMT2', 250);
  const p = completion(ref, 'cs_1', 25000, 'usd');
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assertNotApplied(r.body, 'currency_mismatch', 'สกุลเงินผิด');
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

test('ยอดตรงกัน → order ต้องถูกยืนยัน', async () => {
  const ref = seedOrder('XFR-AMT3', 250);
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(orders.get(ref)!.status, 'VERIFIED');
});

test('ไม่พบ order จาก client_reference_id → 2xx + applied:false ไม่ใช่สร้าง order ใหม่', async () => {
  const p = completion('XFR-NOPE', 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200, 'order ต้องมีอยู่ก่อนชำระเงินเสมอ → ไม่มีทางสำเร็จในการส่งครั้งหลัง');
  assertNotApplied(r.body, 'order_not_found', 'ไม่มี order');
  assert.strictEqual(orders.size, 0, 'ห้ามสร้าง order ใหม่');
});

// ── 3) กันส่งซ้ำ ─────────────────────────────────────────────────────────────

test('ส่ง completion เดิมสองครั้ง → ครั้งที่สองต้องไม่ทำอะไร (idempotent)', async () => {
  const ref = seedOrder('XFR-IDEM1', 250);
  const p = completion(ref, 'cs_1', 25000);
  const first = await deliver(p, sign(p));
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.alreadyApplied, false);
  assert.strictEqual(appliedCount, 1);
  const rowAfterFirst = { ...orders.get(ref)! };

  const second = await deliver(p, sign(p));
  assert.strictEqual(second.status, 200, 'Stripe ต้องได้ 2xx ไม่งั้นจะ retry ไม่จบ');
  assert.strictEqual(second.body.alreadyApplied, true, 'ครั้งที่สองต้องบอกว่าไม่ได้ทำงาน');
  // พิสูจน์ว่า "ไม่ซ้ำ" = ใช้ผลจริงครั้งเดียว ไม่ใช่แค่ไม่เรียกซ้ำ
  // (conditional update จะถูกเรียกซ้ำเสมอ แต่ต้องไม่ "เขียนได้" ซ้ำ)
  assert.strictEqual(appliedCount, 1, 'ต้องเขียน order สำเร็จแค่ครั้งเดียว');
  assert.deepStrictEqual({ ...orders.get(ref)! }, rowAfterFirst, 'สถานะ order ต้องไม่เปลี่ยนเลย');
});

test('order ที่ VERIFIED อยู่แล้ว → การส่งซ้ำต้องไม่ยืนยันซ้ำ', async () => {
  const ref = seedOrder('XFR-IDEM2', 250, 'VERIFIED');
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.alreadyApplied, true);
  assert.strictEqual(orders.get(ref)!.status, 'VERIFIED');
});

test('order ที่ยกเลิกแล้ว → ต้องไม่ถูกยืนยันย้อนหลัง', async () => {
  const ref = seedOrder('XFR-IDEM3', 250, 'CANCELLED');
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.alreadyApplied, true);
  assert.strictEqual(orders.get(ref)!.status, 'CANCELLED', 'CANCELLED ต้องไม่กลับไปเป็น VERIFIED');
});

// ── 4) ทั้งเส้นจากต้นจนจบ: สร้าง session แล้วส่ง completion ของ session นั้น ────

test('E2E: สร้าง session ผ่าน endpoint แล้วส่ง completion ของ session เดียวกัน → order VERIFIED', async () => {
  const ref = seedOrder('XFR-E2E1', 250);
  const created = await fetch(`${baseUrl}${API}/checkout-session`, {
    method: 'POST', headers: AUTH(),
    body: JSON.stringify({ amountBaht: 250, productName: 'Sovereign Origin — สมาชิกปี', refCode: ref, successUrl: 'https://sovereign.example.com/checkout/success' }),
  });
  const session = await created.json() as any;
  assert.strictEqual(created.status, 201);
  assert.strictEqual(session.refCode, ref);

  // Stripe ส่ง completion กลับมาด้วย sessionId ที่เราเพิ่งได้ + client_reference_id เดิม
  const payload = completion(ref, session.sessionId, 25000);
  const r = await deliver(payload, sign(payload));

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.sessionId, session.sessionId);
  assert.strictEqual(orders.get(ref)!.status, 'VERIFIED');
  assert.strictEqual(orders.get(ref)!.txid, session.sessionId, 'ต้องเก็บ cs_… ไว้ใน txid');
});

// ────────────────────────────────────────────────────────────────────────────
// 5) สัญญาการตอบกลับของ webhook: applied / not-applied / rejected
//
// หัวใจอยู่ที่คำถามข้อเดียว: "ถ้าส่งซ้ำอีกครั้ง คำตอบจะเปลี่ยนไหม?"
//   · เปลี่ยนไม่ได้ (ยอดไม่ตรง/สกุลเงินผิด/ไม่มี order) → ตอบ 2xx เพื่อหยุด retry
//     แต่ body ต้องบอกว่า "ไม่ได้จ่าย" แบบอ่านไม่ผิด และต้อง log เสียงดัง
//   · เปลี่ยนได้ (ลายเซ็นผิด/secret ไม่ได้ตั้ง) → ตอบ non-2xx ให้ Stripe ส่งต่อ
//     เพราะการตอบ 2xx ตอนนี้ = บอก Stripe ว่า "ไม่ต้องส่งอีก" = เงินที่จ่ายจริงหายเงียบ
// ────────────────────────────────────────────────────────────────────────────

/** ตอบกลับทุกแบบที่ "ไม่ได้จ่าย" ต้องมีรูปร่างนี้เหมือนกันหมด */
function assertNotApplied(body: any, reason: string, label: string) {
  assert.strictEqual(body.applied, false, `${label}: ต้องบอกว่าไม่ได้จ่าย`);
  assert.strictEqual(body.reason, reason, `${label}: ต้องระบุเหตุผลแบบ machine-readable`);
  assert.strictEqual(body.success, false, `${label}: ห้ามเขียนว่าสำเร็จ`);
  // กันเผลอให้ค่าที่คนอ่านอาจเข้าใจว่าจ่ายสำเร็จ
  assert.notStrictEqual(body.status, 'VERIFIED', `${label}: ห้ามตอบว่า VERIFIED`);
}

test('ไม่มี client_reference_id → 2xx + applied:false (ไม่ใช่ 4xx)', async () => {
  const p = completion('   ', 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assertNotApplied(r.body, 'missing_client_reference_id', 'ไม่มี client_reference_id');
});

test('order ถูกยกเลิก → 2xx + applied:false (ห้ามยืนยันย้อนหลัง)', async () => {
  const ref = seedOrder('XFR-CON1', 250, 'CANCELLED');
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.applied, false, 'รอบนี้ไม่ได้จ่าย');
  assert.strictEqual(orders.get(ref)!.status, 'CANCELLED');
});

test('event type ที่ไม่ใช่ของเรา → 2xx + applied:false + ignored (เดิมเป็นแบบนี้แล้ว)', async () => {
  const p = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: {} } });
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.applied, false);
  assert.strictEqual(r.body.reason, 'unsupported_event_type');
});

test('ส่งซ้ำทั้งที่ order VERIFIED แล้ว → ยืนยันว่าจ่ายแล้ว แต่รอบนี้ไม่ได้เขียนซ้ำ', async () => {
  const ref = seedOrder('XFR-CON2', 250, 'VERIFIED');
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.applied, false, 'รอบนี้ไม่ได้เขียน');
  assert.strictEqual(r.body.alreadyApplied, true);
  // กรณีนี้ "จ่ายจริงแล้ว" จึงไม่ใช่เรื่องผิด — ต่างจาก order ที่ไม่มีเลย
  assert.strictEqual(orders.get(ref)!.status, 'VERIFIED');
});

test('ขอบเขตที่สำคัญที่สุด: ลายเซ็นผิด → ต้อง non-2xx (ห้ามตอบ 2xx)', async () => {
  // เหตุผลที่ต่างจากข้างบน: ผิด secret อาจเป็นเรื่องชั่วคราว (หมุน secret /
  // deploy ที่ค่าไม่ครบ) ถ้าตอบ 2xx เราจะสั่ง Stripe ว่าเลิกส่ง แล้วเงินที่จ่ายจริง
  // จะหายไปเงียบ ๆ โดยไม่มีอะไรมาช่วยกู้ — นี่แย่กว่า retry ดัง ๆ มาก
  const ref = seedOrder('XFR-SIG2', 250);
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p, 'whsec_wrong_secret'));
  assert.ok(r.status >= 400, `ลายเซ็นผิดต้องไม่ใช่ 2xx (ได้ ${r.status})`);
  assert.strictEqual(r.body.rejected, true);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING', 'ห้ามแตะ order');
});

test('ไม่มี stripe-signature เลย → non-2xx + rejected', async () => {
  const ref = seedOrder('XFR-SIG3', 250);
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p);
  assert.ok(r.status >= 400);
  assert.strictEqual(r.body.rejected, true);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

test('body ไม่ใช่ JSON (แต่ลายเซ็นผ่าน) → non-2xx + rejected', async () => {
  const r = await deliver('{not json', sign('{not json'));
  assert.ok(r.status >= 400);
  assert.strictEqual(r.body.rejected, true);
});

test('ยอดไม่ตรงต้อง log เสียงดัง ไม่ใช่หายไปเงียบ ๆ ใน 200', async () => {
  const ref = seedOrder('XFR-LOG1', 250);
  const p = completion(ref, 'cs_1', 1);
  const seen: string[] = [];
  const real = console.error;
  console.error = (...a: any[]) => { seen.push(a.map(String).join(' ')); };
  try { await deliver(p, sign(p)); } finally { console.error = real; }
  assert.ok(seen.length > 0, 'ไม่ match ก็ต้องมีอะไรบางอย่างบอกว่าเกิด mismatch');
  assert.match(seen.join('\n'), /ref/i, 'log ต้องมี ref_code เพื่อไปหา order มาแก้');
  assert.match(seen.join('\n'), /25000/, 'log ต้องมีตัวเลขยอดที่คาดไว้กับที่ได้จริง');
});

test('ไม่มี order → ต้อง log เสียงดังด้วย (ไม่ใช่แค่เงียบตอบ 200)', async () => {
  const seen: string[] = [];
  const real = console.error;
  console.error = (...a: any[]) => { seen.push(a.map(String).join(' ')); };
  const p = completion('XFR-GHOST', 'cs_1', 25000);
  try { await deliver(p, sign(p)); } finally { console.error = real; }
  assert.ok(seen.some((s) => /XFR-GHOST/.test(s)), 'ref ที่ไม่มี order ต้องถูก log');
});

test('เส้นปกติต้องไม่เปลี่ยน: 200 + applied:true + order VERIFIED', async () => {
  const ref = seedOrder('XFR-OK1', 250);
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.applied, true);
  assert.strictEqual(r.body.success, true);
  assert.strictEqual(r.body.status, 'VERIFIED');
  assert.strictEqual(r.body.sessionId, 'cs_1');
  assert.strictEqual(r.body.refCode, ref);
  assert.strictEqual(orders.get(ref)!.status, 'VERIFIED');
});

// ────────────────────────────────────────────────────────────────────────────
// 4) ออเดอร์หน้าร้าน (BusinessOrder) — checkout ส่ง publicToken มาแทน ref_code
//
// เหตุผลที่ต้องมี: ซอฟต์แวร์/แพ็กเกจที่ขายหน้าร้านเป็น BusinessOrder ไม่ใช่ TransferOrder
// และ orderNo ไม่ unique ข้ามร้าน → ต้องใช้ publicToken (UUID @unique) เป็นตัวจับคู่
// ────────────────────────────────────────────────────────────────────────────

test('หน้าร้าน: publicToken + ยอดตรง → applied:true และ order เป็น PAID', async () => {
  const tok = seedStorefront('tok-abc-123', 9900, 'ORDERED');
  const p = completion(tok, 'cs_shop_1', 990000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.applied, true);
  assert.strictEqual(r.body.status, 'PAID');
  assert.strictEqual(storefront.get(tok)!.status, 'PAID');
  assert.strictEqual(storefrontApplied, 1);
});

test('หน้าร้าน: ยอดไม่ตรง → ไม่ apply และ order ยังรอชำระ (เงินหายเงียบ = ห้าม)', async () => {
  const tok = seedStorefront('tok-mismatch', 9900, 'ORDERED');
  const p = completion(tok, 'cs_shop_2', 100); // จ่าย 1 บาท แต่ order 9,900
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.applied, false);
  assert.strictEqual(r.body.reason, 'amount_mismatch');
  assert.strictEqual(storefront.get(tok)!.status, 'ORDERED', 'order ต้องไม่ถูกแตะ');
  assert.strictEqual(storefrontApplied, 0);
});

test('หน้าร้าน: ส่งซ้ำหลังจ่ายแล้ว → applied:false alreadyApply ไม่เขียนซ้ำ', async () => {
  const tok = seedStorefront('tok-dup', 500, 'PAID');
  const p = completion(tok, 'cs_shop_3', 50000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.applied, false);
  assert.strictEqual(r.body.alreadyApplied, true);
  assert.strictEqual(storefrontApplied, 0);
});

test('หน้าร้าน: checkout-session รับ publicToken เป็น refCode ได้ (ไม่ต้องแตะสัญญา)', async () => {
  const res = await fetch(`${baseUrl}${API}/checkout-session`, {
    method: 'POST',
    headers: AUTH(),
    body: JSON.stringify({
      amountBaht: 250, productName: 'แพ็กเกจทดลอง', refCode: 'tok-abc-123',
      successUrl: 'https://example.test/ok',
    }),
  });
  const body = await res.json() as any;
  assert.strictEqual(res.status, 201);
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.refCode, 'tok-abc-123', 'refCode ต้องส่งต่อได้ ไม่ถูกแปลง');
});

// ────────────────────────────────────────────────────────────────────────────
// 5) เงินที่จ่ายจริงต้องมีแถวใน business_payments
//
// เหตุผลที่ไม่ใช่ "ของสวยงาม": getPublicOrderByToken คิดยอดที่ชำระแล้ว
// จาก "ผลรวมของแถวใน business_payments" ไม่ใช่จาก order.paidAmount
// → ถ้าไม่เขียนแถว ลูกค้าที่จ่ายบัตรแล้วจะยังเห็น "ค้างชำระ" เต็มจำนวน
//   พร้อม QR PromptPay ซ้ำ = เงินเข้าแล้วแต่หน้าจอบอกว่ายังไม่จ่าย
//
// method ต้องไม่ใช่ PROMPTPAY: buildMorningDigest กรองทีเดียว
// (method:'PROMPTPAY') เพื่อสรุป "แจ้งชำระรอยืนยัน" — บัตรไม่ใช่โอน QR
// ถ้าใส่ PROMPTPAY ยอดนี้จะไปปนกับยอดโอนจริงในสรุปเช้า
// ────────────────────────────────────────────────────────────────────────────

test('หน้าร้าน: จ่ายสำเร็จ → ต้องมีแถวเงิน 1 แถว ยอดเท่า order.total', async () => {
  const tok = seedStorefront('tok-pay-1', 9900, 'ORDERED');
  const p = completion(tok, 'cs_pay_1', 990000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.applied, true);
  assert.strictEqual(payments.length, 1, 'ต้องมีแถวเงินพอดี 1 แถว');
  assert.strictEqual(payments[0].amount, 9900, 'ยอดต้องเป็นเต็มจำนวน ไม่ใช่สตางค์');
  assert.strictEqual(payments[0].method, 'CARD', 'ต้องแยกจาก PROMPTPAY ไม่งั้นสรุปเช้าจะปน');
  assert.strictEqual(payments[0].reference, 'cs_pay_1', 'เก็บเลขอ้างอิงฝั่ง Stripe ไว้ตามรอยย้อนได้');
});

test('หน้าร้าน: Stripe ส่งซ้ำ → ต้องไม่เพิ่มแถวเงินซ้ำ (เงินเข้าครั้งเดียว)', async () => {
  const tok = seedStorefront('tok-pay-2', 2500, 'ORDERED');
  const p = completion(tok, 'cs_pay_2', 250000);
  await deliver(p, sign(p));
  const again = await deliver(p, sign(p));
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.alreadyApplied, true);
  // ค่านี้คือ "สัญญา" ที่ client อ่าน — ถ้าหลุด/กลายเป็น undefined จะไม่มีใครเห็นตอนรัน
  assert.strictEqual(again.body.reason, 'order_not_pending');
  assert.strictEqual(payments.length, 1, 'ส่งซ้ำแล้วต้องยังมีแถวเดียว ไม่ใช่สองแถว');
});

test('หน้าร้าน: โอนผ่านคำสั่งโอน (TransferOrder) → ต้องไม่แตะ business_payments', async () => {
  const ref = seedOrder('XFR-NOPAY', 250);
  const p = completion(ref, 'cs_no_pay', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.body.applied, true);
  assert.strictEqual(payments.length, 0, 'เส้นทางเดิมต้องไม่มีผลข้างเคียง');
});

// ────────────────────────────────────────────────────────────────────────────
// 6) TransferOrder.verified_by เป็นคอลัมน์ @db.Uuid — ค่าที่เขียนต้องเป็น uuid หรือ null
//
// เทสต์ด้วย mock จับเรื่องนี้ไม่ได้เลย (โค้ดเดิมเขียนค่า 'stripe-webhook' ผ่านทุกเทสต์)
// แต่ของจริงคือ schema.prisma:375 = `verified_by String? @db.Uuid` การเขียนค่าที่ไม่ใช่
// uuid ทำให้ Prisma โยน P2023 → express 4 ไม่ส่ง error ออกจาก async handler → request ค้าง
// → Stripe retry ไม่จบ → คำสั่งโอนไม่เคยเป็น VERIFIED และเงินที่จ่ายจริงไม่เข้า ledger
//
// เทสต์นี้จึงผูก "ค่าที่เขียน" เข้ากับข้อจำกัดของ schema โดยตรง
// ────────────────────────────────────────────────────────────────────────────

test('TransferOrder: verified_by ต้องเป็น uuid หรือ null (คอลัมน์เป็น @db.Uuid)', async () => {
  const ref = seedOrder('XFR-UUID', 250);
  const p = completion(ref, 'cs_uuid', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200, 'webhook ต้องตอบ 2xx ไม่ใช่ค้าง');
  const v = orders.get(ref)?.verified_by ?? null;
  assert.ok(
    v === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v)),
    `verified_by ต้องเป็น uuid หรือ null แต่ได้ ${JSON.stringify(v)} — คอลัมน์เป็น @db.Uuid (schema.prisma:375)`,
  );
});
