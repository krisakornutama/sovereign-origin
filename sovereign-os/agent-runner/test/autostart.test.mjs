// test/autostart.test.mjs — เทสต์ "เครื่องลูกเปิด runner เองตอนล็อกอิน"
//
// ของที่ต้องจับให้ได้ (แต่ละข้อเคยเป็นกับดักจริงบนเครื่อง 2):
//   1) path มีเว้นวรรค/อักษรไทย ⇒ คำสั่งต้องถูก quote ให้ถูก ไม่งั้น task ล้มเงียบ
//   2) ติดตั้งซ้ำทุกครั้งที่บูต ⇒ ต้องไม่เขียนไฟล์ใหม่ถ้าเนื้อหาเดิม (idempotent)
//   3) schtasks ล้ม (ไม่มีสิทธิ์ admin) ⇒ ต้องไม่ throw และยังมี Startup entry เป็นทางสำรอง
//   4) ผู้ใช้ปิดเองได้ด้วย AUTOSTART=false ⇒ ต้องไม่แตะอะไรเลย
//   5) ไม่ใช่ Windows ⇒ ข้าม ไม่ throw
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STARTUP_FILE_NAME,
  HIDDEN_LAUNCHER_NAME,
  TASK_NAME,
  isAutostartEnabled,
  buildHiddenLauncher,
  buildStartupEntry,
  ensureAutostart,
} from '../src/autostart.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_DIR = 'E:\\My work\\Project Sovereign Origin\\sovereign-os\\agent-runner';
const APP_DATA = 'C:\\Users\\USER\\AppData\\Roaming';
const STARTUP_DIR = path.join(APP_DATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const STARTUP_PATH = path.join(STARTUP_DIR, STARTUP_FILE_NAME);
const HIDDEN_PATH = path.join(RUNNER_DIR, HIDDEN_LAUNCHER_NAME);

/** fs ปลอมในหน่วยความจำ — นับจำนวนครั้งที่เขียน เพื่อพิสูจน์ว่าไม่เขียนซ้ำ */
function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  const dirs = new Set();
  const writes = [];
  return {
    files,
    writes,
    existsSync(p) {
      return files.has(p) || dirs.has(p);
    },
    readFileSync(p) {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(p);
    },
    writeFileSync(p, data) {
      writes.push(p);
      files.set(p, String(data));
    },
    mkdirSync(p) {
      dirs.add(p);
    },
  };
}

/** exec ปลอม — เก็บคำสั่งที่ถูกเรียก และตอบตามที่กำหนด */
function fakeExec(handler = () => ({ code: 0, stdout: '', stderr: '' })) {
  const calls = [];
  const exec = async (file, args = [], opts = {}) => {
    calls.push({ file, args, opts });
    return handler(file, args, opts) ?? { code: 0, stdout: '', stderr: '' };
  };
  exec.calls = calls;
  return exec;
}

const quiet = () => {};

test('isAutostartEnabled: ค่าเริ่มต้นเปิด และปิดได้ด้วย AUTOSTART=false/0', () => {
  assert.equal(isAutostartEnabled({}), true);
  assert.equal(isAutostartEnabled({ AUTOSTART: '' }), true);
  assert.equal(isAutostartEnabled({ AUTOSTART: 'true' }), true);
  for (const off of ['false', '0', 'no', 'off', 'FALSE']) {
    assert.equal(isAutostartEnabled({ AUTOSTART: off }), false, `AUTOSTART=${off} ต้องปิด`);
  }
});

test('buildHiddenLauncher: quote path ที่มีเว้นวรรค และรันแบบซ่อนหน้าต่าง (0, False)', () => {
  const vbs = buildHiddenLauncher({ runnerDir: RUNNER_DIR });
  assert.match(vbs, /Set sh = CreateObject\("WScript\.Shell"\)/);
  // CurrentDirectory ต้องเป็น path เต็ม (ไม่ลงท้ายด้วย \ ก็ได้)
  assert.ok(
    vbs.includes(`sh.CurrentDirectory = "${RUNNER_DIR}"`) || vbs.includes(`sh.CurrentDirectory = "${RUNNER_DIR}\\"`),
    'ต้องตั้ง CurrentDirectory เป็นโฟลเดอร์ runner',
  );
  // 0 = ซ่อนหน้าต่าง · False = ไม่รอจบ
  assert.match(vbs, /, 0, False\s*$/m);
  // path ที่มีเว้นวรรคต้องอยู่ในเครื่องหมายคำพูด ("" ใน VBS = " หนึ่งตัว)
  assert.ok(vbs.includes(`""${RUNNER_DIR}\\run-runner.cmd""`), 'คำสั่งต้อง quote path ของ run-runner.cmd');
});

test('buildStartupEntry: ชี้ไปที่ hidden launcher ตัวจริง ไม่ก็อปโค้ดทั้งก้อน', () => {
  const vbs = buildStartupEntry({ hiddenLauncherPath: HIDDEN_PATH });
  assert.ok(vbs.includes(`""${HIDDEN_PATH}""`), 'ต้อง quote path ของ hidden launcher');
  assert.match(vbs, /wscript\.exe/i);
  assert.match(vbs, /, 0, False\s*$/m);
});

test('ensureAutostart: Windows + ยังไม่มีอะไร = สร้าง hidden launcher, startup entry และ task', async () => {
  const fsImpl = memFs();
  const exec = fakeExec((file, args) => {
    if (args[0] === '/Query') return { code: 1, stdout: '', stderr: 'not found' };
    return { code: 0, stdout: 'SUCCESS', stderr: '' };
  });

  const out = await ensureAutostart({
    runnerDir: RUNNER_DIR,
    appData: APP_DATA,
    platform: 'win32',
    env: {},
    fsImpl,
    exec,
    log: quiet,
  });

  assert.equal(out.ok, true);
  assert.equal(out.startup, 'created');
  assert.equal(out.task, 'created');
  assert.ok(fsImpl.files.has(HIDDEN_PATH), 'ต้องมี hidden launcher ในโฟลเดอร์ runner');
  assert.ok(fsImpl.files.has(STARTUP_PATH), 'ต้องมีไฟล์ใน Startup folder');

  // ไฟล์ .vbs ที่มีอักษรไทย/ยูนิโค้ดต้องเขียนเป็น UTF-16LE พร้อม BOM ไม่งั้น wscript อ่านเพี้ยน
  assert.ok(fsImpl.files.get(STARTUP_PATH).startsWith('\uFEFF'), 'ต้องมี BOM');
  assert.ok(fsImpl.files.get(HIDDEN_PATH).startsWith('\uFEFF'), 'ต้องมี BOM');

  const create = exec.calls.find((c) => c.args[0] === '/Create');
  assert.ok(create, 'ต้องเรียก schtasks /Create');
  assert.ok(create.args.includes(TASK_NAME), 'ต้องตั้งชื่อ task ตามที่ตกลง');
  assert.ok(create.args.includes('ONLOGON'), 'ต้องรันตอนล็อกอิน');
  const tr = create.args[create.args.indexOf('/TR') + 1];
  assert.ok(tr.includes(`"${HIDDEN_PATH}"`), `คำสั่งใน task ต้อง quote path (ได้: ${tr})`);
  assert.equal(create.opts?.windowsHide, true, 'ต้องไม่เด้งหน้าต่างดำ');
});

test('ensureAutostart: เรียกซ้ำแล้วต้องไม่เขียนไฟล์ซ้ำ และไม่สร้าง task ซ้ำ', async () => {
  const fsImpl = memFs();
  let queried = 0;
  const exec = fakeExec((file, args) => {
    if (args[0] === '/Query') {
      queried += 1;
      return { code: 0, stdout: 'TaskName: Sovereign Agent Runner', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  });

  const first = await ensureAutostart({
    runnerDir: RUNNER_DIR,
    appData: APP_DATA,
    platform: 'win32',
    env: {},
    fsImpl,
    exec,
    log: quiet,
  });
  const writesAfterFirst = fsImpl.writes.length;
  assert.ok(writesAfterFirst > 0, 'รอบแรกต้องเขียนไฟล์');

  const second = await ensureAutostart({
    runnerDir: RUNNER_DIR,
    appData: APP_DATA,
    platform: 'win32',
    env: {},
    fsImpl,
    exec,
    log: quiet,
  });

  assert.equal(fsImpl.writes.length, writesAfterFirst, 'รอบสองต้องไม่เขียนไฟล์เพิ่ม');
  assert.equal(second.startup, 'unchanged');
  assert.equal(second.task, 'exists');
  assert.equal(exec.calls.filter((c) => c.args[0] === '/Create').length, 0, 'มี task อยู่แล้วห้ามสร้างซ้ำ');
  assert.ok(queried >= 1);
  assert.equal(first.ok, true);
});

test('ensureAutostart: schtasks ล้ม (ไม่ใช่ admin) = ไม่ throw และยังติดตั้ง Startup entry สำเร็จ', async () => {
  const fsImpl = memFs();
  const exec = fakeExec((file, args) => {
    if (args[0] === '/Query') return { code: 1, stdout: '', stderr: 'not found' };
    return { code: 1, stdout: '', stderr: 'ERROR: Access is denied.' };
  });

  const out = await ensureAutostart({
    runnerDir: RUNNER_DIR,
    appData: APP_DATA,
    platform: 'win32',
    env: {},
    fsImpl,
    exec,
    log: quiet,
  });

  assert.equal(out.ok, true, 'ติดตั้งไม่ครบก็ต้องไม่ทำให้ runner ล้ม');
  assert.equal(out.task, 'failed');
  assert.match(String(out.taskError), /Access is denied/i);
  assert.ok(fsImpl.files.has(STARTUP_PATH), 'Startup entry ต้องถูกสร้างแม้ task ล้ม');
});

test('ensureAutostart: AUTOSTART=false = ไม่แตะไฟล์และไม่เรียก schtasks', async () => {
  const fsImpl = memFs();
  const exec = fakeExec();

  const out = await ensureAutostart({
    runnerDir: RUNNER_DIR,
    appData: APP_DATA,
    platform: 'win32',
    env: { AUTOSTART: 'false' },
    fsImpl,
    exec,
    log: quiet,
  });

  assert.equal(out.status, 'skipped');
  assert.equal(fsImpl.writes.length, 0);
  assert.equal(exec.calls.length, 0);
});

test('ensureAutostart: ไม่ใช่ Windows = ข้ามแบบไม่ throw', async () => {
  const fsImpl = memFs();
  const exec = fakeExec();

  const out = await ensureAutostart({
    runnerDir: '/opt/runner',
    appData: '/home/user/.config',
    platform: 'linux',
    env: {},
    fsImpl,
    exec,
    log: quiet,
  });

  assert.equal(out.status, 'skipped');
  assert.equal(fsImpl.writes.length, 0);
  assert.equal(exec.calls.length, 0);
});

test('ensureAutostart: ไม่มี APPDATA = ยังติดตั้ง hidden launcher + task ได้ (Startup ข้าม)', async () => {
  const fsImpl = memFs();
  const exec = fakeExec((file, args) =>
    args[0] === '/Query' ? { code: 1, stdout: '', stderr: 'not found' } : { code: 0, stdout: '', stderr: '' },
  );

  const out = await ensureAutostart({
    runnerDir: RUNNER_DIR,
    appData: '',
    platform: 'win32',
    env: {},
    fsImpl,
    exec,
    log: quiet,
  });

  assert.equal(out.startup, 'skipped');
  assert.ok(fsImpl.files.has(HIDDEN_PATH), 'hidden launcher ต้องถูกสร้าง');
  assert.equal(out.task, 'created');
});

test('main.mjs: ต้องเรียก ensureAutostart ตอนบูต (กันคนลบการเชื่อมต่อทิ้ง)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'main.mjs'), 'utf8');
  assert.match(src, /from '\.\/autostart\.mjs'/, 'ต้อง import autostart.mjs');
  assert.match(src, /ensureAutostart\s*\(/, 'ต้องเรียก ensureAutostart()');
  assert.match(src, /AUTOSTART/, 'ต้องอ่านค่าปิดจาก env');
});

test('doctor.mjs: ตรวจ autostart ทาง Startup folder ได้ และชื่อไฟล์ตรงกัน', () => {
  const src = fs.readFileSync(path.join(HERE, '..', '..', '..', 'tools', 'agent-pack', 'doctor.mjs'), 'utf8');
  assert.ok(src.includes(`'${STARTUP_FILE_NAME}'`), `doctor ต้องรู้จักไฟล์ ${STARTUP_FILE_NAME}`);
  assert.match(src, /Startup folder/, 'doctor ต้องยอมรับ Startup entry แทน Scheduled Task');
});
