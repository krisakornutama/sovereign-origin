// เทสต์ตรรกะเทียบผล restore ของ backup-restore-check
//
// บทเรียนจริง 7/11/69: nightly ล้มเพราะ `system_settings` ใน dump มี 12 แถว
// แต่ฐานจริงเหลือ 10 — สาเหตุคือล้าง DB override (telegram.botToken/chatId)
// หลังถ่าย backup ซึ่งเป็นเรื่องปกติ ไม่ใช่ backup เสีย
// เทสต์นี้ล็อกว่า "ต่างสองทาง" ไม่ถูกตีเป็นความผิด และของที่ผิดจริงยังถูกจับ
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareTableCounts } from '../verify/restore-compare.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('ตารางที่ฐานจริงมีแต่กู้ไม่ได้ = missing (ผิดปกติ)', () => {
  const live = new Map([['users', 7], ['audit_logs', 100]]);
  const restored = new Map([['users', 7]]);
  const r = compareTableCounts(live, restored);
  assert.deepEqual(r.missing, ['audit_logs']);
  assert.deepEqual(r.moreInLive, []);
  assert.deepEqual(r.moreInRestore, []);
});

test('dump เก่ากว่าเวลาถ่าย = moreInLive (ปกติ)', () => {
  const live = new Map([['users', 9]]);
  const restored = new Map([['users', 7]]);
  const r = compareTableCounts(live, restored);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.moreInLive, [{ table: 'users', live: 9, restored: 7 }]);
  assert.deepEqual(r.moreInRestore, []);
});

test('ลบแถวหลังถ่าย backup = moreInRestore (ปกติ ไม่ใช่ backup เสีย)', () => {
  const live = new Map([['system_settings', 10]]);
  const restored = new Map([['system_settings', 12]]);
  const r = compareTableCounts(live, restored);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.moreInLive, []);
  assert.deepEqual(r.moreInRestore, [{ table: 'system_settings', live: 10, restored: 12 }]);
});

test('ตารางที่เพิ่มหลังถ่าย backup ไม่ถูกนับเป็นปัญหา', () => {
  const live = new Map([['users', 7], ['brand_new', 3]]);
  const restored = new Map([['users', 7], ['old_table', 1]]);
  const r = compareTableCounts(live, restored);
  assert.deepEqual(r.missing, ['brand_new']);
  assert.deepEqual(r.moreInLive, []);
  assert.deepEqual(r.moreInRestore, []);
});

test('backup-restore-check ใช้ compareTableCounts และไม่ตี moreInRestore เป็นปัญหา', () => {
  const src = readFileSync(join(ROOT, 'tools', 'verify', 'backup-restore-check.mjs'), 'utf8');
  assert.match(src, /compareTableCounts\(live, restored\)/, 'ต้องใช้ตัวเทียบที่เทสต์แล้ว');
  assert.doesNotMatch(src, /ตารางที่ข้อมูลมากกว่าฐานจริง/, 'ห้ามตี dump มีมากกว่าจริงเป็นปัญหา');
  assert.match(src, /tablesWithFewerLiveRows/, 'ต้องบันทึกจำนวนตารางที่ dump มีมากกว่าไว้ดู trend');
});
