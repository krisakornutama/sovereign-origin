import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import featureRoutes from '../src/modules/features/feature.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';
import {
  prisma,
  FEATURE_CATALOG,
  MEMBER_GRANTABLE_FEATURES,
  grantedFeaturesFor,
  hasFeatureGrant,
  setFeatureGrants,
  requireFeature,
} from '../src/services/feature-grant.service';

let server: TestServer;
let adminToken: string;
let memberToken: string;
let db: any;

const OWNER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

before(async () => {
  db = mockModel(prisma, 'userFeatureGrant', {
    findMany: async ({ where }: any = {}) =>
      !where
        ? [{ user_id: OWNER_B, feature: '/portfolio' }, { user_id: OWNER_B, feature: '/health' }]
        : where?.user_id === OWNER_B
          ? [{ feature: '/portfolio' }, { feature: '/health' }]
          : [],
    findUnique: async ({ where }: any) =>
      where?.user_id_feature?.user_id === OWNER_B && where?.user_id_feature?.feature === '/portfolio'
        ? { feature: '/portfolio' }
        : null,
    deleteMany: async () => ({ count: 0 }),
    createMany: async () => ({ count: 1 }),
  });
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) =>
      where?.id === OWNER_B ? { id: OWNER_B, role: 'OPERATOR' } : where?.id === OWNER_A ? { id: OWNER_A, role: 'SUPERADMIN' } : null,
    findMany: async () => [
      { id: OWNER_A, username: 'admin', role: 'SUPERADMIN' },
      { id: OWNER_B, username: 'member', role: 'OPERATOR' },
    ],
  });
  // $transaction เรียก callback พร้อม tx (ใช้ tx เดียวกับ delegate ของ userFeatureGrant)
  (prisma as any).$transaction = async (fn: any) => fn(prisma);

  server = await createTestServer((app) => app.use('/api/features', featureRoutes));
  adminToken = makeToken('SUPERADMIN', { userId: OWNER_A });
  memberToken = makeToken('OPERATOR', { userId: OWNER_B });
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Catalog / middleware ──

test('FEATURE_CATALOG ครอบคลุมหน้า member ทั้งหมดและแยกหน้า admin', () => {
  assert.ok(FEATURE_CATALOG.some((f) => f.key === '/portfolio'));
  assert.ok(FEATURE_CATALOG.some((f) => f.key === '/treasury')); // LIFE & FINANCE ใหม่
  assert.ok(FEATURE_CATALOG.some((f) => f.key === '/users' && f.adminOnly));
  // ทุก key ไม่ซ้ำ
  const keys = FEATURE_CATALOG.map((f) => f.key);
  assert.strictEqual(new Set(keys).size, keys.length);
});

test('MEMBER_GRANTABLE_FEATURES ไม่รวมหน้า admin', () => {
  assert.ok(!MEMBER_GRANTABLE_FEATURES.includes('/users'));
  assert.ok(!MEMBER_GRANTABLE_FEATURES.includes('/system'));
  assert.ok(MEMBER_GRANTABLE_FEATURES.includes('/portfolio'));
});

test('setFeatureGrants กรอง feature ที่ไม่รู้จัก / หน้า admin ออก', async () => {
  const saved = await setFeatureGrants(OWNER_B, ['/portfolio', '/treasury', '/hack-me', '/users', '/health']);
  assert.deepStrictEqual(saved, ['/portfolio', '/treasury', '/health']);
});

test('hasFeatureGrant: สมาชิกมีสิทธิ์เฉพาะที่ grant', async () => {
  assert.strictEqual(await hasFeatureGrant(OWNER_B, 'OPERATOR', '/portfolio'), true);
  assert.strictEqual(await hasFeatureGrant(OWNER_B, 'OPERATOR', '/farm'), false);
});

test('hasFeatureGrant: SUPERADMIN ได้เสมอ', async () => {
  assert.strictEqual(await hasFeatureGrant(OWNER_A, 'SUPERADMIN', '/anything'), true);
});

test('grantedFeaturesFor: SUPERADMIN ได้ทุกหน้า', async () => {
  const features = await grantedFeaturesFor(OWNER_A, 'SUPERADMIN');
  assert.strictEqual(features.length, FEATURE_CATALOG.length);
});

test('requireFeature middleware: สมาชิกไม่มีสิทธิ์ → 403', async () => {
  const req: any = { user: { id: OWNER_B, role: 'OPERATOR' } };
  const res: any = { status: (code: number) => ({ json: (body: any) => ({ code, body }) }) };
  let called = false;
  const next = () => { called = true; };
  const out = await requireFeature('/farm')(req, res, next);
  assert.strictEqual(out.code, 403);
  assert.strictEqual(called, false);
});

test('requireFeature middleware: สมาชิกมีสิทธิ์ → next()', async () => {
  const req: any = { user: { id: OWNER_B, role: 'OPERATOR' } };
  let called = false;
  const next = () => { called = true; };
  await requireFeature('/portfolio')(req, {} as any, next);
  assert.strictEqual(called, true);
});

test('requireFeature (array): มีสิทธิ์กลุ่มใดกลุ่มหนึ่ง → next() — /treasury ผ่านสิทธิ์ /portfolio เดิม', async () => {
  const req: any = { user: { id: OWNER_B, role: 'OPERATOR' } };
  let called = false;
  const next = () => { called = true; };
  await requireFeature(['/treasury', '/portfolio'])(req, {} as any, next);
  assert.strictEqual(called, true);
});

test('requireFeature (array): ไม่มีสิทธิ์ทั้งสอง → 403', async () => {
  const req: any = { user: { id: OWNER_B, role: 'OPERATOR' } };
  const res: any = { status: (code: number) => ({ json: (body: any) => ({ code, body }) }) };
  let called = false;
  const next = () => { called = true; };
  const out = await requireFeature(['/farm', '/xyz'])(req, res, next);
  assert.strictEqual(out.code, 403);
  assert.strictEqual(called, false);
});

test('requireFeature middleware: SUPERADMIN → next() เสมอ', async () => {
  const req: any = { user: { id: OWNER_A, role: 'SUPERADMIN' } };
  let called = false;
  const next = () => { called = true; };
  await requireFeature('/anything')(req, {} as any, next);
  assert.strictEqual(called, true);
});

// ── HTTP ──

test('GET /api/features ต้อง login (401)', async () => {
  const res = await fetch(server.baseUrl + '/api/features');
  assert.strictEqual(res.status, 401);
});

test('GET /api/features — สมาชิกเห็น catalog ได้ (ใช้สร้าง checkbox)', async () => {
  const res = await fetch(server.baseUrl + '/api/features', { headers: auth(memberToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.features));
  assert.ok(body.features.some((f: any) => f.key === '/portfolio'));
});

test('GET /api/features/me — สมาชิกเห็นเฉพาะสิทธิ์ของตัวเอง', async () => {
  const res = await fetch(server.baseUrl + '/api/features/me', { headers: auth(memberToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body.features, ['/portfolio', '/health']);
});

test('GET /api/features/me — SUPERADMIN เห็นทุกหน้า', async () => {
  const res = await fetch(server.baseUrl + '/api/features/me', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.features.length, FEATURE_CATALOG.length);
});

test('GET /api/features/users/:id — เฉพาะ SUPERADMIN', async () => {
  const res = await fetch(server.baseUrl + '/api/features/users/' + OWNER_B, { headers: auth(memberToken) });
  assert.strictEqual(res.status, 403);
});

test('GET /api/features/summary — สมาชิกโดน 403', async () => {
  const res = await fetch(server.baseUrl + '/api/features/summary', { headers: auth(memberToken) });
  assert.strictEqual(res.status, 403);
});

test('GET /api/features/summary — SUPERADMIN เห็น matrix ทั้งครอบครัว', async () => {
  const res = await fetch(server.baseUrl + '/api/features/summary', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  // catalog ครบ
  assert.ok(Array.isArray(body.catalog));
  assert.ok(body.catalog.length >= FEATURE_CATALOG.length);
  // สมาชิก 2 คน: admin (ได้ทุกหน้า) + member (ได้เฉพาะที่ grant)
  assert.strictEqual(body.members.length, 2);
  const admin = body.members.find((m: any) => m.role === 'SUPERADMIN');
  const member = body.members.find((m: any) => m.role === 'OPERATOR');
  assert.strictEqual(admin.features.length, FEATURE_CATALOG.length);
  assert.deepStrictEqual(member.features, ['/portfolio', '/health']);
});

test('PUT /api/features/users/:id — เฉพาะ SUPERADMIN (สมาชิกโดน 403)', async () => {
  const res = await fetch(server.baseUrl + '/api/features/users/' + OWNER_B, {
    method: 'PUT',
    headers: { ...auth(memberToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ features: ['/portfolio'] }),
  });
  assert.strictEqual(res.status, 403);
});

test('PUT /api/features/users/:id — SUPERADMIN ตั้งสิทธิ์ให้สมาชิกได้', async () => {
  const res = await fetch(server.baseUrl + '/api/features/users/' + OWNER_B, {
    method: 'PUT',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ features: ['/portfolio', '/health'] }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.deepStrictEqual(body.features, ['/portfolio', '/health']);
});

test('PUT /api/features/users/:id — ตั้งสิทธิ์ให้ SUPERADMIN ไม่ได้ (400)', async () => {
  const res = await fetch(server.baseUrl + '/api/features/users/' + OWNER_A, {
    method: 'PUT',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ features: ['/portfolio'] }),
  });
  assert.strictEqual(res.status, 400);
});
