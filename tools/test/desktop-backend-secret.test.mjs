// desktop-backend-secret — sidecar ต้องมี JWT_SECRET ของเครื่องเอง และความล้มเหลวต้องมีร่องรอย
//
// เคสจริง 13/11/69: ติดตั้ง v1.3.3 แล้วแอปเลือกพอร์ตสำรอง 3011 ถูกต้อง แต่ sidecar
// ตายทันทีเพราะ `config/index.ts` โยน "JWT_SECRET is not set" และ spawn ด้วย
// stdio:'ignore' ⇒ ไม่มี log, ไม่มี exit code, ไม่มี stderr — พอร์ตสำรองที่ประกาศ
// ไปแล้วจึงว่างเปล่าและ frontend ชี้ไปที่ API ที่ไม่มีอยู่
//
// เขียนก่อน implementation (red-first): ../backend-secret.cjs ยังไม่มีตอนรันรอบแรก
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { loadOrCreateJwtSecret, isValidSecret } from '../../sovereign-frontend/electron/backend-secret.cjs';
import { superviseBackend } from '../../sovereign-frontend/electron/backend-supervisor.cjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-secret-'));
}

test('isValidSecret: รับเฉพาะค่าที่ใช้เป็น secret ได้จริง', () => {
  assert.equal(isValidSecret('a'.repeat(64)), true);
  assert.equal(isValidSecret('a'.repeat(32)), true);
  assert.equal(isValidSecret('short'), false);
  assert.equal(isValidSecret(''), false);
  assert.equal(isValidSecret(null), false);
  assert.equal(isValidSecret(undefined), false);
  assert.equal(isValidSecret('has space in it ....................'), false, 'ช่องว่าง = ใช้ไม่ได้');
});

test('loadOrCreateJwtSecret: สร้าง secret ต่อเครื่องครั้งแรก แล้วใช้ค่าเดิมตลอด', () => {
  const dir = tmpDir();
  const first = loadOrCreateJwtSecret({ dir });
  assert.equal(first.created, true);
  assert.equal(first.source, 'file');
  assert.equal(isValidSecret(first.secret), true);
  assert.equal(first.secret.length, 64, 'hex 32 ไบต์');

  const raw = fs.readFileSync(path.join(dir, 'jwt-secret'), 'utf8');
  assert.equal(raw.trim(), first.secret, 'ไฟล์เก็บค่าเดียวกับที่ใช้');

  if (process.platform !== 'win32') {
    const mode = fs.statSync(path.join(dir, 'jwt-secret')).mode & 0o777;
    assert.equal(mode, 0o600, 'ไฟล์ secret ต้องอ่านได้เฉพาะเจ้าของ');
  }

  const second = loadOrCreateJwtSecret({ dir });
  assert.equal(second.secret, first.secret, 'เปิดแอปซ้ำต้องไม่เปลี่ยน secret (token เดิมยังใช้ได้)');
  assert.equal(second.created, false);
});

test('loadOrCreateJwtSecret: secret ที่ผู้ปฏิบัติการตั้งไว้ชนะไฟล์เสมอ และไม่เขียนทับ', () => {
  const dir = tmpDir();
  const envSecret = 'e'.repeat(48);
  const res = loadOrCreateJwtSecret({ dir, envSecret });
  assert.equal(res.secret, envSecret);
  assert.equal(res.source, 'env');
  assert.equal(fs.existsSync(path.join(dir, 'jwt-secret')), false);
});

test('loadOrCreateJwtSecret: ไฟล์ที่เสีย/สั้นเกินไปต้องสร้างใหม่ ไม่ใช่ใช้ต่อ', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'jwt-secret'), 'too-short\n');
  const res = loadOrCreateJwtSecret({ dir });
  assert.equal(res.created, true);
  assert.equal(isValidSecret(res.secret), true);
  assert.notEqual(res.secret, 'too-short');
});

test('superviseBackend: ส่ง JWT_SECRET ให้ sidecar และไม่พิมพ์ค่าออก log', async () => {
  const dir = tmpDir();
  const logs = [];
  let spawnArgs = null;
  const spawn = (cmd, args, opts) => {
    spawnArgs = { cmd, args, opts };
    const child = new EventEmitter();
    child.stderr = new Readable({ read() {} });
    child.stdout = new Readable({ read() {} });
    return child;
  };
  const app = {
    isPackaged: false,
    getPath: () => dir,
  };
  // ให้ supervisor เห็น core-api ที่มีอยู่จริงในรีโป
  const res = await superviseBackend({
    app, http: { get: () => ({ on() {}, destroy() {} }) }, spawn,
    dlog: (m) => logs.push(String(m)),
    probe: async () => ({ listening: false, version: null }),
    env: { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/sovereign' },
  });
  assert.equal(res.verdict, 'free');
  assert.ok(spawnArgs, 'ต้อง spawn sidecar');
  assert.equal(isValidSecret(spawnArgs.opts.env.JWT_SECRET), true);
  assert.equal(spawnArgs.opts.env.JWT_SECRET, res.jwtSecret);
  assert.ok(!logs.join('\n').includes(spawnArgs.opts.env.JWT_SECRET), 'ห้าม log ค่า secret');
});

test('superviseBackend: sidecar ตายต้องทิ้งร่องรอย (exit code + stderr)', async () => {
  const dir = tmpDir();
  const logs = [];
  let child = null;
  const spawn = () => {
    child = new EventEmitter();
    child.stderr = new Readable({ read() {} });
    child.stdout = new Readable({ read() {} });
    child.kill = () => {};
    return child;
  };
  const res = await superviseBackend({
    app: { isPackaged: false, getPath: () => dir },
    http: { get: () => ({ on() {}, destroy() {} }) },
    spawn,
    dlog: (m) => logs.push(String(m)),
    probe: async () => ({ listening: false, version: null }),
    env: { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/sovereign' },
  });
  assert.ok(res.child);

  child.stderr.push('Error: JWT_SECRET is not set\n');
  child.emit('exit', 1, null);
  await new Promise((r) => setTimeout(r, 50));

  const text = logs.join('\n');
  assert.match(text, /backend exit code=1/, 'ต้องบอก exit code');
  assert.match(text, /JWT_SECRET is not set/, 'ต้องเก็บ stderr ไว้ให้เห็นสาเหตุ');
});

test('superviseBackend: ไม่มี DATABASE_URL = ไม่ spawn (ไม่แต่ง file: ให้ Prisma postgresql)', async () => {
  const dir = tmpDir();
  let spawnOpts = null;
  const logs = [];
  const spawn = (cmd, args, opts) => {
    spawnOpts = opts;
    const child = new EventEmitter();
    child.stderr = new Readable({ read() {} });
    child.stdout = new Readable({ read() {} });
    return child;
  };
  const res = await superviseBackend({
    app: { isPackaged: false, getPath: () => dir },
    http: { get: () => ({ on() {}, destroy() {} }) },
    spawn,
    dlog: (m) => logs.push(String(m)),
    probe: async () => ({ listening: false, version: null }),
    env: {}, // เครื่องที่ไม่มี Postgres
  });
  assert.equal(res.verdict, 'no-database');
  assert.equal(spawnOpts, null, 'ไม่มี DB = ไม่เปิดพอร์ตหลอก');
  assert.match(logs.join(' '), /DATABASE_URL/, 'ต้องบอกเหตุผลใน log');
});

test('superviseBackend: มี DATABASE_URL จริง = เปิด migrate ก่อนเสิร์ฟให้เอง', async () => {
  const dir = tmpDir();
  let spawnOpts = null;
  const spawn = (cmd, args, opts) => {
    spawnOpts = opts;
    const child = new EventEmitter();
    child.stderr = new Readable({ read() {} });
    child.stdout = new Readable({ read() {} });
    return child;
  };
  await superviseBackend({
    app: { isPackaged: false, getPath: () => dir },
    http: { get: () => ({ on() {}, destroy() {} }) },
    spawn,
    dlog: () => {},
    probe: async () => ({ listening: false, version: null }),
    env: { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/sovereign' },
  });
  assert.equal(spawnOpts.env.DATABASE_URL, 'postgresql://u:p@127.0.0.1:5432/sovereign');
  assert.equal(spawnOpts.env.MIGRATE_ON_START, '1');
});

test('superviseBackend: sidecar พ่น stderr แล้วยังไม่ตาย ก็ต้องเห็นใน log ทันที', async () => {
  const dir = tmpDir();
  const logs = [];
  let child = null;
  const spawn = () => {
    child = new EventEmitter();
    child.stderr = new Readable({ read() {} });
    child.stdout = new Readable({ read() {} });
    return child;
  };
  await superviseBackend({
    app: { isPackaged: false, getPath: () => dir },
    http: { get: () => ({ on() {}, destroy() {} }) },
    spawn,
    dlog: (m) => logs.push(String(m)),
    probe: async () => ({ listening: false, version: null }),
    env: { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/sovereign' },
  });
  // migrate ล้มเหลวจะถูกเขียนลง stderr แต่โปรเซสยังไม่ตาย — ต้องไม่รอถึง exit
  child.stderr.push('🗄️ migrate: ล้มเหลว — drift\n');
  await new Promise((r) => setTimeout(r, 60));
  assert.match(logs.join('\n'), /migrate: ล้มเหลว/, 'ต้อง log ทันทีที่ได้บรรทัด');
});
