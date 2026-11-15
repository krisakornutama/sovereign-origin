// livestock-page-budget-truth — pages/livestock.tsx เกินเพดาน 800 ต้องย้าย tabs ออก (FE-003)
//
// เหตุผล: pages/livestock.tsx 860 บรรทัด > เพดาน page 800 — เกิน 60
// โครงอำนวย: 6 tab + GroupSelect เป็น top-level function แยกอยู่แล้วในไฟล์เดียวกัน
// วิธีแก้: ย้าย tab ไป components/livestock/*.tsx (ไฟล์ตาม tab — ทุกไฟล์ต้อง ≤ 400 ตามเพดาน
//   component) + constants/type ร่วมไป lib/livestock-helpers.ts — ย้าย verbatim
//   ไม่เปลี่ยนพฤติกรรมหน้า และ props ของ tab ทุกตัวคงเดิม
// หมายเหตุ: GroupSelect ถูกใช้เฉพาะภายใน tabs (MedicalTab/ProductionTab) — หน้าไม่ import ตรง
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'sovereign-frontend', 'src');
const PAGE = path.join(FE, 'pages', 'livestock.tsx');
const HELPERS = path.join(FE, 'lib', 'livestock-helpers.ts');
const TAB_FILES = [
  'components/livestock/GroupsTab.tsx',
  'components/livestock/MedicalTab.tsx',
  'components/livestock/ClimateTab.tsx',
  'components/livestock/ProductionTab.tsx',
  'components/livestock/BiosecurityTab.tsx',
  'components/livestock/FinanceTab.tsx',
];
const ALL_COMPONENT_FILES = TAB_FILES.concat(['components/livestock/GroupSelect.tsx']);

test('pages/livestock.tsx ต้องจัดขนาดลง ≤ 800 บรรทัด (เพดาน pages)', () => {
  const n = readFileSync(PAGE, 'utf8').split('\n').length;
  assert.ok(n <= 800, `livestock.tsx = ${n} บรรทัด > เพดาน 800 — ย้าย tabs ไป components/livestock/`);
});

test('lib/livestock-helpers.ts ต้องมี constants/type ร่วมครบ (ย้ายตามเดิม)', () => {
  assert.ok(existsSync(HELPERS), 'lib/livestock-helpers.ts ยังไม่มี');
  const src = readFileSync(HELPERS, 'utf8');
  for (const k of ['SPECIES_ORDER', 'STATUS_COLOR', 'speciesLabel', 'fmtDate', 'fmtNum', 'TABS', 'type Group', 'type TabId']) {
    assert.match(src, new RegExp(`(export )?(const|type) ${k.replace('type ', '')}`), `helpers ต้องมี ${k}`);
  }
});

test('components/livestock ต้องมี tab ครบ 6 + GroupSelect — ทุกไฟล์ ≤ 400 บรรทัด (เพดาน components)', () => {
  for (const rel of ALL_COMPONENT_FILES) {
    const p = path.join(FE, rel);
    assert.ok(existsSync(p), `${rel} ยังไม่มี`);
    const n = readFileSync(p, 'utf8').split('\n').length;
    assert.ok(n <= 400, `${rel} = ${n} บรรทัด > เพดาน 400 — ต้องแยกไฟล์ตาม tab`);
  }
});

test('หน้าห้ามมี tab function เดิมค้าง — ต้อง import tab ครบ 6 จาก components/livestock (GroupSelect อยู่ใน tabs เท่านั้น)', () => {
  const src = readFileSync(PAGE, 'utf8');
  for (const fn of ['function GroupsTab', 'function MedicalTab', 'function ClimateTab', 'function ProductionTab', 'function BiosecurityTab', 'function FinanceTab', 'function GroupSelect']) {
    assert.doesNotMatch(src, new RegExp(fn), `${fn} ยังค้างอยู่ในหน้า — ต้องย้ายไป components/livestock/`);
  }
  for (const rel of TAB_FILES) {
    const name = rel.replace('.tsx', '').split('/').pop() ?? rel;
    assert.match(src, new RegExp(`\\b${name}\\b`), `หน้าต้อง import ${rel}`);
  }
  assert.doesNotMatch(src, /components\/livestock\/GroupSelect/, 'หน้าห้าม import GroupSelect ตรง ๆ — มันถูกใช้ภายใน tabs เท่านั้น');
});
