import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createPublicKey, generateKeyPairSync, sign as edSign } from 'node:crypto';
import express from 'express';
import { authenticate } from '../src/middleware/auth.middleware';
import licenseRoutes from '../src/modules/license/license.routes';
import { licenseGuard } from '../src/services/license-gate.service';
import { encodeLicenseToken, hashMachineId, type LicensePayload } from '../src/services/license.service';
import { createTestServer, makeToken, TestServer } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// licenseGate.test.ts — ไลเซนส์ออฟไลน์ "บังคับสิทธิ์จริง" ไม่ใช่แค่ซ่อน UI
//
// กติกาที่เทสต์นี้ล็อกไว้:
//   1) ยังไม่ตั้งไลเซนส์ / ไลเซนส์ไม่ผ่าน = โหมด CE → ระบบไม่ล็อกผู้ใช้ (ห้ามทำให้ข้อมูลหาย)
//   2) ไลเซนส์ผ่านแต่ฟีเจอร์อยู่นอกสิทธิ์ = 403 ที่ middleware
//   3) GET /api/license ห้ามคืน token (มีแต่สถานะที่ UI ต้องใช้)
// ─────────────────────────────────────────────────────────────────────────────

const MACHINE = 'test-machine-01';
const OTHER_MACHINE = 'test-machine-99';
const NOW = new Date('2026-11-09T00:00:00.000Z');

const keys = generateKeyPairSync('ed25519');
const publicPem = createPublicKey(keys.privateKey).export({ type: 'spki', format: 'pem' }).toString();

let server: TestServer;
let token: string;

function payloadOf(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    v: 1,
    id: 'lic_test',
    licensee: 'ร้านทดสอบ',
    tier: 'business',
    features: ['/reports', '/inventory'],
    issuedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2027-11-01T00:00:00.000Z',
    maxMachines: 1,
    machineHashes: [hashMachineId(MACHINE)],
    ...overrides,
  };
}

function sign(payload: LicensePayload): string {
  return encodeLicenseToken(payload, (data) => edSign(null, data, keys.privateKey));
}

function auth() {
  return { Authorization: `Bearer ${token}` };
}

/** ตั้งค่า env ของโปรเซสเหมือนที่ลูกค้าทำใน .env */
function withLicense(licenseToken: string | null, machine = MACHINE): void {
  if (licenseToken === null) delete process.env.SOVEREIGN_LICENSE;
  else process.env.SOVEREIGN_LICENSE = licenseToken;
  process.env.SOVEREIGN_LICENSE_PUBLIC_KEY = publicPem;
  process.env.SOVEREIGN_MACHINE_ID = machine;
}

before(async () => {
  token = makeToken('SUPERADMIN');
  server = await createTestServer((app) => {
    // เหมือนของจริง: authenticate ก่อน แล้วค่อย licenseGuard (ดู src/routes.ts)
    app.use('/api/license', licenseRoutes);
    app.use(
      '/api/reports',
      authenticate,
      licenseGuard('/reports'),
      (_req, res) => res.json({ ok: true, module: 'reports' })
    );
    app.use(
      '/api/dashboard',
      authenticate,
      licenseGuard('/dashboard'),
      (_req, res) => res.json({ ok: true, module: 'dashboard' })
    );
    app.use(express.json()); // mount ซ้ำได้ ปลอดภัย (เหมือน server.ts)
  });
});

after(async () => {
  delete process.env.SOVEREIGN_LICENSE;
  delete process.env.SOVEREIGN_LICENSE_PUBLIC_KEY;
  delete process.env.SOVEREIGN_MACHINE_ID;
  if (server) await server.close();
});

beforeEach(() => {
  withLicense(null);
});

// ── 1) ไม่มีไลเซนส์ = โหมด CE: ใช้งานได้ ไม่ล็อกผู้ใช้ ─────────────────────

test('GET /api/license: ยังไม่ตั้งไลเซนส์ → 200 mode=ce configured=false', async () => {
  const res = await fetch(server.baseUrl + '/api/license', { headers: auth() });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.strictEqual(body.mode, 'ce');
  assert.strictEqual(body.configured, false);
  assert.strictEqual(body.valid, false);
  assert.strictEqual(body.reason, 'not-configured');
  assert.deepStrictEqual(body.features, []);
  assert.strictEqual(body.tier, null);
});

test('โหมด CE: ฟีเจอร์ที่ "ปกติต้องมีสิทธิ์" ยังเข้าได้ (ห้ามล็อกเอาต์ผู้ใช้เดิม)', async () => {
  const res = await fetch(server.baseUrl + '/api/reports', { headers: auth() });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
});

// ── 2) ไลเซนส์ถูกต้อง = บังคับสิทธิ์ตาม tier ────────────────────────────────

test('GET /api/license: ไลเซนส์ถูกต้อง → mode=licensed + tier/วันหมดอายุ และไม่คืน token', async () => {
  const license = sign(payloadOf());
  withLicense(license);
  const res = await fetch(server.baseUrl + '/api/license', { headers: auth() });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.mode, 'licensed');
  assert.strictEqual(body.configured, true);
  assert.strictEqual(body.valid, true);
  assert.strictEqual(body.reason, 'ok');
  assert.strictEqual(body.tier, 'business');
  assert.deepStrictEqual(body.features, ['/reports', '/inventory']);
  assert.strictEqual(body.expiresAt, '2027-11-01T00:00:00.000Z');
  assert.ok(body.daysLeft > 300);
  assert.strictEqual(body.licensee, 'ร้านทดสอบ');
  assert.strictEqual(body.machineBound, true);
  // ห้ามมี token / ลายเซ็น / คีย์ / machine hash หลุดออก API
  const raw = JSON.stringify(body);
  assert.strictEqual(raw.includes(license), false);
  assert.strictEqual(raw.includes(license.split('.')[1]), false);
  assert.strictEqual(raw.includes('BEGIN PUBLIC KEY'), false);
  assert.strictEqual(raw.includes(hashMachineId(MACHINE)), false);
});

test('ไลเซนส์มีสิทธิ์ /reports → เข้า /api/reports ได้', async () => {
  withLicense(sign(payloadOf()));
  const res = await fetch(server.baseUrl + '/api/reports', { headers: auth() });
  assert.strictEqual(res.status, 200);
});

test('ไลเซนส์ไม่มีสิทธิ์ /dashboard → 403 ที่ middleware (ไม่ใช่แค่ซ่อนเมนู)', async () => {
  withLicense(sign(payloadOf({ features: ['/reports', '/inventory'] })));
  const res = await fetch(server.baseUrl + '/api/dashboard', { headers: auth() });
  assert.strictEqual(res.status, 403);
  const body = await res.json();
  assert.strictEqual(body.code, 'LICENSE_FEATURE_NOT_ENTITLED');
  assert.strictEqual(body.feature, '/dashboard');
});

test('tier pro (features=["*"]) → เข้าได้ทุกฟีเจอร์', async () => {
  withLicense(sign(payloadOf({ tier: 'pro', features: ['*'] })));
  const res = await fetch(server.baseUrl + '/api/dashboard', { headers: auth() });
  assert.strictEqual(res.status, 200);
});

// ── 3) ไลเซนส์ไม่ผ่าน = กลับไปโหมด CE (ไม่ตัดสิทธิ์ผู้ใช้เดิม) ──────────────

test('ไลเซนส์หมดอายุ → mode=ce reason=expired และ route ยังเข้าได้', async () => {
  withLicense(sign(payloadOf({ expiresAt: '2026-10-01T00:00:00.000Z' })));
  const res = await fetch(server.baseUrl + '/api/license', { headers: auth() });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.mode, 'ce');
  assert.strictEqual(body.valid, false);
  assert.strictEqual(body.reason, 'expired');
  assert.deepStrictEqual(body.features, []);

  const guarded = await fetch(server.baseUrl + '/api/dashboard', { headers: auth() });
  assert.strictEqual(guarded.status, 200);
});

test('ไลเซนส์ของเครื่องอื่น → reason=wrong-machine (ไม่ใช่ ok)', async () => {
  withLicense(sign(payloadOf()), OTHER_MACHINE);
  const res = await fetch(server.baseUrl + '/api/license', { headers: auth() });
  const body = await res.json();
  assert.strictEqual(body.valid, false);
  assert.strictEqual(body.reason, 'wrong-machine');
  assert.strictEqual(body.mode, 'ce');
});

test('ลายเซ็นถูกแก้ → reason=bad-signature (fail-closed)', async () => {
  const license = sign(payloadOf());
  const [body, sig] = license.split('.');
  const tampered = `${body}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
  withLicense(tampered);
  const res = await fetch(server.baseUrl + '/api/license', { headers: auth() });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.valid, false);
  assert.strictEqual(data.reason, 'bad-signature');
});

test('มี token แต่ไม่มี public key → reason=no-public-key', async () => {
  withLicense(sign(payloadOf()));
  delete process.env.SOVEREIGN_LICENSE_PUBLIC_KEY;
  const res = await fetch(server.baseUrl + '/api/license', { headers: auth() });
  const body = await res.json();
  assert.strictEqual(body.valid, false);
  assert.strictEqual(body.reason, 'no-public-key');
});

// ── 4) auth ────────────────────────────────────────────────────────────────

test('GET /api/license ไม่มี token → 401', async () => {
  const res = await fetch(server.baseUrl + '/api/license');
  assert.strictEqual(res.status, 401);
});
