#!/usr/bin/env node
/**
 * verify-purge.mjs — พิสูจน์ `uninstall --purge-data` บนสแตกชั่วคราว (ไม่แตะข้อมูลจริง)
 *
 * ทำไม: การทดสอบบนเครื่องจริงทำได้แค่โหมดเก็บข้อมูล (การลบ volume ถาวรทำลายข้อมูลลูกค้า)
 * สคริปต์นี้จึงสร้าง Docker project ของตัวเอง (ชื่อสุ่ม) + volume ของตัวเอง แล้ว:
 *   1) โหมดปกติ  → container หาย แต่ volume + ข้อมูลยังอยู่
 *   2) --purge-data → container + volume หายจริง
 * ล้างทุกอย่างใน finally เสมอ (down -v + ลบโฟลเดอร์ชั่วคราว)
 *
 * ใช้: node tools/install/verify-purge.mjs [--image timescale/timescaledb:latest-pg15]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUninstallPlan } from './uninstall.mjs';


const IMAGE = process.argv.includes('--image')
  ? process.argv[process.argv.indexOf('--image') + 1]
  : 'timescale/timescaledb:latest-pg15';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UNINSTALL = path.join(ROOT, 'tools', 'install', 'uninstall.mjs');

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { ok: res.status === 0, status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** สแตกชั่วคราว: postgres ตัวเดียว + named volume ของ project เอง */
function makeStack(tag) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `sovereign-purge-${tag}-`));
  const project = `sovereign-verify-${tag}-${Date.now().toString(36)}`;
  const compose = path.join(dir, 'docker-compose.yml');
  writeFileSync(
    compose,
    [
      'services:',
      '  db:',
      `    image: ${IMAGE}`,
      '    environment:',
      '      POSTGRES_USER: verify',
      '      POSTGRES_PASSWORD: verify-local-only',
      '      POSTGRES_DB: verify',
      '    volumes:',
      '      - data:/var/lib/postgresql/data',
      '    healthcheck:',
      '      test: ["CMD-SHELL", "pg_isready -U verify -d verify"]',
      '      interval: 2s',
      '      timeout: 3s',
      '      retries: 45',
      'volumes:',
      '  data:',
      '',
    ].join('\n')
  );
  const envFile = path.join(dir, '.env');
  writeFileSync(envFile, `POSTGRES_PASSWORD=verify-local-only\n`);
  // backups/ ของชุดนี้ (purge ต้องลบเฉพาะในโฟลเดอร์นี้)
  mkdirSync(path.join(dir, 'backups'), { recursive: true });
  writeFileSync(path.join(dir, 'backups', 'probe.dump'), 'probe');
  return { dir, project, compose, envFile, backupsDir: path.join(dir, 'backups') };
}

const composeArgs = (stack) => ['compose', '-p', stack.project, '--env-file', stack.envFile, '-f', stack.compose];
const containerName = (stack) => `${stack.project}-db-1`;

function waitReady(stack) {
  for (let i = 0; i < 45; i++) {
    if (run('docker', ['exec', containerName(stack), 'pg_isready', '-U', 'verify', '-d', 'verify']).ok) return true;
    // sleep แบบ sync (main thread) — harness นี้ตั้งใจให้เป็นสคริปต์ sync ทั้งหมด
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  return false;
}

function up(stack) {
  const res = run('docker', [...composeArgs(stack), 'up', '-d', '--wait', '--wait-timeout', '120'], { timeout: 180_000 });
  if (!res.ok) return { ok: false, output: res.output };
  if (!waitReady(stack)) return { ok: false, output: 'postgres ไม่พร้อม (pg_isready ไม่ผ่านใน 60 วิ)' };
  // เขียนข้อมูลจริงลง volume เพื่อพิสูจน์ว่า "ข้อมูลอยู่/หาย" ไม่ใช่แค่ volume มีชื่ออยู่
  const write = run('docker', [
    'exec',
    containerName(stack),
    'psql',
    '-U',
    'verify',
    '-d',
    'verify',
    '-tAc',
    'create table probe(id int); insert into probe values (1),(2),(3); select count(*) from probe;',
  ]);
  return { ok: write.ok, output: write.output };
}

function countRows(stack) {
  const res = run('docker', ['exec', containerName(stack), 'psql', '-U', 'verify', '-d', 'verify', '-tAc', 'select count(*) from probe;']);
  return res.ok ? res.output.trim() : `error:${res.status}`;
}

function volumeExists(volume) {
  return run('docker', ['volume', 'inspect', volume]).ok;
}

function uninstall({ stack, purgeData }) {
  const args = [UNINSTALL, '--yes', '--compose', stack.compose, '--project', stack.project];
  if (purgeData) args.push('--purge-data');
  // ต้องรันจากโฟลเดอร์ชั่วคราว เพื่อให้ env-file auto-detect ของตัวถอนไม่ไปหยิบไฟล์ของ repo
  return run(process.execPath, args, { cwd: stack.dir });
}

function cleanup(stack) {
  run('docker', [...composeArgs(stack), 'down', '-v', '--remove-orphans']);
  try {
    rmSync(stack.dir, { recursive: true, force: true });
  } catch {
    // ปล่อยไว้ใน temp ก็ไม่เป็นไร
  }
}

function main() {
  console.log(`════ verify purge-data (image: ${IMAGE}) ════\n`);

  // ── 1) โหมดปกติ: เก็บข้อมูล ─────────────────────────────────────────────
  const keep = makeStack('keep');
  try {
    const started = up(keep);
    check('สแตกชั่วคราวเริ่มทำงาน (โหมดเก็บข้อมูล)', started.ok, started.ok ? '' : started.output.slice(-300));
    if (!started.ok) throw new Error('stack start failed');

    const plan = buildUninstallPlan({ platform: process.platform, composeFile: keep.compose, projectName: keep.project, purgeData: false });
    check('แผนมี -p ของ project นี้', plan.steps.find((s) => s.id === 'compose-down').args.includes(keep.project));

    const removed = uninstall({ stack: keep, purgeData: false });
    check('uninstall --yes exit 0', removed.ok, removed.ok ? '' : removed.output.slice(-300));
    check('container ถูกลบ', !run('docker', ['ps', '-a', '--format', '{{.Names}}']).output.includes(containerName(keep)));
    check('volume ยังอยู่', volumeExists(`${keep.project}_data`));

    // เปิดกลับมาแล้วต้องเห็นข้อมูลเดิม = พิสูจน์ว่า "ไม่ลบข้อมูล"
    const again = run('docker', [...composeArgs(keep), 'up', '-d', '--wait'], { timeout: 180_000 });
    check('เปิดสแตกกลับได้หลังถอน', again.ok, again.ok ? '' : again.output.slice(-200));
    check('ข้อมูลเดิมยังครบ 3 แถว', countRows(keep) === '3', `rows=${countRows(keep)}`);
  } finally {
    cleanup(keep);
  }

  // ── 2) --purge-data: ลบ volume + ข้อมูลจริง ─────────────────────────────
  const purge = makeStack('purge');
  try {
    const started = up(purge);
    check('สแตกชั่วคราวเริ่มทำงาน (โหมด purge)', started.ok, started.ok ? '' : started.output.slice(-300));
    if (!started.ok) throw new Error('stack start failed');

    const removed = uninstall({ stack: purge, purgeData: true });
    check('uninstall --yes --purge-data exit 0', removed.ok, removed.ok ? '' : removed.output.slice(-300));
    check('container ถูกลบ', !run('docker', ['ps', '-a', '--format', '{{.Names}}']).output.includes(containerName(purge)));
    check('volume ถูกลบจริง', !volumeExists(`${purge.project}_data`));
    check('backups ของชุดนี้ถูกลบ', !existsSync(purge.backupsDir));
    // กันเคยพลาด (เคสจริง 10/11/69): purge ของชุดทดสอบลบ backups/ ของ repo จริง
    const repoBackups = path.join(ROOT, 'backups', 'postgres');
    if (existsSync(repoBackups)) {
      const dumps = readdirSync(repoBackups).filter((f) => f.endsWith('.dump'));
      check('backups ของ repo ไม่ถูกแตะ', dumps.length > 0, `${dumps.length} dump`);
    }
  } finally {
    cleanup(purge);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? '✅ ผ่านครบ' : '⚠ ล้ม'} ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error('✗ harness ล้ม:', e instanceof Error ? e.message : e);
  process.exit(1);
}
