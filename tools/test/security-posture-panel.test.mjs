#!/usr/bin/env node
// Security posture panel — ด่านกัน "แดชบอร์ดความปลอดภัยเขียวปลอม"
//
// กติกาที่ถูกล็อกไว้:
//  1) แผงนี้ต้องดึงจาก endpoint จริง /api/security/posture (ไม่ใช่ค่าคงที่ในโค้ด)
//  2) ต้องใช้ StatusDot + เหตุผลจากแหล่งที่ล้ม (แสดง degraded ไม่ใช่ซ่อน)
//  3) ตรรกะสรุป (overall/attention) ต้องอยู่ใน lib ที่มีเทสต์ (ไม่กระจายใน JSX)
//  4) หน้า /security ต้องเรนเดอร์แผงนี้จริง และต้องไม่เกินเพดาน 800 บรรทัด
//  5) ไฟล์ component ต้องไม่เกินเพดาน 400 บรรทัด
//
// เทสต์ตรรกะ/i18n อยู่ใน sovereign-frontend/src/lib/security/posture.test.ts
// (frontend ไม่มี test runner ในตัว → รันด้วย tsx ของ core-api เหมือนเทสต์ frontend อื่น)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(ROOT, 'sovereign-frontend');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const countLines = (p) => read(p).split(/\r?\n/).length;

const PANEL = 'sovereign-frontend/src/components/security/PosturePanel.tsx';
const LIB = 'sovereign-frontend/src/lib/security/posture.ts';
const PAGE = 'sovereign-frontend/src/pages/security.tsx';
const TH = 'sovereign-frontend/src/i18n/th/pages/security.ts';
const EN = 'sovereign-frontend/src/i18n/en/pages/security.ts';
const TSX_TEST = 'src/lib/security/posture.test.ts';

const requireFromCoreApi = createRequire(path.join(ROOT, 'sovereign-os', 'core-api', 'package.json'));
const TSX_CLI = requireFromCoreApi.resolve('tsx/cli');

describe('security posture — ตรรกะและ i18n', () => {
  test(`frontend suite (tsx): ${TSX_TEST}`, () => {
    const result = spawnSync(process.execPath, [TSX_CLI, TSX_TEST], {
      cwd: FRONTEND,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180_000,
    });

    assert.equal(
      result.status,
      0,
      `${TSX_TEST} ล้ม (exit ${String(result.status)}):\n${result.stdout || ''}\n${result.stderr || ''}`
    );
  });
});

describe('security posture — แผงต้องต่อของจริง', () => {
  test('PosturePanel มีอยู่ และดึง endpoint จริงผ่าน authFetch', () => {
    const src = read(PANEL);
    assert.ok(src.includes('/api/security/posture'), 'ต้องยิง /api/security/posture');
    assert.ok(/authFetch\s*\(/.test(src), 'ต้องใช้ authFetch (แนบ token/401 handling)');
    assert.ok(src.includes('useLanguageStore'), 'ต้องใช้ i18n ผ่าน useLanguageStore');
    assert.ok(src.includes('<StatusDot'), 'ต้องใช้ StatusDot แสดงสถานะต่อแหล่ง');
    assert.ok(src.includes('postureAttention'), 'ต้องใช้ตรรกะ attention จาก lib (ไม่คำนวณใน JSX)');
    assert.ok(src.includes('checkedAt'), 'ต้องแสดงเวลาที่ตรวจ (ผู้ใช้อ่านย้อนได้)');
  });

  test('ต้องมีการแสดงเหตุผลของแหล่งที่อ่านไม่ได้ ไม่ใช่ซ่อน/เขียว', () => {
    const src = read(PANEL);
    assert.ok(/unavailable/.test(src), 'ต้องมีเส้นทาง unavailable');
    assert.ok(/reason/.test(src), 'ต้องแสดงเหตุผล');
    assert.ok(/degraded/.test(src), 'ต้องแยกสถานะ degraded');
  });

  test('ห้ามฝังค่า "ทุกอย่างปกติ" ไว้ในโค้ด', () => {
    const src = read(PANEL);
    assert.ok(!/overall\s*[:=]\s*['"]ok['"]/.test(src), 'ห้าม hardcode overall ok');
    assert.ok(!/available\s*[:=]\s*6/.test(src), 'ห้าม hardcode จำนวนแหล่งที่อ่านได้');
  });

  test('เพดานบรรทัด component ≤ 400', () => {
    const lines = countLines(PANEL);
    assert.ok(lines <= 400, `${PANEL} ยาว ${lines} บรรทัด (เพดาน 400) — แยกส่วนออก`);
  });
});

describe('security posture — ต่อเข้าหน้า /security', () => {
  test('หน้า /security import และเรนเดอร์ PosturePanel', () => {
    const src = read(PAGE);
    assert.ok(/from '\.\.\/components\/security\/PosturePanel'/.test(src), 'ต้อง import PosturePanel');
    assert.ok(/<PosturePanel\b/.test(src), 'ต้องเรนเดอร์ <PosturePanel />');
    assert.equal(src.match(/<PosturePanel\b/g).length, 1, 'เรนเดอร์ซ้ำ = ยิง API ซ้ำโดยไม่จำเป็น');
  });

  test('หน้า /security ยังอยู่ใต้เพดาน 800 บรรทัด', () => {
    const lines = countLines(PAGE);
    assert.ok(lines <= 800, `${PAGE} ยาว ${lines} บรรทัด (เพดาน 800)`);
  });

  test('i18n th/en มีคีย์ posture (ตัวจริงตรวจละเอียดใน tsx suite)', () => {
    assert.ok(/posture\s*:/.test(read(TH)), 'th/pages/security.ts ต้องมี posture');
    assert.ok(/posture\s*:/.test(read(EN)), 'en/pages/security.ts ต้องมี posture');
  });

  test('lib ต้องมีอยู่จริง (ไม่ inline ตรรกะไว้ใน component)', () => {
    assert.ok(fs.existsSync(path.join(ROOT, LIB)), `${LIB} หายไป`);
  });
});
