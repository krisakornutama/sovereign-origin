#!/usr/bin/env node
// กันการถอยหลัง: watchdog ต้องอ่านโหมดจาก runtime-layers ไม่ใช่ hardcode
// (ถ้า hardcode, การ stop emqx/wazuh จะถูกปลุกกลับทุก 1 นาที และ "ชั้น" จะไม่มีความหมาย)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('docker-watchdog ใช้ watchContainerNamesForMode และไม่ hardcode รายชื่อเดิม', () => {
  const src = read('tools/docker-watchdog.mjs');
  assert.match(src, /runtime-layers\.mjs/);
  assert.match(src, /watchContainerNamesForMode/);
  assert.doesNotMatch(src, /const CONTAINERS = \['sovereign-db', 'sovereign-core-api', 'sovereign-emqx'\]/);
});

test('frontend-watchdog เคารพโหมด: ไม่บูตเว็บเมื่อโหมดไม่มี web', () => {
  const src = read('tools/frontend-watchdog.mjs');
  assert.match(src, /runtime-layers\.mjs/);
  assert.match(src, /modeHasWeb/);
  // ต้องมีทางออกก่อน bootProd — ตรวจว่าการเช็ค mode อยู่ก่อนฟังก์ชัน bootProd ในลำดับการรัน
  const modeIdx = src.indexOf('modeHasWeb(');
  const bootIdx = src.indexOf('bootProd();');
  assert.ok(modeIdx > 0, 'ต้องเรียก modeHasWeb');
  assert.ok(bootIdx > modeIdx, 'ต้องเช็คโหมดก่อน bootProd');
});
