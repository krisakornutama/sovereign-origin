// ─────────────────────────────────────────────────────────────
// GET /api/agent-machines + /queue — ขอบเขตของสิ่งที่ไม่ใช่ SUPERADMIN เห็น
//
// เดิมสอง route นี้ตรวจแค่ authenticate แล้วคืนทุกเครื่อง (พร้อม IP) และทุกงาน
// (prompt/ผลลัพธ์) ของทั้งฟลีต ⇒ ผู้ใช้ระดับ OPERATOR เห็นเครื่องและงานของคนอื่น
// ขณะที่ /mine กรองด้วย listMachinesForUser() อยู่แล้ว
//
// กติกาที่บังคับตอนนี้: SUPERADMIN (เจ้าของ) ยังเห็นทั้งฟลีตเพื่อผูก/ลงทะเบียนเครื่องใหม่
// แต่ role อื่นเห็นเฉพาะเครื่องที่ผูกกับตัวเอง (และงานที่รันบนเครื่องนั้น)
// ─────────────────────────────────────────────────────────────
import './setup-env';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { mockModel, createTestServer, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';

function loadRouter() {
  const mod = require('../src/modules/agent-machines/agent-machines.routes');
  return mod.default;
}

const MINE = { id: 'm-mine', name: 'เครื่องของฉัน', status: 'online', hub_users: [{ user_id: 'test-user-operator' }], lan_confirmed_at: new Date() };
const OTHER = { id: 'm-other', name: 'เครื่องคนอื่น', status: 'online', hub_users: [{ user_id: 'someone-else' }], lan_confirmed_at: new Date() };

beforeEach(() => {
  mockModel(prisma as any, 'agentMachine', {
    findMany: async () => [MINE, OTHER],
    findUnique: async (args: any) => (String(args?.where?.id) === MINE.id ? MINE : OTHER),
    findFirst: async () => MINE,
    update: async (args: any) => ({ id: MINE.id, ...args.data }),
  });
  mockModel(prisma as any, 'agentJob', {
    findMany: async () => [
      { id: 'j-mine', machine_id: MINE.id, status: 'done', prompt: 'งานของฉัน', role_name: 'coder' },
      { id: 'j-other', machine_id: OTHER.id, status: 'done', prompt: 'งานของคนอื่น', role_name: 'coder' },
    ],
    groupBy: async () => [{ status: 'done', _count: { _all: 2 } }],
    update: async (args: any) => ({ id: args?.where?.id, ...args.data }),
  });
});

test('OPERATOR เห็นเฉพาะเครื่องที่ผูกกับตัวเอง', async () => {
  const srv = await createTestServer((app) => app.use('/api/agent-machines', loadRouter()));
  try {
    const res = await fetch(`${srv.baseUrl}/api/agent-machines`, {
      headers: { authorization: `Bearer ${makeToken('OPERATOR')}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    const ids = (body.machines || []).map((m: any) => m.id);
    assert.deepEqual(ids, [MINE.id], 'ต้องไม่เห็นเครื่องของคนอื่น');
  } finally {
    await srv.close();
  }
});

test('OPERATOR เห็นเฉพาะงานที่รันบนเครื่องของตัวเอง', async () => {
  const srv = await createTestServer((app) => app.use('/api/agent-machines', loadRouter()));
  try {
    const res = await fetch(`${srv.baseUrl}/api/agent-machines/queue`, {
      headers: { authorization: `Bearer ${makeToken('OPERATOR')}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    const ids = (body.jobs || []).map((j: any) => j.id);
    assert.deepEqual(ids, ['j-mine'], 'คิวงานของเครื่องคนอื่นต้องไม่หลุด');
  } finally {
    await srv.close();
  }
});

test('SUPERADMIN ยังเห็นทั้งฟลีต (ต้องใช้ผูก/ลงทะเบียนเครื่องใหม่)', async () => {
  const srv = await createTestServer((app) => app.use('/api/agent-machines', loadRouter()));
  try {
    const res = await fetch(`${srv.baseUrl}/api/agent-machines`, {
      headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
    });
    const body = await res.json() as any;
    const ids = (body.machines || []).map((m: any) => m.id).sort();
    assert.deepEqual(ids, [MINE.id, OTHER.id].sort());
  } finally {
    await srv.close();
  }
});
