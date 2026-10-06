#!/usr/bin/env node
/* กันดักบล็อก auto ใน docs/modules — เครื่องมือ gen ต้อง "เขียนทับบล็อกเดิม"
   ไม่ใช่ append เพิ่มทุกรัน (บั๊กจริง: marker ในไฟล์เป็นรูปแบบ suffixed
   `<!-- auto:begin — ส่วนนี้ gen ... -->` แต่โค้ดเช็ค `<!-- auto:begin -->`
   แบบเป๊ะ → ไม่เคย match → ทุกรัน append → บล็อกซ้ำงอกไม่รู้จบ)

   เขียนก่อนแก้โค้ด → ต้องแดงก่อน (exit 1) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyAutoBlock } from '../auto-doc-block.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SUFFIXED = (body) =>
  `<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->\n${body}\n<!-- auto:end -->`;

test('marker แบบ suffixed (รูปจริงในไฟล์) ต้องถูกเขียนทับ ไม่ใช่ append', () => {
  const cur = ['# หัวเรื่องเขียนมือ', '', SUFFIXED('ของเก่า'), '', 'ท้ายเรื่องเขียนมือ', ''].join('\n');
  const next = applyAutoBlock(cur, SUFFIXED('ของใหม่'));
  assert.ok(next !== null, 'มี marker ต้องคืนผล (ไม่ใช่ null)');
  assert.equal(next.match(/<!-- auto:begin/g).length, 1, 'ต้องมีบล็อกเดียว');
  assert.ok(next.includes('ของใหม่'), 'ของใหม่ต้องอยู่ในผลลัพธ์');
  assert.ok(!next.includes('ของเก่า'), 'ของเก่าต้องหายไป');
  assert.ok(next.includes('# หัวเรื่องเขียนมือ') && next.includes('ท้ายเรื่องเขียนมือ'),
    'เนื้อหาเขียนมือก่อน/หลังบล็อกต้องไม่โดนแตะ');
});

test('บล็อกซ้ำ (ผลจากการ append ผิดรอบก่อน) ต้องถูกลงให้เหลือ 1', () => {
  const cur = [
    'ข้อความเขียนมือ A', '',
    SUFFIXED('รอบแรก'), '',
    'ข้อความเขียนมือ B', '',
    SUFFIXED('รอบสอง'), '',
  ].join('\n');
  const next = applyAutoBlock(cur, SUFFIXED('รอบใหม่'));
  assert.ok(next !== null);
  assert.equal(next.match(/<!-- auto:begin/g).length, 1, 'ซ้ำกี่อันก็ต้องเหลือ 1');
  assert.ok(next.includes('รอบใหม่') && !next.includes('รอบแรก') && !next.includes('รอบสอง'));
  assert.ok(next.includes('ข้อความเขียนมือ A') && next.includes('ข้อความเขียนมือ B'),
    'เนื้อหาเขียนมือระหว่างบล็อกซ้ำต้องรอด');
});

test('marker แบบเป๊ะ <!-- auto:begin --> (รูปดั้งเดิมในคอมเมนต์เครื่องมือ) ยังใช้ได้', () => {
  const cur = ['หัว', '<!-- auto:begin -->\nเก่า\n<!-- auto:end -->', 'ท้าย'].join('\n');
  const next = applyAutoBlock(cur, '<!-- auto:begin -->\nใหม่\n<!-- auto:end -->');
  assert.ok(next !== null);
  assert.equal(next.match(/<!-- auto:begin/g).length, 1);
  assert.ok(next.includes('ใหม่') && !next.includes('เก่า'));
});

test('ไม่มี marker เลย = คืน null (คนละเคส — ให้ผู้เรียกตัดสินใจ append เอง)', () => {
  assert.equal(applyAutoBlock('เอกสารเขียนมือล้วน ไม่มี marker', 'x'), null);
});

test('ผลลัพธ์ทุกไฟล์จริงใน repo: มีบล็อก auto อย่างมากสุด 1 ชุด (กัน append ซ้ำกลับมา)', () => {
  const dir = path.join(ROOT, 'docs', 'modules');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const count = (text.match(/<!-- auto:begin/g) || []).length;
    if (count > 1) bad.push(`${f}=${count}`);
    if (!text.includes('<!-- auto:end -->') && count > 0) bad.push(`${f}=unclosed`);
  }
  assert.deepEqual(bad, [], `ไฟล์ที่มีบล็อกซ้ำ/ปิดไม่สนิท: ${bad.join(', ')}`);
});
