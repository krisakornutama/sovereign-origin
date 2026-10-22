#!/usr/bin/env node
// เทสต์นโยบาย build ของ verify: prod :3000 ต้องไม่ถูกทับ .next
// เคสจริง 22/10/69: build ใหม่เขียน .next ตอน 15:53 แต่ server เปิดตั้งแต่ 15:13
// → HTML อ้าง _buildManifest.js ของ build เก่า → 404 → ค้าง "กำลังโหลด..."
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldIsolateProdBuild } from '../verify-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('shouldIsolateProdBuild', () => {
  test('prod กำลัง serve + ไม่มี e2e → build แยก', () => {
    assert.equal(shouldIsolateProdBuild({ e2e: false, listenerPid: 1234, serverKind: true }), true);
  });

  test('จับชนิด server ไม่ได้ (null) → ถือเป็น prod เพื่อความปลอดภัย', () => {
    assert.equal(shouldIsolateProdBuild({ e2e: false, listenerPid: 1234, serverKind: null }), true);
  });

  test('dev ชัดเจน → ใช้ .next ตามเดิม', () => {
    assert.equal(shouldIsolateProdBuild({ e2e: false, listenerPid: 1234, serverKind: false }), false);
  });

  test('ไม่มีใครฟัง :3000 → ใช้ .next ตามเดิม', () => {
    assert.equal(shouldIsolateProdBuild({ e2e: false, listenerPid: 0, serverKind: false }), false);
  });

  test('โหมด e2e ต้องใช้ .next + restart prod ตามเดิม', () => {
    assert.equal(shouldIsolateProdBuild({ e2e: true, listenerPid: 1234, serverKind: true }), false);
  });
});

describe('wiring', () => {
  test('verify.mjs ตั้ง NEXT_DIST_DIR และคืน next-env.d.ts', () => {
    const src = read('tools/verify.mjs');
    assert.match(src, /shouldIsolateProdBuild/);
    assert.match(src, /NEXT_DIST_DIR/);
    assert.match(src, /next-env\.d\.ts/);
  });

  test('nightly-verify ไม่ build ทับ .next ของ prod (non-e2e + .next-verify)', () => {
    const src = read('tools/nightly-verify.mjs');
    assert.match(src, /NEXT_DIST_DIR:\s*'\.next-verify'/);
    assert.match(src, /const script = 'verify';/);
  });

  test('nightly-gate: verify ลง .next-verify และไม่ kill prod ที่ healthy', () => {
    const src = read('tools/verify/nightly-gate.mjs');
    assert.match(src, /NEXT_DIST_DIR:\s*'\.next-verify'/);
    const body = src.slice(src.indexOf('async function ensureProdFrontend'), src.indexOf('// ── gate'));
    assert.ok(body.length > 0, 'ต้องพบ ensureProdFrontend');
    assert.doesNotMatch(body, /taskkill|netstat/);
  });
});
