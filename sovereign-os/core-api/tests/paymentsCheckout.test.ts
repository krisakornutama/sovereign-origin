// ────────────────────────────────────────────────────────────────────────────
// POST /api/payments/checkout-session — ทดสอบผ่าน HTTP จริง (ไม่เรียกฟังก์ชันตรง)
//
// ข้อตกลงของ pass นี้: transport เป็นของปลอมเสมอ (createFakeStripeTransport)
// ไม่มี request ใดออกไป Stripe และโค้ดฝั่งแอปไม่มีทางเลือก live
// ────────────────────────────────────────────────────────────────────────────
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import type { Express } from 'express';
import { createTestServer, makeToken, type TestServer } from './helpers';
import { createPaymentsRouter } from '../src/modules/payments/payments.routes';
import { createFakeStripeTransport } from '../src/services/stripe-checkout';
import { makeRefCode } from '../src/services/transfer.service';

const API = '/api/payments';
const AUTH = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('SUPERADMIN')}` });

let server: TestServer;
let transport: ReturnType<typeof createFakeStripeTransport>;

const VALID = {
  amountBaht: 250,
  productName: 'Sovereign Origin — สมาชิกปี',
  refCode: 'XFR-TEST0001',
  successUrl: 'https://sovereign.example.com/checkout/success',
};

before(async () => {
  transport = createFakeStripeTransport();
  server = await createTestServer((app: Express) => {
    app.use(API, createPaymentsRouter({ transport }));
  });
});

after(async () => {
  await server.close();
});

async function post(body: unknown, auth = true) {
  return fetch(server.baseUrl + `${API}/checkout-session`, {
    method: 'POST',
    headers: auth ? AUTH() : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── เส้นทางหลัก: ต้องได้ session id + URL สำหรับพาลูกค้าไปจ่าย ──────────────

test('POST checkout-session คืน sessionId + url ให้ลูกค้าไปจ่ายต่อได้', async () => {
  const before = transport.calls.length;
  const res = await post(VALID);
  const body = await res.json();

  assert.strictEqual(res.status, 201);
  assert.strictEqual(body.success, true);
  assert.ok(String(body.sessionId).startsWith('cs_'), 'ต้องมี session id รูปแบบ cs_…');
  assert.ok(String(body.url).startsWith('https://'), 'ต้องมี URL สำหรับ redirect');
  assert.strictEqual(body.refCode, VALID.refCode, 'ต้อง echo refCode กลับมาให้ลูกค้าเก็บ');
  assert.strictEqual(body.mode, 'mock', 'ต้องบอกชัดว่าเป็นโหมดจำลอง');

  assert.strictEqual(transport.calls.length, before + 1, 'ต้องสร้าง session 1 ครั้งเท่านั้น');
});

test('ยอดต้องไปถึง transport เป็นสตางค์จำนวนเต็ม (250 บาท = 25000 สตางค์ ไม่ใช่ 250)', async () => {
  const before = transport.calls.length;
  await post(VALID);

  const call = transport.calls[transport.calls.length - 1];
  assert.strictEqual(transport.calls.length, before + 1);
  assert.strictEqual(call.line_items.length, 1);
  assert.strictEqual(call.line_items[0].price_data.unit_amount, 25000);
  assert.ok(Number.isInteger(call.line_items[0].price_data.unit_amount), 'ต้องเป็น integer');
  assert.notStrictEqual(call.line_items[0].price_data.unit_amount, 250, 'กันสลับบาท/สตางค์');
  assert.strictEqual(call.line_items[0].price_data.currency, 'thb');
  assert.strictEqual(call.mode, 'payment');
});

// ── ref_code คือ join key ของ webhook ในอนาคต ──────────────────────────────

test('refCode ของ order ต้องถูกส่งต่อเป็น client_reference_id ของ session', async () => {
  await post(VALID);
  const call = transport.calls[transport.calls.length - 1];
  assert.strictEqual(call.client_reference_id, 'XFR-TEST0001');
});

test('ref_code จากตัวสร้างจริงของระบบ ต้องใช้เป็น client_reference_id ได้จริง', async () => {
  const refCode = makeRefCode();
  const res = await post({ ...VALID, refCode });
  const body = await res.json();

  assert.strictEqual(res.status, 201);
  assert.strictEqual(body.refCode, refCode);
  const call = transport.calls[transport.calls.length - 1];
  assert.strictEqual(call.client_reference_id, refCode);
});

test('ref_code ที่ระบบสร้าง ต้องอยู่ในกรอบ 200 ตัวอักษรของ Stripe เสมอ', () => {
  // ข้อสรุปว่า ref_code ใช้เป็น join key ได้ ต้องมีหลักฐานรองรับ ไม่ใช่แค่คาดเดา
  for (let i = 0; i < 200; i += 1) {
    const ref = makeRefCode();
    assert.ok(ref.length <= 200, `ยาวเกิน 200: ${ref.length}`);
    assert.match(ref, /^XFR-[0-9A-Z]+$/, 'ต้องเป็น ASCII ที่ไม่ต้อง escape');
  }
});

// ── เส้นทางปฏิเสธ ต้องพิสูจน์ที่ขอบ HTTP ไม่ใช่แค่ใน unit ────────────────

test('ไม่มี successUrl ต้อง 400 และต้องไม่สร้าง session', async () => {
  const before = transport.calls.length;
  const { successUrl, ...noUrl } = VALID;
  const res = await post(noUrl);
  const body = await res.json();

  assert.strictEqual(res.status, 400);
  assert.match(String(body.error), /successUrl/);
  assert.strictEqual(transport.calls.length, before, 'ต้องไม่สร้าง session ตอน validation ไม่ผ่าน');
});

test('refCode ยาวเกิน 200 ตัวอักษรต้อง 400 และต้องไม่สร้าง session', async () => {
  const before = transport.calls.length;
  const res = await post({ ...VALID, refCode: 'X'.repeat(201) });
  const body = await res.json();

  assert.strictEqual(res.status, 400);
  assert.match(String(body.error), /client_reference_id|200/);
  assert.strictEqual(transport.calls.length, before);
});

test('ยอด 0 บาทต้อง 400 และต้องไม่สร้าง session', async () => {
  const before = transport.calls.length;
  const res = await post({ ...VALID, amountBaht: 0 });
  const body = await res.json();

  assert.strictEqual(res.status, 400);
  assert.match(String(body.error), /greater than 0/);
  assert.strictEqual(transport.calls.length, before);
});

test('ยอดติดลบต้อง 400', async () => {
  const res = await post({ ...VALID, amountBaht: -5 });
  assert.strictEqual(res.status, 400);
});

test('ไม่มี refCode ต้อง 400 (webhook จะไม่มีอะไรมาจับคู่)', async () => {
  const before = transport.calls.length;
  const { refCode, ...noRef } = VALID;
  const res = await post(noRef);
  const body = await res.json();

  assert.strictEqual(res.status, 400);
  assert.match(String(body.error), /refCode/);
  assert.strictEqual(transport.calls.length, before);
});

// ── auth ตามระเบียบเดียวกับโมดูลอื่น ────────────────────────────────────────

test('ไม่มี token ต้องถูกปฏิเสธ (401) และต้องไม่สร้าง session', async () => {
  const before = transport.calls.length;
  const res = await post(VALID, false);
  assert.strictEqual(res.status, 401);
  assert.strictEqual(transport.calls.length, before);
});
