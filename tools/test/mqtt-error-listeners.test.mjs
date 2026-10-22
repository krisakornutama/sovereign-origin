#!/usr/bin/env node
// กัน backend ล่มเงียบเมื่อ EMQX ถูกหยุด (โหมด core/connected ไม่มี emqx)
// mqtt.js จะ emit 'error' เมื่อต่อ broker ไม่ได้ — ถ้าไม่มี listener, EventEmitter ของ Node
// จะ throw และ kill process ทั้งตัว (ไม่ใช่แค่ log) ⇒ ต้องมี error listener ทุก client
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = [
  'sovereign-os/core-api/src/workers/mqttIngest.ts',
  'sovereign-os/core-api/src/workers/start.ts',
  'sovereign-os/core-api/src/modules/relay/relay.routes.ts',
  'sovereign-os/core-api/src/modules/ota/ota.routes.ts',
  'sovereign-os/core-api/src/services/ota-status.service.ts',
  'sovereign-os/core-api/src/services/relay-scheduler.service.ts',
];

for (const rel of FILES) {
  test(`${rel}: ทุก mqtt.connect มี error listener`, () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const connects = (src.match(/\bmqtt\.connect\s*\(/g) || []).length;
    const errors = (src.match(/\.on\(\s*['"]error['"]/g) || []).length;
    assert.ok(connects > 0, 'ต้องมี mqtt.connect อย่างน้อย 1 จุด');
    assert.ok(errors >= connects, `mqtt.connect ${connects} จุด แต่ error listener มี ${errors} จุด`);
  });
}
