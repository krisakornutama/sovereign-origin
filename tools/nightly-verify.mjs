#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// nightly-verify.mjs — รัน verify:full ทุกคืนโดยอัตโนมัติ (Phase 3: ระบบพิสูจน์สุขภาพตัวเอง)
// โครง: lock กันรันซ้อน → รัน verify:full → เก็บ status/log บน E: → ส่งสรุป Telegram
// หลักการ fail-safe: ล้มเหลวทุกจุด = เขียน status + รายงานเสมอ (ไม่มีความพังแบบเงียบ)
// log ทั้งหมดอยู่บน E: ตามกฎ PROJECT DRIVE ONLY (ข้อ 7)
// ติดตั้ง: tools/register-nightly-task.ps1 (Task Scheduler 02:00 ทุกคืน)
// ────────────────────────────────────────────────────────────────────────────
import { spawnSync, execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// REPO = root ของ repo (ไฟล์อยู่ tools/ → ต้องขึ้น 2 ชั้น: ไฟล์ → tools → root)
// (บั๊กจริงรอบแรก: ขึ้นชั้นเดียว → REPO=tools → log หลุดไป tools/logs และไม่เรียก report)
function repoOf(file) {
  const inTools = dirname1(file);
  return dirname1(inTools);
}
function dirname1(p) {
  const i = p.lastIndexOf('\\');
  return i > 3 ? p.slice(0, i) : p;
}
const REPO = repoOf(fileURLToPath(import.meta.url));
const LOGDIR = join(REPO, 'logs', 'nightly');
const LOCK = join(LOGDIR, 'nightly.lock');
const STATUS = join(LOGDIR, 'status.json');
function isAlive(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8', timeout: 15_000 });
    return out.includes(String(pid)); // tasklist ตอบสำเร็จแม้ไม่เจอ PID (ต้องดูเนื้อความ)
  } catch { return false; }
}

// ── lock กันรันซ้อน (เช่น verify ปกติกำลังรัน / nightly ค้างจากเมื่อคืน) ──
mkdirSync(LOGDIR, { recursive: true });
if (existsSync(LOCK)) {
  try {
    const old = JSON.parse(readFileSync(LOCK, 'utf8'));
    if (old.pid && isAlive(old.pid)) {
      console.log(`nightly: มีรอบก่อนหน้า (pid ${old.pid} เริ่ม ${old.startedAt}) ยังทำงานอยู่ — ข้ามคืนนี้`);
      process.exit(0);
    }
  } catch { /* lock เสีย — ลบแล้วทำต่อ */ }
  try { unlinkSync(LOCK); } catch { /* ข้าม */ }
}
writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

const t0 = Date.now();
let ok = false;
try {
  // สภาพแวดล้อม: ใช้ DATABASE_URL ที่ .env มีอยู่แล้ว (verify จัดการเอง) — รันผ่าน npm เหมือนมือ
  const r = spawnSync('npm', ['run', 'verify:full'], {
    cwd: REPO, encoding: 'utf8', timeout: 30 * 60_000, shell: true,
  });
  ok = r.status === 0;
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  writeFileSync(join(LOGDIR, 'last-run.log'), out);
  console.log(out.split('\n').slice(-8).join('\n'));
} catch (err) {
  writeFileSync(join(LOGDIR, 'last-run.log'), `runner error: ${err instanceof Error ? err.stack : String(err)}`);
}

// ── สถานะรวม (ให้ report + watchdog + หน้าเว็บอ่านต่อ) ──
// โครง system-truth.json: { ok, steps, prodTruth:{diskFingerprint,...} } — codeMatch/migrationHead
// ต้องคำนวณเองจาก /api/health (runtime fingerprint) เทียบกับดิสก์
let truth = {};
try { truth = JSON.parse(readFileSync(join(REPO, 'sovereign-os', 'core-api', 'data', 'system-truth.json'), 'utf8')); } catch { /* ไม่มี = เกตไม่ถึงขั้นเขียน */ }
let runtimeFp = null, migrationHead = null;
try {
  const h = await fetch('http://localhost:3001/api/health', { signal: AbortSignal.timeout(10_000) });
  const j = await h.json();
  runtimeFp = j?.build?.fingerprint ?? null;
  migrationHead = j?.db?.migrationHead ?? null;
} catch { /* backend ล่ม = codeMatch ไม่มีข้อมูล */ }
const diskFp = truth.prodTruth?.diskFingerprint ?? null;
const codeMatch = diskFp && runtimeFp ? diskFp === runtimeFp : null;
const status = {
  ok,
  durationMin: Math.round((Date.now() - t0) / 60_000),
  finishedAt: new Date().toISOString(),
  lastGateOk: truth.ok ?? null,
  codeMatch,
  migrationHead,
  steps: truth.steps ?? [],
};
writeFileSync(STATUS, JSON.stringify(status, null, 2) + '\n');
try { unlinkSync(LOCK); } catch { /* ข้าม */ }

// ── สรุป Telegram (สคริปต์แยก — soft-fail) — เก็บ output ไว้พิสูจน์เสมอ (ส่ง/skip/พลาด) ──
const rep = spawnSync('node', [join(REPO, 'tools', 'nightly-report.mjs'), STATUS], { cwd: REPO, encoding: 'utf8', shell: true });
writeFileSync(join(LOGDIR, 'report.log'), `${rep.stdout ?? ''}\n${rep.stderr ?? ''}`);
process.exit(ok ? 0 : 1);
