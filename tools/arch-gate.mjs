#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// arch-gate.mjs — Architecture Gate: เปลี่ยน "ธรรมเนียมที่อาศัยความจำ" เป็น "ของเครื่องตรวจได้"
// (Phase 0 arch-hardening — เสียบเป็นสเต็ปของ npm run verify · fail = verify fail)
//
// กฎที่ตรวจ:
//   1) schema-sync      — schema.prisma กับ schema.sqlite.prisma ต้องมี model ชุดเดียวกัน
//                         (จับเคส "แก้ postgres ลืม sqlite" — ตอนนี้ต้องแก้คู่กันด้วยมือ)
//   2) file-budget      — ไฟล์ที่เปลี่ยนแปลงใน diff (กับ base branch) ต้องไม่โตเกิน 800 บรรทัด
//                         (ไฟล์เก่าที่ใหญ่อยู่แล้วไม่โดนย้อนหลัง — กฎกัน "โตต่อ" เท่านั้น)
//   3) env-truth        — DATABASE_URL ใน .env ต้องชี้ DB ที่ connect ได้จริง
//                         (เคสจริง: ชี้ sovereign_v2 ที่ไม่มีอยู่ — ทุก tool เจอ P1003)
//   4) module-boundary  — รายงานโมดูลที่แตะตารางของโมดูลอื่นผ่าน prisma.<model> (report-only
//                         ในเฟสแรก — เก็บ baseline ก่อนบังคับจริงในเฟสถัดไป)
//
// ใช้: node tools/arch-gate.mjs [--base origin/main]   (base สำหรับ file-budget; default = main)
// ────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'sovereign-os', 'core-api');
const argBase = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'main';

const problems = [];
const reports = [];

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: ROOT, ...opts }).trim();
}

// ── 1) schema-sync: model ทั้งสอง schema ต้องตรงกัน ──
function checkSchemaSync() {
  const pg = readFileSync(join(BACKEND, 'prisma', 'schema.prisma'), 'utf8');
  const sqlite = readFileSync(join(BACKEND, 'prisma', 'schema.sqlite.prisma'), 'utf8');
  const models = (text) =>
    [...text.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1]).sort();
  const pgModels = models(pg);
  const sqModels = models(sqlite);
  const onlyPg = pgModels.filter((m) => !sqModels.includes(m));
  const onlySq = sqModels.filter((m) => !pgModels.includes(m));
  if (onlyPg.length || onlySq.length) {
    problems.push(
      `schema-sync: model ไม่ตรงกันระหว่าง schema.prisma กับ schema.sqlite.prisma` +
        (onlyPg.length ? `\n   มีใน postgres เท่านั้น: ${onlyPg.join(', ')}` : '') +
        (onlySq.length ? `\n   มีใน sqlite เท่านั้น: ${onlySq.join(', ')}` : '') +
        `\n   → แก้ทั้งสองไฟล์คู่กันเสมอ (ตามธรรมเนียมเดิมของ repo)`
    );
  } else {
    reports.push(`schema-sync: ตรงกัน ${pgModels.length} models`);
  }
}

// ── 2) file-budget: ไฟล์ที่เปลี่ยนใน diff ไม่เกินเพดาน ──
function checkFileBudget() {
  const BUDGET = 800;
  let diffOutput = '';
  try {
    diffOutput = sh(`git diff --name-only ${argBase}...HEAD`);
  } catch {
    reports.push(`file-budget: ข้าม (หา base '${argBase}' ไม่เจอ)`);
    return;
  }
  const changed = diffOutput.split('\n').filter(Boolean).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.mjs') || f.endsWith('.js'));
  const offenders = [];
  for (const f of changed) {
    const full = join(ROOT, f);
    if (!existsSync(full)) continue; // ลบไฟล์ = ไม่นับ
    const lines = readFileSync(full, 'utf8').split('\n').length;
    if (lines > BUDGET) offenders.push(`${f} (${lines} บรรทัด)`);
  }
  if (offenders.length) {
    problems.push(`file-budget: ไฟล์ที่แก้ใน branch นี้ใหญ่เกิน ${BUDGET} บรรทัด:\n   ${offenders.join('\n   ')}\n   → แตกเป็นโมดูลย่อยก่อน merge (กฎกันไฟล์ยักษ์โตต่อ)`);
  } else {
    reports.push(`file-budget: ผ่าน (${changed.length} ไฟล์ที่เปลี่ยน · เพดาน ${BUDGET} บรรทัด)`);
  }
}

// ── 3) env-truth: DATABASE_URL ต้อง connect ได้จริง ──
async function checkEnvTruth() {
  const envPath = join(BACKEND, '.env');
  if (!existsSync(envPath)) {
    reports.push('env-truth: ข้าม (ไม่มี .env — เครื่องนี้ใช้ env จากที่อื่น)');
    return;
  }
  const env = readFileSync(envPath, 'utf8');
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) {
    problems.push('env-truth: .env ไม่มี DATABASE_URL');
    return;
  }
  const url = m[1].trim().replace(/\s+#.*$/, '').trim(); // ตัด comment ท้ายบรรทัดออก
  const parsed = url.match(/^postgres(?:ql)?:\/\/([^:@]+):([^@]*)@([^:/]+):(\d+)\/(.+?)(\?.*)?$/);
  if (!parsed) {
    problems.push('env-truth: DATABASE_URL รูปแบบไม่รู้จัก (ต้องเป็น postgresql://user:pass@host:port/db)');
    return;
  }
  const [, user, , host, port, dbName] = parsed;
  // connect ผ่าน pg ของ core-api — ไม่พิมพ์รหัสผ่านลง output เด็ดขาด
  try {
    // pg เป็น CJS — ใช้ createRequire (ESM import() ของ Windows absolute path ใช้ไม่ได้)
    const require = createRequire(import.meta.url);
    const { Client } = require(join(BACKEND, 'node_modules', 'pg'));
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 4000 });
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    reports.push(`env-truth: DATABASE_URL ชี้ ${host}:${port}/${dbName} (user=${user}) — connect สำเร็จ`);
  } catch (err) {
    const code = err?.code || '';
    const hint =
      code === '3D000'
        ? 'ฐานข้อมูลไม่มีอยู่จริง — แก้ชื่อ DB ให้ตรงของจริง (ดูจาก container: docker exec sovereign-core-api sh -c "echo $DATABASE_URL")'
        : code === '28P01'
          ? 'รหัสผ่านไม่ถูก'
          : code === 'ECONNREFUSED'
            ? 'เชื่อมต่อไม่ได้ — Postgres ยังไม่รัน?'
            : err?.message?.slice(0, 120);
    problems.push(`env-truth: DATABASE_URL ชี้ ${host}:${port}/${dbName} แต่ connect ไม่ได้ (${hint})`);
  }
}

// ── 4) module-boundary (report-only): ใครแตะตารางของใคร ──
function checkModuleBoundary() {
  const ownersPath = join(ROOT, 'tools', 'module-owners.json');
  if (!existsSync(ownersPath)) {
    reports.push('module-boundary: ข้าม (ไม่มี tools/module-owners.json)');
    return;
  }
  const owners = JSON.parse(readFileSync(ownersPath, 'utf8')).owners || {};
  const modelToOwner = Object.fromEntries(Object.entries(owners).map(([t, mod]) => [t, mod]));
  // delegate prisma.<model> ↔ ตาราง: ตาม @@map — อ่านจาก schema.prisma
  const schema = readFileSync(join(BACKEND, 'prisma', 'schema.prisma'), 'utf8');
  const modelTable = {};
  for (const m of schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{[^}]*?@@map\("([^"]+)"\)/gms)) {
    modelTable[m[1]] = m[2];
  }
  const camelToSnake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
  // เดินไฟล์ backend ทั้ง src — จับ "prisma.<delegate>" แล้ว map เป็นตาราง → โมดูลเจ้าของ
  // โมดูลของไฟล์ = ก้อนแรกที่ขึ้นต้นด้วย modules/ หรือ services/ (เกณฑ์หยาบพอสำหรับ baseline)
  const hits = {}; // `${module} → ${owner}(${table})` = count
  let scanCount = 0;
  const SRC = join(ROOT, 'sovereign-os', 'core-api', 'src');
  // service ที่ทำงาน "ให้โมดูลนั้น" (ตามการเรียกใช้จริง) — นับรวมเป็นโมดูลเดียวกัน
  const serviceAlias = { 'business.service': 'business', 'business-shop.service': 'business', 'trace.service': 'trace', 'advisor.service': 'farm' };
  const walk = (dir) => {
    let list = [];
    try { list = readdirSync(dir); } catch { return; }
    for (const name of list) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!/\.ts$/.test(name) || name.endsWith('.test.ts')) continue;
      scanCount++;
      const rel = relative(SRC, full);
      const parts = rel.split(sep);
      const module =
        parts[0] === 'modules' ? parts[1]
        : parts[0] === 'services' ? (serviceAlias[parts[1]?.replace(/\.ts$/, '')] ?? `service:${parts[1]?.replace(/\.ts$/, '')}`)
        : `root:${parts[0]}`;
      const text = readFileSync(full, 'utf8');
      for (const mm of text.matchAll(/\bprisma\.([a-z][A-Za-z0-9]*)\b/g)) {
        const delegate = mm[1];
        const table = modelTable[delegate] || camelToSnake(delegate);
        const owner = modelToOwner[table];
        if (!owner) continue; // unmapped — baseline ยังไม่ครอบ
        if (owner === module) continue; // เจ้าของแตะของตัวเอง = ถูกต้อง
        const key = `${module} → ${owner}(${table})`;
        hits[key] = (hits[key] || 0) + 1;
      }
    }
  };
  walk(join(ROOT, 'sovereign-os', 'core-api', 'src'));
  const keys = Object.keys(hits).sort();
  if (keys.length) {
    reports.push(`module-boundary (report-only): เจอ ${keys.length} เส้นข้ามโมดูล จาก ${scanCount} ไฟล์:`);
    for (const k of keys.slice(0, 20)) reports.push(`   ${k} ×${hits[k]}`);
  } else {
    reports.push(`module-boundary: สะอาด (สแกน ${scanCount} ไฟล์)`);
  }
}

const results = [];
checkSchemaSync();
checkFileBudget();
await checkEnvTruth(); // top-level await (ESM) — ต้องรอ ไม่งั้น report/fail หลุดไปหลัง print
checkModuleBoundary();

console.log('═══ Architecture Gate ═══');
for (const r of reports) console.log('  · ' + r);
if (problems.length) {
  console.error('\n❌ Architecture Gate ล้ม — แก้ก่อน commit:');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('✅ Architecture Gate ผ่าน');
