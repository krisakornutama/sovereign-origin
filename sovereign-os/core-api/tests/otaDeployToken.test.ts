// ─────────────────────────────────────────────────────────────
// OTA — token ไม่ควรเดินทางใน URL และ /events ไม่ใช่ของทุก role
//
// ของเดิม: /deploy ประกอบ URL เป็น ...?token=<OTA_TOKEN> ให้อุปกรณ์ไปโหลด
//   ⇒ token ติดไปใน log ของ proxy/HA/ประวัติเบราว์เซอร์/MQTT payload ที่ใครบนวงอ่านได้
// ของเดิม: GET /events ตรวจแค่ authenticate ⇒ ทุก role เห็นประวัติ OTA ทั้งฟลีต
// ─────────────────────────────────────────────────────────────
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';
import { prisma } from '../src/lib/prisma';

const TOKEN = 'ota-secret-token-123';
const BASE = 'https://ota.example.com';
let dir = '';
let published: Array<{ topic: string; payload: string }> = [];
let server: TestServer;
let mqttClient: any;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-ota-deploy-'));
  process.env.OTA_DIR = dir;
  process.env.OTA_TOKEN = TOKEN;
  process.env.OTA_BASE_URL = BASE;
  fs.writeFileSync(path.join(dir, 'esp32_v1.2.bin'), Buffer.from('firmware'));

  mockModel(prisma as any, 'otaEvent', {
    create: async (args: any) => ({ id: 'ev-1', ...args.data }),
    findMany: async () => [{ id: 'ev-1', type: 'deploy', status: 'sent' }],
  });

  const mod = await import('../src/modules/ota/ota.routes');
  mqttClient = mod.mqttClient;
  mock.method(mqttClient, 'publish', (topic: string, payload: string) => {
    published.push({ topic, payload });
  });
  server = await createTestServer((app) => app.use('/api/ota', mod.default));
});

after(async () => {
  mock.restoreAll();
  mqttClient?.end?.(true);
  if (server) await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const AUTH = () => ({ authorization: `Bearer ${makeToken('SUPERADMIN')}`, 'content-type': 'application/json' });

test('deploy: URL ที่ส่งให้อุปกรณ์ต้องไม่มี token ฝังอยู่ (ส่ง token ทาง header แทน)', async () => {
  published = [];
  const res = await fetch(`${server.baseUrl}/api/ota/deploy`, {
    method: 'POST',
    headers: AUTH(),
    body: JSON.stringify({ nodeId: 'node-1', file: 'esp32_v1.2.bin' }),
  });
  assert.equal(res.status, 200);
  assert.equal(published.length, 1, 'ต้อง publish คำสั่ง OTA 1 ครั้ง');
  const payload = JSON.parse(published[0].payload);
  assert.ok(!String(payload.url).includes('token='), `URL ต้องไม่ฝัง token (ได้ ${payload.url})`);
  assert.equal(payload.headers?.['x-ota-token'], TOKEN, 'token ต้องไปทาง header ของอุปกรณ์');
});

test('download: รับ token ทาง header และยังรับทาง query ได้ (เส้นทางเดิมของอุปกรณ์)', async () => {
  const viaHeader = await fetch(`${server.baseUrl}/api/ota/firmwares/esp32_v1.2.bin`, {
    headers: { 'x-ota-token': TOKEN },
  });
  assert.equal(viaHeader.status, 200);

  const blockedQuery = await fetch(`${server.baseUrl}/api/ota/firmwares/esp32_v1.2.bin?token=${TOKEN}`);
  assert.equal(blockedQuery.status, 401, 'ค่าเริ่มต้นต้องไม่รับ token จาก URL');

  process.env.OTA_ALLOW_QUERY_TOKEN = '1';
  const viaQuery = await fetch(`${server.baseUrl}/api/ota/firmwares/esp32_v1.2.bin?token=${TOKEN}`);
  assert.equal(viaQuery.status, 200, 'เปิดสวิตช์แล้วอุปกรณ์รุ่นเดิมต้องอัปเดตได้');
  delete process.env.OTA_ALLOW_QUERY_TOKEN;

  const wrong = await fetch(`${server.baseUrl}/api/ota/firmwares/esp32_v1.2.bin`, {
    headers: { 'x-ota-token': 'wrong' },
  });
  assert.equal(wrong.status, 401);
});

test('GET /events จำกัดเฉพาะ SUPERADMIN', async () => {
  const asOperator = await fetch(`${server.baseUrl}/api/ota/events`, {
    headers: { authorization: `Bearer ${makeToken('OPERATOR')}` },
  });
  assert.equal(asOperator.status, 403, 'ประวัติ OTA ทั้งฟลีตไม่ใช่ข้อมูลของทุก role');

  const asAdmin = await fetch(`${server.baseUrl}/api/ota/events`, {
    headers: { authorization: `Bearer ${makeToken('SUPERADMIN')}` },
  });
  assert.equal(asAdmin.status, 200);
});
