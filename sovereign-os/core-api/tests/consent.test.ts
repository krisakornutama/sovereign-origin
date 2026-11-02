// tests/consent.test.ts
//
// ── ความยินยอม (PDPA) + สิทธิ์ลบข้อมูล ──────────────────────────────────────
// เป้าหมาย: เก็บข้อมูลลูกค้าจริงได้อย่างถูกกฎหมาย และผู้ใช้ลบบัญชีตัวเองได้
// กติกาที่เทสต์นี้ล็อก:
//   · วัตถุประสงค์ "จำเป็นต่อบริการ" ปิดไม่ได้ (แต่ยังแสดงให้เห็น)
//   · วัตถุประสงค์ที่ไม่รู้จัก = 400 ไม่ใช่บันทึกมั่ว
//   · ทุกการเปลี่ยนความยินยอมต้องมี event หลักฐาน
//   · ลบบัญชี = anonymize (ไม่ลบแถว user) เพราะ audit ต้องอ้างอิงผู้กระทำได้
//   · บัญชี SUPERADMIN คนสุดท้ายลบตัวเองไม่ได้
import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { mockModel, createTestServer, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';

const USER_ID = '11111111-1111-4111-8111-111111111111';

interface FakeState {
  consents: Map<string, any>;
  events: any[];
  user: any;
  userUpdates: any[];
  audit: any[];
  superadminCount: number;
}

let state: FakeState;

function mockConsentModels() {
  mockModel(prisma as any, 'userConsent', {
    findMany: async () => [...state.consents.values()],
    findUnique: async (args: any) => {
      const { user_id, purpose } = args?.where?.user_id_purpose ?? {};
      return state.consents.get(`${user_id}:${purpose}`) ?? null;
    },
    upsert: async (args: any) => {
      const key = `${args.where.user_id_purpose.user_id}:${args.where.user_id_purpose.purpose}`;
      const row = { id: 'c-1', ...args.create, ...args.update, updated_at: new Date() };
      state.consents.set(key, row);
      return row;
    },
  } as any);

  mockModel(prisma as any, 'consentEvent', {
    create: async (args: any) => {
      const row = { id: `e-${state.events.length + 1}`, created_at: new Date(), ...args.data };
      state.events.push(row);
      return row;
    },
    findMany: async () => state.events,
  } as any);

  mockModel(prisma as any, 'user', {
    findUnique: async () => state.user,
    count: async () => state.superadminCount,
    update: async (args: any) => {
      state.userUpdates.push(args.data);
      return { ...state.user, ...args.data };
    },
  } as any);

  mockModel(prisma as any, 'auditLog', {
    create: async (args: any) => {
      state.audit.push(args.data);
      return { id: 'a-1' };
    },
  } as any);
}

function loadRouter() {
  const mod = require('../src/modules/consent/consent.routes');
  return mod.default;
}

beforeEach(async () => {
  state = {
    consents: new Map(),
    events: [],
    user: {
      id: USER_ID,
      username: 'owner',
      role: 'SUPERADMIN',
      password_hash: await bcrypt.hash('correct-horse', 4),
      mfa_secret: 'JBSWY3DPEHPK3PXP',
      pending_mfa_secret: null,
      mfa_backup_hash: '["abc"]',
      token_version: 0,
    },
    userUpdates: [],
    audit: [],
    superadminCount: 2,
  };
  mockConsentModels();
});

async function withServer(fn: (base: string) => Promise<void>) {
  const router = loadRouter();
  const srv = await createTestServer((app) => app.use('/api/consent', router));
  try {
    await fn(srv.baseUrl);
  } finally {
    await srv.close();
  }
}

describe('consent — GET /api/consent', () => {
  test('คืนวัตถุประสงค์ครบ และ "จำเป็นต่อบริการ" เปิดอยู่เสมอ', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;
      assert.ok(Array.isArray(body.purposes));
      assert.ok(body.purposes.length >= 5, 'ต้องมีวัตถุประสงค์ครบชุด');
      const essential = body.purposes.find((p: any) => p.key === 'essential');
      assert.equal(essential.required, true);
      assert.equal(essential.granted, true, 'จำเป็นต่อบริการต้องเปิดเสมอ');
      const marketing = body.purposes.find((p: any) => p.key === 'marketing');
      assert.equal(marketing.granted, false, 'ยังไม่ให้ความยินยอม = ปิด');
      assert.ok(body.policyVersion, 'ต้องบอกเวอร์ชันนโยบายที่ใช้อยู่');
    });
  });

  test('ไม่ล็อกอิน = 401', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent`);
      assert.equal(res.status, 401);
    });
  });
});

describe('consent — PUT /api/consent', () => {
  test('วัตถุประสงค์ที่ไม่รู้จัก = 400', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ purpose: 'sell-everything', granted: true }),
      });
      assert.equal(res.status, 400);
    });
  });

  test('ปิดวัตถุประสงค์จำเป็น = 409 (ปิดไม่ได้)', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ purpose: 'essential', granted: false }),
      });
      assert.equal(res.status, 409);
    });
  });

  test('ให้ความยินยอมการตลาด = บันทึก + เขียน event หลักฐาน', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ purpose: 'marketing', granted: true }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;
      assert.equal(body.purpose, 'marketing');
      assert.equal(body.granted, true);
      assert.equal(state.events.length, 1, 'ต้องมี event หนึ่งรายการ');
      assert.equal(state.events[0].action, 'granted');
      assert.equal(state.events[0].user_id, USER_ID);
    });
  });

  test('ถอนความยินยอม = event action revoked', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ purpose: 'analytics', granted: false }),
      });
      assert.equal(res.status, 200);
      assert.equal(state.events[0].action, 'revoked');
    });
  });
});

describe('consent — DELETE /api/consent/account (สิทธิ์ลบข้อมูล)', () => {
  test('รหัสผ่านผิด = 401', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent/account`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ password: 'wrong', confirm: 'DELETE' }),
      });
      assert.equal(res.status, 401);
    });
  });

  test('ไม่ยืนยันคำ = 400', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent/account`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ password: 'correct-horse', confirm: 'maybe' }),
      });
      assert.equal(res.status, 400);
    });
  });

  test('SUPERADMIN คนสุดท้ายลบตัวเองไม่ได้ = 409', async () => {
    state.superadminCount = 1;
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent/account`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ password: 'correct-horse', confirm: 'DELETE' }),
      });
      assert.equal(res.status, 409);
      assert.equal(state.userUpdates.length, 0, 'ห้ามแตะบัญชีเมื่อยังเป็นผู้ดูแลคนสุดท้าย');
    });
  });

  test('ลบสำเร็จ = anonymize: เปลี่ยนชื่อ, เคลียร์ MFA, bump token, ไม่ลบแถว user', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/consent/account`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ password: 'correct-horse', confirm: 'DELETE' }),
      });
      assert.equal(res.status, 200);
      const patch = state.userUpdates[0];
      assert.ok(patch, 'ต้องมีการอัปเดตผู้ใช้');
      assert.match(String(patch.username), /^deleted-/, 'ชื่อผู้ใช้ต้องถูกทำให้ไม่ระบุตัวตนได้');
      assert.equal(patch.mfa_secret, null);
      assert.equal(patch.pending_mfa_secret, null);
      assert.equal(patch.mfa_backup_hash, null);
      assert.equal(patch.token_version, 1, 'token ทุกใบต้องตายทันที');
      assert.ok(patch.deleted_at instanceof Date, 'ต้องบันทึกเวลาลบไว้ตรวจสอบ');
      assert.equal(state.audit.length, 1, 'ต้องลง audit หนึ่งรายการ');
      assert.equal(state.audit[0].actionType ?? state.audit[0].action_type, 'ACCOUNT_SELF_DELETED');
    });
  });
});
