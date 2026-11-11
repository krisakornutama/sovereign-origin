// ─────────────────────────────────────────────────────────────
// OTA — ตัวนับ "ใครยังใช้ ?token=" เพื่อบอกว่าเมื่อไรปิดสวิตช์ได้
//
// หลัง SEC-017 (ค่าเริ่มต้นปฏิเสธ query token) ผู้ดูแลยังต้องรู้ว่ามีอุปกรณ์ไหน
// ยังพยายามใช้ ?token= อยู่ ถ้าไม่มีใครใช้แล้วจึงลบ OTA_ALLOW_QUERY_TOKEN ได้
// ตัวนับนี้ไม่ใช่หลักฐานถาวร: เก็บในหน่วยความจำ, จำกัดจำนวน, และอ่านได้เฉพาะ SUPERADMIN
// ─────────────────────────────────────────────────────────────
import './setup-env';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestServer, makeToken, TestServer } from './helpers';

let dir = '';
let server: TestServer;
let mqttClient: any;
let legacy: any;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-ota-legacy-'));
  process.env.OTA_DIR = dir;
  process.env.OTA_TOKEN = 'legacy-token';
  delete process.env.OTA_ALLOW_QUERY_TOKEN;
  fs.writeFileSync(path.join(dir, 'esp32_v9.bin'), Buffer.from('firmware'));

  legacy = await import('../src/modules/ota/ota.legacy');
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

beforeEach(() => legacy.resetLegacyClients());

const url = () => `${server.baseUrl}/api/ota/firmwares/esp32_v9.bin`;
const admin = () => ({ authorization: `Bearer ${makeToken('SUPERADMIN')}` });

test('ตัวนับ: รวมยอดตาม ip+user-agent และบอกว่าปิดสวิตช์ได้หรือยัง', () => {
  const now = Date.now();
  legacy.recordLegacyTokenUse({ ip: '192.168.1.9', userAgent: 'ESP32', accepted: false, now });
  legacy.recordLegacyTokenUse({ ip: '192.168.1.9', userAgent: 'ESP32', accepted: false, now: now + 10 });
  legacy.recordLegacyTokenUse({ ip: '192.168.1.9', userAgent: 'curl', accepted: true, now });

  const fresh = legacy.legacyClientReport({ now });
  assert.equal(fresh.clients.length, 2, 'ip เดียวกันแต่ user-agent ต่างกัน = คนละอุปกรณ์');
  assert.equal(fresh.clients[0].rejected, 2);
  assert.equal(fresh.clients[0].accepted, 0);
  assert.equal(fresh.readyToDisable, false, 'ยังมีการใช้ล่าสุด = ยังปิดสวิตช์ไม่ได้');

  const later = legacy.legacyClientReport({ now: now + 25 * 3600_000 });
  assert.equal(later.readyToDisable, true, 'ไม่มีใครใช้เกินหน้าต่าง 24 ชม. = ปิดสวิตช์ได้');
  assert.equal(later.recentHits, 0);
  assert.ok(later.totalHits >= 3, 'ยอดรวมยังอยู่แม้ไม่มีhit ใหม่');
});

test('ตัวนับ: จำกัดจำนวนรายการ (กันหน่วยความจำบวม)', () => {
  for (let i = 0; i < 260; i += 1) {
    legacy.recordLegacyTokenUse({ ip: `10.0.0.${i % 250}`, userAgent: `ua-${i}`, accepted: false, now: i });
  }
  const report = legacy.legacyClientReport();
  assert.ok(report.clients.length <= 200, `ต้องไม่เกินเพดาน (ได้ ${report.clients.length})`);
});

test('route: ?token= ที่ถูกปฏิเสธต้องถูกนับ และอ่านได้เฉพาะ SUPERADMIN', async () => {
  const blocked = await fetch(`${url()}?token=legacy-token`, { headers: { 'user-agent': 'ESP32-legacy' } });
  assert.equal(blocked.status, 401);

  const report = await fetch(`${server.baseUrl}/api/ota/legacy-clients`, { headers: admin() });
  assert.equal(report.status, 200);
  const body = await report.json() as any;
  assert.equal(body.clients.length, 1, 'ต้องเห็นอุปกรณ์ที่ยังยิงด้วย ?token=');
  assert.equal(body.clients[0].rejected, 1);
  assert.equal(body.readyToDisable, false);

  const asOperator = await fetch(`${server.baseUrl}/api/ota/legacy-clients`, {
    headers: { authorization: `Bearer ${makeToken('OPERATOR')}` },
  });
  assert.equal(asOperator.status, 403, 'รายงานนี้ใช้ตัดสินใจเรื่อง secret — SUPERADMIN เท่านั้น');
});

test('route: ดาวน์โหลดด้วย header ต้องไม่ถูกนับเป็น legacy client', async () => {
  const ok = await fetch(url(), { headers: { 'x-ota-token': 'legacy-token', 'user-agent': 'ESP32-new' } });
  assert.equal(ok.status, 200);

  const report = await fetch(`${server.baseUrl}/api/ota/legacy-clients`, { headers: admin() });
  const body = await report.json() as any;
  assert.deepEqual(body.clients, [], 'อุปกรณ์ที่ส่ง token ทาง header ไม่ใช่ legacy');
  assert.equal(body.readyToDisable, true);
});
