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
let updateManyCalls = 0;
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

beforeEach(() => { orders.clear(); updateManyCalls = 0; appliedCount = 0; });

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

// ── 1) ลายเซ็น ────────────────────────────────────────────────────────────────

test('ลายเซ็นถูกต้อง → ผ่านการตรวจ (คืนค่า verified ไม่ใช่ error)', async () => {
  const ref = seedOrder('XFR-SIG1', 250);
  const p = completion(ref, 'cs_test_0001', 25000);
  const r = await deliver(p, sign(p));
  assert.notStrictEqual(r.status, 400);
  assert.strictEqual(r.body.error, undefined);
});

test('ไม่มี header stripe-signature → ต้องปฏิเสธ', async () => {
  const ref = seedOrder('XFR-SIG2', 250);
  const r = await deliver(completion(ref, 'cs_1', 25000));
  assert.strictEqual(r.status, 400);
  assert.match(String(r.body.error), /signature/i);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING', 'order ต้องไม่ถูกแตะ');
});

test('ลายเซ็นผิดรูปแบบ → ต้องปฏิเสธ', async () => {
  const ref = seedOrder('XFR-SIG3', 250);
  const p = completion(ref, 'cs_1', 25000);
  for (const bad of ['garbage', 't=123', 'v1=abc', 't=notanumber,v1=abc']) {
    const r = await deliver(p, bad);
    assert.strictEqual(r.status, 400, `ควรปฏิเสธ: ${bad}`);
  }
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

test('ลายเซ็นที่เซ็นด้วย secret อื่น → ต้องปฏิเสธ (กันปลอมเป็น Stripe)', async () => {
  const ref = seedOrder('XFR-SIG4', 250);
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p, 'whsec_someone_elses_secret'));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

test('ลายเซ็นเก่าเกิน tolerance → ต้องปฏิเสธ (กัน replay)', async () => {
  const ref = seedOrder('XFR-SIG5', 250);
  const p = completion(ref, 'cs_1', 25000);
  const stale = Math.floor(Date.now() / 1000) - 4000;
  const r = await deliver(p, sign(p, WEBHOOK_SECRET, stale));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

test('แก้ body หลังเซ็น → ต้องปฏิเสธ (กันแก้ยอดเงิน)', async () => {
  const ref = seedOrder('XFR-SIG6', 250);
  const p = completion(ref, 'cs_1', 25000);
  const header = sign(p);
  const tampered = p.replace('25000', '100');   // ลดยอดให้ถูกลง แต่ใช้ลายเซ็นเดิม
  const r = await deliver(tampered, header);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

// ── 2) ยอดเงินต้องตรงกับ order ───────────────────────────────────────────────

test('ยอดใน session ต่ำกว่าที่ order คาดไว้ → ต้องปฏิเสธ และ order ต้องยัง PENDING', async () => {
  const ref = seedOrder('XFR-AMT1', 250);        // order คาด 250 บาท = 25000 สตางค์
  const p = completion(ref, 'cs_1', 100);          // แต่ Stripe ส่งมาแค่ 100 สตางค์ = 1 บาท
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 400);
  assert.match(String(r.body.error), /amount/i);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING', 'ห้ามจ่ายเงินให้ order ที่ยังไม่ครบ');
});

test('สกุลเงินไม่ใช่ thb → ต้องปฏิเสธ', async () => {
  const ref = seedOrder('XFR-AMT2', 250);
  const p = completion(ref, 'cs_1', 25000, 'usd');
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 400);
  assert.match(String(r.body.error), /currency/i);
  assert.strictEqual(orders.get(ref)!.status, 'PENDING');
});

test('ยอดตรงกัน → order ต้องถูกยืนยัน', async () => {
  const ref = seedOrder('XFR-AMT3', 250);
  const p = completion(ref, 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(orders.get(ref)!.status, 'VERIFIED');
});

test('ไม่พบ order จาก client_reference_id → ต้องปฏิเสธ ไม่ใช่สร้าง order ใหม่', async () => {
  const p = completion('XFR-NOPE', 'cs_1', 25000);
  const r = await deliver(p, sign(p));
  assert.strictEqual(r.status, 404);
  assert.strictEqual(orders.size, 0);
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
