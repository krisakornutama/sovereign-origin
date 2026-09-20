#!/usr/bin/env node
// test-db-local.mjs — รันชุดเทส real-Postgres บนเครื่องนี้ (แก้ปัญหา TCP loopback ของ Docker Desktop/WSL)
//
// ปัญหาที่แก้: บนเครื่องนี้ (Windows + Docker Desktop ผ่าน WSL) พอร์ต publish 5432 ผ่าน
// wslrelay/wsl-bootstrap "กิน" startup packet ของ Postgres — TCP เปิดได้แต่เซิร์ฟเวอร์ไม่ตอบ
// (จับตอนเขียนชุด real-DB: pg connect ได้แต่ค้างจน "Connection terminated unexpectedly")
// CI บน GitHub ไม่เจอเพราะ service container เชื่อมตรงใน network เดียวกัน
//
// วิธี: สร้าง TCP forwarder ขนาดจิ๋วใน container (node pipe) publish ผ่านพอร์ตอื่น (15432)
// ซึ่งไม่ผ่าน relay ตัวปัญหา → host เชื่อม 127.0.0.1:15432 ได้แบบ bytes ครบทุกไบต์
//
// ทำงานอัตโนมัติทั้งหมด:
//   1. หา container Postgres (sovereign-db) + network ที่มันอยู่ + รหัสผ่านจาก infra/.env
//   2. สร้างฐานทดสอบ sovereign_test (ถ้ายังไม่มี) + prisma db push
//   3. เริ่ม forwarder container (pg-forwarder-test) ถ้ายังไม่มี + ตรวจว่าตอบจริง (ส่ง startup packet จริง)
//   4. รันชุดเทส *-db.test.ts ด้วย tsx --test --test-concurrency=1
//   5. เก็บกวาด (ถ้าสร้าง forwarder เอง → ลบทิ้ง, ถ้ายืมของมีอยู่ → ปล่อยไว้)
//
// ใช้: npm run test:db            (จาก root ของ repo)
//      node tools/test-db-local.mjs --keep   (คง forwarder ไว้สำหรับรอบถัดไปเร็วขึ้น)
import { execSync, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'sovereign-os', 'core-api');
const INFRA_ENV = path.join(ROOT, 'sovereign-os', 'infra', '.env');

const DB_CONTAINER = process.env.DB_CONTAINER || 'sovereign-db';
const DB_USER = 'sovereign';
const TEST_DB = process.env.TEST_DB_NAME || 'sovereign_test';
const FWD_NAME = 'pg-forwarder-test';
const FWD_PORT = 15432;
const KEEP = process.argv.includes('--keep');

const log = (msg) => console.log(`[test-db] ${msg}`);
const fail = (msg) => { console.error(`[test-db] ✗ ${msg}`); process.exit(1); };

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', cwd: ROOT, ...opts }).trim();
}
function shOk(cmd) {
  try { sh(cmd); return true; } catch { return false; }
}

/* 1) หา container + รหัสผ่าน */
if (!shOk(`docker inspect ${DB_CONTAINER}`)) {
  fail(`ไม่พบ container "${DB_CONTAINER}" — เปิด Docker Desktop แล้วรัน docker compose up -d timescaledb ก่อน`);
}
function readPostgresPassword() {
  /* รหัสผ่านอยู่ใน infra/.env เท่านั้น (ไม่ hardcode — ห้ามพิมพ์ค่า) */
  if (fs.existsSync(INFRA_ENV)) {
    const line = fs.readFileSync(INFRA_ENV, 'utf8').split(/\r?\n/).find((l) => l.startsWith('POSTGRES_PASSWORD='));
    if (line) {
      const pw = line.slice('POSTGRES_PASSWORD='.length).trim().replace(/^["']|["']$/g, '');
      if (pw) return pw;
    }
  }
  fail(`ไม่พบ POSTGRES_PASSWORD ใน ${path.relative(ROOT, INFRA_ENV)}`);
}
const PG_PASSWORD = readPostgresPassword();

/* 2) TCP forwarder ใน container — ต้องมาก่อน push schema เพราะพอร์ต 5432 ตรงใช้ไม่ได้บนเครื่องนี้
      (relay loopback กิน startup packet — prisma จะ P1001 ตลอด) */
function fwdRunning() {
  try {
    const state = sh(`docker inspect ${FWD_NAME} --format "{{.State.Running}}"`);
    return state === 'true';
  } catch { return false; }
}
function fwdHealthy() {
  /* ส่ง startup packet จริง — ต้องได้ 'R' (auth request) กลับมาภายใน 3 วิ
     (TCP connect เฉย ๆ ไม่พอ — relay ที่กิน bytes ก็ "เปิด" ได้) */
  return new Promise((resolve) => {
    const params = `user\0${DB_USER}\0database\0${TEST_DB}\0\0`;
    const buf = Buffer.alloc(8 + params.length);
    buf.writeInt32BE(buf.length, 0);
    buf.writeInt32BE(196608, 4);
    buf.write(params, 8);
    const s = net.connect({ host: '127.0.0.1', port: FWD_PORT });
    const done = (ok) => { try { s.destroy(); } catch {} resolve(ok); };
    s.setTimeout(3000, () => done(false));
    s.once('error', () => done(false));
    s.once('data', (d) => done(d.length > 0 && String.fromCharCode(d[0]) === 'R'));
    s.on('connect', () => s.write(buf));
  });
}

let createdFwd = false;
let fwdUrl = `postgresql://${DB_USER}:${encodeURIComponent(PG_PASSWORD)}@127.0.0.1:${FWD_PORT}/${TEST_DB}`;
if (await fwdHealthy()) {
  log(`ใช้ forwarder เดิม (${FWD_NAME}:${FWD_PORT}) — healthy`);
} else {
  if (fwdRunning()) {
    log(`forwarder ค้าง (ไม่ตอบ startup packet) → ลบแล้วสร้างใหม่`);
    shOk(`docker rm -f ${FWD_NAME}`);
  }
  const network = sh(`docker inspect ${DB_CONTAINER} --format "{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}"`);
  log(`สร้าง forwarder ${FWD_NAME} (network ${network} → 127.0.0.1:${FWD_PORT})`);
  const run = spawnSync('docker', [
    'run', '-d', '--rm', '--name', FWD_NAME,
    '--network', network,
    '-p', `127.0.0.1:${FWD_PORT}:${FWD_PORT}`,
    'node:20-alpine', 'node', '-e',
    `const net=require('net');const srv=net.createServer(c=>{const up=net.connect({host:'${DB_CONTAINER}',port:5432});c.pipe(up);up.pipe(c);up.on('error',()=>c.destroy());c.on('error',()=>up.destroy());});srv.listen(${FWD_PORT},()=>console.log('READY'));`,
  ], { stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
  if (run.status !== 0) fail('สร้าง forwarder container ไม่สำเร็จ');
  createdFwd = true;

  /* รอ healthy สูงสุด ~20 วิ (image pull อาจช้าในรอบแรก) */
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    ok = await fwdHealthy();
  }
  if (!ok) fail('forwarder ไม่ตอบ startup packet ภายใน 20 วิ');
  log('forwarder healthy (ตอบ auth request จริง)');
/* 3) ฐานทดสอบ + schema (prisma db push รวมสร้างฐานให้ถ้ายังไม่มี) */
log(`push schema → ${TEST_DB} (สร้างอัตโนมัติถ้ายังไม่มี)`);
const pushUrl = fwdUrl;
{
  const push = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: API, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: pushUrl },
  });
  if (push.status !== 0) fail(`prisma db push ล้มเหลว (exit ${push.status}) — ดู log ข้างบน`);
}


  fwdUrl = `postgresql://${DB_USER}:${encodeURIComponent(PG_PASSWORD)}@127.0.0.1:${FWD_PORT}/${TEST_DB}`;
}

/* 4) รันชุดเทส real-DB */
const TESTS = [
  'tests/knowledge-db.test.ts',
  'tests/uploads-db.test.ts',
  'tests/vision-detections-db.test.ts',
  'tests/security-events-db.test.ts',
  'tests/dime-db.test.ts',
];
const TEST_TMPDIR = path.join(API, '.dbtest-tmp');
fs.mkdirSync(TEST_TMPDIR, { recursive: true });

log(`รัน ${TESTS.length} ไฟล์เทส (RUN_DB_TESTS=1, --test-concurrency=1)`);
const test = spawnSync('npx', ['tsx', '--test', '--test-concurrency=1', ...TESTS], {
  cwd: API,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    RUN_DB_TESTS: '1',
    TEST_DATABASE_URL: fwdUrl,
    TEST_TMPDIR,
    JWT_SECRET: process.env.JWT_SECRET || 'ci-secret-0123456789abcdef',
    TZ: 'Asia/Bangkok',
  },
});

/* 5) เก็บกวาด */
if (createdFwd && !KEEP) {
  log('ลบ forwarder (สร้างเองในรอบนี้) — ใช้ --keep เพื่อคงไว้');
  shOk(`docker rm -f ${FWD_NAME}`);
} else if (KEEP) {
  log(`คง forwarder ไว้ (docker rm -f ${FWD_NAME} เพื่อลบเอง)`);
}

process.exit(test.status ?? 1);
