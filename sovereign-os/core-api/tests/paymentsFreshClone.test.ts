// ──────────────────────────────────────────���─────────────────────────────────
// "คนที่เพิ่ง clone" — ตั้งค่าอะไรจากเทมเพลตไม่ได้เลย ระบบต้องประพฤติตัวถูก
//
// คำถามที่ต้องพิสูจน์: ถ้า STRIPE_WEBHOOK_SECRET ว่าง (ซึ่งคือสถานะของ
// fresh clone ที่ copy แค่ .env.example) webhook ต้อง "ปฏิเสธเสียงดัง"
// ไม่ใช่รับ delivery ที่ไม่มีลายเซ็นเงียบ ๆ — ไม่งั้นใครยิงมาก็จ่ายเงินได้
// ────────────────────────────────────────────────────────────────────────────
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { createPaymentsRouter } from '../src/modules/payments/payments.routes';
import { createFakeStripeTransport } from '../src/services/stripe-checkout';
import { makeToken } from './helpers';

const API = '/api/payments';
let server: Server;
let baseUrl: string;

const orders = new Map<string, any>();
const prisma: any = {
  transferOrder: {
    findFirst: async ({ where }: any) => orders.get(where?.ref_code) ?? null,
    updateMany: async ({ where, data }: any) => {
      const row = orders.get(where?.ref_code);
      if (!row || (where?.status && row.status !== where.status)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  },
};

const completion = (ref: string, total: number) =>
  JSON.stringify({ id: 'evt_fresh', type: 'checkout.session.completed',
    data: { object: { id: 'cs_fresh_1', client_reference_id: ref, amount_total: total, currency: 'thb' } } });

// เซ็นด้วย secret ที่ "การตั้งค่าไม่ได้เซ็นไว้" เพื่อพิสูจน์ว่าระบบไม่รับ
function signWith(secret: string, payload: string) {
  const ts = Math.floor(Date.now() / 1000);
  return `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex')}`;
}

async function boot(secret: string | undefined) {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  const app = express();
  app.use(`${API}/webhook`, express.raw({ type: 'application/json', limit: '256kb' }));
  app.use(express.json());
  app.use(API, createPaymentsRouter({
    transport: createFakeStripeTransport(),
    prisma,
    webhookSecret: secret,
  }));
  server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
}

async function deliver(payload: string, header?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (header !== undefined) headers['stripe-signature'] = header;
  const res = await fetch(`${baseUrl}${API}/webhook`, { method: 'POST', headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

before(async () => { await boot(''); });
after(async () => { if (server) await new Promise<void>((r) => server.close(() => r())); });

// ── fresh clone: ไม่มี secret เลย ────────────────────────────────────────────

test('ไม่ได้ตั้ง STRIPE_WEBHOOK_SECRET เลย → webhook ต้องปฏิเสธ ไม่ใช่รับเงียบ ๆ', async () => {
  // ส่ง '' (ไม่ใช่ undefined) = บังคับสถานะ "ไม่ได้ตั้ง" ให้แน่นอน
  // undefined จะไหลไปอ่าน .env ของเครื่องผู้รัน → เทสต์นี้ผูกกับเครื่อง
  await boot('');
  orders.set('XFR-FRESH1', { ref_code: 'XFR-FRESH1', status: 'PENDING', amount_thb: 250 });
  const p = completion('XFR-FRESH1', 25000);

  // แม้แต่ลายเซ็น "ถูกต้อง" ตาม secret ที่ว่าง — ต้องไม่ผ่าน
  const noHeader = await deliver(p);
  assert.ok(noHeader.status >= 400, 'ไม่มี secret = ปฏิเสธแบบ rejected (non-2xx ให้ Stripe retry ต่อ)');
  assert.match(String(noHeader.body.error), /secret|signature/i);

  // สำคัญ: order ต้องยัง PENDING — ห้ามถูกจ่ายเงิน
  assert.strictEqual(orders.get('XFR-FRESH1').status, 'PENDING');
});

test('ข้อความต้องบอกชัดว่าขาดอะไร ไม่ใช่ error กำกวม', async () => {
  await boot('');
  const r = await deliver(completion('XFR-FRESH1', 25000), 't=1,v1=deadbeef');
  assert.ok(r.status >= 400);
  assert.strictEqual(String(r.body.error), 'webhook signing secret is not configured');
});

test('secret ที่เป็นช่องว่างล้วน ต้องถือว่า "ยังไม่ได้ตั้ง" ไม่ใช่ secret ที่ใช้ได้', async () => {
  // กันกรณี copy/paste เหลือช่องว่าง — ถ้ารับเป็น secret เงียบ ๆ
  // ใครยิงมาด้วย key ที่เป็นช่องว่างก็ผ่าน ซึ่งอันตรายมาก
  await boot('   ');
  orders.set('XFR-FRESH2', { ref_code: 'XFR-FRESH2', status: 'PENDING', amount_thb: 250 });
  const p = completion('XFR-FRESH2', 25000);
  const r = await deliver(p, signWith('   ', p));
  assert.ok(r.status >= 400, 'ช่องว่างล้วนต้องถือว่าไม่ได้ตั้ง');
  assert.strictEqual(orders.get('XFR-FRESH2').status, 'PENDING');
});

// ── fresh clone: ฝั่งสร้าง session ยังใช้ได้ (ไม่พังเพราะไม่มี key) ──────────

test('ไม่มี STRIPE_* เลย → ยังสร้าง Checkout Session ได้ด้วย transport ของปลอม', async () => {
  await boot(undefined);
  const res = await fetch(`${baseUrl}${API}/checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('SUPERADMIN')}` },
    body: JSON.stringify({ amountBaht: 250, productName: 'สมาชิกปี', refCode: 'XFR-FRESH3',
      successUrl: 'https://sovereign.example.com/checkout/success' }),
  });
  const body = await res.json() as any;
  assert.strictEqual(res.status, 201, 'ระบบต้องเริ่มและสร้าง session ได้แม้ไม่มี key เลย');
  assert.strictEqual(body.mode, 'mock');
  assert.ok(String(body.sessionId).startsWith('cs_'));
});

test('ตัวแปร Stripe ที่โค้ดอ่าน ต้องมีในเทมเพลต .env.example ครบ (กันอ่านค่าที่ไม่มีใครเขียนไว้)', async () => {
  const fs = await import('node:fs');
  // อ่านจากตำแหน่งไฟล์เทสต์ ไม่ใช่ cwd (cwd ตอนรันเทสต์คือ core-api)
  const tpl = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  // เฉพาะตัวที่โค้ดใช้จริง — ตัวที่ยังไม่ถูกใช้จะรายงานแยก ไม่ใส่เทมเพลต
  for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_LIVE_ENABLED']) {
    assert.ok(tpl.includes(`${name}=`), `${name} ยังไม่มีใน .env.example`);
  }
  // ห้ามมีค่าจริงในเทมเพลต
  assert.ok(!/pk_live_[A-Za-z0-9]{10,}/.test(tpl), 'เทมเพลตห้ามมี publishable key จริง');
  assert.ok(!/sk_live_[A-Za-z0-9]{10,}/.test(tpl), 'เทมเพลตห้ามมี secret key จริง');
  assert.ok(!/rk_live_[A-Za-z0-9]{10,}/.test(tpl), 'เทมเพลตห้ามมี restricted key จริง');
  assert.ok(!/whsec_[A-Za-z0-9]{10,}/.test(tpl), 'เทมเพลตห้ามมี signing secret จริง');
});
