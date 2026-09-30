import './setup-env';
// PARTNER_APPLY_LIMIT ต้องตั้งก่อน import routes (limiter อ่านตอน import) — จึง import routes แบบ dynamic ใน before()
process.env.PARTNER_APPLY_LIMIT = '100';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let partnersRoutes: any;
let prisma: any;

let server: TestServer;
let adminToken: string;

before(async () => {
  const mod = await import('../src/modules/partners/partners.routes');
  partnersRoutes = mod.default;
  prisma = mod.prisma;
  server = await createTestServer((app) => {
    app.use('/api/partners', partnersRoutes);
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

test('POST /api/partners — P17: ต้องยืนยันเบอร์ OTP ก่อน (ไม่มี token = 403) · มี token = 202 PENDING', async () => {
  let saved: any = null;
  mockModel(prisma, 'partner', {
    create: async ({ data }: any) => { saved = { id: 'p1', ...data }; return saved; },
    findMany: async () => [],
    count: async () => 0,
    update: async ({ data }: any) => ({ id: 'p1', ...data }),
    findFirst: async () => null,
  });
  const payload = {
    name: 'ร้านถ่ายเสียงกลางอำเภอ', category: 'SHOP',
    detail: 'ติดตั้งกล้องวงจรปิด+ระบบเสียงร้านค้า', address: '123 ถ.สามัคคี ต.ในเมือง',
    phone: '0812345678', lat: 15.11, lng: 104.32,
    contactName: 'สมชาย', contactPhone: '0898765432',
  };
  // ไม่มี otpToken → 403 พร้อมข้อความบอกทาง
  const noToken = await fetch(server.baseUrl + '/api/partners', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.strictEqual(noToken.status, 403);
  // ขอ OTP (dev fallback คืน devCode) → verify → token
  const send = await (await fetch(server.baseUrl + '/api/partners/otp/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactPhone: '0898765432' }),
  })).json() as any;
  assert.ok(send.devCode, 'dev fallback ต้องคืน devCode เพื่อเทสต์');
  const ver = await (await fetch(server.baseUrl + '/api/partners/otp/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactPhone: '0898765432', code: send.devCode }),
  })).json() as any;
  assert.ok(ver.token);
  // สมัครด้วย token → 202 + name_normalized
  const res = await fetch(server.baseUrl + '/api/partners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, otpToken: ver.token }),
  });
  assert.strictEqual(res.status, 202);
  const body: any = await res.json();
  assert.strictEqual(body.accepted, true);
  assert.ok(body.id);
  assert.strictEqual(saved?.status, undefined, 'status default PENDING ที่ DB — service ไม่รับค่า status จากผู้สมัคร');
  assert.strictEqual(saved?.category, 'SHOP');
  assert.ok(saved?.name_normalized && saved.name_normalized.length > 0, 'name_normalized ต้องถูกกรอก');
  assert.ok(saved?.ip_hash && saved.ip_hash.length === 8);
});

test('POST /api/partners — honeypot + ของเพี้ยน (พิกัดผิด/ไม่มีชื่อ) = ทิ้งเงียบ ไม่ลง DB', async () => {
  let created = 0;
  mockModel(prisma, 'partner', {
    create: async ({ data }: any) => { created += 1; return { id: 'p2', ...data }; },
    count: async () => 0, // ไม่โดน IP limit
    findFirst: async () => null, // ไม่โดนชื่อซ้ำ
  });
  const honeypot = await fetch(server.baseUrl + '/api/partners', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'บอท', lat: 1, lng: 1, contactName: 'x', contactPhone: 'x', website: 'http://spam' }),
  });
  const badCoords = await fetch(server.baseUrl + '/api/partners', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ร้านx', lat: 999, lng: 999, contactName: 'x', contactPhone: 'x' }),
  });
  const noName = await fetch(server.baseUrl + '/api/partners', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: 1, lng: 1, contactName: 'x', contactPhone: 'x' }),
  });
  assert.strictEqual(honeypot.status, 202);
  assert.strictEqual(badCoords.status, 202);
  assert.strictEqual(noName.status, 202);
  assert.strictEqual(created, 0, 'ของเพี้ยนต้องไม่ลง DB');
});

test('GET /api/partners — คืนเฉพาะ ACTIVE และไม่มีฟิลด์ผู้ติดต่อรั่วออกสาธารณะ', async () => {
  mockModel(prisma, 'partner', {
    findMany: async () => [{
      id: 'p3', name: 'ช่างประปากลางเมือง', category: 'TECHNICIAN', detail: 'ซ่อมท่อ',
      address: '456 ถ.ช่างยนต์', phone: '02xxxxxxx', lat: 15.12, lng: 104.33,
    }],
    count: async ({ where }: any) => (where?.status === 'PENDING' ? 2 : 1),
  });
  const res = await fetch(server.baseUrl + '/api/partners');
  assert.strictEqual(res.status, 200);
  const body: any = await res.json();
  assert.strictEqual(body.counts.active, 1);
  assert.strictEqual(body.counts.pending, 2);
  const p = body.partners[0];
  assert.ok(!('contactName' in p) && !('contactPhone' in p) && !('contactEmail' in p) && !('status' in p), 'ห้ามรั่วฟิลด์ภายใน');
  assert.strictEqual(p.name, 'ช่างประปากลางเมือง');
});

test('PATCH /api/partners/:id — ไม่ login 401 · OPERATOR 403 · SUPERADMIN อนุมัติได้', async () => {
  mockModel(prisma, 'partner', {
    update: async ({ data }: any) => ({ id: 'p3', status: data.status }),
  });
  const anon = await fetch(server.baseUrl + '/api/partners/p3', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }) });
  assert.strictEqual(anon.status, 401);
  const op = await fetch(server.baseUrl + '/api/partners/p3', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('OPERATOR')}` }, body: JSON.stringify({ status: 'ACTIVE' }) });
  assert.strictEqual(op.status, 403);
  const ok = await fetch(server.baseUrl + '/api/partners/p3', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ status: 'ACTIVE' }) });
  assert.strictEqual(ok.status, 200);
  const bad = await fetch(server.baseUrl + '/api/partners/p3', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ status: 'WHATEVER' }) });
  assert.strictEqual(bad.status, 400);
});
