#!/usr/bin/env node
// coverage-floor.mjs — แก้รหนีไม่ให้ coverage ถอยหลัง (เพิ่ม 3/10/69)
//
// ที่มา: audit 3/10/69 เจอว่า 34 โมดูลอยู่ที่ 0% และไม่มีอะไรฟ้องเลย เพราะตัวเลข
// coverage เป็นแค่ "กระจกส่อง" (no threshold) มาตลอด — ลดลงเท่าไรก็ไม่มีใครรู้
// หลักการ: baseline = ค่าที่วัดได้จริงวันนี้ (ไม่ตั้งเป้าให้เป็นไปได้แต่ยังไม่ถึง)
//   1) รวมทั้งโปรเจกต์ ≥ floor รวม        → ห้ามลดลง
//   2) โมดุลที่อยู่ใน baseline ≥ ค่าของมัน → ห้ามถอยหลังทีละโมดูล
//   3) โมดุลใหม่ที่ไม่มีใน baseline ≥ newModuleFloor (ค่าเริ่มต้น 40%)
//      → เป็นข้อที่ 3 ของคำสั่ง "no new module can land at 0%"
//   4) ไฟล์ใหม่ที่เพิ่งเขียนเทสต์ → ยก baseline ให้เองด้วย --update-baseline
//
// ใช้: node tools/coverage-floor.mjs [--summary <coverage-summary.json>] [--update] [--no-enforce]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const API = join(ROOT, '..', 'sovereign-os', 'core-api');
const FLOOR_FILE = join(ROOT, 'coverage-floor.json');

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const ENFORCE = !args.includes('--no-enforce');
const summaryIdx = args.indexOf('--summary');
const SUMMARY = join(
  API,
  'coverage',
  summaryIdx >= 0 ? args[summaryIdx + 1] : 'coverage-summary.json',
);

// ── อ่านค่าที่วัดได้ ───────────────────────────────────────────────────────────
if (!existsSync(SUMMARY)) {
  console.error(`❌ ไม่เจอ ${SUMMARY} — รัน npm run coverage:core ก่อน`);
  process.exit(1);
}
const s = JSON.parse(readFileSync(SUMMARY, 'utf8'));

/** รวม coverage ต่อ "กลุ่ม" — โมดูลใน src/modules หรือ service/middleware/... */
function measure() {
  const groups = {};
  for (const [file, v] of Object.entries(s)) {
    if (file === 'total') continue;
    const norm = file.replace(/\\/g, '/');
    let key;
    const m = norm.match(/src\/modules\/([a-z0-9-]+)/);
    if (m) key = `modules/${m[1]}`;
    else if (norm.includes('/services/')) key = 'services';
    else if (norm.includes('/middleware/')) key = 'middleware';
    else {
      const d = norm.match(/src\/([a-z0-9-]+)/);
      key = d ? d[1] : 'other';
    }
    groups[key] = groups[key] || { covered: 0, total: 0 };
    groups[key].covered += v.statements.covered;
    groups[key].total += v.statements.total;
  }
  const pct = {};
  for (const [k, v] of Object.entries(groups)) {
    if (v.total > 0) pct[k] = Math.floor((100 * v.covered) / v.total);
  }
  return { total: s.total.statements.pct, groups: pct };
}

const now = measure();

// ── โหมดอัปเดต baseline ─────────────────────────────────────────────────────
if (UPDATE) {
  const previous = existsSync(FLOOR_FILE) ? JSON.parse(readFileSync(FLOOR_FILE, 'utf8')) : null;
  const merged = { ...(previous?.groups || {}), ...now.groups };
  // ยกเฉพาะขึ้น — ถ้าวัดต่ำกว่า (เช่นลบโค้ดที่ไม่มีเทสต์) เก็บค่าเดิมไว้ ไม่ให้พื้นหลุดตาม
  for (const k of Object.keys(merged)) {
    if (now.groups[k] !== undefined) merged[k] = Math.max(merged[k], now.groups[k]);
  }
  const next = {
    _note: 'เกณฑ์ coverage ขั้นต่ำ — ห้ามถอยหลัง (สร้าง 3/10/69 · ยกด้วย node tools/coverage-floor.mjs --update)',
    _newModuleFloor: previous?._newModuleFloor ?? 40,
    total: Math.max(previous?.total ?? 0, now.total),
    groups: merged,
  };
  writeFileSync(FLOOR_FILE, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  console.log(`✅ อัปเดต ${FLOOR_FILE}`);
  console.log(`   รวม ${next.total}% · ${Object.keys(next.groups).length} กลุ่ม · newModuleFloor ${next._newModuleFloor}%`);
  process.exit(0);
}

// ── ตรวจ ───────────────────────────────────────────────────────────────────
if (!existsSync(FLOOR_FILE)) {
  console.warn('⚠️  ยังไม่มี tools/coverage-floor.json — สร้างด้วย: node tools/coverage-floor.mjs --update');
  process.exit(0);
}

const floor = JSON.parse(readFileSync(FLOOR_FILE, 'utf8'));
const newModuleFloor = floor._newModuleFloor ?? 40;
const violations = [];

if (now.total < floor.total) {
  const drop = (Math.round((floor.total - now.total) * 10) / 10).toFixed(1);
  violations.push(`coverage รวม ${now.total}% < floor ${floor.total}% (ถอยไป ${drop} จุด)`);
}

for (const [key, pct] of Object.entries(now.groups)) {
  const f = floor.groups[key];
  if (f === undefined) {
    // โมดุลใหม่ที่ไม่เคยมีใน baseline
    if (pct < newModuleFloor) {
      violations.push(`โมดุลใหม่ "${key}" เข้ามาที่ ${pct}% — ต้อง ≥ ${newModuleFloor}% (เขียนเทสต์ก่อน commit)`);
    }
    continue;
  }
  if (pct < f) violations.push(`"${key}" ถอยจาก ${f}% → ${pct}%`);
}
for (const key of Object.keys(floor.groups)) {
  if (now.groups[key] === undefined && floor.groups[key] > 0) {
    violations.push(`"${key}" หายไปจากรายงาน coverage (โมดูลถูกลบ/ย้าย?) — floor เดิม ${floor.groups[key]}%`);
  }
}

console.log('\n═══ Coverage Floor ═══');
console.log(`รวม ${now.total}% (floor ${floor.total}%) · newModuleFloor ${newModuleFloor}%`);
const regressed = Object.keys(floor.groups).filter(
  (k) => now.groups[k] !== undefined && now.groups[k] < floor.groups[k]
);

if (violations.length === 0) {
  console.log('✅ ไม่มีการถอยหลัง');
  if (!ENFORCE) console.log('ℹ️  --no-enforce = โหมดรายงานอย่างเดียว');
  process.exit(0);
}

console.error(`\n❌ coverage ถอยหลัง (${violations.length} ข้อ) — กฎ AGENTS.md ข้อ 2: ห้าม commit ถ้า gate ไม่ผ่าน`);
for (const v of violations) console.error(`   · ${v}`);
if (regressed.length) {
  console.error(`\n   กลุ่มที่ถอย: ${regressed.join(', ')}`);
  console.error('   ทางแก้: เขียนเทสต์เพิ่ม · หรือถ้าถอยเพราะตั้งใจลบโค้ด ให้ยก baseline ด้วย');
  console.error('         node tools/coverage-floor.mjs --update   (ยกเฉพาะขึ้น — ค่าที่ลดจะไม่ถูกยก)');
}
if (!ENFORCE) {
  console.error('\nℹ️  --no-enforce = รายงานอย่างเดียว ไม่ fail');
  process.exit(0);
}
process.exit(1);
