#!/usr/bin/env node
/* backup-restore-check — พิสูจน์ว่า backup ล่าสุด "กู้คืนได้จริง" ไม่ใช่แค่มีไฟล์ (คำสั่งเจ้าของ 2/10/69)
   ใช้: node tools/verify/backup-restore-check.mjs [--strict] [--test] [--keep]
   เรียกอัตโนมัติ: tools/nightly-verify.mjs (ทุกคืน) + tools/verify/visitor-digest.mjs (รายสัปดาห์)

   ทำอะไร: กู้ dump ล่าสุดเข้า "ฐานข้อมูลชั่วคราว" แล้วเทียบกับฐานข้อมูลจริงทีละตาราง
     · ตารางครบไหม (restore ต้องได้ทุกตาราง)
     · แถวหายไหม (restore มีแถวมากกว่าจริง = ข้อมูลเพี้ยน)
     · migration head ตรงกันไหม
   แล้วลบฐานข้อมูลชั่วคราวทิ้งเสมอ — ไม่แตะฐานข้อมูลจริงเด็ดขาด (อ่านอย่างเดียว)

   ⚠️ เงื่อนไขสำคัญที่เจอจริง 2/10/69: DB นี้ใช้ TimescaleDB — pg_restore ตรง ๆ จะล้มที่
   "could not find hypertable with id 1" เพราะ dump เก็บไฟล์ของ hypertable มาแต่
   ไม่มี metadata ของ hypertable ในฐานใหม่ ต้องเรียก timescaledb_pre_restore() ก่อน
   และ timescaledb_post_restore() หลังเสร็จ (ตามคู่มือ Timescale) ถ้าไม่ทำ = กู้ไม่ขึ้น
   และนี่คือขั้นตอนที่ต้องมีตอนฟื้นระบบจริงด้วย — บันทึกไว้ใน runbook §กู้คืนด้วย */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notify } from './telegram-creds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// worktree (Freebuff) ไม่มีโฟลเดอร์ backups — ให้หาโฟลเดอร์หลักของ MAIN แทน (เหมือน frontend-watchdog)
const MAIN_ROOT = (() => {
  const i = ROOT.indexOf('.freebuff');
  return i > 3 ? ROOT.slice(0, i).replace(/[\\/]+$/, '') : ROOT;
})();
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(MAIN_ROOT, 'backups', 'postgres');
const OUT_DIR = path.join(ROOT, 'logs');
const OUT_FILE = path.join(OUT_DIR, 'backup-restore-check.json');
const TMP_DB = 'sovereign_restore_check';
const CONT = process.env.PG_CONTAINER || 'sovereign-db';
const PG_USER = process.env.PG_USER || 'sovereign';
const LIVE_DB = process.env.PG_DB || 'sovereign';
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const TEST = args.includes('--test');
const KEEP = args.includes('--keep');

const log = (s) => console.log(s);
const docker = (argsList, opts = {}) =>
  execFileSync('docker', argsList, { encoding: 'utf8', timeout: opts.timeout ?? 300_000, windowsHide: true, ...opts });
const psql = (db, sql, opts = {}) =>
  docker(['exec', CONT, 'psql', '-U', PG_USER, '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], opts).trim();

function latestDump() {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.dump'));
  if (!files.length) return null;
  const full = files
    .map((f) => ({ f, p: path.join(BACKUP_DIR, f), t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return full[0];
}

function tableCounts(db) {
  const sql = psql(db, "select format('select %L as t, count(*)::bigint as n from %I.%I;', relname, schemaname, relname) from pg_stat_user_tables where schemaname='public' order by relname");
  const file = path.join(OUT_DIR, `_counts_${db}.sql`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, sql);
  const out = docker(['exec', '-i', CONT, 'psql', '-U', PG_USER, '-d', db, '-At', '-f', '-'], { input: sql });
  const map = new Map();
  for (const line of out.split(/\r?\n/)) {
    const [t, n] = line.split('|');
    if (t && n !== undefined) map.set(t, Number(n));
  }
  try { fs.unlinkSync(file); } catch { /* soft */ }
  return map;
}

function migrationHead(db) {
  try {
    return psql(db, "select migration_name from _prisma_migrations where finished_at is not null order by finished_at desc limit 1;");
  } catch {
    return null;
  }
}

const problems = [];
const rec = { at: new Date().toISOString(), container: CONT, ok: false, problems };

function cleanup() {
  try { docker(['exec', CONT, 'psql', '-U', PG_USER, '-d', 'postgres', '-q', '-c', `DROP DATABASE IF EXISTS ${TMP_DB};`]); } catch { /* soft */ }
  try { docker(['exec', CONT, 'rm', '-f', '/tmp/restore-check.dump']); } catch { /* soft */ }
  try { fs.unlinkSync(path.join(OUT_DIR, '_counts_sovereign.sql')); } catch { /* soft */ }
  try { fs.unlinkSync(path.join(OUT_DIR, `_counts_${TMP_DB}.sql`)); } catch { /* soft */ }
}

try {
  const dump = latestDump();
  if (!dump) {
    problems.push(`ไม่พบไฟล์ .dump ใน ${BACKUP_DIR}`);
  } else {
    rec.dump = dump.f;
    // ห้ามเขียน 3.600_000 — ใน JS นั่นคือ 3.6 (ตัวคั่นหลังจุดทศนิยม) ได้อายุเพี้ยนเป็นล้าน (เจอจริงรอบแรก)
    rec.dumpAgeHours = Math.round((Date.now() - dump.t) / 3_600_000);
    if (rec.dumpAgeHours > 30) problems.push(`dump ล่าสุดเก่า ${rec.dumpAgeHours} ชม. (ถ้าคาดว่าจะมีทุกวัน)`);

    log(`backup-restore-check: กู้ ${dump.f} (${(dump.t ? fs.statSync(dump.p).size / 1048576 : 0).toFixed(1)} MB) ลงฐานข้อมูลชั่วคราว…`);
    docker(['cp', dump.p, `${CONT}:/tmp/restore-check.dump`], { timeout: 300_000 });
    cleanup(); // ล้างร่องรอยรอบก่อน (ถ้าค้างจากครั้งที่แล้ว)
    docker(['cp', dump.p, `${CONT}:/tmp/restore-check.dump`], { timeout: 300_000 });

    psql('postgres', `DROP DATABASE IF EXISTS ${TMP_DB};`);
    psql('postgres', `CREATE DATABASE ${TMP_DB} OWNER ${PG_USER};`);
    // ขั้นตอน Timescale ที่ห้ามข้าม — ขาดแล้ว restore ล้มที่ hypertable
    psql(TMP_DB, 'CREATE EXTENSION IF NOT EXISTS timescaledb;');
    psql(TMP_DB, 'SELECT timescaledb_pre_restore();');

    let restoreErr = '';
    try {
      const out = docker(['exec', CONT, 'pg_restore', '-U', PG_USER, '-d', TMP_DB, '--no-owner', '--no-privileges', '/tmp/restore-check.dump'], { timeout: 600_000 });
      if (out.trim()) restoreErr = out.trim();
    } catch (e) {
      restoreErr = `${e?.stdout ?? ''}${e?.stderr ?? e}`.trim();
    }
    if (restoreErr) problems.push(`pg_restore มีข้อความ/ข้อผิดพลาด: ${restoreErr.split(/\r?\n/)[0].slice(0, 200)}`);
    try { psql(TMP_DB, 'SELECT timescaledb_post_restore();'); } catch (e) { problems.push(`timescaledb_post_restore ล้ม: ${String(e).slice(0, 120)}`); }

    const live = tableCounts(LIVE_DB);
    const restored = tableCounts(TMP_DB);
    rec.liveTables = live.size;
    rec.restoredTables = restored.size;
    if (restored.size === 0) problems.push('กู้แล้วไม่มีตารางเลย');
    const missing = [...live.keys()].filter((t) => !restored.has(t));
    if (missing.length) problems.push(`ตารางที่หายไป ${missing.length} ตัว: ${missing.slice(0, 5).join(', ')}`);
    const more = [...restored.entries()].filter(([t, n]) => live.has(t) && n > live.get(t)).map(([t, n]) => `${t}(${n}>${live.get(t)})`);
    if (more.length) problems.push(`ตารางที่ข้อมูลมากกว่าฐานจริง = เพี้ยน: ${more.slice(0, 5).join(', ')}`);
    const fewer = [...restored.entries()].filter(([t, n]) => live.has(t) && n < live.get(t));
    rec.tablesWithNewerLiveRows = fewer.length; // ปกติ — dump เก่ากว่าเวลาถ่าย
    rec.rowSamples = ['users', 'products', 'business_orders', 'partners', 'feedback_notes']
      .filter((t) => restored.has(t))
      .map((t) => ({ t, live: live.get(t), restored: restored.get(t) }));

    rec.migrationLive = migrationHead(LIVE_DB);
    rec.migrationRestored = migrationHead(TMP_DB);
    if (rec.migrationLive !== rec.migrationRestored) problems.push(`migration head ไม่ตรง: จริง ${rec.migrationLive} · กู้ ${rec.migrationRestored}`);

    log(`backup-restore-check: ตาราง จริง ${rec.liveTables} · กู้ ${rec.restoredTables} · ที่มีข้อมูลใหม่กว่าใน dump ${rec.tablesWithNewerLiveRows} ตาราง (ปกติ)`);
    for (const s of rec.rowSamples) log(`  · ${s.t}: จริง ${s.live} / กู้ ${s.restored}`);
  }
} catch (e) {
  problems.push(`ตรวจไม่สำเร็จ: ${(e?.message ?? String(e)).split(/\r?\n/)[0].slice(0, 200)}`);
} finally {
  if (!KEEP) cleanup();
  else log('backup-restore-check: --keep = ไม่ลบฐานข้อมูลชั่วคราว (เพื่อตรวจต่อ)');
}

rec.ok = problems.length === 0;
try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(rec, null, 2) + '\n');
} catch { /* soft */ }
log(`backup-restore-check: ${rec.ok ? 'ผ่าน — backup กู้คืนได้จริง' : `มีปัญหา ${problems.length} จุด`}`);
if (!rec.ok) {
  const text = [
    '🚨 <b>Backup กู้คืนไม่ได้</b> — ต้องแก้ก่อนเชื่อถือระบบสำรอง',
    ...problems.slice(0, 10).map((p) => `• ${p}`),
    `<code>${new Date().toLocaleString('th-TH')}</code>`,
  ].join('\n');
  if (TEST) log(`[dry] ${text.replace(/<[^>]+>/g, '')}`);
  else notify(text).then((r) => log(r.ok ? 'แจ้ง Telegram แล้ว' : `ส่ง TG ไม่สำเร็จ: ${r.error}`)).catch(() => {});
}
process.exitCode = STRICT && !rec.ok ? 1 : 0;
