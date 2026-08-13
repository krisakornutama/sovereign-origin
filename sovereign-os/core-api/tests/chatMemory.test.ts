import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import aiRoutes from '../src/modules/ai/ai.routes';
import {
  prisma,
  listHistory,
  appendExchange,
  clearHistory,
  deleteMessage,
  formatHistoryForPrompt,
  MAX_HISTORY,
  HISTORY_CONTEXT_LIMIT,
} from '../src/services/chat-memory.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;
let db: any;
let beforeFindMany: any;
let beforeDeleteMany: any;

const rows = [
  { id: 'm1', actor: 'u1', role: 'user', content: 'แบตเตอรี่เหลือเท่าไหร่', created_at: new Date('2026-08-12T01:00:00Z') },
  { id: 'm2', actor: 'u1', role: 'assistant', content: 'เหลือ 42% ครับ', created_at: new Date('2026-08-12T01:00:05Z') },
  { id: 'm3', actor: 'u1', role: 'user', content: 'แล้วน้ำล่ะ', created_at: new Date('2026-08-12T01:01:00Z') },
  { id: 'm4', actor: 'u1', role: 'assistant', content: 'น้ำ 70% ครับ', created_at: new Date('2026-08-12T01:01:05Z') },
];

before(async () => {
  db = mockModel(prisma, 'chatMessage', {
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      if (where?.actor) {
        let out = rows.filter((r) => r.actor === where.actor);
        if (orderBy?.created_at === 'desc') out = [...out].reverse();
        if (skip) out = out.slice(skip);
        if (take) out = out.slice(0, take);
        return out;
      }
      return rows;
    },
    create: async ({ data }: any) => ({ id: 'new', ...data }),
    deleteMany: async ({ where }: any) => {
      if (where?.id?.in) return { count: where.id.in.length };
      if (where?.id) {
        return {
          count: rows.some((r) => r.id === where.id && (!where.actor || r.actor === where.actor)) ? 1 : 0,
        };
      }
      if (where?.actor) return { count: rows.filter((r) => r.actor === where.actor).length };
      return { count: 0 };
    },
  });
  beforeFindMany = db.findMany;
  beforeDeleteMany = db.deleteMany;
  server = await createTestServer((app) => app.use('/api/ai', aiRoutes));
  adminToken = makeToken('SUPERADMIN', { userId: 'u1' });
});

after(async () => {
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test('history routes require authentication', async () => {
  for (const [method, url] of [
    ['GET', '/api/ai/history'],
    ['DELETE', '/api/ai/history'],
    ['DELETE', '/api/ai/history/m1'],
  ] as const) {
    const res = await fetch(server.baseUrl + url, { method });
    assert.strictEqual(res.status, 401, `${method} ${url}`);
  }
});

test('GET /history returns recent messages (ใหม่สุดอยู่ท้าย, ตามเวลา)', async () => {
  const res = await fetch(server.baseUrl + '/api/ai/history?limit=10', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.history.length, 4);
  assert.strictEqual(body.history[0].id, 'm1');
  assert.strictEqual(body.history[3].id, 'm4');
  assert.strictEqual(body.history[1].role, 'assistant');
});

test('DELETE /history clears all messages for the actor', async () => {
  const res = await fetch(server.baseUrl + '/api/ai/history', {
    method: 'DELETE',
    headers: auth(adminToken),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.ok(body.deleted >= 1);
});

test('DELETE /history/:id returns 404 for missing message', async () => {
  const res = await fetch(server.baseUrl + '/api/ai/history/nonexistent', {
    method: 'DELETE',
    headers: auth(adminToken),
  });
  assert.strictEqual(res.status, 404);
});

test('listHistory caps at HISTORY_CONTEXT_LIMIT and never goes above 200', async () => {
  const calls: any[] = [];
  db.findMany = async (args: any = {}) => {
    calls.push(args);
    return args.take ? rows.slice(0, args.take) : rows;
  };
  await listHistory('u1', HISTORY_CONTEXT_LIMIT);
  await listHistory('u1', 9999);
  assert.strictEqual(calls[0].take, HISTORY_CONTEXT_LIMIT);
  assert.strictEqual(calls[1].take, 200);
  await listHistory('u1', -5);
  assert.strictEqual(calls.length, 2, 'limit ไม่ valid → ไม่เรียก DB เลย');
});

test('appendExchange saves both sides (user + assistant) and does not throw when prisma fails', async () => {
  let created = 0;
  db.create = async () => {
    created++;
    return { id: 'x' };
  };
  await appendExchange('u1', 'สวัสดี', 'สวัสดีครับ');
  assert.strictEqual(created, 2);

  db.create = async () => {
    throw new Error('db down');
  };
  await appendExchange('u1', 'a', 'b'); // ไม่ throw — ประวัติพังไม่ทำลาย chat
  db.create = async ({ data }: any) => ({ id: 'new', ...data });
  await appendExchange('u1', 'a', 'b');
});

test('appendExchange skips empty messages', async () => {
  let created = 0;
  db.create = async () => {
    created++;
    return { id: 'x' };
  };
  await appendExchange('u1', '  ', '');
  assert.strictEqual(created, 0);
});

test('formatHistoryForPrompt formats Thai roles and returns empty string when no rows', () => {
  const empty = formatHistoryForPrompt([]);
  assert.strictEqual(empty, '');

  const out = formatHistoryForPrompt(rows.slice(0, 2));
  assert.match(out, /ประวัติการสนทนาก่อนหน้า/);
  assert.match(out, /ผู้ใช้: แบตเตอรี่เหลือเท่าไหร่/);
  assert.match(out, /ผู้ช่วย: เหลือ 42% ครับ/);
  assert.ok(out.indexOf('ผู้ใช้') < out.indexOf('ผู้ช่วย'), 'user มาก่อน assistant');
});

test('MAX_HISTORY prune logic targets the right messages (oldest beyond cap)', async () => {
  // จำลอง: มี 502 ข้อความ → ต้องเหลือ 500 — ตรวจว่า deleteMany ถูกเรียกด้วย id เก่าสุด 2 ตัว
  const all = Array.from({ length: 502 }, (_, i) => ({
    id: `id-${i}`,
    created_at: new Date(2026, 7, 1, 0, 0, i),
  }));
  mock.method(db, 'findMany', async ({ skip, take }: any = {}) => {
    const newest = [...all].reverse();
    return skip ? newest.slice(skip, (skip || 0) + (take || 20)) : newest;
  });
  const deleted: any[] = [];
  mock.method(db, 'deleteMany', async ({ where }: any) => {
    deleted.push(...where.id.in);
    return { count: where.id.in.length };
  });
  await appendExchange('u1', 'x', 'y');
  assert.strictEqual(deleted.length, 2, `ลบ ${deleted.length} ข้อความเก่าเกิน cap`);
  assert.ok(deleted.every((id) => id.startsWith('id-0') || id.startsWith('id-1')), 'ลบเฉพาะข้อความเก่าสุด');
  db.findMany = beforeFindMany;
  db.deleteMany = beforeDeleteMany;
});