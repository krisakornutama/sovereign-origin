#!/usr/bin/env node
// เทสต์ตัวคุมความถี่ของ synthetic browser check
// ปัญหาจริง: task ถูกตั้งทุก 5 นาที แต่ละรอบเปิด WebKit/Chromium 3 โปรไฟล์
// → แล็ปท็อปมี Chrome/Node ตื่นทั้งวันแม้ไม่มีคนใช้แอป
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldRunSynthetic, readLastRunMs, DEFAULT_MIN_INTERVAL_MS } from '../synthetic-schedule.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIN = 60_000;

describe('shouldRunSynthetic', () => {
  test('ไม่มีประวัติ → รัน', () => {
    assert.equal(shouldRunSynthetic({ lastRunMs: 0, now: 1000 }), true);
  });

  test('เพิ่งรันไป 29 นาที → ข้าม (ค่าเริ่มต้น 30 นาที)', () => {
    const now = 1_000_000_000;
    assert.equal(shouldRunSynthetic({ lastRunMs: now - 29 * MIN, now }), false);
    assert.equal(DEFAULT_MIN_INTERVAL_MS, 30 * MIN);
  });

  test('ครบ 30 นาที → รัน', () => {
    const now = 1_000_000_000;
    assert.equal(shouldRunSynthetic({ lastRunMs: now - 30 * MIN, now }), true);
  });

  test('--force ต้องรันเสมอ', () => {
    const now = 1_000_000_000;
    assert.equal(shouldRunSynthetic({ lastRunMs: now - MIN, now, force: true }), true);
  });

  test('เวลาของไฟล์อยู่ในอนาคต (clock skew) → รัน ไม่ค้างตลอดกาล', () => {
    const now = 1_000_000_000;
    assert.equal(shouldRunSynthetic({ lastRunMs: now + 5 * MIN, now }), true);
  });

  test('อ่านไฟล์ที่ไม่มี/ค่าเสีย → 0 (ให้รัน)', () => {
    const file = path.join(ROOT, '.freebuff', 'synthetic-last-run-missing.txt');
    try { fs.unlinkSync(file); } catch { /* ไม่มีก็ดี */ }
    assert.equal(readLastRunMs(file), 0);
  });
});

describe('wiring', () => {
  test('synthetic-browser-check ใช้ตัวคุมความถี่ + state file ใน infra/logs', () => {
    const src = fs.readFileSync(path.join(ROOT, 'sovereign-frontend', 'scripts', 'synthetic-browser-check.mjs'), 'utf8');
    assert.match(src, /shouldRunSynthetic/);
    assert.match(src, /synthetic-check\.last-run/);
  });
});
