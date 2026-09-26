#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// machine-health.mjs — ตรวจสุขภาพเครื่องจริงก่อน verify (Phase 4)
// เจตนา: nightly ล้มเพราะ "สภาพแวดล้อม" หลายครั้ง (OOM exit 134, ดิสก์เต็มทำ build พัง,
// docker ล่มทำ backend test ชน) — รู้ก่อนรัน แจ้ง Telegram ก่อน ดีกว่ารองนอนแปลกใจ
// ตรวจ: แรมว่าง · ดิสก์ที่ repo อยู่ (E:) · บริการ docker (sovereign-db, sovereign-core-api)
//       · อายุ backup สองสาย (DB backup + offsite — เคสจริง 24–26/9: สาย offsite ขาด 3 คืนเงียบ ๆ)
//       · สุขภาพดิสก์กายภาพ (เครื่องมีดิสก์เดียว C+E — SSD เสื่อม = ทุกอย่างหายพร้อมกัน)
// ผลลัพธ์: JSON ไป stdout (runner อ่านต่อ) — exit 0 เสมอ (soft-fail ไม่หยุด nightly)
// ────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { statfsSync, statSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

// สาย backup เขียนที่ MAIN tree เสมอ (container mount ของ MAIN / offsite-push ชี้ MAIN ตรง ๆ)
// — ถ้ารันจาก worktree ให้ไปดูไฟล์จริงที่ MAIN กันผลบวกปลอมจากสำเนา sandbox ที่ไม่มีไฟล์
const MAIN_ROOT = (() => {
  const i = REPO.indexOf('.freebuff');
  return i > 3 ? REPO.slice(0, i).replace(/[\\/]+$/, '') : REPO;
})();

// เกณฑ์ (ปรับได้ผ่าน env): เตือน = ใกล้ต่ำกว่า · critical = ต่ำกว่าจริง
const RAM_WARN_GB = Number(process.env.MH_RAM_WARN_GB ?? 1.5);
const RAM_CRIT_GB = Number(process.env.MH_RAM_CRIT_GB ?? 0.8);
const DISK_WARN_GB = Number(process.env.MH_DISK_WARN_GB ?? 20);
const DISK_CRIT_GB = Number(process.env.MH_DISK_CRIT_GB ?? 8);
const BACKUP_MAX_AGE_H = Number(process.env.MH_BACKUP_MAX_AGE_H ?? 26); // รอบคืน 03:00 + 2 ชม. กันหลับ/ชดเชย
const DB_BACKUP_DIR = process.env.MH_DB_BACKUP_DIR || join(MAIN_ROOT, 'sovereign-os/core-api/backups');
const OFFSITE_DIR = process.env.MH_OFFSITE_DIR || join(MAIN_ROOT, 'sovereign-os/infra/offsite');
const OFFSITE_LOG = process.env.MH_OFFSITE_LOG || join(DB_BACKUP_DIR, 'offsite-log.jsonl');

const problems = []; // { level, area, message }
const info = {};

// ── 1) แรม (Windows: WMU OS FreeMemory → bytes) ──
try {
  const out = execSync(
    'powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory*1KB)"',
    { encoding: 'utf8', timeout: 20_000 }
  ).trim();
  const freeBytes = Number(out);
  if (Number.isFinite(freeBytes) && freeBytes > 0) {
    info.ramFreeGB = Math.round((freeBytes / 1024 ** 3) * 10) / 10;
    if (info.ramFreeGB < RAM_CRIT_GB) problems.push({ level: 'critical', area: 'ram', message: `แรมว่าง ${info.ramFreeGB}GB < ${RAM_CRIT_GB}GB — build อาจโดน OOM (exit 134)` });
    else if (info.ramFreeGB < RAM_WARN_GB) problems.push({ level: 'warn', area: 'ram', message: `แรมว่าง ${info.ramFreeGB}GB — ต่ำกว่าปกติ (${RAM_WARN_GB}GB) เสี่ยง OOM ระหว่าง build คู่ขนาน` });
  }
} catch { info.ramFreeGB = null; /* ตรวจไม่ได้ — ไม่ทำให้ nightly พัง */ }

// ── 2) ดิสก์ของ repo (E:) — statfs ได้ทั้ง Windows/ลินุกซ์ ──
try {
  const s = statfsSync(REPO);
  const freeGB = Math.round((s.bsize * s.bavail) / 1024 ** 3);
  info.diskFreeGB = freeGB;
  if (freeGB < DISK_CRIT_GB) problems.push({ level: 'critical', area: 'disk', message: `ดิสก์ repo เหลือ ${freeGB}GB < ${DISK_CRIT_GB}GB — build/e2e พังแน่ (ต้องเคลียร์ก่อน)` });
  else if (freeGB < DISK_WARN_GB) problems.push({ level: 'warn', area: 'disk', message: `ดิสก์ repo เหลือ ${freeGB}GB — ใกล้เกินเกณฑ์ (${DISK_WARN_GB}GB) ควรเคลียร์ build cache` });
} catch { info.diskFreeGB = null; }

// ── 3) docker services ที่ verify ต้องใช้ ──
const CONTAINERS = ['sovereign-db', 'sovereign-core-api'];
info.containers = {};
try {
  const out = execSync('docker ps --format "{{.Names}}\\t{{.Status}}"', { encoding: 'utf8', timeout: 20_000 });
  for (const name of CONTAINERS) {
    const line = out.split('\n').find((l) => l.startsWith(name));
    const running = Boolean(line) && /Up|healthy/i.test(line ?? '');
    info.containers[name] = running ? (line ?? '').trim() : 'DOWN';
    if (!running) problems.push({ level: 'critical', area: 'docker', message: `container ${name} ล่ม — DB/API หาย ระบบใช้งานไม่ได้จริง (แจ้งทันทีผ่าน machine-alert)` });
  }
} catch { info.containers = null; problems.push({ level: 'critical', area: 'docker', message: 'docker daemon ไม่ตอบ (Docker Desktop ดับ) — containers ทั้งชุดล่ม ระบบใช้งานไม่ได้จริง (แจ้งทันทีผ่าน machine-alert)' }); }

// ── 4) อายุ backup สองสาย — สายสำรองต้องมาทุกคืน เงียบเกิน = พังแล้วต้องรู้ทันที ──
// (รากเคสจริง 24–26/9: offsite-push ตายเมื่อ DNS ล่ม + ไม่มีใครดูว่าไฟล์ล่าสุดแก่แค่ไหน)
const ageHours = (ms) => Math.round(((Date.now() - ms) / 3_600_000) * 10) / 10;

// 4a) DB backup (เป้า 03:00 ทุกคืน — sovereign_backup_YYYYMMDD_*.sql.gz)
try {
  const files = readdirSync(DB_BACKUP_DIR).filter((f) => f.startsWith('sovereign_backup_') && f.endsWith('.sql.gz')).sort();
  if (!files.length) {
    problems.push({ level: 'critical', area: 'backup', message: `ไม่มีไฟล์ DB backup เลยใน ${DB_BACKUP_DIR} — สาย backup 03:00 ไม่เคยสำเร็จ` });
    info.dbBackupAgeH = null;
  } else {
    const age = ageHours(statSync(join(DB_BACKUP_DIR, files.at(-1))).mtimeMs);
    info.dbBackupAgeH = age;
    if (age > BACKUP_MAX_AGE_H) problems.push({ level: 'critical', area: 'backup', message: `DB backup เก่า ${age} ชม. (> ${BACKUP_MAX_AGE_H}) — ไฟล์ล่าสุด ${files.at(-1)} — สาย 03:00 พัง/ถูกข้ามหลายคืน` });
  }
} catch (e) {
  info.dbBackupAgeH = null;
  problems.push({ level: 'critical', area: 'backup', message: `อ่านโฟลเดอร์ DB backup ไม่ได้ (${String(e?.message || e).slice(0, 80)})` });
}

// 4b) offsite (เป้า ~20:30 ทุกคืน — offsite-log.jsonl จดทั้งส่งสำเร็จและ failed; .enc = staging ก่อนส่ง)
try {
  if (existsSync(OFFSITE_LOG)) {
    const lines = readFileSync(OFFSITE_LOG, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).sort((a, b) => new Date(a.ts) - new Date(b.ts));
    if (!lines.length) {
      problems.push({ level: 'critical', area: 'offsite', message: 'offsite-log.jsonl ว่างเปล่า — ไม่เคย push สำเร็จเลย' });
      info.offsiteAgeH = null;
    } else {
      const last = lines.at(-1);
      const age = ageHours(new Date(last.ts).getTime());
      info.offsiteAgeH = age;
      info.offsiteLastStatus = last.status || (last.tg_message_id ? 'sent' : 'unknown');
      if (info.offsiteLastStatus === 'failed') problems.push({ level: 'critical', area: 'offsite', message: `offsite ล่าสุด (อายุ ${age} ชม.) สถานะ failed — ${String(last.reason || 'ไม่ทราบเหตุ').slice(0, 120)} — ไฟล์สำรองยังอยู่ในเครื่องเท่านั้น` });
      else if (age > BACKUP_MAX_AGE_H) problems.push({ level: 'critical', area: 'offsite', message: `offsite เงียบ ${age} ชม. (> ${BACKUP_MAX_AGE_H}) — ส่งนอกเครื่องล่าสุดเมื่อ ${last.ts}` });
    }
  } else {
    const staged = existsSync(OFFSITE_DIR) ? readdirSync(OFFSITE_DIR).filter((f) => f.startsWith('sovereign_dump_') && f.endsWith('.enc')) : [];
    info.offsiteAgeH = null;
    if (staged.length) problems.push({ level: 'warn', area: 'offsite', message: `มีไฟล์ staging ${staged.length} ไฟล์แต่ไม่มี offsite-log.jsonl — สถานะการส่งจริงไม่ทราบ (log path ผิด/ถูกลบ?)` });
    else problems.push({ level: 'critical', area: 'offsite', message: 'ไม่มี offsite-log.jsonl และไม่มีไฟล์ staging — ไม่เคยสำรองนอกเครื่องเลย' });
  }
} catch (e) {
  info.offsiteAgeH = null;
  problems.push({ level: 'critical', area: 'offsite', message: `ตรวจสาย offsite ไม่ได้ (${String(e?.message || e).slice(0, 80)})` });
}

// ── 5) สุขภาพดิสก์กายภาพ — เครื่องนี้มีดิสก์เดียว (C+E = Disk 0) SSD เสื่อม = ตายทั้งระบบ ──
try {
  const out = execSync('powershell -NoProfile -Command "Get-PhysicalDisk | Select-Object -ExpandProperty HealthStatus"', { encoding: 'utf8', timeout: 20_000 });
  const statuses = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  info.physicalDiskHealth = statuses;
  const bad = statuses.filter((s) => !/healthy/i.test(s));
  if (bad.length) problems.push({ level: 'critical', area: 'disk-health', message: `ดิสก์กายภาพสถานะ ${bad.join(', ')} — SSD กำลังเสื่อม/ผิดปกติ — กู้สำรองทันที (เครื่องมีดิสก์เดียว C+E)` });
} catch { info.physicalDiskHealth = null; /* cmdlet เก่าไป/ไม่มีสิทธิ์ — ข้าม ไม่ทำให้ nightly พัง */ }

const result = {
  checkedAt: new Date().toISOString(),
  ok: problems.every((p) => p.level !== 'critical'),
  problems,
  info,
};

console.log(JSON.stringify(result, null, 2));
process.exit(0);
