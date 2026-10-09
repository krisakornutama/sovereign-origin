import './setup-env';
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { mockModel, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';
import machineControlRoutes from '../src/modules/machine-control/machine-control.routes';
import {
  MAX_FRAME_BYTES,
  awaitCommand,
  controlState,
  dispatchCommand,
  getLatestFrame,
  resetMachineControl,
} from '../src/services/machine-control.service';

// ── ช่องควบคุมเครื่องระยะไกล — สัญญาผ่าน HTTP จริง ────────────────────────────
//
// ทำไมต้องเทสต์ผ่าน HTTP จริง ไม่ใช่เรียก service ตรง ๆ:
//   ช่องนี้มี "ด่านยืนยันตัวตนสองแบบ" (machine token กับ JWT+SUPERADMIN) และ
//   มีจุดที่พลาดง่ายมากจนพังเงียบ — Express 4 ที่ async handler throw จะค้างไม่ตอบ
//   → เครื่องที่ 2 จะค้างรอจน timeout ไม่มี error ให้เห็นเลย
//
// เทสต์ชุดนี้จึงยิงผ่าน http server จริง แล้วยืนยันทั้ง "ผลลัพธ์" และ "สถานะที่ค้าง"

const MACHINE_ID = 'm-control-1';
const MACHINE_TOKEN = 'machine-token-for-test';

let server: http.Server;
let baseUrl = '';

before(async () => {
  // token ของเครื่อง: authenticateToken หาแถวจาก token_hash — mock ให้เจอเสมอ
  // (ตัว token เองไม่ต้องตรง เพราะ hashToken เทียบเฉพาะค่าที่ mock คืน)
  mockModel(prisma as any, 'agentMachine', {
    findFirst: async () => ({
      id: MACHINE_ID,
      name: 'runner-test',
      status: 'online',
      executors: ['opencode'],
    }),
    findMany: async () => [],
    update: async (args: any) => ({ id: MACHINE_ID, ...args.data }),
  });

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/machine-control', machineControlRoutes);

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  resetMachineControl();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetMachineControl();
});

/** POST ด้วย machine token (ฝั่ง runner) — path เป็น suffix ใต้ /api/machine-control */
function postAsMachine(path: string, body: unknown, token = MACHINE_TOKEN) {
  return fetch(`${baseUrl}/api/machine-control${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-machine-token': token },
    body: JSON.stringify(body ?? {}),
  });
}

/** POST/GET ด้วย JWT ของคน (ฝั่งผู้ใช้) */
function asUser(path: string, init: RequestInit = {}, role = 'SUPERADMIN') {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${makeToken(role)}`,
      ...(init.headers ?? {}),
    },
  });
}

describe('machine-control: ด่านยืนยันตัวตนของ runner', () => {
  test('ไม่มี token → 401 (ไม่ค้าง)', async () => {
    const res = await fetch(`${baseUrl}/api/machine-control/next`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ waitMs: 50 }),
    });
    assert.equal(res.status, 401);
  });

  test('token ปลอม (mock ไม่เจอแถว) → 401', async () => {
    mockModel(prisma as any, 'agentMachine', { findFirst: async () => null });
    const res = await postAsMachine('/next', { waitMs: 50 });
    assert.equal(res.status, 401);
    mockModel(prisma as any, 'agentMachine', {
      findFirst: async () => ({ id: MACHINE_ID, name: 'runner-test', status: 'online' }),
    });
  });

  test('ไม่มีคำสั่ง → คืน command: null ตามเวลา (ไม่ค้างคา connection)', async () => {
    const started = Date.now();
    const res = await postAsMachine('/next', { waitMs: 80 });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { command: unknown };
    assert.equal(body.command, null);
    assert.ok(Date.now() - started >= 50, 'ต้องค้างรอจริง ไม่ตอบทันที');
  });

  test('มีคำสั่งในคิว → ค้างไว้จนได้คำสั่งแล้วตอบกลับทันที', async () => {
    dispatchCommand(MACHINE_ID, 'fs.list', { path: 'E:\\' });

    const res = await postAsMachine('/next', { waitMs: 5000 });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { command: { type: string; payload: Record<string, unknown> } };
    assert.equal(body.command.type, 'fs.list');
    assert.equal(body.command.payload.path, 'E:\\');
  });

  test('คำสั่งที่ส่งมาหลัง poll ค้างอยู่ ถึงมือภายในรอบเดียวกัน (long-poll ทำงานจริง)', async () => {
    const polling = postAsMachine('/next', { waitMs: 5000 });
    // ให้ HTTP request ไปถึง handler ก่อน แล้วค่อย dispatch (จำลองผู้ใช้กดปุ่ม)
    await new Promise((r) => setTimeout(r, 50));
    dispatchCommand(MACHINE_ID, 'input.mouse', { x: 10, y: 20 });

    const body = (await (await polling).json()) as { command: { type: string } };
    assert.equal(body.command.type, 'input.mouse');
  });

  test('POST /result ของคำสั่งที่ไม่รู้จัก → 200 ok:false (ไม่ให้ runner เข้าใจผิดว่าต้อง retry)', async () => {
    const res = await postAsMachine('/result', { commandId: 'never-existed', ok: true });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    assert.equal(body.ok, false);
    assert.ok(body.reason);
  });

  test('POST /result ที่ไม่มี commandId → 400', async () => {
    const res = await postAsMachine('/result', { ok: true });
    assert.equal(res.status, 400);
  });

  test('POST /result ของคำสั่งจริง → 200 ok:true และคำสั่งถูกปิด (รับซ้ำไม่ได้)', async () => {
    const command = dispatchCommand(MACHINE_ID, 'fs.write', { path: 'E:\\a.txt' });
    const first = await postAsMachine('/result', { commandId: command.id, ok: true, result: { bytes: 3 } });
    assert.equal(first.status, 200);
    assert.equal(((await first.json()) as { ok: boolean }).ok, true);

    const second = await postAsMachine('/result', { commandId: command.id, ok: true });
    assert.equal(((await second.json()) as { ok: boolean }).ok, false, 'รายงานผลซ้ำต้องไม่ถูกนับ');
  });
});

describe('machine-control: เฟรมภาพหน้าจอผ่าน HTTP', () => {
  const png = Buffer.from('fake-png-bytes-for-test');

  test('ไม่มี token → 401', async () => {
    const res = await fetch(`${baseUrl}/api/machine-control/frame`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: png.toString('base64') }),
    });
    assert.equal(res.status, 401);
  });

  test('ไม่มี data → 400', async () => {
    const res = await postAsMachine('/frame', { width: 100 });
    assert.equal(res.status, 400);
  });

  test('เฟรมใหญ่เกินเพดาน → 413 และไม่ถูกเก็บ (HUB ต้องไม่หมดหน่วยความจำ)', async () => {
    const huge = Buffer.alloc(MAX_FRAME_BYTES + 1024).toString('base64');
    const res = await postAsMachine('/frame', { data: huge });
    assert.equal(res.status, 413);
    assert.equal(getLatestFrame(MACHINE_ID), null);
  });

  test('ส่งเฟรมสำเร็จ → seq เพิ่มขึ้น และผู้ใช้ดึงภาพล่าสุดได้เป็น binary จริง', async () => {
    const first = await postAsMachine('/frame', {
      data: png.toString('base64'),
      mime: 'image/jpeg',
      width: 640,
      height: 480,
    });
    assert.equal(first.status, 200);
    assert.equal(((await first.json()) as { seq: number }).seq, 1);

    const img = await asUser(`/api/machine-control/frame/${MACHINE_ID}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal(img.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);

    const second = await postAsMachine('/frame', { data: png.toString('base64') });
    assert.equal(((await second.json()) as { seq: number }).seq, 2, 'seq ต้องเดินหน้าเสมอ');
  });

  test('ยังไม่มีเฟรม → 404 (ไม่ใช่ 200 ที่มีภาพเปล่า)', async () => {
    const res = await asUser(`/api/machine-control/frame/${MACHINE_ID}`);
    assert.equal(res.status, 404);
  });
});

describe('machine-control: ฝั่งผู้ใช้ (JWT + SUPERADMIN เท่านั้น)', () => {
  test('GET /state ไม่มี token → 401', async () => {
    const res = await fetch(`${baseUrl}/api/machine-control/state`);
    assert.equal(res.status, 401);
  });

  test('GET /state ด้วย role ที่ไม่ใช่ SUPERADMIN → 403', async () => {
    // ช่องนี้ควบคุมเครื่องอื่นได้ทั้งเครื่อง ⇒ ห้ามเปิดให้ role อื่นแม้แต่ "ดู"
    const res = await asUser('/api/machine-control/state', {}, 'NODE_ADMIN');
    assert.equal(res.status, 403);
  });

  test('GET /state ด้วย SUPERADMIN → 200 พร้อมรายการช่อง', async () => {
    dispatchCommand(MACHINE_ID, 'fs.list', {});
    const res = await asUser('/api/machine-control/state');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { channels: Array<{ machineId: string; queued: number }> };
    const mine = body.channels.find((c) => c.machineId === MACHINE_ID);
    assert.ok(mine, 'ต้องเห็นช่องของเครื่องที่เพิ่งสั่งคำสั่งไป');
    assert.equal(mine!.queued, 1);
  });

  test('POST /command ด้วย SUPERADMIN → runner ได้คำสั่งจริง', async () => {
    const res = await asUser('/api/machine-control/command', {
      method: 'POST',
      body: JSON.stringify({ machineId: MACHINE_ID, type: 'fs.mkdir', payload: { path: 'E:\\new-folder' } }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { command: { id: string; type: string } };
    assert.equal(body.command.type, 'fs.mkdir');

    const received = await awaitCommand(MACHINE_ID, 200);
    assert.equal(received?.id, body.command.id, 'คำสั่งที่ผู้ใช้สั่งต้องถึง runner');
    assert.equal(received?.payload.path, 'E:\\new-folder');
  });

  test('POST /command ด้วย role อื่น → 403 และไม่มีคำสั่งหลุดไปที่เครื่อง', async () => {
    const res = await asUser(
      '/api/machine-control/command',
      { method: 'POST', body: JSON.stringify({ machineId: MACHINE_ID, type: 'fs.list' }) },
      'OPERATOR',
    );
    assert.equal(res.status, 403);
    assert.equal((await awaitCommand(MACHINE_ID, 60)), null, 'คำสั่งต้องไม่ถูกส่งเมื่อสิทธิ์ไม่พอ');
  });

  test('POST /command ที่ขาด machineId/type → 400', async () => {
    const missingType = await asUser('/api/machine-control/command', {
      method: 'POST',
      body: JSON.stringify({ machineId: MACHINE_ID }),
    });
    assert.equal(missingType.status, 400);
  });

  test('คำสั่งที่ผู้ใช้ยิงไว้ ถูกนับในคิวจนกว่า runner จะมารับ', async () => {
    await asUser('/api/machine-control/command', {
      method: 'POST',
      body: JSON.stringify({ machineId: MACHINE_ID, type: 'fs.delete', payload: { path: 'E:\\tmp' } }),
    });
    const beforePoll = controlState().find((c) => c.machineId === MACHINE_ID);
    assert.equal(beforePoll?.queued, 1);

    await awaitCommand(MACHINE_ID, 200);
    const afterPoll = controlState().find((c) => c.machineId === MACHINE_ID);
    assert.equal(afterPoll?.queued, 0, 'เมื่อ runner รับไปแล้ว ต้องไม่ค้างในคิว');
  });
});
