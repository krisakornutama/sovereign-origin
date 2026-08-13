import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import otaRoutes, { prisma, mqttClient } from '../src/modules/ota/ota.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

const OTA_DIR = process.env.OTA_DIR as string;

let server: TestServer;
let adminToken: string;

before(async () => {
  fs.rmSync(OTA_DIR, { recursive: true, force: true });
  fs.mkdirSync(OTA_DIR, { recursive: true });
  // mock MQTT publish — test ไม่ต้องมี broker จริง
  mock.method(mqttClient, 'publish', () => {});
  server = await createTestServer((app) => app.use('/api/ota', otaRoutes));
  adminToken = makeToken('SUPERADMIN');
});

after(async () => {
  mock.restoreAll();
  mqttClient.end(true);
  if (server) await server.close();
  fs.rmSync(OTA_DIR, { recursive: true, force: true });
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test('requires authentication on all endpoints', async () => {
  for (const [method, url] of [
    ['GET', '/api/ota/firmwares'],
    ['POST', '/api/ota/firmwares?name=x.bin'],
    ['GET', '/api/ota/events'],
    ['POST', '/api/ota/deploy'],
  ] as const) {
    const res = await fetch(server.baseUrl + url, { method });
    assert.strictEqual(res.status, 401, `${method} ${url} should be 401`);
  }
});

test('blocks non-SUPERADMIN from upload/deploy', async () => {
  const operatorToken = makeToken('OPERATOR');
  const res = await fetch(server.baseUrl + '/api/ota/firmwares?name=x.bin', {
    method: 'POST',
    headers: auth(operatorToken),
    body: Buffer.from('fake'),
  });
  assert.strictEqual(res.status, 403);
});

test('rejects invalid file names on upload', async () => {
  for (const name of ['notes.txt', '..%2Fevil.bin', 'folder%2Fevil.bin', '']) {
    const res = await fetch(server.baseUrl + `/api/ota/firmwares?name=${name}`, {
      method: 'POST',
      headers: auth(adminToken),
      body: Buffer.from('fake-binary'),
    });
    assert.strictEqual(res.status, 400, `name="${name}" should be 400`);
  }
});

test('rejects empty upload body', async () => {
  const res = await fetch(server.baseUrl + '/api/ota/firmwares?name=empty.bin', {
    method: 'POST',
    headers: auth(adminToken),
    body: Buffer.alloc(0),
  });
  assert.strictEqual(res.status, 400);
});

test('uploads firmware and lists it', async () => {
  const body = Buffer.from('ESP32-BIN-1.2.3');
  const up = await fetch(server.baseUrl + '/api/ota/firmwares?name=esp32_v1.2.3.bin', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/octet-stream' },
    body,
  });
  assert.strictEqual(up.status, 200);
  assert.ok(fs.existsSync(path.join(OTA_DIR, 'esp32_v1.2.3.bin')));

  const list = await fetch(server.baseUrl + '/api/ota/firmwares', { headers: auth(adminToken) });
  const files = await list.json();
  assert.ok(Array.isArray(files));
  assert.ok(files.some((f: any) => f.file === 'esp32_v1.2.3.bin' && f.size === body.length));
});

test('deploy validates inputs before touching anything', async () => {
  // ไม่มี nodeId
  const r1 = await fetch(server.baseUrl + '/api/ota/deploy', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: 'esp32_v1.2.3.bin' }),
  });
  assert.strictEqual(r1.status, 400);

  // ไม่มี file
  const r2 = await fetch(server.baseUrl + '/api/ota/deploy', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId: '11111111-1111-1111-1111-111111111111' }),
  });
  assert.strictEqual(r2.status, 400);

  // file ไม่อยู่ในระบบ
  const r3 = await fetch(server.baseUrl + '/api/ota/deploy', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId: '11111111-1111-1111-1111-111111111111', file: 'missing.bin' }),
  });
  assert.strictEqual(r3.status, 404);
});

test('deploy succeeds and persists an event', async () => {
  mockModel(prisma, 'otaEvent', { create: async (args: any) => ({ id: 'evt-1', ...args.data }) });

  const res = await fetch(server.baseUrl + '/api/ota/deploy', {
    method: 'POST',
    headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId: '11111111-1111-1111-1111-111111111111', file: 'esp32_v1.2.3.bin' }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.ok(data.topic.includes('/ota/command'));
  assert.ok(data.payload.includes('esp32_v1.2.3.bin'));
});

test('GET /events returns persisted history', async () => {
  mockModel(prisma, 'otaEvent', { findMany: async () => [
    {
      id: 'evt-2',
      node_id: '11111111-1111-1111-1111-111111111111',
      type: 'deploy',
      status: 'sent',
      firmware: 'esp32_v1.2.3.bin',
      version: 'esp32_v1.2.3',
      error: null,
      created_at: new Date().toISOString(),
    },
  ] });

  const res = await fetch(server.baseUrl + '/api/ota/events', { headers: auth(adminToken) });
  assert.strictEqual(res.status, 200);
  const events = await res.json();
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].status, 'sent');
  assert.strictEqual(events[0].firmware, 'esp32_v1.2.3.bin');
});

test('deletes firmware', async () => {
  fs.writeFileSync(path.join(OTA_DIR, 'todelete.bin'), Buffer.from('x'));
  const res = await fetch(server.baseUrl + '/api/ota/firmwares/todelete.bin', {
    method: 'DELETE',
    headers: auth(adminToken),
  });
  assert.strictEqual(res.status, 200);
  assert.ok(!fs.existsSync(path.join(OTA_DIR, 'todelete.bin')));
});
