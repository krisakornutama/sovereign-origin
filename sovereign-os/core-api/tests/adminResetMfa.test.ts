// Admin reset of a member's MFA.
//
// Why: a member who loses the phone with the authenticator is locked out, and
// until now the only recovery was a database console. Resetting MFA weakens an
// account, so it must be SUPERADMIN-only, audited, and it must kill existing
// sessions (token_version) so a stolen token cannot ride along.
//
// Also pins that the user list exposes only `mfa_enabled` — never mfa_secret.
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import usersRoutes from '../src/modules/users/users.routes';
import { prisma } from '../src/lib/prisma';
import { AuditService } from '../src/services/audit.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const ADMIN_ID = 'test-user'; // makeToken('SUPERADMIN') default id
const TARGET_ID = 'ffffffff-ffff-ffff-ffff-ffffffffff01';

let server: TestServer;
const updates: any[] = [];
const auditLogs: any[] = [];

before(async () => {
  const admin = {
    id: ADMIN_ID,
    username: 'owner',
    role: 'SUPERADMIN',
    assigned_node_id: null,
    assigned_site_id: null,
    token_version: 0,
    must_change_password: false,
    mfa_secret: null,
  };
  const target = {
    id: TARGET_ID,
    username: 'member',
    role: 'OPERATOR',
    assigned_node_id: null,
    assigned_site_id: null,
    token_version: 3,
    must_change_password: false,
    mfa_secret: 'JBSWY3DPEHPK3PXP',
    pending_mfa_secret: null,
    mfa_backup_hash: '[]',
  };
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => {
      if (where?.id === ADMIN_ID) return admin;
      if (where?.id === TARGET_ID) return target;
      // makeToken('OPERATOR') ใช้ id นี้ — ต้องมีแถวใน DB ปลอมเพื่อพิสูจน์ว่าเป็น 403 (role) ไม่ใช่ 401 (ไม่มี user)
      if (where?.id === 'test-user-operator') {
        return { id: 'test-user-operator', username: 'op', role: 'OPERATOR', assigned_node_id: null, assigned_site_id: null, token_version: 0, must_change_password: false, mfa_secret: null };
      }
      return null;
    },
    findMany: async () => [admin, target],
    update: async (args: any) => {
      updates.push(args);
      return { id: args.where.id, ...args.data };
    },
  });
  mock.method(AuditService, 'logAction', async (p: any) => {
    auditLogs.push(p);
  });
  server = await createTestServer((app) => app.use('/api/users', usersRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function post(path: string, token: string) {
  return fetch(server.baseUrl + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}

test('รีเซ็ต MFA ต้องเป็น SUPERADMIN (401 / 403)', async () => {
  const anon = await fetch(server.baseUrl + `/api/users/${TARGET_ID}/reset-mfa`, { method: 'POST' });
  assert.equal(anon.status, 401);
  const operator = await post(`/api/users/${TARGET_ID}/reset-mfa`, makeToken('OPERATOR'));
  assert.equal(operator.status, 403);
});

test('SUPERADMIN รีเซ็ตให้สมาชิกได้: ล้าง secret + bump token_version + audit', async () => {
  updates.length = 0;
  auditLogs.length = 0;
  const res = await post(`/api/users/${TARGET_ID}/reset-mfa`, makeToken('SUPERADMIN'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { username: 'member', had_mfa: true });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, TARGET_ID);
  assert.equal(updates[0].data.mfa_secret, null);
  assert.equal(updates[0].data.pending_mfa_secret, null);
  assert.equal(updates[0].data.mfa_backup_hash, null);
  assert.deepEqual(updates[0].data.token_version, { increment: 1 }, 'session เดิมต้องตายหลังรีเซ็ต 2FA');

  const entry = auditLogs.find((l) => l.actionType === 'USER_MFA_RESET_BY_ADMIN');
  assert.ok(entry, 'ต้องมี audit USER_MFA_RESET_BY_ADMIN');
  assert.equal(entry.payload.target_user_id, TARGET_ID);
  assert.equal(entry.payload.target_username, 'member');
});

test('รีเซ็ต MFA ของตัวเองผ่าน endpoint ผู้ดูแลไม่ได้ (ต้องใช้หน้าตั้งค่าที่บังคับรหัสผ่าน)', async () => {
  updates.length = 0;
  const res = await post(`/api/users/${ADMIN_ID}/reset-mfa`, makeToken('SUPERADMIN'));
  assert.equal(res.status, 400);
  assert.equal(updates.length, 0);
});

test('ผู้ใช้ที่ไม่มีอยู่ = 404 และไม่เขียนอะไร', async () => {
  updates.length = 0;
  const res = await post('/api/users/00000000-0000-0000-0000-000000000000/reset-mfa', makeToken('SUPERADMIN'));
  assert.equal(res.status, 404);
  assert.equal(updates.length, 0);
});

test('รายชื่อผู้ใช้บอกแค่ว่าเปิด 2FA ไหม — ไม่ส่ง mfa_secret ออกไป', async () => {
  const res = await fetch(server.baseUrl + '/api/users', { headers: { Authorization: `Bearer ${makeToken('SUPERADMIN')}` } });
  assert.equal(res.status, 200);
  const list = await res.json();
  const target = list.find((u: any) => u.id === TARGET_ID);
  assert.equal(target.mfa_enabled, true);
  assert.equal('mfa_secret' in target, false);
  assert.equal('mfa_backup_hash' in target, false);
});
