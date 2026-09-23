#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// frontend-gate.mjs — เกตสถาปัตยกรรมฝั่ง frontend (ขยาย arch-gate คลุม UI)
// ทำงานเป็นด่านที่ 2 ของ npm run verify (หลัง arch-gate.mjs) และบน CI ทุก PR
//
// กฎ 3 ข้อ (ทุกข้อ fail ได้จริง — ของเดิมให้ผ่านผ่าน baseline ของเดิมผ่านได้):
//   1. import-layers  — pages → lib/stores/components เท่านั้น
//                       • ห้าม pages → pages (ห้ามหน้า import หน้า)
//                       • ห้าม components/<กลุ่ม> → components/<กลุ่มอื่น> ลึกข้ามกลุ่ม
//                         (ui/ และ layout/ ใช้ร่วมได้ทุกที่ — เป็น "ชั้นบริการ" ของ UI)
//                       • ห้าม lib/ และ stores/ import components (ทิศเดียวเสมอ:
//                         pages → components → lib/stores)
//   2. line-budget    — เพดานบรรทัดต่อไฟล์: pages ≤ 800, components ≤ 400
//                         (lib/stores ไม่จำกัด — จำกัดเฉพาะ UI ที่โตเร็ว)
//   3. sidebar-rule   — หน้าใหม่ทุกหน้าต้อง import Sidebar
//                         (ยกเว้นตาม baseline: หน้า public/login/redirect/ไฟล์พิเศษ)
//
// หลักการเดียวกับ arch-gate: "ของเดิมผ่านได้ (baseline) — ของใหม่ที่ละเมิด = fail"
// baseline: tools/frontend-baseline.json (generate ด้วย --write-baseline, รีวิวใน PR)
//
// ใช้:  node tools/frontend-gate.mjs [--write-baseline] [--base <ref>]
//         --write-baseline  บันทึกผลสแกนปัจจุบันเป็น baseline (ใช้ครั้งแรก/หลังตัดสินใจยอมรับ)
//         --base <ref>      file-budget ของเฉพาะไฟล์ที่แตกต่างจาก ref (เหมือน arch-gate)
// ────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(REPO, 'sovereign-frontend', 'src');
const BASELINE_PATH = join(REPO, 'tools', 'frontend-baseline.json');
const WRITE_BASELINE = process.argv.includes('--write-baseline');
const BASE_REF_IDX = process.argv.indexOf('--base');
const BASE_REF = BASE_REF_IDX > -1 ? process.argv[BASE_REF_IDX + 1] : null;

// ── ตัวช่วย ──────────────────────────────────────────────────────────────────
const rel = (p) => relative(REPO, p).split(sep).join('/');

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/** ดึง import specifier ทั้งหมดจากไฟล์ (import/export-from/dynamic-import) */
function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  const re = /(?:^|\n)\s*(?:import\s[^'"]*?|export\s[^'"]*?from\s|import\s*\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/** แปลง specifier สัมพัทธ์เป็น path ไฟล์จริง (รองรับนามสกุลครบ) */
function resolveRel(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`,
    join(base, 'index.ts'), join(base, 'index.tsx')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/** ไฟล์ที่ diff เทียบ base ref (สำหรับ file-budget ใน PR) */
function changedFilesFromBase() {
  try {
    const out = execSync(`git diff --name-only ${JSON.stringify(BASE_REF)} HEAD`, {
      cwd: REPO, encoding: 'utf8', timeout: 20_000,
    });
    return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean)
      .map((p) => join(REPO, p)));
  } catch {
    return null; // ไม่มี git/ ref ไม่มีจริง → ตรวจทุกไฟล์ (โหมด local เต็ม)
  }
}

// ── เก็บไฟล์ฝั่ง frontend ────────────────────────────────────────────────────
const pagesDir = join(SRC, 'pages');
const compDir = join(SRC, 'components');
const libDir = join(SRC, 'lib');
const storesDir = join(SRC, 'stores');
const pageFiles = walk(pagesDir, ['.tsx', '.ts']);
const compFiles = walk(compDir, ['.tsx', '.ts']);
const libFiles = [...walk(libDir, ['.ts', '.tsx']), ...walk(storesDir, ['.ts', '.tsx'])];
const allFiles = [...pageFiles, ...compFiles, ...libFiles];

const violations = []; // { rule, file, detail }
const add = (rule, file, detail) => violations.push({ rule, file: rel(file), detail });

// ── กฎ 1: import-layers ──────────────────────────────────────────────────────
const SHARED_UI = new Set(['ui', 'layout']); // ใช้ร่วมได้ทุกกลุ่ม

function checkImports() {
  for (const file of allFiles) {
    const r = rel(file);
    const isPage = file.startsWith(pagesDir + sep);
    const inComponents = file.startsWith(compDir + sep);
    const inLib = file.startsWith(libDir + sep) || file.startsWith(storesDir + sep);
    const myGroup = inComponents ? file.slice(compDir.length + 1).split(sep)[0] : null;

    for (const spec of importsOf(file)) {
      const target = resolveRel(file, spec);
      if (!target) continue; // package ภายนอก — ไม่เกี่ยว
      const t = rel(target);
      const tIsPage = target.startsWith(pagesDir + sep);
      const tInComp = target.startsWith(compDir + sep);
      const tInLib = target.startsWith(libDir + sep) || target.startsWith(storesDir + sep);
      const tGroup = tInComp ? target.slice(compDir.length + 1).split(sep)[0] : null;

      if (isPage && tIsPage) {
        add('import-layers', file, `ห้าม page import page → ${t}`);
      } else if (inComponents && tIsPage) {
        add('import-layers', file, `ห้าม component import page → ${t}`);
      } else if (inLib && tInComp) {
        add('import-layers', file, `ห้าม lib/stores import components → ${t}`);
      } else if (inComponents && tInComp && myGroup !== tGroup
        && !SHARED_UI.has(myGroup) && !SHARED_UI.has(tGroup)) {
        add('import-layers', file, `ข้ามกลุ่ม component ${myGroup} → ${tGroup} (${t})`);
      }
    }
  }
}

// ── กฎ 2: line-budget (pages ≤ 800, components ≤ 400) ────────────────────────
const PAGE_CAP = 800;
const COMP_CAP = 400;
const changedFiles = BASE_REF ? changedFilesFromBase() : null; // null = ตรวจทุกไฟล์

function countLines(file) {
  return readFileSync(file, 'utf8').split('\n').length;
}

function checkLineBudget() {
  for (const file of pageFiles) {
    const n = countLines(file);
    if (n > PAGE_CAP && (!changedFiles || changedFiles.has(file))) {
      add('line-budget', file, `${n} บรรทัด > เพดาน ${PAGE_CAP} (pages)`);
    }
  }
  for (const file of compFiles) {
    const n = countLines(file);
    if (n > COMP_CAP && (!changedFiles || changedFiles.has(file))) {
      add('line-budget', file, `${n} บรรทัด > เพดาน ${COMP_CAP} (components)`);
    }
  }
}

// ── กฎ 3: sidebar-rule (หน้าจริงต้อง import Sidebar) ─────────────────────────
function hasSidebarImport(file) {
  return importsOf(file).some((s) => /Sidebar/.test(s)
    || /components\/layout|layout\/Sidebar|SidebarMenu/.test(s));
}

function checkSidebar() {
  for (const file of pageFiles) {
    const name = file.slice(pagesDir.length + 1);
    // ไฟล์พิเศษของ Next.js — ไม่ใช่หน้าแบบมี layout
    if (name.startsWith('_')) continue;
    if (!hasSidebarImport(file)) {
      add('sidebar-rule', file, 'หน้าไม่ import Sidebar (ทุกหน้าต้องมี layout เดียวกัน)');
    }
  }
}

// ── Baseline ────────────────────────────────────────────────────────────────
function currentFindings() {
  checkImports();
  checkLineBudget();
  checkSidebar();
  return violations;
}

if (WRITE_BASELINE) {
  currentFindings();
  const baseline = {
    _comment: [
      'Baseline ของ frontend-gate — สร้างจากการสแกนจริง อัปเดตเมื่อ "ตัดสินใจยอมรับ" เท่านั้น',
      'กฎ: import-layers (pages→lib/stores/components, ui/layout ใช้ร่วมได้)',
      '     line-budget (pages≤800, components≤400)',
      '     sidebar-rule (ทุกหน้า import Sidebar; exception = public/login/redirect/ไฟล์พิเศษ)',
      'รายการในนี้ = หนี้ที่รับไว้ชั่วคราว — ของใหม่ที่ละเมิด = verify FAIL',
    ],
    violations: violations.map((v) => `${v.rule}|${v.file}|${v.detail}`),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`เขียน baseline: ${violations.length} รายการ → ${rel(BASELINE_PATH)}`);
  process.exit(0);
}

const findings = currentFindings();
let baselineSet = new Set();
if (existsSync(BASELINE_PATH)) {
  try {
    baselineSet = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).violations ?? []);
  } catch {
    console.error(`✗ baseline พัง (อ่านไม่ได้): ${rel(BASELINE_PATH)}`);
    process.exit(1);
  }
} else {
  console.error('✗ ไม่มี tools/frontend-baseline.json — รัน: node tools/frontend-gate.mjs --write-baseline');
  process.exit(1);
}

// ของใหม่ = ไม่อยู่ใน baseline
const fresh = findings.filter((v) => !baselineSet.has(`${v.rule}|${v.file}|${v.detail}`));

console.log('\n──────── FRONTEND GATE ────────');
const byRule = {};
for (const v of findings) (byRule[v.rule] ??= []).push(v);
for (const [rule, list] of Object.entries(byRule)) {
  console.log(`  ${rule}: ${list.length} รายการ (baseline รับไว้)`);
}

if (fresh.length === 0) {
  console.log('✅ frontend-gate ผ่าน — ไม่มีการละเมิดใหม่');
  process.exit(0);
}

console.error(`\n✗ frontend-gate พบการละเมิดใหม่ ${fresh.length} รายการ:`);
for (const v of fresh) console.error(`   ✗ [${v.rule}] ${v.file} — ${v.detail}`);
console.error('\n  แก้โค้ดให้ถูกกฎ หรือ (กรณีตั้งใจ) อัปเดต baseline พร้อมเหตุผลใน PR');
process.exit(1);
