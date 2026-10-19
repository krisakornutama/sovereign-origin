// เทสต์ของ tools/docker-watchdog.mjs
//   เคสจริง 19/10/69: logs/docker-watchdog.jsonl มี daemon-restart 46 ครั้งในวันเดียว
//   (44 ครั้งใน ~1 ชม. ทุกรอบ "daemon กลับมาใน 11–75 วิ" แล้วตายอีก) ⇒ sovereign-db
//   ถูก kill/start วนตลอดชั่วโมงนั้น เพราะ Task Scheduler ปิด job ทิ้งเมื่อรอบจบ
//   ⇒ Docker Desktop ที่ watchdog ปลุกตายตาม ⇒ รอบถัดไป (1 นาที) ปลุกใหม่ = flap
// เทสต์นี้ล็อกสองอย่าง: (1) flap guard ต้องหยุดปลุกเมื่อตายซ้ำ (2) ห้ามกลับไปปลุกตรง ๆ
//   ใน job — ต้องส่งต่อ explorer.exe และต้องพิสูจน์จริงว่าลูกที่ explorer เปิดรอดหลังตัวเปิดจบ
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  FLAP_MAX,
  FLAP_WINDOW_MS,
  planDaemonStart,
  planRecovery,
  readState,
  shouldNotifyFlap,
  writeState,
} from '../docker-watchdog.mjs';

const HOUR = 60 * 60_000;
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sov-wd-'));

describe('planRecovery — กัน flap (daemon ตายซ้ำในเวลาสั้น)', () => {
  test('daemon มีชีวิต = ตรวจคอนเทนเนอร์เท่านั้น (ไม่ปลุก)', () => {
    const d = planRecovery({ daemonAlive: true, attempts: [Date.now() - 1000] });
    assert.equal(d.action, 'containers-checked');
    assert.equal(d.startDaemon, false);
  });

  test('daemon ตายครั้งแรก = ปลุก', () => {
    const d = planRecovery({ daemonAlive: false, attempts: [] });
    assert.equal(d.action, 'daemon-restart');
    assert.equal(d.startDaemon, true);
  });

  test(`ปลุกครบ ${FLAP_MAX} ครั้งในหน้าต่างเวลา = หยุดปลุก (flap-detected)`, () => {
    const now = Date.now();
    const attempts = Array.from({ length: FLAP_MAX }, (_, i) => now - (i + 1) * 60_000);
    const d = planRecovery({ daemonAlive: false, attempts, now });
    assert.equal(d.action, 'flap-detected');
    assert.equal(d.startDaemon, false, 'ห้ามปลุกซ้ำ — ทุกครั้งลาก sovereign-db ตาย/เกิดตาม');
  });

  test('ประวัติเก่ากว่าหน้าต่างเวลา = ปลุกได้ใหม่ (ไม่ติด flap ตลอดไป)', () => {
    const now = Date.now();
    const attempts = Array.from({ length: FLAP_MAX }, (_, i) => now - FLAP_WINDOW_MS - (i + 1) * 60_000);
    const d = planRecovery({ daemonAlive: false, attempts, now });
    assert.equal(d.action, 'daemon-restart');
    assert.equal(d.startDaemon, true);
  });

  test('timestamp เพี้ยน (NaN/สตริง/อนาคต) ต้องไม่ทำให้ตัดสินผิด', () => {
    const now = Date.now();
    const d = planRecovery({ daemonAlive: false, attempts: [NaN, 'x', null, now + 10 * 60_000], now });
    assert.equal(d.action, 'daemon-restart', 'อนาคต/ขยะต้องไม่ถูกนับเป็นความพยายามในอดีต');
  });

  test('หน้าต่างเวลาตั้งได้ (เทสต์ใช้ 1 ชม. ไม่ผูกกับค่าจริง)', () => {
    const now = Date.now();
    const attempts = [now - 20 * 60_000];
    assert.equal(planRecovery({ daemonAlive: false, attempts, now, windowMs: FLAP_WINDOW_MS, max: 1 }).action, 'flap-detected');
    assert.equal(planRecovery({ daemonAlive: false, attempts, now, windowMs: 10 * 60_000, max: 1 }).action, 'daemon-restart');
  });
});

describe('shouldNotifyFlap — แจ้งเตือน flap ต้องไม่ถี่เกิน', () => {
  test('ยังไม่เคยแจ้ง = แจ้ง', () => {
    assert.equal(shouldNotifyFlap({ lastNotifiedAt: 0 }), true);
  });
  test('แจ้งไปแล้ว 5 นาที = ไม่แจ้งซ้ำ (กัน Telegram สแปม)', () => {
    const now = Date.now();
    assert.equal(shouldNotifyFlap({ lastNotifiedAt: now - 5 * 60_000, now }), false);
  });
  test('แจ้งไปแล้วเกิน 1 ชม. = แจ้งได้อีก', () => {
    const now = Date.now();
    assert.equal(shouldNotifyFlap({ lastNotifiedAt: now - HOUR - 60_000, now }), true);
  });
});

describe('state file — อ่านเพี้ยนต้องไม่ทำให้ watchdog ตาย', () => {
  test('round-trip + เก็บประวัติแค่ 50 รายการล่าสุด', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'state.json');
    const attempts = Array.from({ length: 80 }, (_, i) => i + 1);
    writeState({ attempts, lastFlapNotify: 123 }, file);
    const s = readState(file);
    assert.equal(s.attempts.length, 50);
    assert.equal(s.attempts.at(-1), 80);
    assert.equal(s.lastFlapNotify, 123);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ไฟล์หาย / JSON พัง = ค่าเริ่มต้น (ไม่ throw)', () => {
    const dir = tmpDir();
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{ not json');
    assert.deepEqual(readState(path.join(dir, 'missing.json')), { attempts: [], lastFlapNotify: 0 });
    assert.deepEqual(readState(bad), { attempts: [], lastFlapNotify: 0 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('เขียนไม่ได้ (โฟลเดอร์เป็นไฟล์) = ข้าม ไม่ throw', () => {
    const dir = tmpDir();
    const asFile = path.join(dir, 'blocker');
    fs.writeFileSync(asFile, 'x');
    assert.doesNotThrow(() => writeState({ attempts: [1] }, path.join(asFile, 'state.json')));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('planDaemonStart — ห้ามปลุก Docker Desktop ตรง ๆ จากใน job', () => {
  test('มี exe = เปิดผ่าน explorer (โปรเซสนอก job ของ Task Scheduler)', () => {
    const p = planDaemonStart({ exe: 'C:\\x\\Docker Desktop.exe', exists: true });
    assert.ok(p, 'ต้องมีแผน');
    assert.equal(p.file, 'explorer.exe', 'ปลุกตรง ๆ = ลูกตายตาม job เมื่อรอบจบ (เคสจริง 19/10/69)');
    assert.deepEqual(p.args, ['C:\\x\\Docker Desktop.exe'], 'ต้องส่ง path เดิมให้ explorer เปิด');
  });

  test('ไม่มี exe = null (ให้ main รายงานว่าไม่พบตำแหน่งติดตั้ง)', () => {
    assert.equal(planDaemonStart({ exe: 'C:\\nope\\x.exe', exists: false }), null);
  });

  test('ไม่ส่ง exists มา = เช็คไฟล์จริงเอง (ไฟล์ที่ไม่มีต้องได้ null)', () => {
    assert.equal(planDaemonStart({ exe: path.join(os.tmpdir(), 'sov-wd-no-such-' + process.pid + '.exe') }), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  ของจริง: explorer hand-off ต้องรอดหลังตัวเปิดจบไปก่อน
//  เทสต์นี้ไม่แตะ Docker — ใช้ sleeper.vbs (wscript = GUI host ไม่มีหน้าต่าง) เป็นตัวแทน
//  Docker Desktop แล้วดูว่าโพรเซสยังมีชีวิตหลังตัวเปิด (แบบเดียวกับรอบ watchdog) จบไปแล้ว
// ─────────────────────────────────────────────────────────────────────────────
const vbsHandler = String(
  spawnSync('cmd', ['/c', 'ftype', 'VBSFile'], { windowsHide: true, encoding: 'utf8' }).stdout || '',
);
const canRunVbs = /wscript\.exe/i.test(vbsHandler);

function sleeperProcs(name) {
  const q = `@((Get-CimInstance Win32_Process -Filter "Name='wscript.exe'") | Where-Object { $_.CommandLine -like '*${name}*' })`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `${q}.Count`], {
    windowsHide: true, encoding: 'utf8', timeout: 30_000,
  });
  return Number(String(r.stdout || '').trim()) || 0;
}

function killSleepers(name) {
  const q = `@((Get-CimInstance Win32_Process -Filter "Name='wscript.exe'") | Where-Object { $_.CommandLine -like '*${name}*' }) | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync('powershell.exe', ['-NoProfile', '-Command', q], { windowsHide: true, stdio: 'ignore', timeout: 30_000 });
}

async function waitFor(pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return pred();
}

describe('ของจริง: explorer hand-off ต้องรอดหลังตัวเปิดจบ', () => {
  test('sleeper ที่ explorer เปิด ยังทำงานอยู่หลังตัวเปิดออกไปแล้ว', {
    skip: canRunVbs ? false : 'ไม่พบ association .vbs → WScript.exe (ข้ามเพื่อไม่ให้มี dialog เด้งบนจอ)',
    timeout: 120_000,
  }, async () => {
    const dir = tmpDir();
    const name = `sleeper-${process.pid}.vbs`;
    const vbs = path.join(dir, name);
    const marker = path.join(dir, 'started.txt');

    // VBS: จดว่าเริ่มแล้ว (พิสูจน์ว่ารันจริง) แล้วมีชีวิตค้างไว้ 30 วิ (เหมือน Docker Desktop ที่รันยาว)
    fs.writeFileSync(vbs, [
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      `fso.CreateTextFile("${marker}", True).WriteLine "started"`,
      'WScript.Sleep 30000',
      '',
    ].join('\r\n'), 'ascii');

    // ตัวเปิดอายุสั้น: สั่ง explorer ให้เปิด .vbs แล้วจบเลย (เลียนแบบรอบ watchdog ที่จบแล้ว job ถูกปิด)
    const launcher = path.join(dir, 'launch.mjs');
    fs.writeFileSync(launcher, [
      "import { spawnSync } from 'node:child_process';",
      `spawnSync('explorer.exe', [${JSON.stringify(vbs)}], { windowsHide: true, stdio: 'ignore', timeout: 15000 });`,
      '',
    ].join('\n'), 'utf8');

    try {
      const r = spawnSync(process.execPath, [launcher], { windowsHide: true, stdio: 'ignore', timeout: 60_000 });
      assert.equal(r.status, 0, 'ตัวเปิดต้องจบได้');
      assert.ok(await waitFor(() => fs.existsSync(marker), 25_000), 'explorer ต้องเปิด .vbs ได้จริง (marker ต้องเกิด)');
      assert.ok(await waitFor(() => sleeperProcs(name) > 0, 15_000),
        'sleeper ต้องยังมีชีวิตหลังตัวเปิดจบ — ถ้าตาย = ยังอยู่ใน job ที่ถูกปิด (ปัญหาเดิมของ Docker Desktop)');
    } finally {
      killSleepers(name);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
