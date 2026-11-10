// POST /api/users — input validation and failure handling.
//
// Why: creating an account is the one place a SUPERADMIN types a password for
// someone else. Before this, the handler trusted the body completely:
//   - no `password` → bcrypt.hash(undefined) throws inside an async handler.
//     Express 4 does not forward async throws, so the request HANGS (not a 500)
//     and the admin just sees a spinner.
//   - a 3-character password was accepted (weaker than the rule the user is
//     forced into on first change via validateNewPassword).
//   - a duplicate username raised Prisma P2002 → another hang.
// Every case below is pinned with AbortSignal.timeout so a regression becomes a
// fast failure instead of a 30-minute CI timeout.
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import usersRoutes from '../src/modules/users/users.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const ADMIN_ID = 'test-user'; // makeToken('SUPERADMIN') default id
const HANG_GUARD_MS = 4000;

type Created = { data: any };
const created: Created[] = [];
const existingUsernames = new Set(['somchai']);

let server: TestServer;

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
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => {
      if (where?.id === ADMIN_ID) return admin;
      // makeToken('OPERATOR') ใช้ id นี้ — ต้องมีแถวจริงเพื่อพิสูจน์ว่าเป็น 403 (role) ไม่ใช่ 401 (ไม่มี user)
      if (where?.id === 'test-user-operator') {
        return { id: 'test-user-operator', username: 'op', role: 'OPERATOR', assigned_node_id: null, assigned_site_id: null, token_version: 0, must_change_password: false, mfa_secret: null };
      }
      return null;
    },
    create: async (args: any) => {
      // จำลอง unique constraint ของ Postgres: username ซ้ำ → P2002
      if (existingUsernames.has(args?.data?.username)) {
        const err: any = new Error('Unique constraint failed on the fields: (`username`)');
        err.code = 'P2002';
        err.meta = { target: ['username'] };
        throw err;
      }
      created.push(args);
      // เลียนแบบ Prisma: ถ้ามี `select` ต้องคืนเฉพาะ key ที่ขอ (ไม่ใช่ทั้งแถว)
      const row = { id: `new-${created.length}`, ...args.data };
      if (!args.select) return row;
      return Object.fromEntries(Object.keys(args.select).map((k) => [k, row[k]]));
    },
  });
  server = await createTestServer((app) => app.use('/api/users', usersRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

/** ยิง POST /api/users พร้อมเพดานเวลา — handler ที่ค้างจะกลายเป็น test ที่ตก ไม่ใช่ CI ที่ค้าง */
async function post(body: any, headers: Record<string, string> = AUTH): Promise<{ status: number; body: any }> {
  const res = await fetch(server.baseUrl + '/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HANG_GUARD_MS),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('ต้องเป็น SUPERADMIN เท่านั้น (401 / 403)', async () => {
  const anon = await fetch(server.baseUrl + '/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'x', password: 'a-long-password' }),
    signal: AbortSignal.timeout(HANG_GUARD_MS),
  });
  assert.equal(anon.status, 401);

  const operator = await fetch(server.baseUrl + '/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('OPERATOR')}` },
    body: JSON.stringify({ username: 'x', password: 'a-long-password' }),
    signal: AbortSignal.timeout(HANG_GUARD_MS),
  });
  assert.equal(operator.status, 403);
});

test('ไม่ส่ง password ต้องตอบ 400 ทันที (เดิม: async handler throw → request ค้าง)', async () => {
  const { status, body } = await post({ username: 'newbie' });
  assert.equal(status, 400);
  assert.match(body.error, /รหัสผ่าน/);
  assert.equal(created.length, 0, 'ห้ามสร้างบัญชีที่ไม่มีรหัสผ่าน');
});

test('password ไม่ใช่สตริง/สั้นกว่า 8 ตัว ต้องถูกปฏิเสธ', async () => {
  for (const password of [null, 12345678, '', 'short', 'abc1234']) {
    const { status, body } = await post({ username: 'newbie', password });
    assert.equal(status, 400, `password=${JSON.stringify(password)} ต้องได้ 400`);
    assert.ok(body.error, 'ต้องมีข้อความบอกเหตุผล');
  }
  assert.equal(created.length, 0);
});

test('password ยาวเกิน 128 ตัว และรหัสยอดนิยม ต้องถูกปฏิเสธ (ใช้กฎเดียวกับตอนผู้ใช้ตั้งรหัสเอง)', async () => {
  const tooLong = 'a'.repeat(129);
  assert.equal((await post({ username: 'newbie', password: tooLong })).status, 400);
  assert.equal((await post({ username: 'newbie', password: 'password123' })).status, 400);
  assert.equal(created.length, 0);
});

test('username ว่าง/ไม่ใช่สตริง/ยาวเกิน 64 ต้องถูกปฏิเสธ', async () => {
  for (const username of [undefined, '', '   ', 12345, 'u'.repeat(65)]) {
    const { status } = await post({ username, password: 'a-good-password' });
    assert.equal(status, 400, `username=${JSON.stringify(username)} ต้องได้ 400`);
  }
  assert.equal(created.length, 0);
});

test('role ที่ไม่รู้จักต้องถูกปฏิเสธ (เดิม POST ไม่ตรวจเลย)', async () => {
  const { status, body } = await post({ username: 'newbie', password: 'a-good-password', role: 'ROOT' });
  assert.equal(status, 400);
  assert.match(body.error, /role|สิทธิ์/i);
  assert.equal(created.length, 0);
});

test('username ซ้ำ (Prisma P2002) ต้องตอบ 409 ไม่ค้างและไม่ใช่ 500', async () => {
  const { status, body } = await post({ username: 'somchai', password: 'a-good-password' });
  assert.equal(status, 409);
  assert.match(body.error, /อยู่แล้ว|ซ้ำ/);
  assert.equal(created.length, 0);
});

test('สำเร็จ: ตัดช่องว่างหัวท้าย, default role OPERATOR, บังคับเปลี่ยนรหัส, ไม่คืนรหัส/แฮช', async () => {
  const { status, body } = await post({ username: '  somchai2  ', password: 'a-good-password' });
  assert.equal(status, 200);
  assert.equal(created.length, 1);
  const data = created[0].data;
  assert.equal(data.username, 'somchai2');
  assert.equal(data.role, 'OPERATOR');
  assert.equal(data.must_change_password, true);
  assert.ok(typeof data.password_hash === 'string' && data.password_hash.startsWith('$2'), 'ต้องเก็บแฮช bcrypt ไม่ใช่รหัสจริง');
  assert.ok(!data.password_hash.includes('a-good-password'));
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes('a-good-password'), 'ห้ามสะท้อนรหัสผ่านกลับใน response');
  assert.ok(!serialized.includes('password_hash'), 'ห้ามส่งแฮชออกไป');
});
