// ─────────────────────────────────────────────────────────────
// OTA — สวิตช์ปิดการรับ token ทาง query string
//
// เป้าหมาย: token ไม่ควรเดินทางใน URL (ติด log/ประวัติ) ⇒ ค่าเริ่มต้นต้องรับเฉพาะ header
// แต่ต้องมีทางออกให้อุปกรณ์ที่แฟลชด้วยสัญญาเดิม (?token=) ระหว่างทยอยอัปเดต
//   OTA_ALLOW_QUERY_TOKEN=1 → รับ query ได้ชั่วคราว; ค่าอื่น/ไม่ตั้ง = ปฏิเสธ
// ─────────────────────────────────────────────────────────────
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAllowQueryToken, resolveDownloadToken } from '../src/modules/ota/ota.access';
import { createTestServer, TestServer } from './helpers';

const TOKEN = 'ota-legacy-token';

test('parseAllowQueryToken: เปิดเฉพาะค่าที่ชัดเจน ค่าอื่นทั้งหมด = ปิด (fail closed)', () => {
  for (const raw of ['1', 'true', 'TRUE', 'yes', 'on', ' on ']) {
    assert.equal(parseAllowQueryToken(raw), true, `${raw} ต้องเปิด`);
  }
  for (const raw of ['', '   ', '0', 'false', 'no', 'off', 'maybe', '2', null, undefined]) {
    assert.equal(parseAllowQueryToken(raw as any), false, `${String(raw)} ต้องปิด`);
  }
});

test('resolveDownloadToken: header มาก่อน และ query ถูกใช้เฉพาะเมื่อเปิดสวิตช์', () => {
  assert.equal(resolveDownloadToken({ headerToken: 'h', queryToken: 'q', allowQueryToken: true }), 'h');
  assert.equal(resolveDownloadToken({ headerToken: 'h', queryToken: 'q', allowQueryToken: false }), 'h');
  assert.equal(resolveDownloadToken({ headerToken: '', queryToken: 'q', allowQueryToken: false }), null);
  assert.equal(resolveDownloadToken({ headerToken: null, queryToken: 'q', allowQueryToken: true }), 'q');
});

// ── route-level: ยืนยันว่าสวิตช์มีผลจริงกับ endpoint ──
let dir = '';
let server: TestServer;
let mqttClient: any;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-ota-query-'));
  process.env.OTA_DIR = dir;
  process.env.OTA_TOKEN = TOKEN;
  delete process.env.OTA_ALLOW_QUERY_TOKEN;
  fs.writeFileSync(path.join(dir, 'esp32_v3.bin'), Buffer.from('firmware'));
  const mod = await import('../src/modules/ota/ota.routes');
  mqttClient = mod.mqttClient;
  server = await createTestServer((app) => app.use('/api/ota', mod.default));
});

after(async () => {
  delete process.env.OTA_ALLOW_QUERY_TOKEN;
  mqttClient?.end?.(true);
  if (server) await server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const url = () => `${server.baseUrl}/api/ota/firmwares/esp32_v3.bin`;

test('ค่าเริ่มต้น (ไม่ตั้ง env): ?token= ถูกปฏิเสธ แต่ header ยังใช้ได้', async () => {
  delete process.env.OTA_ALLOW_QUERY_TOKEN;
  const viaQuery = await fetch(`${url()}?token=${TOKEN}`);
  assert.equal(viaQuery.status, 401, 'ค่าเริ่มต้นต้องไม่รับ token จาก URL');

  const viaHeader = await fetch(url(), { headers: { 'x-ota-token': TOKEN } });
  assert.equal(viaHeader.status, 200);
});

test('OTA_ALLOW_QUERY_TOKEN=1: รับ ?token= ชั่วคราวให้อุปกรณ์รุ่นเดิม', async () => {
  process.env.OTA_ALLOW_QUERY_TOKEN = '1';
  const viaQuery = await fetch(`${url()}?token=${TOKEN}`);
  assert.equal(viaQuery.status, 200);

  const wrongQuery = await fetch(`${url()}?token=wrong`);
  assert.equal(wrongQuery.status, 401, 'เปิดสวิตช์แล้วก็ยังต้องเทียบ token ให้ตรง');
});

test('ค่าที่ไม่รู้จัก (เช่น "yes-please") ไม่เปิดสวิตช์', async () => {
  process.env.OTA_ALLOW_QUERY_TOKEN = 'yes-please';
  const viaQuery = await fetch(`${url()}?token=${TOKEN}`);
  assert.equal(viaQuery.status, 401);
});
