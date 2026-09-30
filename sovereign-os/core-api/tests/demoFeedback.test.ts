import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import demoRoutes from '../src/modules/demo/demo.routes';
import feedbackRoutes, { prisma, submitFeedback, sendFeedbackDigest } from '../src/modules/feedback/feedback.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;

before(async () => {
  server = await createTestServer((app) => {
    app.use('/api/demo', demoRoutes);
    app.use('/api/feedback', feedbackRoutes);
  });
  adminToken = makeToken('SUPERADMIN');
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── /api/demo — sandbox คงตัว (ไม่แตะ DB) ──

test('GET /api/demo/farm — สาธารณะ ได้แปลง+ซีรีส์เซนเซอร์+disclaimer', async () => {
  const res = await fetch(server.baseUrl + '/api/demo/farm');
  assert.strictEqual(res.status, 200);
  const body: any = await res.json();
  assert.ok(body.plot.name);
  assert.ok(Array.isArray(body.series) && body.series.length >= 2);
  assert.ok(body.note.includes('ตัวอย่าง'));
});

test('GET /api/demo/livestock — ฝูงมีสถานะครบชุด', async () => {
  const res = await fetch(server.baseUrl + '/api/demo/livestock');
  assert.strictEqual(res.status, 200);
  const body: any = await res.json();
  assert.ok(body.herd.length >= 3);
  assert.ok(body.herd.every((a: any) => a.tag && a.species && typeof a.weightKg === 'number'));
  assert.strictEqual(body.summary.total, body.herd.length);
});

test('GET /api/demo/finance — พอร์ตจำลองมี value/pnl คำนวณถูก', async () => {
  const res = await fetch(server.baseUrl + '/api/demo/finance');
  assert.strictEqual(res.status, 200);
  const body: any = await res.json();
  assert.ok(body.lines.length >= 3);
  const line = body.lines.find((l: any) => l.assetClass === 'GOLD');
  assert.ok(line.value === Math.round(line.quantity * line.price * 100) / 100);
  assert.ok(typeof body.summary.totalValue === 'number' && body.summary.totalValue > 0);
});

test('GET /api/demo/overview — รวมสามโมดูล', async () => {
  const res = await fetch(server.baseUrl + '/api/demo/overview');
  assert.strictEqual(res.status, 200);
  const body: any = await res.json();
  assert.ok(body.farm && body.livestock && body.finance);
});

// ── /api/feedback — honeypot + สิทธิ์ + digest ──

test('POST /api/feedback — honeypot (website ถูกกรอก) = 202 เงียบ ไม่บันทึก', async () => {
  let created = 0;
  mockModel(prisma, 'feedbackNote', {
    create: async () => { created += 1; return { id: 'fb-1', created_at: new Date() }; },
    count: async () => 0,
    findMany: async () => [],
    update: async ({ data }: any) => ({ id: 'fb-1', ...data }),
  });
  const res = await fetch(server.baseUrl + '/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'ดีมากครับ', website: 'http://spam.example' }),
  });
  assert.strictEqual(res.status, 202);
  assert.strictEqual(created, 0, 'honeypot ต้องไม่บันทึก');
});

test('POST /api/feedback — ปกติ = 201 + บันทึกครบ (Telegram เป็น best-effort — โดน severity gate ได้)', async () => {
  let saved: any = null;
  mockModel(prisma, 'feedbackNote', {
    create: async ({ data }: any) => { saved = { id: 'fb-2', ...data }; return saved; },
    count: async () => 0,
    findMany: async () => [],
    update: async ({ data }: any) => ({ id: 'fb-2', ...data }),
  });
  const res = await fetch(server.baseUrl + '/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'bug', message: 'ปุ่มอะไรกดไม่ได้ครับ', senderEmail: 'visitors@example.com' }),
  });
  assert.strictEqual(res.status, 201);
  const body: any = await res.json();
  assert.ok(body.id);
  assert.strictEqual(typeof body.telegramSent, 'boolean'); // best-effort — gate ยับได้ แต่ต้องตอบสถานะ
  assert.strictEqual(saved?.topic, 'bug');
  assert.strictEqual(saved?.sender_email, 'visitors@example.com');
  assert.ok(saved?.ip_hash && saved.ip_hash.length === 8, 'ต้องจำ ip hash 8 ตัว (ไม่เก็บ IP เปล่า)');
});

test('POST /api/feedback — ข้อความสั้นเกิน = 400', async () => {
  mockModel(prisma, 'feedbackNote', { count: async () => 0 });
  const res = await fetch(server.baseUrl + '/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'ส' }),
  });
  assert.strictEqual(res.status, 400);
});

test('GET /api/feedback — ไม่ login = 401 · login ปกติ = 200 ได้รายการ', async () => {
  mockModel(prisma, 'feedbackNote', {
    findMany: async () => [{ id: 'fb-1', message: 'ดี', useful: null, created_at: new Date(), page: '/demo', topic: 'general', sender_email: null, sent_at: null, ip_hash: null, user_agent: null }],
  });
  const anon = await fetch(server.baseUrl + '/api/feedback');
  assert.strictEqual(anon.status, 401);
  const ok = await fetch(server.baseUrl + '/api/feedback', { headers: auth(adminToken) });
  assert.strictEqual(ok.status, 200);
  const body: any = await ok.json();
  assert.ok(Array.isArray(body.notes) && body.notes.length >= 1);
});

test('submitFeedback โดยตรง — คืน honeypot ที่ชั้น service ด้วย (กัน route ลืม)', async () => {
  const r = await submitFeedback({ message: 'ทดสอบ', website: 'x' });
  assert.deepStrictEqual(r, { accepted: false, reason: 'honeypot' });
});
