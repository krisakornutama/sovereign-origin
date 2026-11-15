// occupancy input — PUT /api/actuation/occupancy ต้องไม่เดาเกินข้อมูล
//
// กฎ OCCUPANCY กัน AI ปิดน้ำ/เน็ตเมื่อ "มีคน" หรือ "ไม่รู้" ⇒ ค่าที่ผู้ใช้ส่งมาต้องแปล
// ตรงตัว: `!!v` เดิมทำให้ "false" (สตริง) กลายเป็น true และ 0 กลายเป็น false เงียบ ๆ
// ซึ่งเปลี่ยนผลการตัดสินความปลอดภัยโดยไม่มีใครรู้
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseOccupancyInput } from '../src/services/actuation-occupancy';

test('parseOccupancyInput: ค่าที่ชัดเจนเท่านั้นที่แปลเป็น boolean', () => {
  for (const v of [true, 1, 'true', 'TRUE', 'occupied', 'yes', 'on']) {
    assert.deepEqual(parseOccupancyInput(v), { ok: true, value: true }, `ควรเป็น true: ${JSON.stringify(v)}`);
  }
  for (const v of [false, 0, 'false', 'FALSE', 'empty', 'no', 'off']) {
    assert.deepEqual(parseOccupancyInput(v), { ok: true, value: false }, `ควรเป็น false: ${JSON.stringify(v)}`);
  }
});

test('parseOccupancyInput: "ไม่รู้" ต้องตั้งใจส่ง ไม่ใช่ค่าที่พิมพ์ผิด', () => {
  for (const v of [null, undefined, 'unknown', 'UNKNOWN', '']) {
    assert.deepEqual(parseOccupancyInput(v ?? null), { ok: true, value: null }, `ควรเป็น null: ${JSON.stringify(v)}`);
  }
  // ค่าที่ไม่รู้จักต้องถูกปฏิเสธ ไม่ใช่เดาเป็น false/true
  for (const v of ['maybe', 2, -1, {}, [], '1.0', NaN, 0.5]) {
    assert.equal(parseOccupancyInput(v).ok, false, `ต้องปฏิเสธ: ${JSON.stringify(v)}`);
  }
});
