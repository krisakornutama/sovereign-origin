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
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      fd.append('file', new Blob([png], { type: 'image/png' }), 'shot.png');
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
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      });
      assert.match(out.screenshotUrl, /^\/api\/agent-machines\/screenshots\//);
      const fname = out.screenshotUrl.split('/').pop();
      assert.ok(fs.existsSync(path.join(shotsDir, fname)), 'ไฟล์ที่ runner ส่งต้องถึงดิสก์จริง');
    } finally {
      await srv.close();
    }
  });
});

// red-first (chunk 3): ด่านอนุมัติงานเสี่ยงมีแค่ฝั่ง Telegram callback — ไม่มี route/ปุ่มบนเว็บ
// ⇒ ผู้ใช้ที่ไม่ได้เปิด Telegram เปิดงานเสี่ยงค้างไว้จนหมดอายุไม่ได้เลย
// กฎสถานะ: 200 เมื่อเปลี่ยนสถานะจริง · 409 เมื่องานไม่ได้อยู่ใน awaiting_approval

describe('agent-machines routes — อนุมัติ/ปฏิเสธงานเสี่ยงจากหน้าเว็บ', () => {
  let updateManyCalls: any[] = [];
  let updateCount = 1;

  beforeEach(() => {
    updateManyCalls = [];
    updateCount = 1;
    mockModel(prisma as any, 'agentJob', {
      findMany: async () => [
        { id: 'j-risk', status: 'awaiting_approval', prompt: 'ล้างฐานข้อมูลทั้งหมด', priority: 0 },
        { id: 'j-safe', status: 'queued', prompt: 'สรุปรายงาน', priority: 0 },
      ],
      updateMany: async (args: any) => {
        updateManyCalls.push(args);
        return { count: updateCount };
      },
      groupBy: async () => [], // queueStats ใช้ groupBy — mock ให้ครบจะได้ไม่ log error ท้ายเทสต์
    });
  });

  test('POST /queue/:id/approve ปล่อยงานเข้าคิวเมื่อสถานะเป็น awaiting_approval', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ actor: 'web-admin' }),
      });
      assert.equal(res.status, 200, 'อนุมัติได้จากเว็บต้องตอบ 200 (ไม่ใช่ 404 เหมือนตอนนี้)');
      const body = await res.json() as any;
      assert.equal(body.ok, true);
      assert.equal(body.status, 'queued', 'งานต้องถูกปล่อนกลับเข้าคิวให้เครื่องดึง');
      assert.equal(updateManyCalls.length, 1);
      assert.equal(updateManyCalls[0].where.status, 'awaiting_approval', 'ต้อง gate ด้วยสถานะกันสองคนกดพร้อมกัน');
      assert.equal(updateManyCalls[0].data.status, 'queued');
      assert.equal(updateManyCalls[0].data.approved_by, 'web-admin');
    } finally {
      await srv.close();
    }
  });

  test('POST /queue/:id/approve ตอบ 409 เมื่องานไม่ได้รออนุมัติอยู่', async () => {
    updateCount = 0; // งานถูกตัดสินใจไปแล้ว / ไม่มีจริง
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: '{}',
      });
      assert.equal(res.status, 409, 'สถานะไม่ตรงต้องบอกว่าขัดแย้ง ไม่ใช่แกล้งทำเป็นสำเร็จ');
      const body = await res.json() as any;
      assert.ok(body.error, 'ต้องบอกเหตุผลว่าทำไม่ได้');
    } finally {
      await srv.close();
    }
  });

  test('POST /queue/:id/reject ปฏิเสธงานเป็น cancelled', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('SUPERADMIN')}` },
        body: JSON.stringify({ actor: 'web-admin' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.ok, true);
      assert.equal(body.status, 'cancelled', 'ปฏิเสธแล้วเครื่องห้ามได้งานนี้ไปทำ');
      assert.equal(updateManyCalls[0].data.status, 'cancelled');
    } finally {
      await srv.close();
    }
  });

  test('POST /queue/:id/approve|reject ต้องมีสิทธิ์ SUPERADMIN (401/403)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const noAuth = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/approve`, { method: 'POST', body: '{}' });
      assert.equal(noAuth.status, 401);
      const wrongRole = await fetch(`${srv.baseUrl}/api/agent-machines/queue/j-risk/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${makeToken('VIEWER')}` },
        body: '{}',
      });
      assert.equal(wrongRole.status, 403, 'คนไม่มีสิทธิ์ห้ามปล่อยงานเสี่ยงเข้าคิว');
      assert.equal(updateManyCalls.length, 0, 'คนไม่มีสิทธิ์ห้ามแตะฐานข้อมูล');
    } finally {
      await srv.close();
    }
  });

  test('GET /queue คืน canApprove=true เฉพาะงานที่รออนุมัติ (ให้ UI ใช้แสดงปุ่ม)', async () => {
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const res = await fetch(`${srv.baseUrl}/api/agent-machines/queue`, {
        headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      const risky = body.jobs.find((j: any) => j.id === 'j-risk');
      const safe = body.jobs.find((j: any) => j.id === 'j-safe');
      assert.equal(risky.canApprove, true, 'งานที่รออนุมัติ UI ต้องกดปุ่มได้');
      assert.equal(safe.canApprove, false, 'งานปกติห้ามขึ้นปุ่มอนุมัติ');
    } finally {
      await srv.close();
    }
  });
});

// red-first (chunk 4): ภาพหน้าจอ ~2.8 MB/งาน สะสมใน data/orchestrator-shots
// ไม่มี retention ไม่มีใครล้าง ⇒ disk โตไม่รู้จบ
// กฎ: เกินอายุ (default 14 วัน) = ลบไฟล์ **และ** เคลียร์ screenshot_url บนแถวงาน
//      (ลบอย่างเดียวไม่พอ — URL ค้างทำให้ผู้ใช้กดดูแล้วเจอ 404 งง ๆ)

describe('agent-machines routes — นโยบายอายุภาพหน้าจอ (retention 14 วัน)', () => {
  const pruneCalls: any[] = [];

  beforeEach(() => {
    process.env.ORCHESTRATOR_SCREENSHOT_DIR = shotsDir;
    delete process.env.ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS; // ใช้ default 14
    fs.rmSync(shotsDir, { recursive: true, force: true });
    fs.mkdirSync(shotsDir, { recursive: true });
    pruneCalls.length = 0;
    mockModel(prisma as any, 'agentJob', {
      findUnique: async (args: any) => ({ id: args.where.id, machine_id: 'm-1' }),
      update: async (args: any) => ({ id: args.where.id, ...args.data }),
      updateMany: async (args: any) => {
        pruneCalls.push(args);
        return { count: args?.where?.screenshot_url?.in?.length ?? 0 };
      },
    });
  });

  /** วางไฟล์ภาพแล้วเลื่อน mtime ย้อนหลังตามจำนวนวัน (ทดสอบบน temp dir ไม่แตะ data จริง) */
  function putFile(name: string, ageDays: number): string {
    const full = path.join(shotsDir, name);
    fs.writeFileSync(full, Buffer.from('png-bytes'));
    const t = new Date(Date.now() - ageDays * 86_400_000);
    fs.utimesSync(full, t, t);
    return full;
  }

  function loadScreenshotService(): any {
    return require('../src/services/orchestrator-screenshot.service');
  }

  test('pruneScreenshots ลบไฟล์เกิน 14 วันและเคลียร์ screenshot_url (ไฟล์ยังไม่หมดอายุต้องอยู่)', async () => {
    const { pruneScreenshots } = loadScreenshotService();
    const oldFile = putFile('job-j-old-0001-old.png', 20);
    const youngFile = putFile('job-j-young-0002-young.png', 13);

    const out = await pruneScreenshots();

    assert.equal(fs.existsSync(oldFile), false, 'ไฟล์อายุ 20 วันต้องถูกลบออกจากดิสก์');
    assert.equal(fs.existsSync(youngFile), true, 'ไฟล์อายุ 13 วัน (ยังไม่เกิน 14) ห้ามลบ');
    assert.equal(pruneCalls.length, 1, 'ต้องเคลียร์ screenshot_url บนแถวงานด้วย ไม่ใช่ลบไฟล์อย่างเดียว');
    assert.deepEqual(pruneCalls[0].data, { screenshot_url: null }, 'ต้องล้างคอลัมน์ screenshot_url');
    const inList: string[] = pruneCalls[0].where.screenshot_url.in;
    assert.ok(
      inList.includes('/api/agent-machines/screenshots/job-j-old-0001-old.png'),
      'ต้องชี้ URL ของไฟล์ที่ลบไปแล้วเท่านั้น'
    );
    assert.ok(!inList.some((u) => u.includes('young')), 'ห้ามแตะแถวของงานที่ภาพยังอยู่');
    assert.equal(out.deleted.length, 1, 'ต้องรายงานจำนวนไฟล์ที่ลบให้ worker เอาไป log ได้');
  });

  test('ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS เปลี่ยนอายุที่ใช้ตัดได้', async () => {
    process.env.ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS = '2';
    const { pruneScreenshots } = loadScreenshotService();
    const oldFile = putFile('job-j-3days-old.png', 3);
    const freshFile = putFile('job-j-1day-new.png', 1);

    await pruneScreenshots();

    assert.equal(fs.existsSync(oldFile), false, 'retention=2 ⇒ ไฟล์ 3 วันต้องหาย');
    assert.equal(fs.existsSync(freshFile), true, 'retention=2 ⇒ ไฟล์ 1 วันต้องอยู่');
  });

  test('ค่า retention ที่ผิดรูปแบบต้องตกกลับเป็น 14 วัน ไม่ใช่ลบหมดหรือข้าม', async () => {
    process.env.ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS = 'not-a-number';
    const { pruneScreenshots } = loadScreenshotService();
    const oldFile = putFile('job-j-20days-old.png', 20);
    const youngFile = putFile('job-j-2days-young.png', 2);

    await pruneScreenshots();

    assert.equal(fs.existsSync(oldFile), false, 'ค่าพังไม่ได้แปลว่าปิด retention');
    assert.equal(fs.existsSync(youngFile), true, 'ค่าพังต้องไม่ทำให้ลบไฟล์ที่ยังไม่หมดอายุ');
  });

  test('GET /screenshots/:file ของไฟล์ที่ถูก prune แล้วตอบ 404 ไม่ crash', async () => {
    const { pruneScreenshots } = loadScreenshotService();
    putFile('job-j-gone-gone.png', 30);
    const router = loadRouter();
    const srv = await createTestServer((app) => app.use('/api/agent-machines', router));
    try {
      const url = `${srv.baseUrl}/api/agent-machines/screenshots/job-j-gone-gone.png`;
      const before = await fetch(url, { headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` } });
      assert.equal(before.status, 200, 'ก่อน prune ต้องเปิดดูได้');

      await pruneScreenshots();

      const after = await fetch(url, { headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` } });
      assert.equal(after.status, 404, 'ไฟล์ถูกลบแล้วต้องตอบ 404 ไม่ใช่ 500/crash');
    } finally {
      await srv.close();
    }
  });
});

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
