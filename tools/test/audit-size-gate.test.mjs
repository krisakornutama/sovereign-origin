// I3d — ด่านขนาด audit_logs (กันโตเงียบอีกสาย)
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSizeVerdict, DEFAULT_AUDIT_WARN_MB, DEFAULT_AUDIT_WARN_ROWS } from '../lib/audit-size-gate.mjs';

test('ขนาดปกติ = ไม่เตือน', () => {
  assert.equal(auditSizeVerdict({ totalMb: 12.4, rows: 26901 }), null);
});

test('เกินขนาด MB = เตือน พร้อมบอกตัวเลข', () => {
  const v = auditSizeVerdict({ totalMb: DEFAULT_AUDIT_WARN_MB + 1, rows: 100 });
  assert.equal(v.level, 'warn');
  assert.match(v.message, /audit_logs/);
  assert.match(v.message, new RegExp(String(DEFAULT_AUDIT_WARN_MB)));
});

test('เกินจำนวนแถว = เตือน', () => {
  const v = auditSizeVerdict({ totalMb: 1, rows: DEFAULT_AUDIT_WARN_ROWS + 1 });
  assert.equal(v.level, 'warn');
  assert.match(v.message, /แถว/);
});

test('ปรับเกณฑ์ผ่าน env ได้', () => {
  assert.equal(auditSizeVerdict({ totalMb: 50, rows: 10, warnMb: 100, warnRows: 1000 }), null);
  assert.equal(auditSizeVerdict({ totalMb: 150, rows: 10, warnMb: 100, warnRows: 1000 }).level, 'warn');
});

test('ค่าอ่านไม่ได้ = ไม่เตือน (ไม่สร้างสัญญาณรบกวน)', () => {
  assert.equal(auditSizeVerdict({ totalMb: NaN, rows: NaN }), null);
});
