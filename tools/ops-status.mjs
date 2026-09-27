#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// ops-status.mjs — "มองเห็นทุกสายในคำสั่งเดียว" (P0 ของแผนใช้งานง่าย 27/9)
// ปัญหาเดิม: ความจริงกระจาย 6 ที่ (Task Scheduler / logs/nightly / offsite-log /
//   machine-health / :3001 / DB) — ต้องรัน 4-5 คำสั่งก่อนเห็นภาพเดียวกัน
// หลักการ: ไม่คำนวณซ้ำ — สายเครื่อง/backup ดึงจาก machine-health.mjs (ตัวเดียวกับ watchdog)
//   สาย nightly อ่าน status.json (ที่ MAIN เสมอ) · สาย task ถาม Task Scheduler ตรง
// ใช้: node tools/ops-status.mjs              → ตารางเต็มที่หน้าจอ
//     node tools/ops-status.mjs --quiet       → เฉพาะสิ่งที่ต้องดู (ไม่มี = ปกติทุกสาย)
//     node tools/ops-status.mjs --snapshot    → เขียน data/ops-status.json ให้หน้าเว็บ
//       /system-health อ่าน (bridge: container มองไม่เห็น Task Scheduler ของ Windows)
// ────────────────────────────────────────────────────────────────────────────
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
// log/ไฟล์ runtime อยู่ที่ MAIN tree เสมอ (worktree ไม่มี logs/ — กันอ่านผิดฝั่งแบบสาย backup)
const MAIN_ROOT = (() => {
  const i = REPO.indexOf('.freebuff');
  return i > 3 ? REPO.slice(0, i).replace(/[\\/]+$/, '') : REPO;
})();
const QUIET = process.argv.includes('--quiet');
const SNAPSHOT = process.argv.includes('--snapshot');
const now = () => new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });

const TASKS = [
  { name: 'ShipShop3000', label: 'ShipShop 23:59' },
  { name: 'Sovereign Nightly Verify', label: 'Verify 02:00' },
  { name: 'Sovereign DB Backup', label: 'DB Backup 03:00' },
  { name: 'Sovereign Nightly Quality Gate', label: 'Gate 03:20' },
  { name: 'Sovereign Offsite Backup', label: 'Offsite 03:30' },
  { name: 'Sovereign Security Digest', label: 'Digest 08:00' },
  { name: 'Sovereign Machine Watch', label: 'Machine Watch' },
  { name: 'Sovereign Docker Watch', label: 'Docker Watch' },
  { name: 'Sovereign Synthetic Browser Check', label: 'Synthetic Check' },
];

function decodeResult(code) {
  if (code === 0) return { ok: true, text: 'OK' };
  if (code === 267009) return { ok: true, text: 'ยังไม่เคยรัน (0x41303)' };
  if (code === 2147946720) return { ok: false, text: 'ถูกบล็อกเงื่อนไข (0x800710E0 — แบต/หลับ)' };
  return { ok: false, text: `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}` };
}

// PS 5.1 ConvertTo-Json คืน DateTime เป็น "/Date(1695768976167)/" — รองรับทั้งนี้และ ISO
function parsePsDate(v) {
  if (v == null) return null;
  const m = String(v).match(/\/Date\((-?\d+)\)\//);
  if (m) return new Date(Number(m[1]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ── สาย task scheduler ──
function taskLines() {
  const names = TASKS.map((t) => `'${t.name}'`).join(',');
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-ScheduledTask -TaskName ${names} | Get-ScheduledTaskInfo | Select-Object TaskName,LastRunTime,LastTaskResult | ConvertTo-Json"`,
      { encoding: 'utf8', timeout: 30_000 },
    );
    const arr = JSON.parse(out);
    return (Array.isArray(arr) ? arr : [arr]).map((r) => ({
      name: String(r.TaskName ?? ''),
      lastRun: parsePsDate(r.LastRunTime)?.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) ?? '—',
      result: decodeResult(Number(r.LastTaskResult)),
    }));
  } catch {
    return null;
  }
}

// ── สายเครื่อง + backup (จาก machine-health — ตัวเดียวกับ watchdog ไม่คำนวณซ้ำ) ──
function machineLines() {
  try {
    const r = spawnSync('node', [join(REPO, 'tools', 'machine-health.mjs')], { encoding: 'utf8', timeout: 60_000 });
    if (!r.stdout) throw new Error('ไม่ตอบ');
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

// ── สาย nightly (status.json อยู่ MAIN เสมอ) ──
function nightlyLine() {
  const p = join(MAIN_ROOT, 'logs', 'nightly', 'status.json');
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'));
    const failed = (s.steps ?? []).filter((x) => x.ok === false).map((x) => x.name);
    return {
      ok: s.ok,
      finishedAt: parsePsDate(s.finishedAt)?.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) ?? '—',
      gateOk: s.lastGateOk,
      codeMatch: s.codeMatch,
      failed,
    };
  } catch {
    return null;
  }
}

// ── สายบริการสด ──
async function httpLine(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    return { up: true, code: res.status, body: res.status === 200 ? await res.json().catch(() => null) : null };
  } catch {
    return { up: false };
  }
}

// ────────────────────────────────────────────────────────────────────────────
const watch = [];
const line = (s = '') => { if (!QUIET || watch.length) console.log(s); };

console.log(`═══ Sovereign Ops Status — ${now()} ═══`);
if (QUIET) console.log('(โหมด --quiet = แสดงเฉพาะสิ่งที่ต้องดู · ถ้าไม่มีบรรทัดต่อไปนี้ = ทุกสายปกติ)\n');

// 1) บริการหลัก
const api = await httpLine('http://localhost:3001/api/health');
const web = await httpLine('http://localhost:3000/');
line(`▶ Backend :3001 ${api.up ? (api.code === 200 ? `✓ 200 · fp=${api.body?.build?.fingerprint ?? '—'}` : `HTTP ${api.code}`) : '✗ ล่ม'}`);
line(`▶ Frontend :3000 ${web.up ? (web.code === 200 ? '✓ 200' : `HTTP ${web.code}`) : '✗ ล่ม'}`);
if (!api.up || api.code !== 200) watch.push('backend :3001 ไม่ตอบปกติ');
if (!web.up || web.code !== 200) watch.push('frontend :3000 ไม่ตอบปกติ');

// 2) เครื่อง + backup (critical ทั้งหมดมาจาก machine-health)
const mh = machineLines();
if (mh) {
  line(`▶ เครื่อง: แรมว่าง ${mh.info?.ramFreeGB ?? '—'}GB · ดิสก์ ${mh.info?.diskFreeGB ?? '—'}GB · ดิสก์กายภาพ ${(mh.info?.physicalDiskHealth ?? []).join('/') || '—'}`);
  const dbAge = mh.info?.dbBackupAgeH;
  const offAge = mh.info?.offsiteAgeH;
  const offStatus = mh.info?.offsiteLastStatus;
  line(`▶ Backup: DB ล่าสุด ${dbAge == null ? '—' : `${dbAge} ชม.`} · offsite ${offAge == null ? '—' : `${offAge} ชม. (${offStatus ?? '—'})`}`);
  for (const p of mh.problems ?? []) {
    if (p.level === 'critical') { console.log(`   🚨 [${p.area}] ${p.message}`); watch.push(p.message); }
    else line(`   ⚠️ [${p.area}] ${p.message}`);
  }
} else {
  console.log('▶ machine-health ตอบไม่ถึง — สายเครื่อง/backup ตรวจไม่ได้');
  watch.push('machine-health รันไม่ได้');
}

// 3) nightly verify ล่าสุด
const n = nightlyLine();
if (n) {
  const icon = n.ok === true ? '✓' : n.ok === false ? '✗' : '—';
  const parts = [`เกต ${n.gateOk === true ? '✓' : n.gateOk === false ? '✗' : '?'}`];
  if (n.codeMatch === false) parts.push('⚠️ fingerprint ไม่ตรง (truth เก่า หรือ prod โค้ดเก่า — รัน verify แล้วเคลียร์)');
  line(`▶ Nightly (${n.finishedAt}): ${icon}${n.failed.length ? ` พัง: ${n.failed.join(', ')}` : ''} · ${parts.join(' · ')}`);
  if (n.ok === false) watch.push(`nightly verify พัง: ${n.failed.join(', ') || 'ขั้นนอก steps — ดู logs/nightly/last-run.log'}`);
} else {
  line('▶ Nightly: ไม่มีข้อมูล (ยังไม่เคยรัน)');
}

// 4) task ทั้ง 8
const tasks = taskLines();
if (tasks) {
  line('▶ Task Scheduler:');
  for (const t of TASKS) {
    const r = tasks.find((x) => x.name === t.name);
    if (!r) { line(`   ? ${t.label.padEnd(16)} ไม่พบ task`); continue; }
    const icon = r.result.ok ? '✓' : '✗';
    line(`   ${icon} ${t.label.padEnd(16)} ${r.result.text.padEnd(40)} ล่าสุด ${r.lastRun}`);
    if (!r.result.ok) watch.push(`task "${t.label}" ${r.result.text}`);
  }
} else {
  console.log('▶ Task Scheduler ถามไม่ได้');
  watch.push('Task Scheduler ถามไม่ได้');
}

// ── snapshot สำหรับหน้าเว็บ (container มองไม่เห็น Task Scheduler — bridge ผ่านไฟล์นี้) ──
if (SNAPSHOT) {
  const out = {
    checkedAt: new Date().toISOString(),
    watch,
    tasks: tasks?.map((t) => ({ ...t, label: TASKS.find((x) => x.name === t.name)?.label ?? t.name })),
    nightly: n,
    machine: mh ? { ok: mh.ok, problems: mh.problems, info: mh.info } : null,
    services: { api: api.up && api.code === 200, web: web.up && web.code === 200 },
  };
  const target = join(MAIN_ROOT, 'sovereign-os', 'core-api', 'data', 'ops-status.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`\n📷 snapshot → ${target}`);
}

// ── สรุป ──
console.log('');
if (!watch.length) {
  console.log('✅ ทุกสายปกติ — ไม่มีอะไรต้องดู');
} else {
  console.log(`📋 ${watch.length} เรื่องต้องดู:`);
  for (const w of watch) console.log(`   • ${w}`);
}
console.log('\n(แจ้งเตือนอัตโนมัติ = Machine Watch ทุก 10 นาที · ตัวนี้ไว้เช็คเองเมื่อสงสัย)');
