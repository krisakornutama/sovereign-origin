import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import authRoutes from '../src/modules/auth/auth.routes';
import { prisma } from '../src/services/auth.service';
import { AuditService } from '../src/services/audit.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CURRENT_PASSWORD = 'Current-Pass-123';

let server: TestServer;
let auditLogs: Array<{ userId: string; actionType: string; payload: any }> = [];

before(async () => {
  const hash = await bcrypt.hash(CURRENT_PASSWORD, 12);
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => {
      if (where?.username === 'victim') {
        return {
          id: USER_ID,
          username: 'victim',
          role: 'OPERATOR',
          assigned_node_id: null,
          mfa_secret: null,
          must_change_password: true, // บังคับเปลี่ยนรหัส — ต้องโดน server-side ด้วย
          password_hash: hash,
        };
      }
      if (where?.id === USER_ID) {
        return {
          id: USER_ID,
          username: 'victim',
          role: 'OPERATOR',
          assigned_node_id: null,
          mfa_secret: null,
          must_change_password: true,
          password_hash: hash,
        };
      }
      return null;
    },
    update: async ({ data }: any) => ({ id: USER_ID, ...data }),
  });

  // stub เขียน audit log — จับรายการเพื่อ assert
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

// ── per-account rate limit บน /login ──

test('login ผิดต่อเนื่องเกิน max ต่อบัญชี → 429 ข้อความระดับบัญชี + audit RATE_LIMIT_BLOCK', async () => {
  // max ต่อบัญชี = 5 (ต่ำกว่า per-IP = 10 → ชั้นบัญชีต้องติดก่อนจาก IP เดียว)
  for (let i = 0; i < 5; i++) {
    const res = await post('/api/auth/login', { username: 'victim', password: `wrong-${i}` });
    assert.strictEqual(res.status, 401, `ครั้งที่ ${i + 1} ควรเป็น 401 (รหัสผิด)`);
  }

  const blocked = await post('/api/auth/login', { username: 'victim', password: 'wrong-again' });
  assert.strictEqual(blocked.status, 429);
  assert.match((await blocked.json()).error, /this account/);

  // username อื่น (IP เดิม) ยังผ่านเข้าถึงขั้นตรวจรหัสได้ — bucket แยกต่อบัญชี
  const other = await post('/api/auth/login', { username: 'nobody-here', password: 'x' });
  assert.strictEqual(other.status, 401); // 401 = ผ่าน limiter แล้วโดนตรวจรหัส

  // audit: ทุกครั้งที่โดน 429 → มี RATE_LIMIT_BLOCK อ้างบัญชีที่ถูก brute-force
  const blocks = auditLogs.filter((l) => l.actionType === 'RATE_LIMIT_BLOCK');
  assert.ok(blocks.length >= 1, `ควรมี audit RATE_LIMIT_BLOCK ≥1 (ได้ ${blocks.length})`);
  assert.strictEqual(blocks[0].userId, USER_ID); // FK: resolve username → id แล้ว
  assert.strictEqual(blocks[0].payload.endpoint, '/api/auth/login');
  assert.strictEqual(blocks[0].payload.username, 'victim');
  assert.ok(blocks[0].payload.ip, 'audit ต้องมี ip');
});

// ── must_change_password บังคับฝั่ง server ──

test('token ที่มี must_change_password → API ทั่วไป 403 MUST_CHANGE_PASSWORD (server-side)', async () => {
  const forced = makeToken('OPERATOR', { userId: USER_ID, must_change_password: true });
  const res = await fetch(server.baseUrl + '/api/auth/mfa/status', {
    headers: { Authorization: `Bearer ${forced}` },
  });
  assert.strictEqual(res.status, 403);
  const body = await res.json();
  assert.strictEqual(body.code, 'MUST_CHANGE_PASSWORD');
});

test('token ปกติ (ไม่มี flag) → ผ่าน authenticate เหมือนเดิม', async () => {
  const ok = makeToken('OPERATOR', { userId: USER_ID });
  const res = await fetch(server.baseUrl + '/api/auth/mfa/status', {
    headers: { Authorization: `Bearer ${ok}` },
  });
  assert.strictEqual(res.status, 200);
});

test('change-password ยังเป็นทางออกของ flow บังคับเปลี่ยน (authenticatePartial)', async () => {
  const forced = makeToken('OPERATOR', { userId: USER_ID, must_change_password: true });
  const res = await post('/api/auth/change-password', {
    currentPassword: CURRENT_PASSWORD,
    newPassword: 'Fresh-Pass-789',
  }, forced);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.token, 'ต้องได้ token ใหม่');
});
