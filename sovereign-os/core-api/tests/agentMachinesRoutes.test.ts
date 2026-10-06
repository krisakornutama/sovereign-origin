import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

// red-first (chunk 2): ก่อนมี route นี้ runner จับภาพหน้าจอได้แต่ไม่มีที่ส่ง
// => screenshot_url ว่างตลอด ภาพจบงานไม่มีทางไปถึงผู้ใช้
// ต้องมี x-machine-token เท่านั้น (ไม่ใช่ JWT ของคน) และไฟล์ต้องไม่หลุดออกนอกโฟลเดอร์
// เก็บเป็น relative path /api/agent-machines/screenshots/<ไฟล์> เพื่อให้ UI เรียกผ่าน authFetch ได้ตรง ๆ

const shotsDir = path.resolve(process.cwd(), '.tmp-orch-shots');

describe('agent-machines routes — ภาพหน้าจอตอนจบงาน', () => {
  beforeEach(() => {
    process.env.ORCHESTRATOR_SCREENSHOT_DIR = shotsDir;
    fs.rmSync(shotsDir, { recursive: true, force: true });
    mockModel(prisma as any, 'agentJob', {
      findUnique: async (args: any) => ({ id: args.where.id, machine_id: 'm-1' }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
    });
  });

  test('POST /jobs/:id/screenshot ปฏิเสธเมื่อไม่มี machine token (401)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('x')], { type: 'image/png' }), 'shot.png');
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/jobs/j-1/screenshot`, { method: 'POST', body: fd });
      assert.equal(res.status, 401, 'ต้องไม่ให้คนไม่มี token อัปโหลด');
    } finally {
      await srv.close();
    }
  });

  test('POST /jobs/:id/screenshot เก็บไฟล์จริง + ตั้ง screenshot_url ให้งาน', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('fake-png-bytes')], { type: 'image/png' }), 'shot.png');
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/jobs/j-1/screenshot`, {
        method: 'POST',
        headers: { 'x-machine-token': 'valid-token' },
        body: fd,
      });
      assert.equal(res.status, 201);
      const body = await res.json() as any;
      assert.match(body.screenshotUrl, /^\/api\/agent-machines\/screenshots\//);
      const fname = body.screenshotUrl.split('/').pop();
      assert.ok(fs.existsSync(path.join(shotsDir, fname)), 'ไฟล์ต้องอยู่บนดิสก์จริง');
    } finally {
      await srv.close();
    }
  });

  test('POST /jobs/:id/screenshot ปฏิเสธไฟล์ที่ไม่ใช่ภาพ และไม่เขียนลงดิสก์เลย', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('MZ')], { type: 'application/octet-stream' }), 'evil.exe');
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/jobs/j-1/screenshot`, {
        method: 'POST',
        headers: { 'x-machine-token': 'valid-token' },
        body: fd,
      });
      assert.equal(res.status, 400);
      const written = fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir).length : 0;
      assert.equal(written, 0, 'ไฟล์ผิดชนิดต้องไม่ถูกเขียนบนดิสก์');
    } finally {
      await srv.close();
    }
  });

  test('GET /screenshots/:file ต้องมี JWT จึงเปิดได้', async () => {
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, 'job-j-1-x.png'), Buffer.from('png'));
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const noAuth = await fetch(`${srv.baseUrl}/api/agent-machines/screenshots/job-j-1-x.png`);
      assert.equal(noAuth.status, 401, 'ภาพหน้าจอของเครื่องเป็นของส่วนตัว — ห้ามเปิดสาธารณะ');
      const ok = await fetch(`${srv.baseUrl}/api/agent-machines/screenshots/job-j-1-x.png`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.equal(ok.status, 200);
    } finally {
      await srv.close();
    }
  });

  test('GET /screenshots/:file ปฏิเสธ path traversal', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/screenshots/..%2f..%2fpackage.json`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.ok(res.status === 400 || res.status === 404, `ต้องไม่หลุดออกนอกโฟลเดอร์ (ได้ ${res.status})`);
    } finally {
      await srv.close();
    }
  });

  // เทสต์ข้ามโปรเจ็กต์: ใช้ฟังก์ชัน uploadScreenshot ตัวจริงของ runner ยิงเข้า route จริง
  // เพื่อกัน field name / filename / header หลุดจากกัน (เทสต์ฝั่งเดียวจับ drift ไม่ได้)
  test('e2e — uploadScreenshot ของ runner ส่งเข้าถึง route จริงได้', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const { uploadScreenshot } = await import('../../agent-runner/src/runner.mjs');
      const out = await uploadScreenshot({
        hubUrl: srv.baseUrl,
        token: 'valid-token',
        jobId: 'j-1',
        buffer: Buffer.from('PNG-BYTES'),
      });
      assert.match(out.screenshotUrl, /^\/api\/agent-machines\/screenshots\//);
      const fname = out.screenshotUrl.split('/').pop();
      assert.ok(fs.existsSync(path.join(shotsDir, fname)), 'ไฟล์ที่ runner ส่งต้องถึงดิสก์จริง');
    } finally {
      await srv.close();
    }
  });
});