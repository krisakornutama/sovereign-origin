// tests/telegramChannels.test.ts
//
// ── CE3: endpoint ทดสอบทุกช่องทาง (/api/telegram/channels/test) ──────────────
// ต้องบอกได้ทันทีว่าช่องไหน "ตั้งแล้วส่งได้" และช่องไหนล้ม โดยไม่ต้องรอ alert จริง
// และต้องไม่ทำให้ช่องที่ยังดีล้มไปด้วยเมื่ออีกช่องตอบ error
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import { prisma } from '../src/lib/prisma';
import telegramRoutes from '../src/modules/telegram/telegram.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;

const ENV_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DISCORD_WEBHOOK_URL',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_TO',
] as const;

const saved: Record<string, string | undefined> = {};

before(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // เหมือน telegram.test.ts: DB ปลอมต้องตอบทันที ไม่ให้ Prisma engine ไปต่อ 127.0.0.1:5432
  mockModel(prisma as any, 'systemSetting', {
    findMany: async () => [] as any[],
    findFirst: async () => null,
  });
  server = await createTestServer((app) => app.use('/api/telegram', telegramRoutes));
  adminToken = makeToken('SUPERADMIN');
});

after(async () => {
  mock.restoreAll();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  if (server) await server.close();
});

function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
}

function post() {
  return fetch(server.baseUrl + '/api/telegram/channels/test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
  });
}

test('ต้องมีสิทธิ์ SUPERADMIN (ไม่มี token = 401)', async () => {
  const res = await fetch(server.baseUrl + '/api/telegram/channels/test', { method: 'POST' });
  assert.strictEqual(res.status, 401);
});

test('ยังไม่ได้ตั้งช่องทางไหน = 400 พร้อมเหตุผลอ่านรู้เรื่อง', async () => {
  setEnv({});
  const res = await post();
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.strictEqual(body.success, false);
  assert.match(body.error, /No alert channel/);
});

test('Discord ตั้งไว้ = ส่งจริงและรายงานผลแยกช่อง', async () => {
  setEnv({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/token' });
  const calls: string[] = [];
  const m = mock.method(axios, 'post', async (url: string) => {
    calls.push(url);
    return { data: {} };
  });
  try {
    const res = await post();
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.deepStrictEqual(body.channels.map((c: any) => c.channel), ['discord']);
    assert.ok(calls.some((u) => u.includes('discord.com/api/webhooks/123/token')));
  } finally {
    m.mock.restore();
  }
});

test('ช่องหนึ่งล้ม (Discord 500) — LINE ยังส่งได้ และ success=true', async () => {
  setEnv({
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/token',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    LINE_TO: 'U' + 'a'.repeat(32),
  });
  const m = mock.method(axios, 'post', async (url: string) => {
    if (url.includes('discord.com')) throw new Error('discord 500');
    return { data: {} };
  });
  try {
    const res = await post();
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true, 'LINE สำเร็จ = true');
    const discord = body.channels.find((c: any) => c.channel === 'discord');
    const line = body.channels.find((c: any) => c.channel === 'line');
    assert.strictEqual(discord.ok, false);
    assert.match(discord.reason, /discord 500/);
    assert.strictEqual(line.ok, true);
  } finally {
    m.mock.restore();
  }
});
