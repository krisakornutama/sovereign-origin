// รหัสผ่านยาวเกิน 72 ไบต์ — bcrypt มองไม่เห็นส่วนที่เกิน
//
// bcrypt ใช้ได้เพียง 72 ไบต์แรกของรหัส ที่เหลือถูกตัดทิ้งเงียบ ๆ ⇒ รหัสสองตัวที่
// ต่างกันแค่ท้าย (หรือรหัสไทยยาว ๆ ที่ 25 ตัวอักษร = 75 ไบต์) ใช้แทนกันได้
// ทั้งที่ระบบบอกผู้ใช้ว่ารับได้ถึง 128 ตัวอักษร
//
// เทสต์นี้จึงยึดสองอย่าง:
//   1) validateNewPassword ต้องปฏิเสธรหัสที่ยาวเกิน 72 ไบต์ (บอกเหตุผลเป็นไบต์)
//   2) POST /api/users ต้องได้ 400 ไม่ใช่สร้างบัญชีที่รหัสถูกตัดเงียบ ๆ
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import usersRoutes from '../src/modules/users/users.routes';
import authRoutes from '../src/modules/auth/auth.routes';
import { registerWithInvite } from '../src/services/invite.service';
import { prisma } from '../src/lib/prisma';
import { AuthService } from '../src/services/auth.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const BCRYPT_MAX_BYTES = 72;

test('พื้นฐานของปัญหา: bcrypt ตัดที่ 72 ไบต์ ⇒ รหัสต่างกันท้ายใช้แทนกันได้', async () => {
  const base = 'a'.repeat(BCRYPT_MAX_BYTES);
  const hash = await bcrypt.hash(base + 'X', 4);
  assert.equal(await bcrypt.compare(base + 'Y', hash), true, 'ส่วนที่เกิน 72 ไบต์ไม่ถูกนำมาใช้ — นี่คือเหตุผลที่ต้องปฏิเสธ');
});

test('72 ไบต์พอดี = ผ่าน, 73 ไบต์ = ปฏิเสธ พร้อมบอกเพดานเป็นไบต์', () => {
  assert.doesNotThrow(() => AuthService.validateNewPassword('a'.repeat(BCRYPT_MAX_BYTES)));
  assert.throws(
    () => AuthService.validateNewPassword('a'.repeat(BCRYPT_MAX_BYTES + 1)),
    /72/
  );
});

test('ตัวอักษรไทยนับเป็นไบต์ (3 ไบต์/ตัว) — 25 ตัว = 75 ไบต์ ต้องถูกปฏิเสธ', () => {
  const thai = 'ก'.repeat(25);
  assert.equal(Buffer.byteLength(thai, 'utf8'), 75);
  assert.throws(() => AuthService.validateNewPassword(thai), /72/);
  // 24 ตัว = 72 ไบต์พอดี ยังใช้ได้
  assert.doesNotThrow(() => AuthService.validateNewPassword('ก'.repeat(24)));
});

// ── ต่อสายจริง: POST /api/users ต้องไม่สร้างบัญชีที่รหัสถูกตัด ──────────────
let server: TestServer;
const created: any[] = [];

before(async () => {
  const admin = {
    id: 'test-user',
    username: 'owner',
    role: 'SUPERADMIN',
    assigned_node_id: null,
    assigned_site_id: null,
    token_version: 0,
    must_change_password: false,
    mfa_secret: null,
  };
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => (where?.id === admin.id ? admin : null),
    create: async (args: any) => {
      created.push(args);
      return { id: 'new-user', ...args.data };
    },
  });
  server = await createTestServer((app) => app.use('/api/users', usersRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

test('POST /api/users ปฏิเสธรหัส 73 ไบต์ (400) และไม่เขียนลง DB', async () => {
  const res = await fetch(server.baseUrl + '/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('SUPERADMIN')}` },
    body: JSON.stringify({ username: 'longpw', password: 'a'.repeat(73) }),
    signal: AbortSignal.timeout(4000),
  });
  assert.equal(res.status, 400);
  assert.equal(created.length, 0);
});

// ── เส้นทางอื่นที่รับรหัสใหม่: เปลี่ยนรหัสผ่าน + รับคำเชิญ ต้องใช้เพดานเดียวกัน ──

test('changePassword ปฏิเสธรหัสใหม่ 73 ไบต์ และไม่เขียนลง DB', async () => {
  const updates: any[] = [];
  const current = 'Current-Pass-123';
  const hash = await bcrypt.hash(current, 4);
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) =>
      where?.id === 'test-user-operator'
        ? {
            id: 'test-user-operator',
            username: 'member',
            role: 'OPERATOR',
            assigned_node_id: null,
            mfa_secret: null,
            pending_mfa_secret: null,
            must_change_password: false,
            password_hash: hash,
          }
        : null,
    update: async ({ data }: any) => {
      updates.push(data);
      return { id: 'test-user-operator', ...data };
    },
  });

  await assert.rejects(
    () => AuthService.changePassword('test-user-operator', current, 'a'.repeat(73)),
    /72/
  );
  assert.equal(updates.length, 0);
});

test('POST /api/auth/change-password ตอบ 400 (ไม่ใช่ 500) เมื่อรหัสใหม่ 73 ไบต์', async () => {
  const authServer = await createTestServer((app) => app.use('/api/auth', authRoutes));
  try {
    const res = await fetch(authServer.baseUrl + '/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('OPERATOR')}` },
      body: JSON.stringify({ currentPassword: 'Current-Pass-123', newPassword: 'a'.repeat(73) }),
      signal: AbortSignal.timeout(4000),
    });
    assert.equal(res.status, 400);
    const body: any = await res.json();
    assert.match(JSON.stringify(body), /72/);
  } finally {
    await authServer.close();
  }
});

test('รับคำเชิญ (registerWithInvite) ปฏิเสธรหัส 73 ไบต์ก่อนแตะ DB', async () => {
  await assert.rejects(
    () =>
      registerWithInvite({
        code: 'SG-AAAA-BBBB-CCCC',
        username: 'newmember',
        password: 'a'.repeat(73),
      } as any),
    /72/
  );
});
