import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel, createTestServer, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';
import { hashToken } from '../src/services/agent-machines.service';
import { __resetAlertPhoneCache } from '../src/services/orchestrator-alert-phone.service';

const calls: { method: string; url: string; body?: any; token?: string }[] = [];

const phoneStore: Record<string, string> = {};

function mockPhoneStore() {
  __resetAlertPhoneCache();
  mockModel(prisma as any, 'systemSetting', {
    findUnique: async (args: any) =>
      args?.where?.key in phoneStore ? { key: args.where.key, value: phoneStore[args.where.key] } : null,
    upsert: async (args: any) => {
      phoneStore[args.where.key] = args.update?.value ?? args.create?.value;
      return { key: args.where.key, value: phoneStore[args.where.key] };
    },
    deleteMany: async (args: any) => {
      for (const k of args?.where?.key?.in ?? []) delete phoneStore[k];
      return { count: 1 };
    },
  } as any);
}

function loadRouter() {
  // โหลดสดเพื่อให้ mockModel ของ mockModel ชนิดของแต่ละเทสต์มีผล
  const mod = require('../src/modules/agent-machines/agent-machines.routes');
  return mod.default;
}

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(phoneStore)) delete phoneStore[k];
  mockPhoneStore();
  // mock ทุก method ที่ router จะแตะ เพื่อไม่ให้หลุดไปโดน DB จริง
  mockModel(prisma as any, 'agentMachine', {
    create: async (args: any) => ({ id: 'm-1', name: 'runner-a', ...args.data }),
    findUnique: async () => ({ id: 'm-1', name: 'runner-a', status: 'offline', capabilities: ['opencode'], executors: ['opencode'] }),
    findFirst: async () => ({ id: 'm-1', name: 'runner-a', status: 'online', capabilities: ['opencode'], executors: ['opencode'] }),
    findMany: async () => [{ id: 'm-1', name: 'runner-a', status: 'online' }],
    update: async (args: any) => ({ id: 'm-1', ...args.data }),
  });
  mockModel(prisma as any, 'agentJob', {
    create: async (args: any) => ({ id: 'j-1', ...args.data }),
    findMany: async () => [],
    update: async (args: any) => ({ ...args.data, id: args.where.id }),
  });
});

describe('agent-machines routes — register (ผู้ใช้ผ่านหน้าเว็บ)', () => {
  test('POST /register คืน token เมื่อยืนยันตัวตนแล้ว', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ name: 'คอมเครื่องที่ 2', capabilities: ['opencode'] }),
      });
      assert.equal(res.status, 201);
      const body = await res.json() as any;
      assert.ok(body.token, 'ต้องคืน token ให้ผู้ใช้เอาไปใส่ในเครื่องนั้น');
      assert.equal(body.machine.name, 'คอมเครื่องที่ 2');
    } finally {
      await srv.close();
    }
  });

  test('POST /register ปฏิเสธเมื่อไม่มีสิทธิ์ (401)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      });
      assert.equal(res.status, 401);
    } finally {
      await srv.close();
    }
  });
});

describe('agent-machines routes — runner endpoints ใช้ machine token', () => {
  test('POST /heartbeat ไม่ยอมรับผู้ไม่มี token (401)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 401);
    } finally {
      await srv.close();
    }
  });

  test('GET /jobs/pull คืนงานเป็น array เมื่อ machine token ถูกต้อง', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/jobs/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-machine-token': 'valid-token' },
        body: JSON.stringify({ limit: 2 }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.ok(Array.isArray(body.jobs));
    } finally {
      await srv.close();
    }
  });

  test('POST /jobs/:id/result บันทึกผลได้เมื่อ machine token ถูกต้อง', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/jobs/j-1/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-machine-token': 'valid-token' },
        body: JSON.stringify({ status: 'done', result: 'เสร็จ', exitCode: 0 }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.job.status, 'done');
    } finally {
      await srv.close();
    }
  });

  test('authenticateMachineToken ตรวจ hash ถูกต้อง (pure unit)', () => {
    const h = hashToken('abc');
    assert.match(h, /^[a-f0-9]{64}$/);
    assert.notEqual(h, hashToken('abd'));
  });
});

// red-first: ก่อนมี route นี้ ผู้ใช้เปิดสวิตช์โทรแล้วไม่มีที่กรอกเบอร์
// (บอทไม่มีเบอร์ให้โทร = ระบบโทรเปิดอยู่แต่ใช้ไม่ได้จริง)
describe('agent-machines routes — ตั้งเบอร์โทร', () => {
  test('GET /call-status ต้องบอกว่ามีเบอร์แล้วหรือยัง (ไม่คืนเบอร์เต็มกลับมา)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/call-status`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.hasPhone, false, 'ยังไม่ได้ตั้งเบอร์ต้องบอกตรง ๆ ไม่ใช่ปล่อยให้เดา');
    } finally {
      await srv.close();
    }
  });

  test('PUT /call-phone ต้องบันทึกเบอร์ E.164 และคืนกลับแบบ mask', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/call-phone`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ phone: '+66812345678' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.hasPhone, true);
      assert.ok(!JSON.stringify(body).includes('66812345678'), 'เบอร์เต็มต้องไม่หลุดกลับไป UI');
      assert.match(body.phoneMasked, /…/);
    } finally {
      await srv.close();
    }
  });

  test('PUT /call-phone ปฏิเสธเบอร์ที่ไม่ใช่ E.164 และไม่บันทึกลง DB', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      for (const bad of ['0812345678', '66812345678', '+6681', '']) {
        const res = await fetch(`${srv.baseUrl}/api/agent-machines/call-phone`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
          body: JSON.stringify({ phone: bad }),
        });
        assert.equal(res.status, 400, `ต้องปฏิเสธ: ${JSON.stringify(bad)}`);
      }
      assert.equal(Object.keys(phoneStore).length, 0, 'เบอร์ผิดต้องไม่เขียนลง DB แม้แต่ครั้งเดียว');
    } finally {
      await srv.close();
    }
  });

  test('DELETE /call-phone ล้างเบอร์แล้วรายงานว่ายังไม่มี', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      await fetch(`${srv.baseUrl}/api/agent-machines/call-phone`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ phone: '+66812345678' }),
      });
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/call-phone`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.hasPhone, false);
    } finally {
      await srv.close();
    }
  });

  test('POST /call-test ไม่โทรเมื่อยังไม่ได้ตั้งเบอร์ (400 + บอกทางแก้)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/call-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: '{}',
      });
      assert.equal(res.status, 400, 'ไม่มีเบอร์ต้องบอกตรง ๆ ไม่ใช่ยิงไปหาปลายทางว่าง');
      const body = await res.json() as any;
      assert.match(String(body.error), /เบอร์/);
    } finally {
      await srv.close();
    }
  });

  test('POST /call-test ยิงผ่าน placeCall จริง (ไม่ throw แม้ provider ปิด)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      await fetch(`${srv.baseUrl}/api/agent-machines/call-phone`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ phone: '+66812345678' }),
      });
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/call-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: '{}',
      });
      assert.equal(res.status, 200, 'provider ปิด = ตั้งใจข้าม (skipped) ไม่ใช่ 500');
      const body = await res.json() as any;
      assert.equal(typeof body.ok, 'boolean');
      assert.ok(body.provider, 'ต้องรายงานว่าใช้ provider ไหน');
      assert.ok(body.reason, 'ต้องบอกเหตุผลเมื่อยังโทรไม่ออก');
      assert.ok(!JSON.stringify(body).includes('66812345678'), 'เบอร์เต็มต้องไม่หลุดกลับไป UI');
    } finally {
      await srv.close();
    }
  });

  test('POST /call-test ต้องมีสิทธิ์ SUPERADMIN (401/403)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const noAuth = await fetch(`${srv.baseUrl}/api/agent-machines/call-test`, { method: 'POST', body: '{}' });
      assert.equal(noAuth.status, 401);
      const wrongRole = await fetch(`${srv.baseUrl}/api/agent-machines/call-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('VIEWER')}` },
        body: '{}',
      });
      assert.equal(wrongRole.status, 403);
    } finally {
      await srv.close();
    }
  });

  test('ตั้งเบอร์ต้องมีสิทธิ์ SUPERADMIN (401/403 เมื่อไม่ใช่)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const noAuth = await fetch(`${srv.baseUrl}/api/agent-machines/call-phone`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '+66812345678' }),
      });
      assert.equal(noAuth.status, 401);
      const wrongRole = await fetch(`${srv.baseUrl}/api/agent-machines/call-phone`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('VIEWER')}` },
        body: JSON.stringify({ phone: '+66812345678' }),
      });
      assert.equal(wrongRole.status, 403);
      assert.equal(Object.keys(phoneStore).length, 0, 'คนไม่มีสิทธิ์ห้ามเขียนเบอร์ลง DB');
    } finally {
      await srv.close();
    }
  });
});