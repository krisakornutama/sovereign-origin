import './setup-env';
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { mockModel, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';
import machineControlRoutes from '../src/modules/machine-control/machine-control.routes';
import { resetMachineControl } from '../src/services/machine-control.service';

// ── ช่องโหว่ "SUPERADMIN คนหนึ่งคุมเครื่องของคนอื่นได้" (เจ้าของสั่ง 11/10/69) ──
//
// เดิม: POST /machine-control/command และ GET /state, /frame/:id
//       ตรวจแค่ "คนที่ล็อกอินเป็น SUPERADMIN" ⇒ คุมได้ทุกเครื่องในระบบ
// แก้:  ชั้นที่ 2 = เครื่องต้องอยู่ใต้ผู้เรียก (many-to-many) และยืนยัน LAN แล้ว
//
// เทสต์ยิง HTTP จริงเหมือนชุดเดิม (Express 4 async handler ที่ throw จะค้าง —
// ต้องกันไว้ให้ route ตอบ 403 เสมอ ไม่ใช่ค้าง)

const MINE = '11111111-1111-1111-1111-111111111111';     // เครื่องของ user-a
const OTHER = '22222222-2222-2222-2222-222222222222';   // เครื่องของ user-b

/** เครื่อง → ผู้ใช้ที่ผูก (จำลองตาราง agent_machine_hubs) */
let hubLinks: { machine_id: string; user_id: string }[] = [];
/** role + สถานะยืนยัน LAN ของแต่ละเครื่อง */
let machineState: Record<string, { role: string; lan_confirmed_at: Date | null }> = {};

function seedState() {
  hubLinks = [
    { machine_id: MINE, user_id: 'user-a' },
    { machine_id: OTHER, user_id: 'user-b' },
  ];
  machineState = {
    [MINE]: { role: 'USER', lan_confirmed_at: new Date() },
    [OTHER]: { role: 'USER', lan_confirmed_at: new Date() },
  };
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  seedState();

  const machineRow = (id: string, name: string) => ({
    id,
    name,
    status: 'online',
    role: machineState[id]?.role ?? 'USER',
    owner_user_id: null,
    lan_confirmed_at: machineState[id]?.lan_confirmed_at ?? null,
    pair_code_hash: null,
    pair_code_at: null,
    version: 'test',
    last_heartbeat: new Date(),
    hub_users: hubLinks.filter((h) => h.machine_id === id).map((h) => ({ user_id: h.user_id })),
  });

  mockModel(prisma as any, 'agentMachine', {
    findFirst: async () => ({ id: MINE, name: 'mine', status: 'online', role: 'USER', lan_confirmed_at: new Date() }),
    findMany: async () => [machineRow(MINE, 'เครื่องของฉัน'), machineRow(OTHER, 'เครื่องคนอื่น')],
    findUnique: async (args: any) => {
      const row = machineRow(args?.where?.id, 'x');
      return args?.where?.id === MINE || args?.where?.id === OTHER ? row : null;
    },
    update: async (args: any) => ({ ...machineRow(args?.where?.id, 'x'), ...(args?.data || {}) }),
  });

  mockModel(prisma as any, 'agentMachineHub', {
    findMany: async (args: any) =>
      hubLinks.filter((h) => (args?.where?.machine_id ? h.machine_id === args.where.machine_id : true)),
    upsert: async (args: any) => {
      const row = { machine_id: args?.create?.machine_id, user_id: args?.create?.user_id };
      if (!hubLinks.find((h) => h.machine_id === row.machine_id && h.user_id === row.user_id)) hubLinks.push(row);
      return row;
    },
    deleteMany: async (args: any) => {
      const before = hubLinks.length;
      hubLinks = hubLinks.filter(
        (h) => !(h.machine_id === args?.where?.machine_id && h.user_id === args?.where?.user_id),
      );
      return { count: before - hubLinks.length };
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/machine-control', machineControlRoutes);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  resetMachineControl();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => seedState());

/** ยิงด้วย JWT ของผู้ใช้ที่ระบุ (middleware จริงตรวจ role + userId) */
async function asUser(userId: string, role: string, path: string, body?: unknown) {
  const token = makeToken(role, { userId });
  const res = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* ไม่มี body */ }
  return { status: res.status, body: json };
}

describe('ช่องโหว่: SUPERADMIN คนหนึ่งสั่ง/ดูเครื่องของคนอื่น', () => {
  test('POST /command ยิงเครื่องที่ไม่ใช่ของฉัน = 403 (เดิมผ่านแน่นอน)', async () => {
    const r = await asUser('user-a', 'SUPERADMIN', '/api/machine-control/command', {
      machineId: OTHER, type: 'fs.list', payload: { path: 'E:\\' },
    });
    assert.equal(r.status, 403, `คาด 403 แต่ได้ ${r.status} ${JSON.stringify(r.body)}`);
  });

  test('POST /command ยิงเครื่องของตัวเอง = ผ่าน', async () => {
    const r = await asUser('user-a', 'SUPERADMIN', '/api/machine-control/command', {
      machineId: MINE, type: 'screen.snapshot',
    });
    assert.equal(r.status, 200, `คาด 200 แต่ได้ ${r.status} ${JSON.stringify(r.body)}`);
  });

  test('GET /frame/:id ดูจอเครื่องคนอื่น = 403 (ดูจอคือขั้นสูงสุด)', async () => {
    const r = await asUser('user-a', 'SUPERADMIN', `/api/machine-control/frame/${OTHER}`);
    assert.equal(r.status, 403, `คาด 403 แต่ได้ ${r.status}`);
  });

  test('GET /frame/:id ของตัวเอง = ไม่ถูกบล็อกด้วย 403', async () => {
    const r = await asUser('user-a', 'SUPERADMIN', `/api/machine-control/frame/${MINE}`);
    assert.notEqual(r.status, 403, 'เครื่องของตัวเองต้องไม่โดน 403');
  });

  test('user-b คุมเครื่องของตัวเองได้ แม้ user-a คุมไม่ได้ (many-to-many ทำงาน)', async () => {
    const r = await asUser('user-b', 'SUPERADMIN', '/api/machine-control/command', {
      machineId: OTHER, type: 'screen.snapshot',
    });
    assert.equal(r.status, 200, `user-b ต้องคุมเครื่องของตัวเองได้ แต่ได้ ${r.status}`);
  });
});

describe('ข้อ 3 — ยังไม่ยืนยัน LAN = คุมไม่ได้ แม้ผูกกับผู้ใช้แล้ว', () => {
  test('เครื่องที่ lan_confirmed_at = null ต้องถูกปฏิเสธ 403', async () => {
    machineState[MINE].lan_confirmed_at = null; // ผูกแล้วแต่ยังไม่กดยืนยันบนเครื่อง
    const r = await asUser('user-a', 'SUPERADMIN', '/api/machine-control/command', {
      machineId: MINE, type: 'screen.snapshot',
    });
    assert.equal(r.status, 403, `ยังไม่ยืนยัน LAN ต้องคุมไม่ได้ แต่ได้ ${r.status}`);
  });
});

describe('ผู้ใช้ที่ไม่ได้ผูกเครื่องเลย = สั่งไม่ได้ทุกเครื่อง', () => {
  test('ผู้ใช้ที่ไม่มีเครื่องในชื่อ = 403', async () => {
    const r = await asUser('user-a', 'SUPERADMIN', '/api/machine-control/command', {
      machineId: '99999999-9999-9999-9999-999999999999', type: 'screen.snapshot',
    });
    assert.equal(r.status, 403);
  });
});