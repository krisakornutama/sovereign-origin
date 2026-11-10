// กันการล็อกตัวเองออกจากระบบ (lockout guard) ที่ระดับ API
//
// UI ปิดปุ่มไว้สำหรับแถวของตัวเอง แต่ API ไม่ได้ตรวจอะไรเลย:
//   - ลบบัญชีตัวเอง → สำเร็จ (แล้วไม่มีใครมีสิทธิ์ SUPERADMIN อีก)
//   - ลดสิทธิ์ตัวเองจาก SUPERADMIN → OPERATOR ตอนเป็นคนสุดท้าย → ไม่มีผู้ดูแลเหลือ
//   - ลบผู้ใช้ที่ไม่มีอยู่จริง → 500 "ลบผู้ใช้ไม่สำเร็จ" (ควรเป็น 404)
//   - ลบผู้ใช้ที่มีข้อมูลผูกอยู่ (FK) → 500 พร้อม reason ดิบ (ควรเป็น 400 ที่อธิบายได้)
// ทั้งหมดนี้แก้ได้ด้วย DB console เท่านั้น — ซึ่งขัดกับเป้าหมาย "ใช้งานง่าย/มีระบบจัดการครบ"
import './setup-env';
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import usersRoutes from '../src/modules/users/users.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const ADMIN_ID = 'test-user'; // makeToken('SUPERADMIN') default id
const SECOND_ADMIN = 'aaaaaaaa-0000-4000-8000-000000000002';
const OPERATOR_ID = 'bbbbbbbb-0000-4000-8000-000000000003';
const FK_USER_ID = 'cccccccc-0000-4000-8000-000000000004';
const GONE_ID = 'dddddddd-0000-4000-8000-000000000005';

const rows: Record<string, any> = {
  [ADMIN_ID]: { id: ADMIN_ID, username: 'owner', role: 'SUPERADMIN', assigned_node_id: null, assigned_site_id: null, token_version: 0, must_change_password: false, mfa_secret: null },
  [SECOND_ADMIN]: { id: SECOND_ADMIN, username: 'owner2', role: 'SUPERADMIN', assigned_node_id: null, assigned_site_id: null, token_version: 0, must_change_password: false, mfa_secret: null },
  [OPERATOR_ID]: { id: OPERATOR_ID, username: 'member', role: 'OPERATOR', assigned_node_id: null, assigned_site_id: null, token_version: 0, must_change_password: false, mfa_secret: null },
  [FK_USER_ID]: { id: FK_USER_ID, username: 'busy', role: 'OPERATOR', assigned_node_id: null, assigned_site_id: null, token_version: 0, must_change_password: false, mfa_secret: null },
};

let superadminCount = 1;
let deleted: string[] = [];
let updates: any[] = [];
let server: TestServer;

before(async () => {
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => rows[where?.id] ?? null,
    count: async ({ where }: any) => (where?.role === 'SUPERADMIN' ? superadminCount : 0),
    delete: async ({ where }: any) => {
      if (where.id === FK_USER_ID) {
        const err: any = new Error('Foreign key constraint failed on the field: `assigned_node_id`');
        err.code = 'P2003';
        throw err;
      }
      deleted.push(where.id);
      return { id: where.id };
    },
    update: async (args: any) => {
      updates.push(args);
      return { id: args.where.id };
    },
  });
  server = await createTestServer((app) => app.use('/api/users', usersRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

beforeEach(() => {
  deleted = [];
  updates = [];
  superadminCount = 1;
});

const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

async function del(id: string) {
  const res = await fetch(`${server.baseUrl}/api/users/${id}`, { method: 'DELETE', headers: AUTH, signal: AbortSignal.timeout(4000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function put(id: string, body: any) {
  const res = await fetch(`${server.baseUrl}/api/users/${id}`, {
    method: 'PUT',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('ลบบัญชีตัวเองผ่าน API ไม่ได้ (400) — UI ปิดปุ่มไว้ แต่ API ต้องกันเอง', async () => {
  const { status, body } = await del(ADMIN_ID);
  assert.equal(status, 400);
  assert.match(body.error, /ตัวเอง/);
  assert.deepEqual(deleted, [], 'ต้องไม่มีการลบจริง');
});

test('ลบ SUPERADMIN คนสุดท้ายไม่ได้ (400)', async () => {
  superadminCount = 1;
  const { status, body } = await del(SECOND_ADMIN);
  assert.equal(status, 400);
  assert.match(body.error, /SUPERADMIN|ผู้ดูแลสูงสุด/);
  assert.deepEqual(deleted, []);
});

test('ลบ SUPERADMIN ได้เมื่อยังเหลือคนอื่น (200)', async () => {
  superadminCount = 2;
  const { status } = await del(SECOND_ADMIN);
  assert.equal(status, 200);
  assert.deepEqual(deleted, [SECOND_ADMIN]);
});

test('ลดสิทธิ์ตัวเองจาก SUPERADMIN คนสุดท้ายไม่ได้ (400) — ไม่งั้นไม่เหลือใครจัดการระบบ', async () => {
  superadminCount = 1;
  const { status, body } = await put(ADMIN_ID, { role: 'OPERATOR' });
  assert.equal(status, 400);
  assert.match(body.error, /SUPERADMIN|ผู้ดูแลสูงสุด/);
  assert.deepEqual(updates, []);
});

test('ลดสิทธิ์ SUPERADMIN ได้เมื่อมีคนอื่นเหลือ (200)', async () => {
  superadminCount = 2;
  const { status } = await put(SECOND_ADMIN, { role: 'OPERATOR' });
  assert.equal(status, 200);
  assert.equal(updates.length, 1);
});

test('ยกสิทธิ์ OPERATOR ขึ้นเป็น SUPERADMIN ต้องไม่ถูกกัน (ไม่ต้องนับคน)', async () => {
  superadminCount = 1;
  const { status } = await put(OPERATOR_ID, { role: 'SUPERADMIN' });
  assert.equal(status, 200);
  assert.equal(updates.length, 1);
});

test('ผู้ใช้ที่ไม่มีอยู่จริง = 404 (เดิม 500)', async () => {
  const d = await del(GONE_ID);
  assert.equal(d.status, 404);
  const p = await put(GONE_ID, { role: 'OPERATOR' });
  assert.equal(p.status, 404);
});

test('ลบผู้ใช้ที่มีข้อมูลผูกอยู่ (FK P2003) = 400 พร้อมบอกเหตุ ไม่ใช่ 500 ดิบ', async () => {
  const { status, body } = await del(FK_USER_ID);
  assert.equal(status, 400);
  assert.match(body.error, /ข้อมูลผูก|โอนย้าย/);
});

test('ลบสมาชิกปกติยังทำงานได้ (200)', async () => {
  const { status } = await del(OPERATOR_ID);
  assert.equal(status, 200);
  assert.deepEqual(deleted, [OPERATOR_ID]);
});
