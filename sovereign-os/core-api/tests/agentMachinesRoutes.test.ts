import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mockModel, createTestServer, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';
import { hashToken } from '../src/services/agent-machines.service';
import { __resetAlertPhoneCache } from '../src/services/orchestrator-alert-phone.service';
import { readVerifiedUpdateManifest } from '../src/services/update-manifest-trust.service';
import { generateEnrollToken } from '../src/services/fleet-enrollment.service';

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

// red-first (chunk 2): ก่อนมี route นี้ runner จับภาพหน้าจอได้แต่ไม่มีที่ส่ง
// => screenshot_url ว่างตลอด ภาพจบงานไม่มีทางไปถึงผู้ใช้
// ต้องมี x-machine-token เท่านั้น (ไม่ใช่ JWT ของคน) และไฟล์ต้องไม่หลุดออกนอกโฟลเดอร์
// เก็บเป็น relative path /api/agent-machines/screenshots/<ไฟล์> เพื่อให้ UI เรียกผ่าน authFetch ได้ตรง ๆ

describe('agent-machines routes — เครื่องที่ปิดอยู่ต้องขึ้น offline', () => {
  test('GET / คิดสถานะจากอายุ heartbeat ไม่ใช่ค่าที่ค้างอยู่ใน DB', async () => {
    // เจ้าของสั่ง 11/10/69: "ตอนนี้ผมปิดเครื่องอยู่ มันต้องออฟไลน์"
    // คอลัมน์ status ถูกตั้งเป็น online ตอน heartbeat ครั้งสุดท้ายแล้วค้างอยู่ ⇒ ต้องคำนวณตอนอ่าน
    const now = Date.now();
    const rows = [
      { id: 'm-live', name: 'เครื่องนี้ (HUB)', status: 'online', last_heartbeat: new Date(now - 5_000), executors: ['echo'] },
      { id: 'm-sleep', name: 'คอมเครื่องที่ 2', status: 'online', last_heartbeat: new Date(now - 3 * 24 * 60 * 60 * 1000), executors: ['echo'] },
      { id: 'm-new', name: 'คอมเครื่องที่ 3', status: 'online', last_heartbeat: null, executors: ['echo'] },
      { id: 'm-off', name: 'คอมเครื่องที่ 4', status: 'disabled', last_heartbeat: new Date(now - 3 * 24 * 60 * 60 * 1000), executors: ['echo'] },
    ];
    mockModel(prisma as any, 'agentMachine', { findMany: async () => rows });

    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;
      const byId = new Map<string, any>(body.machines.map((m: any) => [m.id, m]));

      assert.equal(byId.get('m-live')?.status, 'online', 'เพิ่ง heartbeat = ออนไลน์');
      assert.equal(byId.get('m-sleep')?.status, 'offline', 'เครื่องที่ปิดไปแล้วต้องไม่ขึ้นเขียวค้าง');
      assert.equal(byId.get('m-new')?.status, 'offline', 'ยังไม่เคย heartbeat = ยังไม่ออนไลน์');
      assert.equal(byId.get('m-off')?.status, 'disabled', 'คนปิดเองต้องคงเป็น disabled');
      assert.ok((byId.get('m-sleep')?.stale_sec ?? 0) > 60, 'ต้องบอกว่าเงียบมากี่วินาที (หน้าเว็บใช้แสดงผล)');
    } finally {
      await srv.close();
    }
  });
});

test('POST /jobs/pull แนบ header บอกรุ่นชุดเผยแพร่ล่าสุด (สัญญาณอัปเดตผ่าน pull)', async () => {
  // กติกา: มีชุดผ่าน trust แนบ version ใน header เสมอ (runner เทียบรุ่นตัวเองเอง)
  // เครื่องที่ยังไม่มีชุดที่ผ่าน trust = ไม่แนบ header (runner ไม่ต้องเดาเอง)
  const router = loadRouter();
  const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
  try {
    const res = await fetch(`${srv.baseUrl}/api/agent-machines/jobs/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-machine-token': 'valid-token' },
      body: JSON.stringify({ limit: 1 }),
    });
    assert.equal(res.status, 200);
    const verified = readVerifiedUpdateManifest();
    const headerVersion = res.headers.get('x-agent-update-version');
    if (verified.ok) {
      assert.equal(headerVersion, verified.manifest.version, 'header ต้องบอกรุ่นเดียวกับ manifest ที่เซ็นแล้ว');
    } else {
      assert.equal(headerVersion, null, 'ไม่มีชุดผ่าน trust = ต้องไม่แนบ header');
    }
  } finally {
    await srv.close();
  }
});

describe('node-kits — ชุดติดตั้งต้องมีสิทธิ์ก่อนดาวน์โหลด', () => {
  const KEY = 'MACHINE_ENROLL_CODE';
  const saved = process.env[KEY];

  async function withServer(fn) {
    process.env[KEY] = 'enroll-code-for-test';
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      await fn(srv.baseUrl);
    } finally {
      if (saved === undefined) delete process.env[KEY];
      else process.env[KEY] = saved;
      await srv.close();
    }
  }

  test('ไม่มีรหัสและไม่มี token = 401 (ของเดิมเปิดให้โหลดฟรี)', async () => {
    await withServer(async (base) => {
      const res = await fetch(base + '/api/agent-machines/node-kits/manifest');
      assert.equal(res.status, 401, 'ต้องไม่ปล่อย manifest ให้คนที่ไม่มีสิทธิ์');
      const body = await res.json();
      assert.equal(body.decision, 'access_denied');
      assert.match(String(body.hint), /x-enroll-code/);
    });
  });

  test('รหัสเชิญผิด = 401', async () => {
    await withServer(async (base) => {
      const res = await fetch(base + '/api/agent-machines/node-kits/asset', {
        headers: { 'x-enroll-code': 'wrong-code' },
      });
      assert.equal(res.status, 401);
    });
  });

  test('รหัสเชิญถูก (header) = ผ่านด่าน', async () => {
    await withServer(async (base) => {
      const res = await fetch(base + '/api/agent-machines/node-kits/manifest', {
        headers: { 'x-enroll-code': 'enroll-code-for-test' },
      });
      assert.notEqual(res.status, 401);
      assert.ok([200, 404].includes(res.status), 'ผ่านด่านแล้วเหลือแค่เรื่องไฟล์บนดิสก์');
    });
  });

  test('รหัสเชิญถูก (query ?code=) = ผ่านด่าน', async () => {
    await withServer(async (base) => {
      const res = await fetch(base + '/api/agent-machines/node-kits/bootstrap?code=enroll-code-for-test');
      assert.notEqual(res.status, 401);
    });
  });

  test('machine token ของเครื่องที่ลงทะเบียนแล้ว = ผ่านด่าน', async () => {
    await withServer(async (base) => {
      const res = await fetch(base + '/api/agent-machines/node-kits/manifest', {
        headers: { 'x-machine-token': 'valid-token' },
      });
      assert.notEqual(res.status, 401);
    });
  });

  test('รหัสเชิญฝูงที่ยังใช้ได้ = ผ่าน และต้องไม่กินโควตา', async () => {
    let consumed = 0;
    mockModel(prisma, 'fleetEnrollmentToken', {
      findUnique: async () => ({
        id: 'tok-1', label: 'ฝูงทดสอบ', token_hash: 'hash', revoked_at: null,
        expires_at: null, used_count: 0, max_uses: 5,
      }),
      update: async () => { consumed += 1; return {}; },
      updateMany: async () => { consumed += 1; return { count: 1 }; },
    });
    await withServer(async (base) => {
      const { token } = generateEnrollToken();
      const res = await fetch(base + '/api/agent-machines/node-kits/manifest', {
        headers: { 'x-enroll-code': token },
      });
      assert.notEqual(res.status, 401, 'รหัสฝูงที่ยังใช้ได้ต้องผ่าน');
      assert.equal(consumed, 0, 'ดาวน์โหลดชุดติดตั้งต้องไม่กินโควตารหัสเชิญ');
    });
  });

  test('รหัสเชิญฝูงที่ถูกเพิกถอน = 401', async () => {
    mockModel(prisma, 'fleetEnrollmentToken', {
      findUnique: async () => ({
        id: 'tok-2', label: 'เพิกถอนแล้ว', token_hash: 'hash', revoked_at: new Date(),
        expires_at: null, used_count: 0, max_uses: 5,
      }),
    });
    await withServer(async (base) => {
      const { token } = generateEnrollToken();
      const res = await fetch(base + '/api/agent-machines/node-kits/manifest', {
        headers: { 'x-enroll-code': token },
      });
      assert.equal(res.status, 401);
    });
  });
});
