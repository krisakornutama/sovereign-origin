import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel, createTestServer, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';
import { hashToken } from '../src/services/agent-machines.service';

const calls: { method: string; url: string; body?: any; token?: string }[] = [];

function loadRouter() {
  // โหลดสดเพื่อให้ mockModel ของ mockModel ชนิดของแต่ละเทสต์มีผล
  const mod = require('../src/modules/agent-machines/agent-machines.routes');
  return mod.default;
}

beforeEach(() => {
  calls.length = 0;
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