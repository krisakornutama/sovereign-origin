#!/usr/bin/env node
/* ── แกนตัดสินสลิป — ล็อกขอบเขตให้ทดสอบได้โดยไม่ต้องมี DB/เครือข่าย ─────────
   เหตุผล: ถ้าวันหน้ามีคนเผลอ import prisma หรือ fetch เข้าไปในตัวตัดสิน
   เทสต์หน่วยจะรันไม่ได้ทันที (ต้องมี DATABASE_URL) และกติกาเงินจะปนกับ I/O
   เทสต์นี้จึงตรวจ "รูปร่างของโมดูล" ไม่ใช่ผลลัพธ์:
   1) ไม่มี prisma / fetch / axios / process.env ในไฟล์แกนตัดสิน
   2) มี export evaluateSlip + slipKey (ผู้เรียกใช้ทำ unique index)
   3) มีเทสต์คู่กันใน core-api/tests และถูกเก็บโดยสคริปต์ test ของ backend
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SERVICE = 'sovereign-os/core-api/src/services/slip-verify.service.ts';
const TEST = 'sovereign-os/core-api/tests/slipVerify.test.ts';
const PKG = 'sovereign-os/core-api/package.json';

describe('แกนตัดสินสลิป — ขอบเขตบริสุทธิ์', () => {
  test('ไม่แตะ DB/เครือข่าย/env (ทดสอบได้ด้วยข้อมูลล้วน)', () => {
    const src = read(SERVICE);
    assert.doesNotMatch(src, /from\s+['"]@?prisma/, 'ห้าม import prisma');
    assert.doesNotMatch(src, /\bfetch\s*\(/, 'ห้ามเรียก fetch');
    assert.doesNotMatch(src, /from\s+['"]axios['"]/, 'ห้าม import axios');
    assert.doesNotMatch(src, /process\.env/, 'ห้ามอ่าน env (ผู้เรียกเป็นคนส่งค่าเข้ามา)');
  });

  test('export ฟังก์ชันที่ผู้เรียกต้องใช้', () => {
    const src = read(SERVICE);
    for (const name of ['evaluateSlip', 'slipKey', 'toSatang', 'fromSatang', 'normalizePayeeName', 'accountTail']) {
      assert.match(src, new RegExp(`export function ${name}\\b`), `ขาด export ${name}`);
    }
  });

  test('มีเทสต์คู่กันและถูกเก็บโดยสคริปต์ test ของ backend', () => {
    assert.ok(fs.existsSync(path.join(ROOT, TEST)), `ไม่พบ ${TEST}`);
    assert.match(read(TEST), /evaluateSlip/, 'เทสต์ต้องเรียกใช้ตัวตัดสินจริง');
    const pkg = JSON.parse(read(PKG));
    assert.match(pkg.scripts.test, /tests\/\*\.test\.ts/, 'สคริปต์ test ต้องเก็บ tests/*.test.ts');
  });
});
