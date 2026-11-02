// tools/test/deploy-guard.test.mjs
//
// ด่าน "ห้าม deploy/migrate โดยไม่มี backup ที่สดพอ" (คิว P0 หลังรอบ PDPA)
//
// ทำไมต้องมี: การ backup ก่อน deploy เป็นวินัยมือล้วน — ไม่มีอะไรกันลืม
// และเคยเกิดจริง (03/11/69: deploy migration ก่อน backup แล้วโชคช่วยที่มี dump รายวัน)
// เทสต์นี้ล็อกกติกา: ไม่มี dump / dump เก่ากว่าฐานข้อมูล / dump เก่าเกินกำหนด = หยุด
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD = path.join(ROOT, 'tools', 'deploy-guard.mjs');
const DEPLOY = path.join(ROOT, 'tools', 'deploy-db.mjs');

const made = [];
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-deploy-guard-'));
  made.push(dir);
  const dumpDir = path.join(dir, 'postgres');
  const migrationsDir = path.join(dir, 'migrations');
  fs.mkdirSync(dumpDir, { recursive: true });
  fs.mkdirSync(migrationsDir, { recursive: true });
  return { dir, dumpDir, migrationsDir };
}

test.after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function writeDump(dumpDir, name, when) {
  const p = path.join(dumpDir, name);
  fs.writeFileSync(p, 'fake dump');
  // ⚠️ utimesSync รับ "Date" หรือ "วินาที" — ส่ง ms ตรง ๆ จะถูกตีเป็น 1970 → EINVAL บน Windows
  fs.utimesSync(p, new Date(when), new Date(when));
  return p;
}

function writeMigration(migrationsDir, name, when) {
  const p = path.join(migrationsDir, name, 'migration.sql');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '-- migration');
  fs.utimesSync(p, new Date(when), new Date(when));
  return p;
}

const iso = (d) => new Date(d).toISOString();
const HOUR = 3600_000;

// ─── ตรรกะหลัก ───

test('ไม่มี dump เลย → หยุด (no_dump) พร้อมบอกคำสั่ง backup', async () => {
  const { assessDeployBackup } = await import('../deploy-guard.mjs');
  const { dumpDir, migrationsDir } = sandbox();
  writeMigration(migrationsDir, '20260101000000_a', Date.now() - 48 * HOUR);

  const r = assessDeployBackup({ dumpDir, migrationsDir });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_dump');
  assert.match(r.remediation, /backup-db\.ps1/, 'ต้องบอกคำสั่งที่ทำให้ผ่านด่าน');
});

test('dump ใหม่กว่าฐานข้อมูล (migration ล่าสุด) + ไม่เกิน 24 ชม. → ผ่าน', async () => {
  const { assessDeployBackup } = await import('../deploy-guard.mjs');
  const { dumpDir, migrationsDir } = sandbox();
  const now = Date.parse('2026-11-04T10:00:00Z');
  writeMigration(migrationsDir, '20261103120000_add_user_consents', now - 30 * HOUR);
  writeDump(dumpDir, 'sovereign_20261104_090000.dump', now - 1 * HOUR);

  const r = assessDeployBackup({ dumpDir, migrationsDir, now });
  assert.equal(r.ok, true);
  assert.equal(r.code, 'ok');
  assert.ok(r.ageHours <= 1.1, 'ต้องรายงานอายุ dump ตามจริง');
});

test('dump เก่ากว่า migration ล่าสุด → หยุด (dump_older_than_migration)', async () => {
  const { assessDeployBackup } = await import('../deploy-guard.mjs');
  const { dumpDir, migrationsDir } = sandbox();
  const now = Date.parse('2026-11-04T10:00:00Z');
  writeDump(dumpDir, 'sovereign_20261103_010000.dump', now - 33 * HOUR);
  writeMigration(migrationsDir, '20261103120000_add_user_consents', now - 2 * HOUR);

  const r = assessDeployBackup({ dumpDir, migrationsDir, now });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'dump_older_than_migration');
  assert.match(r.message, /migration/, 'ต้องบอกว่า migration ใหม่กว่า dump');
});

test('dump ใหม่กว่า migration แต่เก่าเกิน 24 ชม. → หยุด (dump_too_old)', async () => {
  const { assessDeployBackup } = await import('../deploy-guard.mjs');
  const { dumpDir, migrationsDir } = sandbox();
  const now = Date.parse('2026-11-04T10:00:00Z');
  writeMigration(migrationsDir, '20261001000000_old', now - 40 * 24 * HOUR);
  writeDump(dumpDir, 'sovereign_20261101_010000.dump', now - 3 * 24 * HOUR);

  const r = assessDeployBackup({ dumpDir, migrationsDir, now });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'dump_too_old');
  assert.ok(r.ageHours > 70);
});

test('เลือก dump ใหม่สุดเสมอ (ไม่ใช่ไฟล์แรกที่เจอ)', async () => {
  const { assessDeployBackup } = await import('../deploy-guard.mjs');
  const { dumpDir, migrationsDir } = sandbox();
  const now = Date.parse('2026-11-04T10:00:00Z');
  writeMigration(migrationsDir, '20261001000000_old', now - 40 * 24 * HOUR);
  writeDump(dumpDir, 'sovereign_20261020_010000.dump', now - 15 * 24 * HOUR);
  writeDump(dumpDir, 'sovereign_20261104_090000.dump', now - 1 * HOUR);

  const r = assessDeployBackup({ dumpDir, migrationsDir, now });
  assert.equal(r.ok, true);
  assert.match(r.latestDump.path, /20261104_090000/, 'ต้องใช้ไฟล์ล่าสุด');
});

test('ไฟล์ที่ไม่ใช่ .dump ไม่ถูกนับ', async () => {
  const { assessDeployBackup } = await import('../deploy-guard.mjs');
  const { dumpDir, migrationsDir } = sandbox();
  writeMigration(migrationsDir, '20260101000000_a', Date.now() - 48 * HOUR);
  writeDump(dumpDir, 'sovereign_notes.txt', Date.now() - HOUR);

  const r = assessDeployBackup({ dumpDir, migrationsDir });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_dump');
});

// ─── CLI (ใช้ได้จริงจาก terminal) ───

test('CLI: dump เก่า → exit 1 + พิมพ์วิธีแก้ ไม่ใช่แค่เตือน', () => {
  const { dumpDir, migrationsDir } = sandbox();
  const now = Date.parse('2026-11-04T10:00:00Z');
  writeMigration(migrationsDir, '20261103120000_add_user_consents', now - 2 * HOUR);
  writeDump(dumpDir, 'sovereign_20261101_010000.dump', now - 3 * 24 * HOUR);

  const res = spawnSync(
    process.execPath,
    [GUARD, `--dump-dir=${dumpDir}`, `--migrations-dir=${migrationsDir}`, `--now=${iso(now)}`],
    { encoding: 'utf8', timeout: 60_000 }
  );
  assert.equal(res.status, 1, `ต้องไม่ผ่าน (stdout: ${res.stdout})`);
  assert.match(res.stdout + res.stderr, /backup-db\.ps1/);
});

test('CLI: dump สด → exit 0 + JSON ใช้ต่อในสคริปต์ได้', () => {
  const { dumpDir, migrationsDir } = sandbox();
  const now = Date.parse('2026-11-04T10:00:00Z');
  writeMigration(migrationsDir, '20261103120000_add_user_consents', now - 30 * HOUR);
  writeDump(dumpDir, 'sovereign_20261104_090000.dump', now - HOUR);

  const res = spawnSync(
    process.execPath,
    [GUARD, '--json', `--dump-dir=${dumpDir}`, `--migrations-dir=${migrationsDir}`, `--now=${iso(now)}`],
    { encoding: 'utf8', timeout: 60_000 }
  );
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const body = JSON.parse(res.stdout);
  assert.equal(body.ok, true);
});

// ─── สายจริง: deploy ต้องเรียกด่านก่อนแตะอะไร ───

test('deploy-db.mjs เรียกด่านก่อน migrate/restart เสมอ (ลำดับในโค้ด)', () => {
  assert.ok(fs.existsSync(DEPLOY), 'ต้องมี tools/deploy-db.mjs เป็นทาง deploy เดียว');
  const src = fs.readFileSync(DEPLOY, 'utf8');
  const guardAt = src.indexOf('assessDeployBackup');
  const migrateAt = src.indexOf('migrate deploy');
  const restartAt = src.indexOf('restart');
  assert.ok(guardAt > 0, 'ต้องเรียก assessDeployBackup');
  assert.ok(migrateAt > guardAt, 'ห้าม migrate ก่อนตรวจ backup');
  assert.ok(restartAt > guardAt, 'ห้าม restart ก่อนตรวจ backup');
});

test('deploy-db.mjs: dump เก่า → exit 1 และไม่รัน migrate (พิสูจน์จาก CLI)', () => {
  const { dumpDir, migrationsDir } = sandbox();
  const now = Date.parse('2026-11-04T10:00:00Z');
  writeMigration(migrationsDir, '20261103120000_add_user_consents', now - 2 * HOUR);
  writeDump(dumpDir, 'sovereign_20260101_010000.dump', now - 300 * 24 * HOUR);

  const res = spawnSync(
    process.execPath,
    [
      DEPLOY,
      '--yes',
      `--dump-dir=${dumpDir}`,
      `--migrations-dir=${migrationsDir}`,
      `--now=${iso(now)}`,
    ],
    { encoding: 'utf8', timeout: 60_000 }
  );
  assert.equal(res.status, 1);
  const out = res.stdout + res.stderr;
  assert.doesNotMatch(out, /รัน migrate deploy แล้ว|migrate deploy: สำเร็จ/, 'ห้ามรายงานว่า migrate ทำงาน');
  assert.match(out, /backup-db\.ps1/);
});

test('deploy-db.mjs: ไม่ส่ง --yes = แสดงแผนแล้วจบ ไม่แตะระบบ', () => {
  const { dumpDir, migrationsDir } = sandbox();
  const now = Date.parse('2026-11-04T10:00:00Z');
  writeMigration(migrationsDir, '20261103120000_add_user_consents', now - 30 * HOUR);
  writeDump(dumpDir, 'sovereign_20261104_090000.dump', now - HOUR);

  const res = spawnSync(
    process.execPath,
    [DEPLOY, '--dry-run', `--dump-dir=${dumpDir}`, `--migrations-dir=${migrationsDir}`, `--now=${iso(now)}`],
    { encoding: 'utf8', timeout: 60_000 }
  );
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /migrate deploy/);
  assert.match(res.stdout, /will not|ไม่มีอะไรถูก/i);
});
