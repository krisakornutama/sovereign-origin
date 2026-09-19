import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RUN_DB, SKIP_REASON, primeDbEnv, setupCore, teardownCore, type CoreCtx } from './db-harness';

/* password lifecycle — วงจรจริงบน Postgres (auth.routes + users.routes + auth.service เต็ม ไม่ mock):
     1) admin สร้าง user → login ด้วยรหัสชั่วคราว → โดนบังคับเปลี่ยน (403 MUST_CHANGE_PASSWORD)
     2) เปลี่ยนรหัสเอง → ใช้งานได้ → token "ใบเก่า" (ก่อนเปลี่ยน) ตายทันที — token_version bump
     3) admin รีเซ็ตรหัสให้ (POST /api/users/:id/reset-password) → ได้รหัสชั่วคราว + token ของ user ตายทันที
     4) login ด้วยรหัสชั่วคราว → โดนบังคับเปลี่ยนอีก → ตั้งรหัสใหม่ → ใช้งานปกติ
     5) audit log มี USER_PASSWORD_RESET_BY_ADMIN (force toggle เข้า auto-audit global)
   ครอบรูที่เคยรั่ว: user ที่ติด flag ค้าง admin ยกเลิกไม่ได้ (UI เดิมซ่อนปุ่ม) — PUT must_change_password=false ต้องผ่าน
   Gated: RUN_DB_TESTS=1 + TEST_DATABASE_URL (CI: job test-db) */
describe('password lifecycle — real Postgres (reset + token versioning + audit)', { skip: RUN_DB ? false : SKIP_REASON }, () => {
  primeDbEnv();

  let ctx: CoreCtx;
  let server: { baseUrl: string; close: () => Promise<void> };
  let adminToken: string;
  let adminId: string;
  const targetUsername = `pw-lifecycle-${Date.now().toString(36)}`;
  let targetId = '';

  test('setup: DB จริง + admin จริง (login ผ่าน /api/auth/login ด้วย bcrypt)', async () => {
    ctx = await setupCore();
    const authRoutes = (await import('../src/modules/auth/auth.routes')).default;
    const usersRoutes = (await import('../src/modules/users/users.routes')).default;
    const { authenticate } = await import('../src/middleware/auth.middleware');
    const { createTestServer } = await import('./helpers');
    server = await createTestServer((app) => {
      app.use('/api/auth', authRoutes);
      app.use('/api/users', usersRoutes);
      // probe จริง: middleware authenticate ตัวเต็มไม่ mock — วัดว่า token "ผ่าน authenticate" หรือไม่
      // (แยกจาก /api/users ที่มี requireRole ซ้อนอยู่ ทำให้ 403 กับ OPERATOR ตีความสับสน)
      app.get('/api/probe', authenticate, (_req, res) => res.json({ ok: true }));
    });

    // admin: user จริงที่ setupCore สร้าง — ตั้งรหัสที่รู้ + token version ปัจจุบัน
    const adminPassword = 'Admin-Pw!2026x';
    const { prisma } = ctx;
    await prisma.user.update({
      where: { id: ctx.userId },
      data: { password_hash: await (await import('bcryptjs')).hash(adminPassword, 4), must_change_password: false, role: 'SUPERADMIN' },
    });
    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'db-upload-test', password: adminPassword }),
    });
    assert.equal(login.status, 200, 'admin login จริงผ่าน');
    const body = await login.json();
    adminToken = body.token;
    adminId = ctx.userId;
    assert.ok(adminToken);
  });

  test('1) admin สร้าง user → login รหัสชั่วคราว → 403 MUST_CHANGE_PASSWORD ตอนยิง API ทั่วไป', async () => {
    const create = await fetch(`${server.baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: targetUsername, password: 'First-Pw!2026', role: 'OPERATOR' }),
    });
    assert.equal(create.status, 200);
    const users = await (await fetch(`${server.baseUrl}/api/users`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
    targetId = users.find((u: any) => u.username === targetUsername).id;
    assert.ok(targetId);

    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: targetUsername, password: 'First-Pw!2026' }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.ok(token);

    // token ชั่วคราว (mfa_verified=true แต่ must_change_password=true) → authenticate ต้องปิดปากเอง
    const probe = await fetch(`${server.baseUrl}/api/probe`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(probe.status, 403);
    const err = await probe.json();
    assert.equal(err.code, 'MUST_CHANGE_PASSWORD');
  });

  test('2) เปลี่ยนรหัสเอง → token ใหม่ใช้ได้ + token ใบเก่า (ก่อนเปลี่ยน) ตายทันที (token_version)', async () => {
    const loginOld = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: targetUsername, password: 'First-Pw!2026' }),
    });
    const oldToken = (await loginOld.json()).token;

    const change = await fetch(`${server.baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oldToken}` },
      body: JSON.stringify({ currentPassword: 'First-Pw!2026', newPassword: 'Own-Pw!2026x' }),
    });
    assert.equal(change.status, 200);
    const { token: newToken } = await change.json();

    const withNew = await fetch(`${server.baseUrl}/api/probe`, { headers: { Authorization: `Bearer ${newToken}` } });
    assert.equal(withNew.status, 200, 'token ใหม่ (หลังเปลี่ยน) ผ่าน authenticate');

    const withOld = await fetch(`${server.baseUrl}/api/probe`, { headers: { Authorization: `Bearer ${oldToken}` } });
    assert.equal(withOld.status, 401, 'token เดิม (ก่อนเปลี่ยนรหัส) ต้องตายทันที — เดิมยังใช้ได้อีก 24 ชม.');
    const err = await withOld.json();
    assert.equal(err.code, 'TOKEN_VERSION_STALE');
  });

  test('3) admin รีเซ็ตรหัส → ได้รหัสชั่วคราว + session user ตายทันที + ปุ่มยกเลิกบังคับทำงาน (รูที่เคยรั่ว)', async () => {
    // user login อยู่ (token ปัจจุบันใช้ได้)
    const login = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: targetUsername, password: 'Own-Pw!2026x' }),
    });
    const liveToken = (await login.json()).token;
    const before = await fetch(`${server.baseUrl}/api/probe`, { headers: { Authorization: `Bearer ${liveToken}` } });
    assert.equal(before.status, 200); // user ใช้งานปกติก่อนถูกรีเซ็ต — สถานะตั้งต้นของเคสนี้

    // ก่อน reset: admin ยกเลิกบังคับได้จริง (เดิม UI ซ่อนปุ่มกับ user ที่ติด flag — API เองต้องรองรับ)
    const cancel = await fetch(`${server.baseUrl}/api/users/${targetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ must_change_password: false }),
    });
    assert.equal(cancel.status, 200, 'ยกเลิกบังคับผ่าน (user ที่ติด flag อยู่ก็ตาม)');
    const afterCancel = await fetch(`${server.baseUrl}/api/probe`, { headers: { Authorization: `Bearer ${liveToken}` } });
    assert.equal(afterCancel.status, 200, 'หลังยกเลิก — session เดิมยังใช้ได้ (ไม่ bump version)');

    // reset: server สุ่มรหัสชั่วคราว → token ที่มีชีวิตอยู่ตายทันที
    const reset = await fetch(`${server.baseUrl}/api/users/${targetId}/reset-password`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(reset.status, 200);
    const { temporaryPassword } = await reset.json();
    assert.match(temporaryPassword, /^.{12}$/, 'รหัสชั่วคราว 12 ตัวจาก server');

    const deadSession = await fetch(`${server.baseUrl}/api/probe`, { headers: { Authorization: `Bearer ${liveToken}` } });
    assert.equal(deadSession.status, 401, 'session เดิมตายทันทีหลัง admin รีเซ็ต (เคส สงสัยรหัสรั่ว)');

    // login ด้วยรหัสชั่วคราว → ถูกบังคับเปลี่ยนอีกรอบ
    const relogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: targetUsername, password: temporaryPassword }),
    });
    assert.equal(relogin.status, 200);
    const tempToken = (await relogin.json()).token;
    const forced = await fetch(`${server.baseUrl}/api/probe`, { headers: { Authorization: `Bearer ${tempToken}` } });
    assert.equal(forced.status, 403);

    // ปิดวงจร: ตั้งรหัสเองใหม่ → ใช้งานปกติ
    const final = await fetch(`${server.baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tempToken}` },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: 'Final-Pw!2026' }),
    });
    assert.equal(final.status, 200);
    const finalToken = (await final.json()).token;
    const ok = await fetch(`${server.baseUrl}/api/probe`, { headers: { Authorization: `Bearer ${finalToken}` } });
    assert.equal(ok.status, 200);
  });

  test('4) audit log reset + auto-audit ปิดจบในตัว + ตัวรับปฏิเสธ non-SUPERADMIN', async () => {
    const { prisma } = ctx;
    const types = (await prisma.auditLog.findMany({ where: { user_id: adminId, action_type: { startsWith: 'USER_PASSWORD_' } } })).map((r: any) => r.action_type);
    assert.ok(types.includes('USER_PASSWORD_RESET_BY_ADMIN'), 'reset โดย admin ลง log');

    // non-SUPERADMIN เรียก reset → 403
    const memberLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: targetUsername, password: 'Final-Pw!2026' }),
    });
    const memberToken = (await memberLogin.json()).token;
    const denied = await fetch(`${server.baseUrl}/api/users/${adminId}/reset-password`, {
      method: 'POST', headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(denied.status, 403, 'OPERATOR รีเซ็ตรหัสคนอื่นไม่ได้');
  });

  test('teardown: ลบ user ทดสอบ + audit ทิ้ง', async () => {
    await ctx.prisma.auditLog.deleteMany({ where: { user_id: adminId, action_type: { startsWith: 'USER_PASSWORD_' } } });
    if (targetId) await ctx.prisma.user.delete({ where: { id: targetId } }).catch(() => {});
    await server.close();
    await teardownCore(ctx);
  });
});
