// MFA disable is a credential change: possessing a live JWT is not enough.
// A stolen verified token must not be able to switch 2FA off without the
// current password, otherwise session theft permanently weakens the account.
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import authRoutes from '../src/modules/auth/auth.routes';
import { prisma } from '../src/services/auth.service';
import { AuditService } from '../src/services/audit.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const USER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddd01';
const PASSWORD = 'Correct-Horse-123';

let server: TestServer;
const updates: any[] = [];
const auditLogs: any[] = [];

before(async () => {
  const hash = await bcrypt.hash(PASSWORD, 12);
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => {
      if (where?.id !== USER_ID) return null;
      return {
        id: USER_ID,
        username: 'mfa-user',
        role: 'SUPERADMIN',
        assigned_node_id: null,
        assigned_site_id: null,
        token_version: 0,
        must_change_password: false,
        mfa_secret: 'JBSWY3DPEHPK3PXP',
        mfa_backup_hash: '[]',
        password_hash: hash,
      };
    },
    update: async (args: any) => {
      updates.push(args);
      return { id: USER_ID, ...args.data };
    },
  });
  mock.method(AuditService, 'logAction', async (p: any) => {
    auditLogs.push(p);
  });
  server = await createTestServer((app) => app.use('/api/auth', authRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function post(path: string, body: unknown, token: string) {
  return fetch(server.baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test('ปิด MFA ด้วยรหัสผ่านถูกต้อง = 200 + ล้าง secret + audit MFA_DISABLED', async () => {
  updates.length = 0;
  auditLogs.length = 0;
  const res = await post('/api/auth/mfa/disable', { password: PASSWORD }, makeToken('SUPERADMIN', { userId: USER_ID }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: false });
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].data, { mfa_secret: null, pending_mfa_secret: null, mfa_backup_hash: null });
  assert.ok(auditLogs.some((l) => l.actionType === 'MFA_DISABLED'), 'ต้องมี audit MFA_DISABLED');
});

test('รหัสผ่านผิด = 401 และไม่แตะ secret', async () => {
  updates.length = 0;
  const res = await post('/api/auth/mfa/disable', { password: 'wrong-password' }, makeToken('SUPERADMIN', { userId: USER_ID }));
  assert.equal(res.status, 401);
  assert.equal(updates.length, 0);
});

test('ไม่ส่งรหัสผ่าน = 400 และไม่แตะ secret', async () => {
  updates.length = 0;
  const res = await post('/api/auth/mfa/disable', {}, makeToken('SUPERADMIN', { userId: USER_ID }));
  assert.equal(res.status, 400);
  assert.equal(updates.length, 0);
});

test('token ที่ยังไม่ผ่าน OTP = 403 (authenticate ไม่ใช่ authenticatePartial)', async () => {
  updates.length = 0;
  const res = await post(
    '/api/auth/mfa/disable',
    { password: PASSWORD },
    makeToken('SUPERADMIN', { userId: USER_ID, mfa_verified: false })
  );
  assert.equal(res.status, 403);
  assert.equal(updates.length, 0);
});
