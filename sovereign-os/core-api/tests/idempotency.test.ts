import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel, createTestServer } from './helpers';
import { prisma } from '../src/lib/prisma';
import {
  beginIdempotent,
  completeIdempotent,
  fingerprintRequest,
  isMissingTableError,
  isValidIdempotencyKey,
  readIdempotencyKey,
  releaseIdempotent,
} from '../src/services/idempotency.service';
import { idempotent } from '../src/middleware/idempotency.middleware';

// ── in-memory Prisma delegate ────────────────────────────────────────────────
// ทำไมไม่ใช้ DB จริง: เทสต์ชุดนี้ต้องรันได้ทุกเครื่อง/ทุก CI (ไม่มี DB ก็ต้องผ่าน)
// และพฤติกรรมที่สำคัญ (unique ชน, lease หมดอายุ) จำลองได้ตรงและชัดกว่าการรอ DB จริง
type Row = {
  id: string;
  scope: string;
  key: string;
  fingerprint: string;
  status: string;
  responseCode: number | null;
  responseBody: unknown;
  userId: string | null;
  createdAt: Date;
  expiresAt: Date;
};

let rows: Row[] = [];
let seq = 0;
const dupError = () => Object.assign(new Error('Unique constraint failed on the fields: (`scope`,`key`)'), { code: 'P2002' });

function installStore() {
  rows = [];
  seq = 0;
  mockModel(prisma as any, 'idempotencyKey', {
    create: async ({ data }: any) => {
      if (rows.some((r) => r.scope === data.scope && r.key === data.key)) throw dupError();
      const row: Row = {
        id: `ik-${++seq}`,
        scope: data.scope,
        key: data.key,
        fingerprint: data.fingerprint,
        status: data.status ?? 'in_flight',
        responseCode: data.responseCode ?? null,
        responseBody: data.responseBody ?? null,
        userId: data.userId ?? null,
        createdAt: data.createdAt ?? new Date(),
        expiresAt: data.expiresAt,
      };
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }: any) => {
      const { scope, key } = where?.scope_key ?? {};
      return rows.find((r) => r.scope === scope && r.key === key) ?? null;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i < 0) throw Object.assign(new Error('not found'), { code: 'P2025' });
      return rows.splice(i, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      const before = rows.length;
      rows = rows.filter((r) => !(where?.id && r.id === where.id));
      return { count: before - rows.length };
    },
  } as any);
}

beforeEach(installStore);

describe('idempotency - header + key validation', () => {
  test('อ่านคีย์ได้ทั้ง Idempotency-Key และ x-idempotency-key', () => {
    assert.equal(readIdempotencyKey({ 'idempotency-key': 'abc12345' }), 'abc12345');
    assert.equal(readIdempotencyKey({ 'x-idempotency-key': 'def12345' }), 'def12345');
    assert.equal(readIdempotencyKey({}), null);
    assert.equal(readIdempotencyKey({ 'idempotency-key': '   ' }), null);
  });

  test('คีย์ที่ frontend สร้าง (idem-<uuid> / idem-<base36>-<base36>) ต้องใช้ได้', () => {
    // สัญญาข้ามชั้น: sovereign-frontend/src/lib/requestId.ts → newIdempotencyKey()
    assert.equal(isValidIdempotencyKey('idem-9f1c2a7e-4b3d-4c5e-8a6b-1d2e3f4a5b6c'), true);
    assert.equal(isValidIdempotencyKey('idem-lq3k9z-1a2b3c4d5e'), true);
  });

  test('คีย์ที่รับได้: 8-200 ตัว A-Z a-z 0-9 . _ : - เท่านั้น', () => {
    assert.equal(isValidIdempotencyKey('a'.repeat(8)), true);
    assert.equal(isValidIdempotencyKey('a'.repeat(200)), true);
    assert.equal(isValidIdempotencyKey('a'.repeat(7)), false, 'สั้นเกินไป');
    assert.equal(isValidIdempotencyKey('a'.repeat(201)), false, 'ยาวเกินไป');
    assert.equal(isValidIdempotencyKey('มีช่องว่าง'), false, 'ห้ามมีอักขระนอกชุด');
    assert.equal(isValidIdempotencyKey('abc/../../etc'), false, 'path traversal ต้องไม่ผ่าน');
    assert.equal(isValidIdempotencyKey('abc def1234'), false);
  });
});

describe('idempotency - fingerprint', () => {
  test('payload เดียวกันแต่สลับลำดับ key = hash เดียวกัน', () => {
    const a = fingerprintRequest({ userId: 'u1', method: 'POST', path: '/api/x', body: { a: 1, b: 2 } });
    const b = fingerprintRequest({ userId: 'u1', method: 'POST', path: '/api/x', body: { b: 2, a: 1 } });
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  test('body/ผู้ใช้/พาธ ต่าง = hash ต่าง', () => {
    const base = { userId: 'u1', method: 'POST', path: '/api/x', body: { a: 1 } };
    const h = fingerprintRequest(base);
    assert.notEqual(h, fingerprintRequest({ ...base, body: { a: 2 } }));
    assert.notEqual(h, fingerprintRequest({ ...base, userId: 'u2' }));
    assert.notEqual(h, fingerprintRequest({ ...base, path: '/api/y' }));
    assert.notEqual(h, fingerprintRequest({ ...base, method: 'PUT' }));
  });
});

describe('idempotency - begin/complete/release', () => {
  const T0 = new Date('2026-10-27T00:00:00Z');
  const key = 'key-00000001';

  test('ครั้งแรก = started + สร้าง in_flight พร้อม lease สั้น (ไม่ใช่ TTL ยาว)', async () => {
    const r = await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f1', userId: 'u1', now: T0 });
    assert.equal(r.state, 'started');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'in_flight');
    assert.equal(rows[0].userId, 'u1');
    assert.equal(rows[0].expiresAt.toISOString(), new Date(T0.getTime() + 60_000).toISOString());
  });

  test('คีย์เดิม + payload เดิมหลังทำเสร็จ = replay ผลเดิม (ไม่รันซ้ำ)', async () => {
    const first = await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f1', userId: 'u1', now: T0 });
    assert.equal(first.state, 'started');
    if (first.state !== 'started') return;
    await completeIdempotent(first.id, 201, { id: 'order-1' }, { now: T0, ttlSec: 3600 });

    const again = await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f1', userId: 'u1', now: T0 });
    assert.equal(again.state, 'replay');
    if (again.state !== 'replay') return;
    assert.equal(again.statusCode, 201);
    assert.deepEqual(again.body, { id: 'order-1' });
  });

  test('คีย์เดิม + payload ต่าง = conflict (payload)', async () => {
    await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f1', userId: 'u1', now: T0 });
    const again = await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f2', userId: 'u1', now: T0 });
    assert.equal(again.state, 'conflict');
    if (again.state !== 'conflict') return;
    assert.equal(again.reason, 'payload');
  });

  test('คีย์ซ้ำแต่คนละผู้ใช้ = conflict (owner) และไม่คืน body ของคนอื่น', async () => {
    const first = await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f1', userId: 'u1', now: T0 });
    if (first.state !== 'started') return assert.fail('ต้อง started');
    await completeIdempotent(first.id, 201, { secret: 'ของคนอื่น' }, { now: T0 });

    const again = await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f1', userId: 'u2', now: T0 });
    assert.equal(again.state, 'conflict');
    if (again.state !== 'conflict') return;
    assert.equal(again.reason, 'owner');
  });

  test('คำขอแรกยังทำงานอยู่ = pending พร้อม Retry-After', async () => {
    await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f1', userId: 'u1', now: T0 });
    const again = await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f1', userId: 'u1', now: new Date(T0.getTime() + 5_000) });
    assert.equal(again.state, 'pending');
    if (again.state !== 'pending') return;
    assert.ok(again.retryAfterSec >= 1 && again.retryAfterSec <= 60, `retryAfter ผิด: ${again.retryAfterSec}`);
  });

  test('lease หมดอายุ (คำขอแรกตาย) = ทำงานต่อได้ด้วยคีย์เดิม', async () => {
    await beginIdempotent({ scope: 'business.order', key, fingerprint: 'f1', userId: 'u1', now: T0 });
    const takeOver = await beginIdempotent({
      scope: 'business.order',
      key,
      fingerprint: 'f1',
      userId: 'u1',
      now: new Date(T0.getTime() + 61_000),
    });
    assert.equal(takeOver.state, 'started');
    assert.equal(rows.length, 1, 'ต้องใช้แถวเดิม ไม่สร้างซ้ำ');
  });

  test('บันทึกผลสำเร็จแล้ว TTL ยาว (ค่าเริ่มต้น 24 ชม.)', async () => {
    const first = await beginIdempotent({ scope: 'restaurant.order', key, fingerprint: 'f1', userId: null, now: T0 });
    if (first.state !== 'started') return assert.fail('ต้อง started');
    await completeIdempotent(first.id, 201, { id: 'o-1' }, { now: T0 });
    assert.equal(rows[0].status, 'done');
    assert.equal(rows[0].responseCode, 201);
    assert.equal(rows[0].expiresAt.toISOString(), new Date(T0.getTime() + 24 * 3600_000).toISOString());
  });

  test('release ลบแถวทิ้ง (คำขอที่ล้มเหลวต้องลองใหม่ได้)', async () => {
    const first = await beginIdempotent({ scope: 'restaurant.order', key, fingerprint: 'f1', now: T0 });
    if (first.state !== 'started') return assert.fail('ต้อง started');
    await releaseIdempotent(first.id);
    assert.equal(rows.length, 0);
    const retry = await beginIdempotent({ scope: 'restaurant.order', key, fingerprint: 'f1', now: T0 });
    assert.equal(retry.state, 'started');
  });

  test('P2021 = ตารางยังไม่ถูกสร้าง (ต้องแยกออกจาก DB ล่ม)', () => {
    assert.equal(isMissingTableError(Object.assign(new Error('x'), { code: 'P2021' })), true);
    assert.equal(isMissingTableError(Object.assign(new Error('x'), { code: 'P1001' })), false);
    assert.equal(isMissingTableError(new Error('boom')), false);
  });
});

// ── middleware บน HTTP จริง (express + fetch) ─────────────────────────────────
describe('idempotency - middleware', () => {
  const KEY = 'route-key-0001';

  type Counters = { handler: number; bodies: unknown[] };
  let counters: Counters;

  function appWith(handler: (req: any, res: any) => void) {
    return (app: import('express').Express) => {
      app.use((req, _res, next) => {
        (req as any).user = { userId: 'u-1' };
        next();
      });
      const express = require('express') as typeof import('express');
      const router = express.Router();
      router.post('/orders', idempotent('test.order'), handler);
      app.use('/api/test', router);
    };
  }

  const post = (baseUrl: string, body: unknown, key: string | null = KEY, path = '/api/test/orders') =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'x-idempotency-key': key } : {}) },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    counters = { handler: 0, bodies: [] };
  });

  test('ไม่มีคีย์ = ผ่านปกติ ไม่แตะตาราง idempotency เลย', async () => {
    const srv = await createTestServer(appWith((_req, res) => {
      counters.handler++;
      res.status(201).json({ ok: true });
    }));
    try {
      const res = await post(srv.baseUrl, { a: 1 }, null);
      assert.equal(res.status, 201);
      assert.equal(counters.handler, 1);
      assert.equal(rows.length, 0, 'ไม่มีคีย์ต้องไม่เขียนตาราง');
    } finally {
      await srv.close();
    }
  });

  test('คีย์เดิมส่งซ้ำ = handler รันครั้งเดียว และได้ผลเดิมพร้อมหัว Idempotency-Replayed', async () => {
    const srv = await createTestServer(appWith((req, res) => {
      counters.handler++;
      counters.bodies.push(req.body);
      res.status(201).json({ orderId: 'o-1', n: counters.handler });
    }));
    try {
      const first = await post(srv.baseUrl, { a: 1 });
      assert.equal(first.status, 201);
      const firstBody = await first.json();

      const second = await post(srv.baseUrl, { a: 1 });
      assert.equal(second.status, 201);
      assert.equal(second.headers.get('idempotency-replayed'), 'true');
      assert.deepEqual(await second.json(), firstBody, 'ต้องได้ผลเดิม ไม่ใช่ผลใหม่');
      assert.equal(counters.handler, 1, 'ห้ามรัน handler ซ้ำ');
    } finally {
      await srv.close();
    }
  });

  test('คีย์เดิมแต่ body ต่าง = 409 IDEMPOTENCY_CONFLICT และไม่รัน handler', async () => {
    const srv = await createTestServer(appWith((_req, res) => {
      counters.handler++;
      res.status(201).json({ ok: true });
    }));
    try {
      await post(srv.baseUrl, { a: 1 });
      const bad = await post(srv.baseUrl, { a: 2 });
      assert.equal(bad.status, 409);
      assert.equal((await bad.json()).code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(counters.handler, 1);
    } finally {
      await srv.close();
    }
  });

  test('คีย์ผิดรูปแบบ = 400 ก่อนแตะธุรกิจ', async () => {
    const srv = await createTestServer(appWith((_req, res) => {
      counters.handler++;
      res.status(201).json({ ok: true });
    }));
    try {
      const res = await post(srv.baseUrl, { a: 1 }, 'bad key!');
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, 'IDEMPOTENCY_INVALID_KEY');
      assert.equal(counters.handler, 0);
    } finally {
      await srv.close();
    }
  });

  test('handler ตอบ 4xx/5xx = ไม่แคชผล (แก้แล้วลองใหม่ได้)', async () => {
    let fail = true;
    const srv = await createTestServer(appWith((_req, res) => {
      counters.handler++;
      if (fail) return res.status(500).json({ error: 'boom' });
      res.status(201).json({ ok: true });
    }));
    try {
      const first = await post(srv.baseUrl, { a: 1 });
      assert.equal(first.status, 500);
      fail = false;
      const retry = await post(srv.baseUrl, { a: 1 });
      assert.equal(retry.status, 201, 'คำขอที่ล้มเหลวต้องลองใหม่ได้');
      assert.equal(counters.handler, 2);
    } finally {
      await srv.close();
    }
  });

  test('คำขอแรกยังไม่จบ = 409 IDEMPOTENCY_IN_PROGRESS + Retry-After', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const srv = await createTestServer(appWith(async (_req, res) => {
      counters.handler++;
      await gate;
      res.status(201).json({ ok: true });
    }));
    try {
      const first = post(srv.baseUrl, { a: 1 });
      // รอให้แถว in_flight ถูกสร้างจริงก่อนยิงซ้ำ
      for (let i = 0; i < 50 && rows.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
      const second = await post(srv.baseUrl, { a: 1 });
      assert.equal(second.status, 409);
      assert.equal((await second.json()).code, 'IDEMPOTENCY_IN_PROGRESS');
      assert.ok(Number(second.headers.get('retry-after')) >= 1);
      release?.();
      assert.equal((await first).status, 201);
    } finally {
      release?.();
      await srv.close();
    }
  });

  test('ตารางยังไม่ถูกสร้าง (P2021) = fail-open ทำงานต่อได้ ไม่ทำให้ระบบล่ม', async () => {
    mockModel(prisma as any, 'idempotencyKey', {
      create: async () => {
        throw Object.assign(new Error('The table `idempotency_keys` does not exist'), { code: 'P2021' });
      },
    } as any);
    const srv = await createTestServer(appWith((_req, res) => {
      counters.handler++;
      res.status(201).json({ ok: true });
    }));
    try {
      const res = await post(srv.baseUrl, { a: 1 });
      assert.equal(res.status, 201, 'ก่อน migrate ต้องยังใช้งานได้');
      assert.equal(counters.handler, 1);
    } finally {
      await srv.close();
    }
  });

  test('ฐานข้อมูลล่ม (ไม่ใช่ตารางหาย) = 503 ไม่ปล่อยให้ทำงานซ้ำแบบไม่มีการป้องกัน', async () => {
    mockModel(prisma as any, 'idempotencyKey', {
      create: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'P1001' });
      },
    } as any);
    const srv = await createTestServer(appWith((_req, res) => {
      counters.handler++;
      res.status(201).json({ ok: true });
    }));
    try {
      const res = await post(srv.baseUrl, { a: 1 });
      assert.equal(res.status, 503);
      assert.equal((await res.json()).code, 'IDEMPOTENCY_UNAVAILABLE');
      assert.equal(counters.handler, 0);
    } finally {
      await srv.close();
    }
  });
});
