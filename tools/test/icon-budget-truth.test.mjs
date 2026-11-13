// icon-budget-truth — Icon.tsx เกินเพดาน component ต้องแยกตารางข้อมูลออก (FE-001)
//
// เหตุผล: components/ui/Icon.tsx 653 บรรทัด > เพดาน component 400 — เนื้อหาเป็น
//   ตารางรูปทรงไอคอนล้วน (79 ไอคอน / 244 SVG element) ไม่ใช่ logic
// แก้แล้ว: ตาราง ICONS ย้าย verbatim ไป lib/iconPaths.tsx (lib ไม่มีเพดานบรรทัด
//   ตามกติกา gate) — Icon.tsx คง API เดิมทุกอย่างเพื่อ 102 ไฟล์ที่ import อยู่
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ICON_FILE = path.join(ROOT, 'sovereign-frontend', 'src', 'components', 'ui', 'Icon.tsx');
const LIB_FILE = path.join(ROOT, 'sovereign-frontend', 'src', 'lib', 'iconPaths.tsx');

test('Icon.tsx ต้องจัดขนาดลง ≤ 400 บรรทัด (เพดาน components)', () => {
  const n = readFileSync(ICON_FILE, 'utf8').split('\n').length;
  assert.ok(n <= 400, `Icon.tsx = ${n} บรรทัด > เพดาน 400 — ต้องย้ายตาราง ICONS ไป lib/iconPaths.tsx`);
});

test('ตาราง ICONS ต้องอยู่ที่ lib/iconPaths.tsx ครบทั้ง 79 ไอคอน 243 รูปทรงในตาราง (ย้ายตามเดิม)', () => {
  const src = readFileSync(LIB_FILE, 'utf8');
  assert.match(src, /export const ICONS/, 'lib/iconPaths.tsx ต้อง export ICONS');
  const keys = src.match(/^  [A-Za-z][\w]*: \(\n/gm);
  assert.ok(keys && keys.length >= 79, `ต้องมีไอคอนครบ ≥ 79 (ได้ ${keys ? keys.length : 0})`);
  const els = src.match(/<(rect|circle|path|line|polyline|polygon|g)\b/g);
  assert.ok(els && els.length >= 243, `ต้องมีรูปทรง SVG ครบ ≥ 243 ในตาราง (ได้ ${els ? els.length : 0}) — อีก 1 (fallback วงกลม) อยู่ใน Icon.tsx`);
});

test('API สาธารณะของ Icon ต้องคงเดิม (default export + type IconName + fallback วงกลม)', () => {
  const src = readFileSync(ICON_FILE, 'utf8');
  assert.match(src, /export type IconName/, 'Icon.tsx ต้อง re-export type IconName (102 ไฟล์ import อยู่)');
  assert.match(src, /export default Icon/, 'Icon.tsx ต้องมี default export Icon');
  assert.match(src, /ICONS\[name\] \?\? <circle/, 'ต้องคง fallback วงกลมเมื่อไม่รู้จักชื่อ icon');
});
