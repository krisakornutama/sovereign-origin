import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import authRoutes from '../src/modules/auth/auth.routes';
import { AuthService, prisma } from '../src/services/auth.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CURRENT_PASSWORD = 'Current-Pass-123';
const NEW_PASSWORD = 'New-Pass-456';

let server: TestServer;
let updates: Array<{ data: any }> = [];

before(async () => {
  const hash = await bcrypt.hash(CURRENT_PASSWORD, 12);
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => {
      if (where?.id !== USER_ID) return null;
      return {
        id: USER_ID,
        username: 'member',
        role: 'OPERATOR',
        assigned_node_id: null,
        mfa_secret: null,
        pending_mfa_secret: null,
        must_change_password: true,
        password_hash: hash,
      };
    },
    update: async ({ data }: any) => {
      updates.push({ data });
      return { id: USER_ID, ...data };
    },
  });

  server = await createTestServer((app) => app.use('/api/auth', authRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── AuthService.changePassword ──

test('รหัสปัจจุบันผิด → ข้ามไป ไม่เปลี่ยนรหัส', async () => {
  await assert.rejects(
    () => AuthService.changePassword(USER_ID, 'wrong-password', NEW_PASSWORD),
    /รหัสผ่านปัจจุบันไม่ถูกต้อง/
  );
});

test('รหัสใหม่เหมือนรหัสเดิม → ไม่อนุมัติ', async () => {
  await assert.rejects(
    () => AuthService.changePassword(USER_ID, CURRENT_PASSWORD, CURRENT_PASSWORD),
    /ต้องต่างจากรหัสผ่านเดิม/
  );
});

test('รหัสใหม่สั้นเกิน 8 ตัว → ไม่อนุมัติ', async () => {
  await assert.rejects(
    () => AuthService.changePassword(USER_ID, CURRENT_PASSWORD, 'abc1234'),
    /อย่างน้อย 8 ตัวอักษร/
  );
});

test('รหัสยอดฮิต (password123) → ไม่อนุมัติ', async () => {
  await assert.rejects(
    () => AuthService.changePassword(USER_ID, CURRENT_PASSWORD, 'password123'),
    /อ่อนเกินไป/
  );
});

test('เปลี่ยนสำเร็จ → ล้าง must_change_password + คืน token ใหม่ที่ไม่มี flag บังคับ', async () => {
  const before = updates.length;
  const result = await AuthService.changePassword(USER_ID, CURRENT_PASSWORD, NEW_PASSWORD);
  assert.ok(result.token);

  // DB ถูกอัปเดต: hash ใหม่ + ล้าง flag บังคับเปลี่ยน
  assert.strictEqual(updates.length, before + 1);
  assert.strictEqual(updates[before].data.must_change_password, false);
  assert.notStrictEqual(updates[before].data.password_hash, undefined);

  // token ใหม่: ผ่าน MFA แล้ว + ไม่ถูกบังคับเปลี่ยนอีก
  const payload = jwt.decode(result.token) as any;
  assert.strictEqual(payload.userId, USER_ID);
  assert.strictEqual(payload.mfa_verified, true);
  assert.strictEqual(payload.must_change_password, false);
});

// ── HTTP ──

test('POST /api/auth/change-password — ไม่มี token → 401', async () => {
  const res = await fetch(server.baseUrl + '/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD }),
  });
  assert.strictEqual(res.status, 401);
});

test('POST /api/auth/change-password — สมาชิก (OPERATOR) เปลี่ยนเองได้ → 200 + token ใหม่', async () => {
  const memberToken = makeToken('OPERATOR', { userId: USER_ID });
  const res = await fetch(server.baseUrl + '/api/auth/change-password', {
    method: 'POST',
    headers: { ...auth(memberToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD + 'X' }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  const payload = jwt.decode(body.token) as any;
  assert.strictEqual(payload.must_change_password, false);
});

test('POST /api/auth/change-password — รหัสปัจจุบันผิด → 400', async () => {
  const memberToken = makeToken('OPERATOR', { userId: USER_ID });
  const res = await fetch(server.baseUrl + '/api/auth/change-password', {
    method: 'POST',
    headers: { ...auth(memberToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'not-the-password', newPassword: NEW_PASSWORD }),
  });
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /รหัสผ่านปัจจุบันไม่ถูกต้อง/);
});