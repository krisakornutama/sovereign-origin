#!/usr/bin/env node
// Dashboard data-health — แบนเนอร์ "ข้อมูลบางส่วนโหลดไม่ได้"
//
// เหตุผลที่ต้องมีไฟล์นี้: รอบแรกใช้ error ก้อนเดียวร่วมกันระหว่าง
// /api/dashboard/stats กับ /api/devices/status ⇒ (1) คำขอที่สำเร็จล้าง error ของอีกตัว
// ที่ยังพังอยู่ และ (2) แบนเนอร์กะพริบทุก 5 วิ ตอนเน็ตขาด (ล้ม → ขึ้น → สำเร็จ → หาย)
// กติกาที่ต้องคงอยู่: error แยกต่อ endpoint และแจ้งเมื่อล้มติดกันมากกว่าหนึ่งรอบ
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAILURES_BEFORE_NOTICE,
  initialHealth,
  recordSuccess,
  recordFailure,
  degradedKeys,
} from '../../sovereign-frontend/src/lib/data-health.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DASHBOARD = 'sovereign-frontend/src/pages/dashboard.tsx';

describe('data-health — error แยกต่อ endpoint', () => {
  test('สำเร็จตัวหนึ่งต้องไม่ล้าง error ของอีกตัวที่ยังพัง', () => {
    let h = initialHealth();
    h = recordFailure(h, 'stats', new Error('stats down'));
    h = recordFailure(h, 'stats', new Error('stats down'));
    h = recordFailure(h, 'devices', new Error('devices down'));
    h = recordFailure(h, 'devices', new Error('devices down'));
    assert.deepEqual(degradedKeys(h).sort(), ['devices', 'stats']);

    h = recordSuccess(h, 'stats');
    assert.deepEqual(degradedKeys(h), ['devices'], 'stats สำเร็จแล้ว devices ต้องยังแจ้งอยู่');
  });
});

describe('data-health — แบนเนอร์ไม่กะพริบ', () => {
  test(`ต้องล้มติดกัน ${FAILURES_BEFORE_NOTICE} รอบก่อนแจ้ง`, () => {
    let h = initialHealth();
    h = recordFailure(h, 'stats', new Error('blip'));
    assert.deepEqual(degradedKeys(h), [], 'ล้มรอบเดียว (blip) ต้องยังไม่แจ้ง');
    h = recordFailure(h, 'stats', new Error('blip'));
    assert.deepEqual(degradedKeys(h), ['stats'], 'ล้มติดกันสองรอบต้องแจ้ง');
  });

  test('ล้ม → สำเร็จ → ล้ม = เริ่มนับใหม่ (ไม่แจ้ง)', () => {
    let h = initialHealth();
    h = recordFailure(h, 'stats', new Error('a'));
    h = recordSuccess(h, 'stats');
    h = recordFailure(h, 'stats', new Error('b'));
    assert.deepEqual(degradedKeys(h), []);
  });

  test('สำเร็จซ้ำ ๆ ต้องไม่สร้าง object ใหม่ (ไม่ re-render ทุก 5 วิ)', () => {
    let h = initialHealth();
    const again = recordSuccess(h, 'stats');
    assert.equal(again, h, 'ไม่มีอะไรต้องเคลียร์ = คืน state เดิม');
  });

  test('error ของแต่ละ endpoint ถูกล้างเฉพาะของตัวเอง', () => {
    let h = initialHealth();
    for (let i = 0; i < FAILURES_BEFORE_NOTICE; i++) {
      h = recordFailure(h, 'stats', new Error('s'));
      h = recordFailure(h, 'devices', new Error('d'));
    }
    h = recordSuccess(h, 'devices');
    assert.deepEqual(degradedKeys(h), ['stats']);
    h = recordSuccess(h, 'stats');
    assert.deepEqual(degradedKeys(h), []);
  });
});

describe('dashboard — ต้องใช้ตัวติดตามต่อ endpoint ไม่ใช่ error ก้อนเดียว', () => {
  const src = read(DASHBOARD);

  test('ไม่มี setStatsError ก้อนเดียวแบบเดิม', () => {
    assert.doesNotMatch(src, /setStatsError\s*\(/, 'ต้องไม่มี error ก้อนเดียวร่วมกัน');
  });

  test('ใช้ recordFailure/recordSuccess/degradedKeys จาก lib/data-health', () => {
    assert.match(src, /from '\.\.\/lib\/data-health'/);
    assert.match(src, /recordFailure\(/);
    assert.match(src, /recordSuccess\(/);
    assert.match(src, /degradedKeys\(/);
  });

  test('ทั้งสอง endpoint ถูกติดตามแยกคีย์', () => {
    assert.match(src, /recordFailure\([^)]*'stats'/s);
    assert.match(src, /recordFailure\([^)]*'devices'/s);
  });

  test('แบนเนอร์ยังมีปุ่มลองใหม่และข้อความ th/en ครบ', () => {
    assert.match(src, /dashboard\.partialData/);
    assert.match(src, /dataReloadKey/);
  });
});
