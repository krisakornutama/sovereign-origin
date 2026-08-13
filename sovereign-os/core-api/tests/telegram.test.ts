import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import telegramRoutes from '../src/modules/telegram/telegram.routes';
import { drawTrendPng } from '../src/services/chart-snapshot.service';
import { createTestServer, makeToken, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;

before(async () => {
  server = await createTestServer((app) => app.use('/api/telegram', telegramRoutes));
  adminToken = makeToken('SUPERADMIN');
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function json(token: string) {
  return { ...auth(token), 'Content-Type': 'application/json' };
}

test('requires authentication for notify and photo', async () => {
  const n = await fetch(server.baseUrl + '/api/telegram/notify', { method: 'POST' });
  assert.strictEqual(n.status, 401);
  const p = await fetch(server.baseUrl + '/api/telegram/photo', { method: 'POST' });
  assert.strictEqual(p.status, 401);
});

test('sendMessage text via /notify', async () => {
  const postMock = mock.method(axios, 'post', async () => ({ data: { ok: true } }));

  const res = await fetch(server.baseUrl + '/api/telegram/notify', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({ message: '🔋 แบตเตอรี่ต่ำ!' }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);

  const calls = postMock.mock.calls;
  assert.strictEqual(calls.length, 1);
  const [url, body] = calls[0].arguments as [string, any];
  assert.match(url, /sendMessage$/);
  assert.strictEqual(body.chat_id, process.env.TELEGRAM_CHAT_ID);
  assert.strictEqual(body.text, '🔋 แบตเตอรี่ต่ำ!');
});

test('photo route validates inputs', async () => {
  // ไม่มีทั้ง photo และ file
  const r1 = await fetch(server.baseUrl + '/api/telegram/photo', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({}),
  });
  assert.strictEqual(r1.status, 400);

  // file path นอกโฟลเดอร์ที่อนุญาต → 403 (policy)
  const r2 = await fetch(server.baseUrl + '/api/telegram/photo', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({ file: '/nonexistent/photo.jpg' }),
  });
  assert.strictEqual(r2.status, 403);

  // file path อยู่ในโฟลเดอร์ที่อนุญาตแต่ไฟล์ไม่มีจริง → 404
  const r3 = await fetch(server.baseUrl + '/api/telegram/photo', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({ file: path.join(os.tmpdir(), 'missing-telegram-photo.jpg') }),
  });
  assert.strictEqual(r3.status, 404);
});

test('sendPhoto by URL', async () => {
  const postMock = mock.method(axios, 'post', async () => ({ data: { ok: true } }));

  const res = await fetch(server.baseUrl + '/api/telegram/photo', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({ photo: 'https://example.com/snapshot.jpg', caption: '🌧️ ตรวจพบฝน' }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.source, 'url');

  const calls = postMock.mock.calls;
  assert.strictEqual(calls.length, 1);
  const [url, form] = calls[0].arguments as [string, FormData];
  assert.match(url, /sendPhoto$/);
  assert.ok(form instanceof FormData);
  assert.strictEqual(form.get('chat_id'), process.env.TELEGRAM_CHAT_ID);
  assert.strictEqual(form.get('caption'), '🌧️ ตรวจพบฝน');
  assert.strictEqual(form.get('photo'), 'https://example.com/snapshot.jpg');
});

test('sendPhoto by local file (multipart upload)', async () => {
  const postMock = mock.method(axios, 'post', async () => ({ data: { ok: true } }));

  const tmp = path.join(os.tmpdir(), 'telegram-test-snapshot.jpg');
  fs.writeFileSync(tmp, Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // fake JPEG header

  const res = await fetch(server.baseUrl + '/api/telegram/photo', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({ file: tmp }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.source, tmp);

  const calls = postMock.mock.calls;
  assert.strictEqual(calls.length, 1);
  const [url, form] = calls[0].arguments as [string, FormData];
  assert.match(url, /sendPhoto$/);
  const photo = form.get('photo') as Blob;
  assert.ok(photo instanceof Blob);
  assert.strictEqual(photo.size, 4);

  fs.rmSync(tmp, { force: true });
});

test('sendPhoto uploads PNG buffer as image/png (filename snapshot.png)', async () => {
  const postMock = mock.method(axios, 'post', async () => ({ data: { ok: true } }));

  // สร้าง PNG จริงจาก encoder ของระบบ (จำลอง snapshot จาก alert critical)
  const png = drawTrendPng([
    { time: 1, value: 20 },
    { time: 2, value: 25 },
    { time: 3, value: 22 },
  ], 320, 160);
  const tmp = path.join(os.tmpdir(), 'telegram-test-snapshot.png');
  fs.writeFileSync(tmp, png);

  const res = await fetch(server.baseUrl + '/api/telegram/photo', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({ file: tmp, caption: '📈 แนวโน้ม temperature' }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);

  const calls = postMock.mock.calls;
  assert.strictEqual(calls.length, 1);
  const [url, form] = calls[0].arguments as [string, FormData];
  assert.match(url, /sendPhoto$/);
  const photo = form.get('photo') as any;
  assert.ok(photo instanceof Blob);
  assert.strictEqual(photo.type, 'image/png');
  assert.strictEqual(photo.size, png.length);
  assert.strictEqual(form.get('caption'), '📈 แนวโน้ม temperature');

  fs.rmSync(tmp, { force: true });
});

test('returns success:false when send fails', async () => {
  mock.method(axios, 'post', async () => {
    throw new Error('telegram api down');
  });

  const res = await fetch(server.baseUrl + '/api/telegram/notify', {
    method: 'POST',
    headers: json(adminToken),
    body: JSON.stringify({ message: 'test' }),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, false);
});
