#!/usr/bin/env node
/**
 * verify-purge.mjs — พิสูจน์ `uninstall --purge-data` บนสแตกชั่วคราว (ไม่แตะข้อมูลจริง)
 *
 * ทำไม: การทดสอบบนเครื่องจริงทำได้แค่โหมดเก็บข้อมูล (การลบ volume ถาวรทำลายข้อมูลลูกค้า)
 * สคริปต์นี้จึงสร้าง Docker project ของตัวเอง (ชื่อสุ่ม) + volume ของตัวเอง แล้ว:
 *   1) โหมดปกติ  → container หาย แต่ volume + ข้อมูลยังอยู่ (ครบทุก volume ของชุดติดตั้ง)
 *   2) --purge-data → container + volume หายจริง
 *   3) ถอนซ้ำหลัง purge → exit 0 และไม่มีเศษ (container/volume/network) ค้าง
 * ล้างทุกอย่างใน finally เสมอ (down -v + ลบโฟลเดอร์ชั่วคราว)
 *
 * ใช้: node tools/install/verify-purge.mjs [--image timescale/timescaledb:latest-pg15]
 *
 * หมายเหตุ: mqtt/web/api ใช้ alpine แทน image จริง — เป้าหมายคือ "ทุก volume ของ project
 * ถูกลบครบ" ไม่ใช่ทดสอบพฤติกรรม EMQX/Next ซึ่งไม่เกี่ยวกับ uninstaller
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
const FAKE_IMAGE = 'alpine:latest';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UNINSTALL = path.join(ROOT, 'tools', 'install', 'uninstall.mjs');

/** volume ทุกตัวของชุดติดตั้ง — ชื่อต้องตรงกับ compose ด้านล่าง */
const VOLUMES = [
  { key: 'data' },
  { key: 'mqtt', mount: '/opt/mqtt' },
  { key: 'web', mount: '/srv/web' },
  { key: 'api', mount: '/data/api' },
];

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { ok: res.status === 0, status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** สแตกชั่วคราว: db + mqtt + web + api โดยแต่ละตัวมี named volume ของ project เอง */
function makeStack(tag) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `sovereign-purge-${tag}-`));
  const project = `sovereign-verify-${tag}-${Date.now().toString(36)}`;
  const compose = path.join(dir, 'docker-compose.yml');
  const sidecar = (name, mount) => [
    `  ${name}:`,
    `    image: ${FAKE_IMAGE}`,
    `    command: ["sh", "-c", "echo ${name}-marker > ${mount}/marker && sleep infinity"]`,
    '    volumes:',
    `      - ${name}:${mount}`,
  ];
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
      ...sidecar('mqtt', '/opt/mqtt'),
      ...sidecar('web', '/srv/web'),
      ...sidecar('api', '/data/api'),
      'volumes:',
      '  data:',
      '  mqtt:',
      '  web:',
      '  api:',
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
const containerName = (stack, service = 'db') => `${stack.project}-${service}-1`;
const volumeName = (stack, key) => `${stack.project}_${key}`;
const MARKER = { mqtt: '/opt/mqtt/marker', web: '/srv/web/marker', api: '/data/api/marker' };

/** container/volume/network ที่ยังค้างของ project นี้ (ใช้ label ของ compose = แม่นกว่าเดาชื่อ) */
function leftovers(stack) {
  const filter = `label=com.docker.compose.project=${stack.project}`;
  const names = (args) => {
    const res = run('docker', args);
    // อย่าอ่าน stderr เป็นชื่อ — คำสั่งพลาดต้องเห็นเป็น error ไม่ใช่ "มีของค้าง"
    return res.ok ? res.output.split('\n').map((s) => s.trim()).filter(Boolean) : [`error:${res.status}`];
  };
  return {
    containers: names(['ps', '-a', '--filter', filter, '--format', '{{.Names}}']),
    networks: names(['network', 'ls', '--filter', filter, '--format', '{{.Name}}']),
    volumes: names(['volume', 'ls', '--filter', filter, '--format', '{{.Name}}']),
  };
}

function waitReady(stack) {
  for (let i = 0; i < 45; i++) {
    if (run('docker', ['exec', containerName(stack), 'pg_isready', '-U', 'verify', '-d', 'verify']).ok) return true;
    // sleep แบบ sync (main thread) — harness นี้ตั้งใจให้เป็นสคริปต์ sync ทั้งหมด
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  return false;
}

function up(stack) {
  const res = run('docker', [...composeArgs(stack), 'up', '-d', '--wait', '--wait-timeout', '150'], { timeout: 240_000 });
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
  if (!write.ok) return { ok: false, output: write.output };
  // sidecar เขียน marker เองตอน start — รอให้ครบทุกตัวเพื่อไม่ให้ตรวจเร็วเกิน
  for (let i = 0; i < 20; i++) {
    const ready = Object.keys(MARKER).every((svc) => run('docker', ['exec', containerName(stack, svc), 'test', '-f', MARKER[svc]]).ok);
    if (ready) return { ok: true, output: '' };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return { ok: false, output: 'sidecar ไม่ได้เขียน marker ภายใน 10 วิ' };
}

function countRows(stack) {
  const res = run('docker', ['exec', containerName(stack), 'psql', '-U', 'verify', '-d', 'verify', '-tAc', 'select count(*) from probe;']);
  return res.ok ? res.output.trim() : `error:${res.status}`;
}

function readMarker(volume, mount) {
  const res = run('docker', ['run', '--rm', '-v', `${volume}:${mount}`, FAKE_IMAGE, 'cat', `${mount}/marker`]);
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

/** ตรวจว่า volume ทุกตัวของชุดยังอยู่ + ข้อมูลข้างในอ่านได้ */
function checkVolumesIntact(stack, label) {
  for (const v of VOLUMES) {
    check(`${label}: volume ${v.key} ยังอยู่`, volumeExists(volumeName(stack, v.key)));
  }
  for (const v of VOLUMES.filter((x) => x.mount)) {
    const got = readMarker(volumeName(stack, v.key), v.mount);
    check(`${label}: ข้อมูลใน ${v.key} อ่านได้`, got === `${v.key}-marker`, got);
  }
}

function main() {
  console.log(`════ verify purge-data (image: ${IMAGE}) ════\n`);

  // ── 1) โหมดปกติ: เก็บข้อมูลทุก volume ───────────────────────────────────
  const keep = makeStack('keep');
  try {
    const started = up(keep);
    check('สแตกชั่วคราวเริ่มทำงาน (โหมดเก็บข้อมูล)', started.ok, started.ok ? '' : started.output.slice(-300));
    if (!started.ok) throw new Error('stack start failed');

    const plan = buildUninstallPlan({ platform: process.platform, composeFile: keep.compose, projectName: keep.project, purgeData: false });
    check('แผนมี -p ของ project นี้', plan.steps.find((s) => s.id === 'compose-down').args.includes(keep.project));

    const removed = uninstall({ stack: keep, purgeData: false });
    check('uninstall --yes exit 0', removed.ok, removed.ok ? '' : removed.output.slice(-300));
    const left = leftovers(keep);
    check('container ถูกลบครบ 4 ตัว', left.containers.length === 0, left.containers.join(','));
    checkVolumesIntact(keep, 'โหมดเก็บข้อมูล');

    // เปิดกลับมาแล้วต้องเห็นข้อมูลเดิม = พิสูจน์ว่า "ไม่ลบข้อมูล"
    const again = run('docker', [...composeArgs(keep), 'up', '-d', '--wait'], { timeout: 240_000 });
    check('เปิดสแตกกลับได้หลังถอน', again.ok, again.ok ? '' : again.output.slice(-200));
    check('ข้อมูลเดิมยังครบ 3 แถว', countRows(keep) === '3', `rows=${countRows(keep)}`);
    check('marker ของ mqtt/web/api ยังอยู่', Object.keys(MARKER).every((svc) => run('docker', ['exec', containerName(keep, svc), 'test', '-f', MARKER[svc]]).ok));
  } finally {
    cleanup(keep);
  }

  // ── 2) --purge-data: ลบ volume + ข้อมูลจริง ทุกตัว ────────────────────────
  const purge = makeStack('purge');
  try {
    const started = up(purge);
    check('สแตกชั่วคราวเริ่มทำงาน (โหมด purge)', started.ok, started.ok ? '' : started.output.slice(-300));
    if (!started.ok) throw new Error('stack start failed');

    const removed = uninstall({ stack: purge, purgeData: true });
    check('uninstall --yes --purge-data exit 0', removed.ok, removed.ok ? '' : removed.output.slice(-300));
    const left = leftovers(purge);
    check('container ถูกลบทั้งหมด', left.containers.length === 0, left.containers.join(','));
    check('volume ถูกลบครบทุกตัว', VOLUMES.every((v) => !volumeExists(volumeName(purge, v.key))), VOLUMES.map((v) => v.key).join(','));
    check('ไม่มี volume ค้างตาม label', left.volumes.length === 0, left.volumes.join(','));
    check('network ถูกลบ', left.networks.length === 0, left.networks.join(','));
    check('backups ของชุดนี้ถูกลบ', !existsSync(purge.backupsDir));
    // กันเคยพลาด (เคสจริง 10/11/69): purge ของชุดทดสอบลบ backups/ ของ repo จริง
    const repoBackups = path.join(ROOT, 'backups', 'postgres');
    if (existsSync(repoBackups)) {
      const dumps = readdirSync(repoBackups).filter((f) => f.endsWith('.dump'));
      check('backups ของ repo ไม่ถูกแตะ', dumps.length > 0, `${dumps.length} dump`);
    }

    // ── 3) ถอนซ้ำหลัง purge: ต้องไม่ล้มและไม่เหลืออะไร ─────────────────────
    const twice = uninstall({ stack: purge, purgeData: true });
    check('ถอนซ้ำหลัง purge exit 0', twice.ok, twice.ok ? '' : twice.output.slice(-300));
    const after = leftovers(purge);
    check('ถอนซ้ำ: ไม่มีอะไรค้าง', after.containers.length + after.volumes.length + after.networks.length === 0,
      `containers=${after.containers.length} volumes=${after.volumes.length} networks=${after.networks.length}`);
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
