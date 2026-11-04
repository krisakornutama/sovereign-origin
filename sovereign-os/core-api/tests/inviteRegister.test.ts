// tests/inviteRegister.test.ts
// ── สมัครสมาชิกด้วยรหัสเชิญ (Community Edition) ────────────────────────────
// กติกาที่ล็อกไว้:
//   · รหัสเชิญเก็บเป็น hash เท่านั้น + ใช้ได้ตามจำนวนครั้งที่กำหนด
//   · รหัสที่หมดอายุ/ถูกเพิกถอน/ใช้ครบ ต้องสมัครไม่ได้ (400 ไม่ใช่สร้างบัญชี)
//   · รหัสผิดรูปแบบหรือรหัสผ่านอ่อน ต้องไม่แตะ DB ผู้ใช้
//   · สมัครสำเร็จ = ได้ token ใช้ได้ทันที + บันทึกความยินยอมขั้นจำเป็น
import './setup-env';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel, createTestServer } from './helpers';
import { prisma } from '../src/lib/prisma';
import registerRoutes, { registerLimiter } from '../src/modules/auth/register.routes';
import { createInvite, hashInviteCode, normalizeInviteCode } from '../src/services/invite.service';

type InviteRow = {
  id: string; code_hash: string; label: string | null; role: string;
  max_uses: number; use_count: number; expires_at: Date | null; revoked_at: Date | null;
  created_by: string | null; used_by: string | null; used_at: Date | null; created_at: Date;
};

let invites: Map<string, InviteRow>;
let users: any[];
let consentWrites: any[];
let seq: number;

function seedInvite(overrides: Partial<InviteRow> = {}): InviteRow {
  seq += 1;
  const row: InviteRow = {
    id: 'inv-' + seq,
    code_hash: hashInviteCode('SG-AAAA-BBBB-CCCC'),
    label: 'test',
    role: 'OPERATOR',
    max_uses: 1,
    use_count: 0,
    expires_at: null,
    revoked_at: null,
    created_by: null,
    used_by: null,
    used_at: null,
    created_at: new Date(),
    ...overrides,
  };
  invites.set(row.id, row);
  return row;
}

beforeEach(() => {
  invites = new Map();
  users = [];
  consentWrites = [];
  seq = 0;
  // limiter นับตาม IP — เทสต์ทุกตัวมาจาก 127.0.0.1 จึงต้องเคลียร์ bucket กัน 429 ปลอม
  registerLimiter.store.clear();

  mockModel(prisma as any, 'inviteCode', {
    findUnique: async ({ where }: any) => {
      if (where?.code_hash) return [...invites.values()].find((r) => r.code_hash === where.code_hash) ?? null;
      return invites.get(where?.id) ?? null;
    },
    create: async ({ data }: any) => {
      seq += 1;
      const row: InviteRow = {
        id: 'inv-' + seq, code_hash: data.code_hash, label: data.label ?? null, role: data.role ?? 'OPERATOR',
        max_uses: data.max_uses ?? 1, use_count: 0, expires_at: data.expires_at ?? null, revoked_at: null,
        created_by: data.created_by ?? null, used_by: null, used_at: null, created_at: new Date(),
      };
      invites.set(row.id, row);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const row = invites.get(where.id);
      if (!row) return { count: 0 };
      if (row.revoked_at) return { count: 0 };
      if (where.use_count?.lt !== undefined && !(row.use_count < where.use_count.lt)) return { count: 0 };
      if (row.expires_at && row.expires_at.getTime() <= Date.now()) return { count: 0 };
      row.use_count += data.use_count?.increment ?? 0;
      row.used_at = data.used_at ?? row.used_at;
      return { count: 1 };
    },
    update: async ({ where, data }: any) => {
      const row = invites.get(where.id);
      Object.assign(row ?? {}, data);
      return row;
    },
  });

  mockModel(prisma as any, 'user', {
    create: async ({ data }: any) => {
      if (users.some((u) => u.username === data.username)) {
        const err: any = new Error('Unique constraint failed on the fields: (`username`)');
        err.code = 'P2002';
        throw err;
      }
      const user = { id: 'user-' + (users.length + 1), ...data };
      users.push(user);
      return user;
    },
  });

  mockModel(prisma as any, 'userConsent', {
    upsert: async (args: any) => { consentWrites.push(args); return args; },
  });
  mockModel(prisma as any, 'consentEvent', {
    create: async (args: any) => { consentWrites.push(args); return args; },
  });
});

const BODY = { code: 'SG-AAAA-BBBB-CCCC', username: 'somchai', password: 'StrongPass2026' };

test('createInvite เก็บเฉพาะ hash และคืนรหัสรูปแบบอ่านง่ายครั้งเดียว', async () => {
  const created = await createInvite({ role: 'OPERATOR', maxUses: 2, expiresInHours: 24 });
  assert.match(created.code, /^SG-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const rows = [...invites.values()];
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].code_hash, created.code, 'ต้องไม่เก็บ plaintext');
  assert.equal(rows[0].code_hash, hashInviteCode(created.code));
  assert.equal(rows[0].max_uses, 2);
  assert.ok(rows[0].expires_at instanceof Date);
});

test('registerCheck บอกว่าใช้ได้พร้อมบทบาทและจำนวนสิทธิ์ที่เหลือ', async () => {
  seedInvite({ role: 'NODE_ADMIN', max_uses: 3 });
  const server = await createTestServer((app) => app.use('/api/auth', registerRoutes));
  try {
    const res = await fetch(server.baseUrl + '/api/auth/register/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'sg aaaa bbbb cccc' }),
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.valid, true);
    assert.equal(body.role, 'NODE_ADMIN');
    assert.equal(body.usesLeft, 3);
  } finally {
    await server.close();
  }
});

test('รหัสผิด/ไม่มีอยู่ → check ตอบ 400 INVALID_CODE', async () => {
  const server = await createTestServer((app) => app.use('/api/auth', registerRoutes));
  try {
    const res = await fetch(server.baseUrl + '/api/auth/register/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SG-WRNG-WRNG-WRNG' }),
    });
    assert.equal(res.status, 400);
    const body: any = await res.json();
    assert.equal(body.reason, 'INVALID_CODE');
  } finally {
    await server.close();
  }
});

test('สมัครสำเร็จ: ได้ token, role ตามรหัส, บันทึก consent essential, รหัสถูกใช้', async () => {
  seedInvite();
  const server = await createTestServer((app) => app.use('/api/auth', registerRoutes));
  try {
    const res = await fetch(server.baseUrl + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BODY),
    });
    assert.equal(res.status, 201);
    const body: any = await res.json();
    assert.equal(typeof body.token, 'string');
    assert.ok(body.token.split('.').length === 3, 'ต้องเป็น JWT');
    assert.equal(body.user.username, 'somchai');
    assert.equal(body.user.role, 'OPERATOR');
    assert.equal(users.length, 1);
    assert.notEqual(users[0].password_hash, BODY.password, 'ต้องเก็บเป็น hash');
    assert.equal(users[0].must_change_password, false);

    const row = [...invites.values()][0];
    assert.equal(row.use_count, 1);
    assert.ok(row.used_by, 'ต้องบันทึกว่าใครใช้');

    const essential = consentWrites.find((c) => c?.where?.user_id_purpose?.purpose === 'essential');
    assert.ok(essential, 'ต้องบันทึกความยินยอมขั้นจำเป็น ณ เวลาสมัคร');
    assert.equal(essential.create.granted, true);
  } finally {
    await server.close();
  }
});

test('รหัสใช้ครั้งเดียว: สมัครซ้ำด้วยรหัสเดิมไม่ได้', async () => {
  seedInvite();
  const server = await createTestServer((app) => app.use('/api/auth', registerRoutes));
  try {
    const first = await fetch(server.baseUrl + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(BODY),
    });
    assert.equal(first.status, 201);
    const second = await fetch(server.baseUrl + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BODY, username: 'someone-else' }),
    });
    assert.equal(second.status, 400);
    const body: any = await second.json();
    assert.equal(body.code, 'INVALID_CODE');
    assert.equal(users.length, 1, 'ต้องไม่สร้างบัญชีที่สอง');
  } finally {
    await server.close();
  }
});

test('รหัสที่หมดอายุแล้วสมัครไม่ได้', async () => {
  seedInvite({ expires_at: new Date(Date.now() - 60_000) });
  const server = await createTestServer((app) => app.use('/api/auth', registerRoutes));
  try {
    const res = await fetch(server.baseUrl + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(BODY),
    });
    assert.equal(res.status, 400);
    assert.equal(users.length, 0);
  } finally {
    await server.close();
  }
});

test('รหัสที่ถูกเพิกถอนแล้วสมัครไม่ได้', async () => {
  seedInvite({ revoked_at: new Date() });
  const server = await createTestServer((app) => app.use('/api/auth', registerRoutes));
  try {
    const res = await fetch(server.baseUrl + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(BODY),
    });
    assert.equal(res.status, 400);
    assert.equal(users.length, 0);
  } finally {
    await server.close();
  }
});

test('รหัสผ่านอ่อน/สั้นเกิน ต้องไม่สร้างบัญชี', async () => {
  seedInvite();
  const server = await createTestServer((app) => app.use('/api/auth', registerRoutes));
  try {
    for (const password of ['short', 'password123']) {
      const res = await fetch(server.baseUrl + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...BODY, password }),
      });
      assert.equal(res.status, 400, 'รหัส ' + password + ' ต้องถูกปฏิเสธ');
      const body: any = await res.json();
      assert.equal(body.code, 'WEAK_PASSWORD');
    }
    assert.equal(users.length, 0);
    assert.equal([...invites.values()][0].use_count, 0, 'รหัสต้องไม่ถูกกินเมื่อสมัครไม่สำเร็จ');
  } finally {
    await server.close();
  }
});

test('ชื่อผู้ใช้ผิดรูปแบบถูกปฏิเสธก่อนแตะ DB', async () => {
  seedInvite();
  const server = await createTestServer((app) => app.use('/api/auth', registerRoutes));
  try {
    const res = await fetch(server.baseUrl + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BODY, username: 'มีช่องว่าง ไม่ได้' }),
    });
    assert.equal(res.status, 400);
    const body: any = await res.json();
    assert.equal(body.code, 'INVALID_USERNAME');
    assert.equal(users.length, 0);
  } finally {
    await server.close();
  }
});

test('ชื่อผู้ใช้ซ้ำ → 409 USERNAME_TAKEN', async () => {
  seedInvite({ max_uses: 2 });
  const server = await createTestServer((app) => app.use('/api/auth', registerRoutes));
  try {
    const first = await fetch(server.baseUrl + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(BODY),
    });
    assert.equal(first.status, 201);
    const dup = await fetch(server.baseUrl + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(BODY),
    });
    assert.equal(dup.status, 409);
    const body: any = await dup.json();
    assert.equal(body.code, 'USERNAME_TAKEN');
  } finally {
    await server.close();
  }
});

test('normalizeInviteCode รับรหัสที่ผู้ใช้พิมพ์ติดขีด/เว้นวรรค/ตัวเล็ก', () => {
  assert.equal(normalizeInviteCode(' sg-aaaa-bbbb-cccc '), 'SGAAAABBBBCCCC');
  assert.equal(normalizeInviteCode(null), '');
});
