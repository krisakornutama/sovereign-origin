// ─────────────────────────────────────────────────────────────────────────────
// หัวใจของเทสต์: ตัดสิน migration head ของ backup-restore-check ให้ถูกเจตนา
//
// ปัญหาที่จับ (เจอจริง 8/11/2569): dump 03:00 ถูกถ่ายก่อน migration
//   `20261107190001_non_prisma_objects` ถูก apply ลง live ตอนกลางวัน
//   → head จริง (ใหม่กว่า) ≠ head กู้ (จาก dump ที่เก่ากว่า)
//   → logic เดิม `live !== restored → problems.push('migration head ไม่ตรง')` เด้งแดง
//   → `--strict` คืน exit 1 → nightly-verify ตัดสิน "backup restore-check ไม่ผ่าน"
//     ทั้งที่ dump กู้คืนได้จริงครบ 150/150 ตาราง
//
// กติกาที่ถูกต้อง:
//   1) head จริง "ใหม่กว่า" head กู้  = ปกติของ snapshot (dump เก่ากว่า live) — ไม่มีปัญหา
//   2) head ตรงกัน                     = สมบูรณ์ — ไม่มีปัญหา
//   3) head กู้ "ใหม่กว่า" head จริง   = ผิดปกติจริง (กู้กลับมามี migration ที่ live ไม่มี)
//                                       = มีการลบ migration ตกจาก live — ต้องแดง
//   4) ค่าใดขาดหาย (null/ว่าง)         = ไม่ตัดสินเอง — ปล่อยให้การตรวจอื่นจับ
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headVerdict } from '../verify/backup-restore-check.mjs';

test('headVerdict: dump เก่ากว่า migration ใหม่ (จริงสูงกว่ากู้, วันเดียวกัน) = ไม่มีปัญหา', () => {
  const r = headVerdict('20261107190001_non_prisma_objects', '20261107190000_baseline');
  assert.equal(r, null);
});

test('headVerdict: dump ย้อนวันก่อน (จริงสูงกว่ากู้ ต่างวัน) = ปกติ — ไม่มีปัญหา', () => {
  const r = headVerdict('20261108120000_newer_one', '20261107190001_non_prisma_objects');
  assert.equal(r, null);
});

test('headVerdict: head ตรงกันเป๊ะ = สมบูรณ์ — ไม่มีปัญหา', () => {
  const r = headVerdict('20261107190001_non_prisma_objects', '20261107190001_non_prisma_objects');
  assert.equal(r, null);
});

test('headVerdict: head กู้สูงกว่าจริง (live ถอยหลัง) = ปัญหาที่ต้องแดง', () => {
  const r = headVerdict('20261107190000_baseline', '20261107190001_non_prisma_objects');
  assert.match(String(r), /กู้สูงกว่าจริง/);
  assert.match(String(r), /ตรวจที่ prisma\/migrations/);
});

test('headVerdict: อ่าน head แตก (null/ว่าง) = ไม่ตัดสินเอง — คืน null ให้การตรวจอื่นจับ', () => {
  assert.equal(headVerdict(null, '20261107190001_non_prisma_objects'), null);
  assert.equal(headVerdict('20261107190001_non_prisma_objects', null), null);
  assert.equal(headVerdict('', ''), null);
});
