// P0 security regression: /api/auth/rate-limit/clear must never be usable with a
// partial (password-only) token.
//
// Threat: attacker knows the SUPERADMIN password but not the TOTP code.
// 1) POST /api/auth/login  -> partial token (mfa_verified = false)
// 2) POST /api/auth/rate-limit/clear with that token
//    -> old behaviour: 200 and the per-account MFA limiter was wiped,
//       so the attacker could keep guessing OTP codes forever.
// 3) Now: full MFA is required; the limiter stays blocked.
//
// Recovery for a genuinely locked-out owner is a local/console operation,
// not a remote API call that weakens MFA.
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import authRoutes from '../src/modules/auth/auth.routes';
import { prisma } from '../src/services/auth.service';
import { AuditService } from '../src/services/audit.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const ADMIN_ID = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const ADMIN_USERNAME = 'rate-limit-admin';
const OPERATOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccc02';

let server: TestServer;
const auditLogs: Array<{ userId: string; actionType: string; payload: any }> = [];

before(async () => {
  const adminRow = {
    id: ADMIN_ID,
    username: ADMIN_USERNAME,
    role: 'SUPERADMIN',
    assigned_node_id: null,
    assigned_site_id: null,
    token_version: 0,
    must_change_password: false,
    mfa_secret: null, // verify-mfa ต้องล้มที่ handler (400) — ยังไม่เปิด MFA
  };
  const operatorRow = {
    id: OPERATOR_ID,
    username: 'rate-limit-operator',
    role: 'OPERATOR',
    assigned_node_id: null,
    assigned_site_id: null,
    token_version: 0,
    must_change_password: false,
    mfa_secret: null,
  };
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => {
      if (where?.id === ADMIN_ID) return adminRow;
      if (where?.username === ADMIN_USERNAME) return adminRow;
      if (where?.id === OPERATOR_ID) return operatorRow;
      return null;
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

function post(path: string, body: unknown, token?: string) {
  return fetch(server.baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('P0: token ที่ยังไม่ผ่าน OTP ล้าง MFA rate limit ไม่ได้ — limiter ต้องอยู่ครบ', async () => {
  const partial = makeToken('SUPERADMIN', { userId: ADMIN_ID, mfa_verified: false });

  // 5 ครั้งแรกผ่านถึง handler (400 = MFA not configured) แล้วครั้งที่ 6 ถูก per-account limiter บล็อก
  for (let i = 0; i < 5; i++) {
    const res = await post('/api/auth/verify-mfa', { code: '000000' }, partial);
    assert.strictEqual(res.status, 400, `ครั้งที่ ${i + 1} ควรถึง handler (400)`);
  }
  const blocked = await post('/api/auth/verify-mfa', { code: '000000' }, partial);
  assert.strictEqual(blocked.status, 429, 'ครั้งที่ 6 ต้องถูกบล็อกที่ per-account limiter');

  // หัวใจของ P0: token ที่ยังไม่ผ่าน OTP ต้องล้าง limiter ไม่ได้
  const clear = await post('/api/auth/rate-limit/clear', {}, partial);
  assert.strictEqual(clear.status, 403, 'partial token ต้องโดน 403 (MFA verification required)');

  const stillBlocked = await post('/api/auth/verify-mfa', { code: '000000' }, partial);
  assert.strictEqual(stillBlocked.status, 429, 'limiter ต้องไม่ถูกล้างจากคำขอที่ยังไม่ผ่าน MFA');
});

test('SUPERADMIN ที่ผ่าน MFA แล้วล้างได้จริง + เขียน audit RATE_LIMIT_CLEAR', async () => {
  auditLogs.length = 0;
  const full = makeToken('SUPERADMIN', { userId: ADMIN_ID });

  const res = await post('/api/auth/rate-limit/clear', { username: ADMIN_USERNAME }, full);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.cleared >= 1, `ควรล้างอย่างน้อย 1 bucket (ได้ ${body.cleared})`);

  // ล้างแล้วต้องกลับไปนับ 1 ใหม่ (400) ไม่ใช่ 429
  const afterClear = await post('/api/auth/verify-mfa', { code: '000000' }, full);
  assert.strictEqual(afterClear.status, 400);

  const audit = auditLogs.find((l) => l.actionType === 'RATE_LIMIT_CLEAR');
  assert.ok(audit, 'ต้องมี audit RATE_LIMIT_CLEAR');
  assert.strictEqual(audit!.userId, ADMIN_ID);
  assert.strictEqual(audit!.payload.username, ADMIN_USERNAME);
  assert.strictEqual(audit!.payload.cleared, body.cleared);
});

test('role ที่ไม่ใช่ SUPERADMIN แม้ผ่าน MFA ก็ล้างไม่ได้', async () => {
  const operator = makeToken('OPERATOR', { userId: OPERATOR_ID });
  const res = await post('/api/auth/rate-limit/clear', {}, operator);
  assert.strictEqual(res.status, 403);
});
