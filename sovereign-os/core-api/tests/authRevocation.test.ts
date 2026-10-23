import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createTestServer, makeToken, mockModel, type TestServer } from './helpers';
import { prisma } from '../src/lib/prisma';
import { authenticate, authenticatePartial, requireRole } from '../src/middleware/auth.middleware';
import { setIo, resetIo, userRoom } from '../src/realtime/io-registry';
import workspaceRoutes, { codingLimiter } from '../src/modules/coding/workspace.routes';
import codingRoutes from '../src/modules/coding/coding.routes';
import usersRoutes from '../src/modules/users/users.routes';

// P0 regression tests: token claims must not outlive the database row, and
// terminal/apply must stay SUPERADMIN-only even when /ai-agent is granted.

const USER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TARGET_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

let server: TestServer;
let userRow: any;
let updateArgs: any;

function row(overrides: Record<string, any> = {}) {
  return {
    id: USER_ID,
    role: 'SUPERADMIN',
    assigned_node_id: null,
    token_version: 0,
    must_change_password: false,
    ...overrides,
  };
}

before(async () => {
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => (where?.id === USER_ID ? userRow : null),
    update: async (args: any) => {
      updateArgs = args;
      return { id: args?.where?.id, ...(args?.data ?? {}) };
    },
    delete: async (args: any) => ({ id: args?.where?.id }),
  });

  server = await createTestServer((app) => {
    app.get('/probe', authenticate, requireRole('SUPERADMIN'), (_req, res) => res.json({ ok: true }));
    app.get('/partial', authenticatePartial, (_req, res) => res.json({ ok: true }));
    app.use('/api/coding', workspaceRoutes);
    app.use('/api/coding', codingRoutes);
    app.use('/api/users', usersRoutes);
  });
});

after(async () => {
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test('deleted user token is rejected instead of falling back to JWT claims', async () => {
  userRow = null;
  const token = makeToken('SUPERADMIN', { userId: USER_ID });

  const res = await fetch(`${server.baseUrl}/probe`, { headers: auth(token) });
  assert.strictEqual(res.status, 401);
});

test('demoted user uses the DB role, not the role baked into the JWT', async () => {
  userRow = row({ role: 'OPERATOR' });
  const token = makeToken('SUPERADMIN', { userId: USER_ID });

  const res = await fetch(`${server.baseUrl}/probe`, { headers: auth(token) });
  assert.strictEqual(res.status, 403);
});

test('stale token_version is rejected', async () => {
  userRow = row({ token_version: 4 });
  const token = makeToken('SUPERADMIN', { userId: USER_ID });

  const res = await fetch(`${server.baseUrl}/probe`, { headers: auth(token) });
  assert.strictEqual(res.status, 401);
  assert.match((await res.json()).code, /TOKEN_VERSION_STALE/);
});

test('must_change_password from the DB cannot be bypassed by an old token', async () => {
  userRow = row({ must_change_password: true });
  const token = makeToken('SUPERADMIN', { userId: USER_ID });

  const res = await fetch(`${server.baseUrl}/probe`, { headers: auth(token) });
  assert.strictEqual(res.status, 403);
  assert.match((await res.json()).code, /MUST_CHANGE_PASSWORD/);
});

test('partial auth also rejects a deleted user', async () => {
  userRow = null;
  const token = makeToken('SUPERADMIN', { userId: USER_ID });

  const res = await fetch(`${server.baseUrl}/partial`, { headers: auth(token) });
  assert.strictEqual(res.status, 401);
});

test('terminal is SUPERADMIN-only', async () => {
  userRow = row({ role: 'OPERATOR' });
  const token = makeToken('OPERATOR', { userId: USER_ID });

  const res = await fetch(`${server.baseUrl}/api/coding/terminal`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ command: '' }),
  });
  assert.strictEqual(res.status, 403);
});

test('applying coding-job files is SUPERADMIN-only', async () => {
  userRow = row({ role: 'OPERATOR' });
  const token = makeToken('OPERATOR', { userId: USER_ID });

  const res = await fetch(`${server.baseUrl}/api/coding/jobs/missing/apply`, {
    method: 'POST',
    headers: auth(token),
    body: '{}',
  });
  assert.strictEqual(res.status, 403);
});

test('project file listing and preview are SUPERADMIN-only', async () => {
  userRow = row({ role: 'OPERATOR' });
  const token = makeToken('OPERATOR', { userId: USER_ID });

  for (const path of ['/api/coding/files?path=', '/api/coding/file?path=package.json']) {
    const res = await fetch(`${server.baseUrl}${path}`, { headers: auth(token) });
    assert.strictEqual(res.status, 403, `${path} must reject OPERATOR`);
  }
});

test('workspace path is SUPERADMIN-only', async () => {
  userRow = row({ role: 'OPERATOR' });
  const token = makeToken('OPERATOR', { userId: USER_ID });

  const res = await fetch(`${server.baseUrl}/api/coding/workspace`, { headers: auth(token) });
  assert.strictEqual(res.status, 403);
});

test('coding file paths cannot escape the project or read .env', async () => {
  userRow = row();
  const token = makeToken('SUPERADMIN', { userId: USER_ID });

  for (const path of ['../../etc/passwd', '..\\..\\secret.txt', '.env']) {
    const res = await fetch(
      `${server.baseUrl}/api/coding/file?path=${encodeURIComponent(path)}`,
      { headers: auth(token) },
    );
    assert.strictEqual(res.status, 400, `${path} must be rejected`);
  }
});

test('coding file reads are rate-limited per user', async () => {
  userRow = row();
  codingLimiter.store.clear();
  const token = makeToken('SUPERADMIN', { userId: USER_ID });

  let lastStatus = 0;
  for (let i = 0; i < 61; i += 1) {
    const res = await fetch(`${server.baseUrl}/api/coding/file?path=package.json`, {
      headers: auth(token),
    });
    lastStatus = res.status;
  }
  assert.strictEqual(lastStatus, 429);
});

test('changing role/node/password-flag bumps token_version and disconnects target sockets', async () => {
  userRow = row();
  updateArgs = null;
  const token = makeToken('SUPERADMIN', { userId: USER_ID });
  const disconnected: string[] = [];
  const rooms = new Map<string, Set<string>>([[userRoom(TARGET_ID), new Set(['socket-1'])]]);
  setIo({
    sockets: { adapter: { rooms } },
    in: (room: string) => ({
      disconnectSockets: () => {
        disconnected.push(room);
        rooms.get(room)?.clear();
      },
    }),
  } as any);

  try {
    const res = await fetch(`${server.baseUrl}/api/users/${TARGET_ID}`, {
      method: 'PUT',
      headers: auth(token),
      body: JSON.stringify({ role: 'OPERATOR' }),
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(updateArgs?.data?.token_version, { increment: 1 });
    assert.deepStrictEqual(disconnected, [userRoom(TARGET_ID)]);
  } finally {
    resetIo();
  }
});

test('deleting a user disconnects their sockets', async () => {
  userRow = row();
  const token = makeToken('SUPERADMIN', { userId: USER_ID });
  const disconnected: string[] = [];
  const rooms = new Map<string, Set<string>>([[userRoom(TARGET_ID), new Set(['socket-1'])]]);
  setIo({
    sockets: { adapter: { rooms } },
    in: (room: string) => ({
      disconnectSockets: () => {
        disconnected.push(room);
        rooms.get(room)?.clear();
      },
    }),
  } as any);

  try {
    const res = await fetch(`${server.baseUrl}/api/users/${TARGET_ID}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(disconnected, [userRoom(TARGET_ID)]);
  } finally {
    resetIo();
  }
});
