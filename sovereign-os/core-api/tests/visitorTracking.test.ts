import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import analyticsRoutes, { prisma } from '../src/modules/analytics/analytics.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;

before(async () => {
  server = await createTestServer((app) => {
    app.use('/api', analyticsRoutes);
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

test('POST /api/track — page_view สาธารณะ = 202 accepted (บันทึกลง DB)', async () => {
  let saved: any = null;
  mockModel(prisma, 'visitorEvent', {
    create: async ({ data }: any) => { saved = { id: 'v1', ...data }; return saved; },
  });
  const res = await fetch(server.baseUrl + '/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'page_view', page: '/demo' }),
  });
  assert.strictEqual(res.status, 202);
  const body: any = await res.json();
  assert.strictEqual(body.accepted, true);
  assert.strictEqual(saved?.kind, 'page_view');
  assert.strictEqual(saved?.page, '/demo');
  assert.ok(saved?.ip_hash && saved.ip_hash.length === 8, 'ต้อง hash IP (ไม่เก็บ IP เปล่า)');
});

test('POST /api/track — honeypot (website ถูกกรอก) = 202 แต่ไม่บันทึก', async () => {
  let created = 0;
  mockModel(prisma, 'visitorEvent', {
    create: async ({ data }: any) => { created += 1; return { id: 'v2', ...data }; },
  });
  const res = await fetch(server.baseUrl + '/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'page_view', page: '/demo', website: 'http://spam.example' }),
  });
  assert.strictEqual(res.status, 202);
  const body: any = await res.json();
  assert.strictEqual(body.accepted, false, 'ตอบยอมรับปลอม ไม่ให้ bot จับแพตเทิร์น');
  assert.strictEqual(created, 0);
});

test('POST /api/track — kind นอก allowlist / page ไม่ใช่ path = ทิ้งเงียบ (202 accepted:false)', async () => {
  let created = 0;
  mockModel(prisma, 'visitorEvent', {
    create: async ({ data }: any) => { created += 1; return { id: 'v3', ...data }; },
  });
  const bad1 = await fetch(server.baseUrl + '/api/track', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'anything-i-want', page: '/demo' }),
  });
  const bad2 = await fetch(server.baseUrl + '/api/track', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'survey', page: 'javascript:alert(1)' }),
  });
  assert.strictEqual(bad1.status, 202);
  assert.strictEqual(bad2.status, 202);
  assert.strictEqual(created, 0, 'ของเพี้ยนต้องไม่ลง DB');
});

test('GET /api/analytics/summary — ไม่ login = 401 · OPERATOR = 403', async () => {
  const anon = await fetch(server.baseUrl + '/api/analytics/summary');
  assert.strictEqual(anon.status, 401);
  const opToken = makeToken('OPERATOR');
  const op = await fetch(server.baseUrl + '/api/analytics/summary', { headers: auth(opToken) });
  assert.strictEqual(op.status, 403);
});

test('GET /api/analytics/summary — SUPERADMIN = 200 สรุปครบ (นับแยก kind + ผู้มาเยือนประมาณ)', async () => {
  const rows = [
    { kind: 'page_view', page: '/demo', detail: null, value: null, ip_hash: 'aa11bb22' },
    { kind: 'page_view', page: '/shop', detail: null, value: null, ip_hash: 'aa11bb22' },
    { kind: 'page_view', page: '/demo', detail: null, value: null, ip_hash: 'cc33dd44' },
    { kind: 'demo_tab', page: '/demo', detail: 'farm', value: null, ip_hash: 'aa11bb22' },
    { kind: 'survey', page: '/demo', detail: null, value: 'livestock', ip_hash: 'aa11bb22' },
    { kind: 'question', page: '/demo', detail: 'อยากได้เพิ่มใน livestock', value: 'ระบบแจ้งเตือนยา', ip_hash: 'aa11bb22' },
    { kind: 'time_on_page', page: '/demo', detail: null, value: '95', ip_hash: 'aa11bb22' },
    { kind: 'feedback_open', page: '/shop', detail: null, value: null, ip_hash: 'cc33dd44' },
  ];
  mockModel(prisma, 'visitorEvent', {
    findMany: async () => rows,
  });
  const res = await fetch(server.baseUrl + '/api/analytics/summary?days=7', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body: any = await res.json();
  assert.strictEqual(body.totalEvents, 8);
  assert.strictEqual(body.uniqueVisitors, 2, 'ip_hash 2 ชุด = ผู้มาเยือน 2 (ประมาณ)');
  const demo = body.pageViews.find((p: any) => p.page === '/demo');
  assert.strictEqual(demo.count, 2);
  assert.strictEqual(body.demoTabs[0].detail, 'farm');
  assert.strictEqual(body.surveys[0].value, 'livestock');
  assert.strictEqual(body.questions[0].value, 'ระบบแจ้งเตือนยา');
  assert.strictEqual(body.avgTimeOnPageSec, 95);
  assert.strictEqual(body.feedbackOpens, 1);
});
