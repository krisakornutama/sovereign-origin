#!/usr/bin/env node
// กัน backend ล่มเงียบเมื่อ EMQX ถูกหยุด (โหมด core/connected ไม่มี emqx)
// mqtt.js จะ emit 'error' เมื่อต่อ broker ไม่ได้ — ถ้าไม่มี listener, EventEmitter ของ Node
// จะ throw และ kill process ทั้งตัว (ไม่ใช่แค่ log) ⇒ ต้องมี error listener ทุก client
//
// แก้ 16/11/69 หลัง CI-001: relay/ota/scheduler ย้ายไปใช้ `createMqttClient()` จาก
// `src/lib/mqtt-client.ts` (จุดเดียวที่ต่อ broker + ผูก error listener + reconnect ได้ controlled)
// ⇒ ด่านต้องยอมรับทั้งสองทาง: ต่อเองแล้วมี listener ครบ หรือใช้ factory ที่มี listener ให้แล้ว
// (ด่านนี้เคยแดงค้างบน main เพราะยังบังคับให้ทุกไฟล์มี `mqtt.connect` เอง)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FACTORY = 'sovereign-os/core-api/src/lib/mqtt-client.ts';
const FILES = [
  'sovereign-os/core-api/src/workers/mqttIngest.ts',
  'sovereign-os/core-api/src/workers/start.ts',
  'sovereign-os/core-api/src/modules/relay/relay.routes.ts',
  'sovereign-os/core-api/src/modules/ota/ota.routes.ts',
  'sovereign-os/core-api/src/services/ota-status.service.ts',
  'sovereign-os/core-api/src/services/relay-scheduler.service.ts',
];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// คอมเมนต์มีคำว่า mqtt.connect() ได้ (เอกสารในไฟล์) — ตัดทิ้งก่อนนับ ไม่ให้ตัวเลขเฟ้อ
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test(`${FACTORY}: factory ต้องมี mqtt.connect + error listener`, () => {
  const src = stripComments(read(FACTORY));
  const connects = (src.match(/\bmqtt\.connect\s*\(/g) || []).length;
  const errors = (src.match(/\.on\(\s*['"]error['"]/g) || []).length;
  assert.ok(connects > 0, 'factory ต้องเป็นที่เดียวที่ต่อ broker');
  assert.ok(errors >= connects, `factory: mqtt.connect ${connects} จุด แต่ error listener มี ${errors} จุด`);
});

for (const rel of FILES) {
  test(`${rel}: ทุก MQTT client มี error listener (ต่อเอง หรือผ่าน factory)`, () => {
    const src = stripComments(read(rel));
    const connects = (src.match(/\bmqtt\.connect\s*\(/g) || []).length;
    const errors = (src.match(/\.on\(\s*['"]error['"]/g) || []).length;
    const usesFactory = /from\s+['"][^'"]*lib\/mqtt-client['"]/.test(src) && /\bcreateMqttClient\s*\(/.test(src);

    if (connects > 0) {
      assert.ok(errors >= connects, `mqtt.connect ${connects} จุด แต่ error listener มี ${errors} จุด`);
      return;
    }
    assert.ok(usesFactory, 'ไม่มี mqtt.connect และไม่ได้ใช้ createMqttClient() ⇒ client หลุดจากด่านนี้');
  });
}
