// ────────────────────────────────────────────────────────────────────────────
// งานนี้มีไว้จับช่องว่างที่ทำเงินหาย **โดยไม่มีใครสังเกต**
//   (Stripe จ่ายแล้ว · ฝั่งเรายังโชว์ "ค้างชำระ" — เคยเกิดจริงเมื่อ webhook หลุด)
// เทสต์นี้จึงต้องพิสูจน์ว่าเครื่องมือ "เจอ" ช่องว่างจริง ไม่ใช่แค่รันไม่ error
//
// ข้อที่ต้องระวังมากที่สุด: งานชนิดนี้พังแบบเงียบได้ง่ายที่สุดในโลก
//   · คืน "ไม่พบช่องว่าง" ทั้งที่จับไม่ได้จริง = ข้อความลวงที่อันตรายกว่าไม่มีเครื่องมือ
//   · ปิดอยู่เงียบ ๆ = กลับไปอยู่ในสถานะเดิมที่เงินหายโดยไม่มีใครรู้
// ทุกเทสต์ด้านล่างจึงมีอย่างน้อยหนึ่งข้อที่พิสูจน์ว่า "ถ้ามันพลาด มันจะเห็น"
//
// ⚠️ ใช้ค่าปลอมเท่านั้น — ห้ามใส่ค่า secret จริงในไทสต์นี้
// ────────────────────────────────────────────────────────────────────────────
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRealPaidSession,
  reconcilePaidSessions,
  formatReconciliationReport,
  type StripeCompletedSession,
  type LocalPaidRecord,
} from '../src/services/stripe-reconcile.service';
import { runStripeReconcile, runAndReportStripeReconcile } from '../src/services/stripe-reconcile.runtime';

const session = (over: Partial<StripeCompletedSession> = {}): StripeCompletedSession => ({
  id: 'cs_test_1',
  clientReferenceId: '11111111-1111-4111-8111-111111111111',
  amountTotal: 12500,
  currency: 'thb',
  paymentStatus: 'paid',
  livemode: true,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

const local = (over: Partial<LocalPaidRecord> = {}): LocalPaidRecord => ({
  kind: 'transfer_order',
  key: '11111111-1111-4111-8111-111111111111',
  sessionId: 'cs_test_1',
  amountThb: 12500,
  ...over,
});

// ── 1) นับเฉพาะเงินจริง ───────────────────────────────────────────────────

test('เฉพาะ session ที่จ่ายแล้ว AND เป็นเงินจริงเท่านั้นที่นับ', () => {
  assert.equal(isRealPaidSession(session()), true);
  // test mode ไม่ใช่เงินจริง — ถ้านับรวม รายงานจะขึ้น "เงินหาย" ทั้งที่ไม่มีเงินจริง
  assert.equal(isRealPaidSession(session({ livemode: false })), false);
  // ยังไม่จ่าย = ไม่ใช่ช่องว่าง (ยังไม่มีเงินให้หาย)
  assert.equal(isRealPaidSession(session({ paymentStatus: 'unpaid' })), false);
  assert.equal(isRealPaidSession(session({ paymentStatus: 'paid', livemode: true })), true);
  assert.equal(isRealPaidSession(session({ livemode: true, paymentStatus: null })), false);
  // ไม่มี id = ระบุไม่ได้ว่าอะไร ต้องไม่ถือเป็นหลักฐาน
  assert.equal(isRealPaidSession(session({ id: '' })), false);
});

test('ทั้งสองฝั่งตรงกัน → ไม่มีช่องว่าง (เคสปกติ)', () => {
  const r = reconcilePaidSessions({
    stripeSessions: [session()],
    localPaid: [local()],
  });
  assert.equal(r.consistent, true, formatReconciliationReport(r));
  assert.equal(r.matchedCount, 1);
  assert.deepEqual(r.gaps, []);
});

// ── 2) ช่องว่างที่ต้องจับได้: Stripe จ่ายแล้ว แต่เราไม่มีแถว ────────────────

test('Stripe จ่ายแล้ว แต่ DB ไม่มีแถว → ต้องจับช่องว่าง (เงินหายเงียบ)', () => {
  const r = reconcilePaidSessions({
    stripeSessions: [session()],
    localPaid: [],
  });
  assert.equal(r.consistent, false, 'กรณีเงินหายต้องไม่ผ่าน');
  assert.equal(r.gaps.length, 1);
  const g = r.gaps[0];
  assert.equal(g.kind, 'paid_in_stripe_missing_locally');
  assert.equal(g.sessionId, 'cs_test_1');
  assert.equal(g.stripeAmount, 12500);
  // ข้อความต้องบอกได้ว่าเงินอยู่ฝั่งไหน ไม่ใช่แค่ "ต่างกัน"
  assert.match(g.explanation, /จ่ายแล้ว/);
  assert.match(g.explanation, /ค้างชำระ/);
});

test('session ที่ไม่มี client_reference_id ก็ต้องรายงาน ไม่เงียบทิ้ง', () => {
  const r = reconcilePaidSessions({
    stripeSessions: [session({ clientReferenceId: null })],
    localPaid: [],
  });
  assert.equal(r.consistent, false);
  assert.match(r.gaps[0].explanation, /client_reference_id/);
});

// ── 3) จับคู่ได้สองทาง — กันรายงานเงินหายเกินจริง ────────────────────────

test('จับคู่ด้วย client_reference_id ได้ แม้ DB ไม่ได้เก็บ session id', () => {
  const r = reconcilePaidSessions({
    stripeSessions: [session()],
    localPaid: [local({ sessionId: null })],
  });
  assert.equal(r.consistent, true, 'ข้อมูลไม่ครบไม่ใช่เหตุให้ตก flag');
  assert.equal(r.matchedCount, 1);
});

test('จับคู่ด้วย session id ได้ แม้ key ใน DB ไม่ตรง', () => {
  const r = reconcilePaidSessions({
    stripeSessions: [session({ clientReferenceId: 'ref-different' })],
    localPaid: [local({ key: 'key-different' })],
  });
  assert.equal(r.consistent, true);
  assert.equal(r.matchedCount, 1);
});

// ── 4) ช่องว่างอีกทิศทาง ─────────────────────────────────────────────────

test('DB บอกว่าจ่ายแล้ว แต่ Stripe ไม่มี → ต้องรายงาน (แต่ห้ามแก้ทับ)', () => {
  const r = reconcilePaidSessions({
    stripeSessions: [],
    localPaid: [local()],
  });
  assert.equal(r.consistent, false);
  const g = r.gaps[0];
  assert.equal(g.kind, 'paid_locally_missing_in_stripe');
  assert.match(g.explanation, /คนตัดสินใจ|ให้คนตรวจ/, 'ต้องบอกว่าไม่แก้ทับอัตโนมัติ');
});

// ── 5) ไม่โกหก: test mode ต้องไม่ทำให้เกิด false alarm ────────────────────

test('session ใน test mode ทั้งหมด + ไม่มีแถวใน DB = ไม่มีช่องว่าง', () => {
  const r = reconcilePaidSessions({
    stripeSessions: [session({ livemode: false })],
    localPaid: [],
  });
  assert.equal(r.consistent, true, 'ของปลอมไม่ใช่เงินหาย');
  assert.equal(r.stripePaidCount, 0);
});

test('รายงานต้องบอกว่าตรวจอะไรไปแล้ว ไม่ใช่แค่ "ไม่มีปัญหา"', () => {
  const r = reconcilePaidSessions({ stripeSessions: [session()], localPaid: [local()] });
  const text = formatReconciliationReport(r);
  assert.match(text, /Stripe จ่ายแล้ว 1/, 'ต้องเห็นว่าตรวจจาก Stripe มา 1 รายการ');
  assert.match(text, /ตรงกัน 1/);
});

// ── 6) ประตู: ปิดอยู่ต้องบอกเหตุผล ห้ามเงียบ ──────────────────────────────

test('ไม่มี STRIPE_SECRET_KEY → ไม่รัน แต่ต้องบอกเหตุผล (ไม่ใช่ "ไม่มีเงินหาย")', async () => {
  const { config } = await import('../src/config');
  // ต้องแก้ที่ `config` ไม่ใช่ process.env — config อ่านค่า ณ เวลา import แล้ว
  // (และบนเครื่องนี้มี .env จริงอยู่ จึงตั้งผ่าน process.env ไม่มีผล)
  const prevKey = config.stripe.secretKey;
  const prevLive = config.stripe.liveEnabled;
  config.stripe.secretKey = '';
  config.stripe.liveEnabled = true; // ตั้งไว้เพื่อให้แน่ใจว่าติดที่ประตู key ไม่ใช่ประตู flag
  try {
    const out = await runStripeReconcile();
    assert.equal(out.ran, false);
    assert.ok(out.reason, 'ต้องบอกเหตุผลที่ข้าม ไม่ใช่เงียบ');
    assert.match(out.reason, /STRIPE_SECRET_KEY/);
    // ป้องกันคนอ่าน log แล้วเข้าใจผิดว่า "ตรวจแล้วไม่มีเงินหาย"
    assert.match(out.reason, /ไม่ใช่ "ตรวจแล้วไม่มีเงินหาย"|ยังไม่ได้ตรวจ/, 'ต้องระบุว่ายังตรวจไม่ได้ ไม่ใช่ผลที่ปลอดภัย');
  } finally {
    config.stripe.secretKey = prevKey;
    config.stripe.liveEnabled = prevLive;
  }
});

test('มี key แต่ STRIPE_LIVE_ENABLED=false → ยังไม่รัน และบอกว่าตั้งใจไม่ยิง', async () => {
  const { config } = await import('../src/config');
  const prevKey = config.stripe.secretKey;
  const prevLive = config.stripe.liveEnabled;
  config.stripe.secretKey = 'sk_live_test_placeholder_not_real';
  config.stripe.liveEnabled = false;
  try {
    let fetchCalls = 0;
    const out = await runStripeReconcile({
      fetcher: async () => {
        fetchCalls++;
        return [];
      },
    });
    assert.equal(out.ran, false);
    assert.match(out.reason, /STRIPE_LIVE_ENABLED/);
    assert.equal(fetchCalls, 0, 'ห้ามแตะ Stripe จริงเมื่อสวิตช์ยังไม่เปิด');
  } finally {
    config.stripe.secretKey = prevKey;
    config.stripe.liveEnabled = prevLive;
  }
});

test('ล้มต้องบอกว่าตรวจไม่สำเร็จ ไม่ใช่เงียบ และไม่โยน error ออก', async () => {
  const { config } = await import('../src/config');
  const prevKey = config.stripe.secretKey;
  const prevLive = config.stripe.liveEnabled;
  config.stripe.secretKey = 'sk_live_test_placeholder_not_real';
  config.stripe.liveEnabled = true;
  try {
    const out = await runStripeReconcile({
      fetcher: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(out.ran, false);
    assert.match(out.reason, /ล้ม/);
    assert.match(out.reason, /boom/);
  } finally {
    config.stripe.secretKey = prevKey;
    config.stripe.liveEnabled = prevLive;
  }
});

test('runAndReport ต้องคืนข้อความ "ข้ามรอบนี้" เสมอเมื่อรันไม่ได้', async () => {
  const { config } = await import('../src/config');
  const prevKey = config.stripe.secretKey;
  const prevLive = config.stripe.liveEnabled;
  config.stripe.secretKey = '';
  config.stripe.liveEnabled = false;
  try {
    const text = await runAndReportStripeReconcile();
    assert.match(text, /ข้ามรอบนี้/, 'ต้องมีคำว่าว่าข้าม ไม่ใช่แค่เงียบ');
  } finally {
    config.stripe.secretKey = prevKey;
    config.stripe.liveEnabled = prevLive;
  }
});

// ── 7) ป้องกันการกลับมาเป็น silent no-op ──────────────────────────────────

test('กรณีที่เคยทำเงินหายจริง: Stripe จ่ายแล้ว แต่ refCode จับไม่เจอ → ต้องเห็น', () => {
  // จำลองสถานการณ์จริง: webhook หลุด → Stripe มีเงิน · เราไม่มีแถวเลย
  const r = reconcilePaidSessions({
    stripeSessions: [
      session({ id: 'cs_real_1', clientReferenceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      session({ id: 'cs_real_2', clientReferenceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
    ],
    localPaid: [],
  });
  assert.equal(r.consistent, false);
  assert.equal(r.gaps.length, 2);
  assert.match(formatReconciliationReport(r), /เงินจริงอาจอยู่คนละฝั่ง/);
});