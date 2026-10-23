import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestServer, makeToken, mockModel, type TestServer } from './helpers';
import { prisma } from '../src/lib/prisma';
import authRoutes from '../src/modules/auth/auth.routes';

// Phase 1: server-side logout must revoke the token, not only clear the browser.
const USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

let server: TestServer;
let version = 0;
let exists = true;
let updates: Array<{ data: any }> = [];

before(async () => {
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) =>
      exists && where?.id === USER_ID
        ? {
            id: USER_ID,
            username: 'logout-user',
            role: 'SUPERADMIN',
            assigned_node_id: null,
            token_version: version,
            must_change_password: false,
          }
        : null,
    update: async ({ where, data }: any) => {
      updates.push({ data });
      if (data?.token_version?.increment) version += data.token_version.increment;
      return { id: where?.id, token_version: version, ...(data ?? {}) };
    },
  });

  server = await createTestServer((app) => app.use('/api/auth', authRoutes));
});

after(async () => {
  if (server) await server.close();
});

function headers(token?: string) {
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

test('POST /api/auth/logout bumps token_version and makes the old token unusable', async () => {
  version = 0;
  exists = true;
  updates = [];
  const token = makeToken('SUPERADMIN', { userId: USER_ID, token_version: 0 });

  const res = await fetch(`${server.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: headers(token),
  });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { success: true });
  assert.deepStrictEqual(updates.at(-1)?.data?.token_version, { increment: 1 });
  assert.strictEqual(version, 1);

  const reuse = await fetch(`${server.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: headers(token),
  });
  assert.strictEqual(reuse.status, 401);
  assert.match((await reuse.json()).code, /TOKEN_VERSION_STALE/);
});

test('logout works for a partially authenticated (MFA-pending) token', async () => {
  version = 2;
  exists = true;
  updates = [];
  const token = makeToken('SUPERADMIN', {
    userId: USER_ID,
    token_version: 2,
    mfa_verified: false,
  });

  const res = await fetch(`${server.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: headers(token),
  });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(updates.at(-1)?.data?.token_version, { increment: 1 });
});

test('logout without a token is rejected', async () => {
  const res = await fetch(`${server.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: headers(),
  });
  assert.strictEqual(res.status, 401);
});

test('logout of a deleted user is rejected', async () => {
  version = 3;
  exists = false;
  const token = makeToken('SUPERADMIN', { userId: USER_ID, token_version: 3 });

  const res = await fetch(`${server.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: headers(token),
  });
  assert.strictEqual(res.status, 401);
});
