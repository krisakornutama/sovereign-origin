#!/usr/bin/env node
// coverage-core.mjs — วัด coverage ของ sovereign-os/core-api ด้วย c8 (ชุด mock ล้วน — ไม่ต้องมี DB)
// รัน: npm run coverage:core
// ผลลัพธ์: ตัวเลขรวม (lines/branches/functions) + สรุปไฟล์ 0% ที่ใหญ่สุด + หลุมบรรทัดมากสุด 10 อันดับ
// กติกา: ไม่บังคับตัวเลขขั้นต่ำ (no threshold) — ใช้เป็นกระจกส่อง ไม่ใช่กับดัก · exit 0 เมื่อเทสผ่านเอง
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const API = join(ROOT, '..', 'sovereign-os', 'core-api');
const REPORT_DIR = 'coverage';
const RUN_DB = process.argv.includes('--db'); // --db = รวมชุด real-DB (RUN_DB_TESTS=1) ในรอบวัด

const env = {
  ...process.env,
  JWT_SECRET: process.env.JWT_SECRET || 'ci-secret-0123456789abcdef',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://ci:ci@127.0.0.1:5432/ci',
  TZ: 'Asia/Bangkok',
};
if (RUN_DB) {
  // คายหลัง test:db — ตั้งให้ไฟล์ -db.test.ts ไม่ข้ามตัวเอง (ต้องมี TEST_DATABASE_URL ของชุดจริงด้วย)
  env.RUN_DB_TESTS = '1';
  console.log('ℹ️  โหมด --db: รวมชุด real-DB ในรอบวัด (ต้องรัน npm run test:db ก่อนจึงมี TEST_DATABASE_URL/ฐานพร้อม)');
}

console.log('▶ วัด coverage ของ core-api (c8 + ชุด mock)');
const r = spawnSync(
  'npx',
  [
    'c8',
    '--reporter=json-summary',
    '--reporter=text',
    '--include', 'src/**',
    '--all', '--src', 'src',
    `--report-dir=${REPORT_DIR}`,
    '--',
    'npx', 'tsx', '--test', '--test-concurrency=1', 'tests/*.test.ts',
  ],
  { cwd: API, stdio: 'inherit', shell: process.platform === 'win32', env }
);

if (r.status !== 0) {
  console.error(`\n❌ เทสล้มเหลว (exit ${r.status}) — coverage รอบนี้ไม่สะท้อนของจริง`);
  process.exit(r.status ?? 1);
}

const summaryPath = join(API, REPORT_DIR, 'coverage-summary.json');
if (!existsSync(summaryPath)) {
  console.error('❌ ไม่เจอ coverage-summary.json — c8 รันไม่สำเร็จ');
  process.exit(1);
}

const s = JSON.parse(readFileSync(summaryPath, 'utf8'));
const total = s.total;
const pct = (x) => `${x.pct}%`;

console.log('\n═══ Coverage รวม (sovereign-os/core-api) ═══');
console.log(`lines ${pct(total.lines)} · branches ${pct(total.branches)} · functions ${pct(total.functions)} · บรรทัดที่วัด ${total.lines.total}`);

const rows = Object.entries(s)
  .filter(([k]) => k !== 'total' && !/\.d\.ts$/.test(k))
  .map(([p, d]) => ({
    path: p.replace(/.*core-api.src/, 'src'),
    miss: d.lines.total - d.lines.covered,
    size: d.lines.total,
    pct: d.lines.pct,
  }));

const zero = rows.filter((r0) => r0.pct === 0 && r0.size >= 60).sort((a, b) => b.size - a.size);
console.log(`\n── ไฟล์ 0% (ยังไม่ถูก import ในชุดเทส) ใหญ่สุด 10 ──`);
for (const z of zero.slice(0, 10)) console.log(`  ${String(z.size).padStart(5)} บรรทัด  ${z.path}`);
if (zero.length === 0) console.log('  (ไม่มี — ทุกไฟล์ใหญ่ถูก import แล้ว)');

const holes = rows.filter((h) => h.size >= 60).sort((a, b) => b.miss - a.miss);
console.log(`\n── หลุมบรรทัดมากสุด 10 (ไม่ครอบ/รวม) ──`);
for (const h of holes.slice(0, 10)) console.log(`  ${String(h.miss).padStart(5)}/${String(h.size).padEnd(5)} (${h.pct}%)  ${h.path}`);

console.log('\n✅ วัดเสร็จ — รายงานเต็ม: sovereign-os/core-api/coverage/index.html (npx c8 report --reporter=html)');
