// ─────────────────────────────────────────────────────────────────────────────
// tools/test/hidden-launch.test.mjs
// ตัวช่วย "เปิดคำสั่งแบบไม่มีหน้าต่างเด้ง" (tools/hidden-launch.cjs) + พิสูจน์ของจริง
//
// เคสจริง 20/10/69: เจ้าของส่งภาพหน้าต่าง
//   `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3001/api/health …`
//   เด้งขึ้นมาเองระหว่างเริ่มระบบ ⇒ ต้นตอคือ Electron เปิด start-sovereign.bat ด้วย
//   spawn(cmd, …, { detached: true, windowsHide: true }) ⇒ .bat ไม่มี console
//   ⇒ powershell ในลูป health check (ทุก 3 วิ) ขอ console ใหม่เอง = หน้าต่างจริงเด้ง
//
// เทสต์นี้ล็อก 3 ชั้น:
//   1) buildHiddenCli — รูปแบบ command line (quote path ที่มีเว้นวรรค · log redirection ผ่าน cmd)
//   2) planHiddenLaunch — .cmd ต้อง ASCII + CRLF + ไม่มี BOM + ไม่ซ้ำชื่อกัน และคำสั่งที่ได้ต้อง
//      วิ่งผ่าน wscript (GUI host = ไม่มี console ของตัวเอง)
//   3) พิสูจน์บนเครื่องนี้ — รัน .bat จริงผ่าน wscript + tools/run-hidden.vbs แล้วใช้ probe
//      (tools/window-flash-probe.ps1) นับหน้าต่างที่มองเห็นได้จริง ⇒ ต้องได้ 0 หน้าต่าง
//      และ .bat ต้องทำงานจนจบแม้ตัวที่เปิดมัน "จบไปก่อน" (ออกจากโปรเซสทันที)
//
// รัน: npm run test:tools
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { buildHiddenCli, buildTempVbsBody, planHiddenLaunch, WSCRIPT } = require(path.join(ROOT, 'tools', 'hidden-launch.cjs'));

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sov-hidden-'));

// ═════════════════════════════════════════════════════════════
//  1) buildHiddenCli
// ═════════════════════════════════════════════════════════════
describe('buildHiddenCli — ต่อ command line ให้ปลอดภัยกับ path ที่มีเว้นวรรค', () => {
  test('ไม่ใส่ quote ถ้าไม่จำเป็น', () => {
    assert.equal(buildHiddenCli({ file: 'wscript.exe' }), 'wscript.exe');
  });

  test('ใส่ quote ให้ path ที่มีเว้นวรรค (ไม่งั้น cmd แยกเป็นสองคำสั่ง)', () => {
    const cli = buildHiddenCli({ file: 'E:\\My work\\node.exe', args: ['-e', 'x y'] });
    assert.equal(cli, '"E:\\My work\\node.exe" -e "x y"');
  });

  test('มี log = ต้องผ่าน cmd เพื่อให้ >> ทำงาน (WshShell.Run ไม่มี shell)', () => {
    const cli = buildHiddenCli({ file: 'C:\\n.exe', args: ['a'], logFile: 'E:\\l g\\out.log' });
    assert.match(cli, /^cmd \/c "/, 'ต้องเรียก cmd /c');
    assert.match(cli, />> "E:\\l g\\out\.log" 2>&1"$/, 'ต้อง redirect ทั้ง stdout และ stderr');
  });
});

// ═════════════════════════════════════════════════════════════
//  2) planHiddenLaunch
// ═════════════════════════════════════════════════════════════
describe('planHiddenLaunch — ต้องได้ wscript ที่ไม่มี console ของตัวเอง', () => {
  test('มี tools/run-hidden.vbs ในโปรเจ็กต์ = ใช้ตัวนั้น', () => {
    const plan = planHiddenLaunch({ rootDir: ROOT, cli: 'cmd /c echo hi', tmpDir: tmpDir(), tag: 'test' });
    assert.ok(plan, 'ต้องวางแผนได้');
    assert.equal(plan.file, WSCRIPT, 'ต้องรันผ่าน wscript (GUI host)');
    assert.ok(plan.args.includes('//B'), 'ต้อง //B (โหมดไม่มี UI เลย)');
    assert.ok(plan.args.includes(path.join(ROOT, 'tools', 'run-hidden.vbs')), 'ต้องใช้ run-hidden.vbs ของโปรเจ็กต์');
    assert.ok(fs.existsSync(plan.cmdFile), 'ต้องมีไฟล์ .cmd ที่ wscript จะอ่าน');
  });

  test('.cmd ต้อง ASCII + CRLF + ไม่มี BOM (กฎ .cmd ของโปรเจ็กต์)', () => {
    const r = planHiddenLaunch({ rootDir: ROOT, cli: 'cmd /c echo hello', tmpDir: tmpDir(), tag: 'test' });
    const buf = fs.readFileSync(r.cmdFile);
    assert.ok(!(buf[0] === 0xEF && buf[1] === 0xBB), 'ต้องไม่มี BOM');
    assert.ok(buf.includes(0x0d) && buf.includes(0x0a), 'ต้องเป็น CRLF');
    const text = buf.toString('ascii');
    assert.match(text, /cmd \/c echo hello\r\n$/, 'ต้องมีคำสั่งเดียวจบ');
  });

  test('เรียกติดกันต้องได้ไฟล์คนละชื่อ (wscript อ่าน async — เขียนทับ = รันผิดคำสั่ง)', () => {
    const dir = tmpDir();
    const a = planHiddenLaunch({ rootDir: ROOT, cli: 'cmd /c echo A', tmpDir: dir, tag: 'same' });
    const b = planHiddenLaunch({ rootDir: ROOT, cli: 'cmd /c echo B', tmpDir: dir, tag: 'same' });
    assert.notEqual(a.cmdFile, b.cmdFile, 'ชื่อไฟล์ต้องไม่ซ้ำกัน');
    assert.match(fs.readFileSync(a.cmdFile, 'ascii'), /echo A/);
    assert.match(fs.readFileSync(b.cmdFile, 'ascii'), /echo B/);
  });

  test('ไม่มี run-hidden.vbs (แพ็กแบบไม่มี tools/) = สร้าง VBS สำรองที่ทำหน้าที่เดียวกัน', () => {
    const dir = tmpDir();
    const plan = planHiddenLaunch({ rootDir: path.join(dir, 'no-such-root'), cli: 'cmd /c echo hi', tmpDir: dir, tag: 'fallback' });
    assert.ok(plan, 'ต้องยังวางแผนได้');
    assert.equal(plan.file, WSCRIPT);
    const vbs = fs.readFileSync(plan.vbs, 'ascii');
    assert.match(vbs, /sh\.Run\("cmd \/c echo hi", 0, True\)/, 'ต้องรันแบบซ่อน (0) และรอจบ (True)');
    assert.match(vbs, /WScript\.Quit rc/, 'ต้องคืน exit code ให้ผู้เรียก');
  });

  test('คำสั่งที่มีอักขระไทย = null (ไฟล์ .cmd อ่านด้วย codepage ของ console แล้วพังทั้งไฟล์)', () => {
    const plan = planHiddenLaunch({ rootDir: ROOT, cli: 'cmd /c echo สวัสดี', tmpDir: tmpDir(), tag: 'thai' });
    assert.equal(plan, null, 'ต้องปฏิเสธคำสั่งที่มีอักขระนอก ASCII');
  });

  test('buildTempVbsBody ต้อง escape เครื่องหมายคำพูดเป็น ""', () => {
    const body = buildTempVbsBody('cmd /c ""C:\\a b\\x.bat""');
    // 4 quote ในคำสั่ง → escaping เป็น 8 + เครื่องหมายปิดอาร์กิวเมนต์ของ Run อีก 1 = 5 ตัวท้าย
    assert.ok(
      body.includes('rc = sh.Run("cmd /c """"C:\\a b\\x.bat""""", 0, True)'),
      `VBS ต้อง escape " ด้วย "" — ได้:\\n${body}`,
    );
  });
});

// ═════════════════════════════════════════════════════════════
//  3) ของจริงบนเครื่องนี้ — probe นับหน้าต่างที่มองเห็นได้
// ═════════════════════════════════════════════════════════════
const PROBE = path.join(ROOT, 'tools', 'window-flash-probe.ps1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasPowerShell() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true, timeout: 20_000 });
  return r.status === 0;
}

describe('ของจริง: .bat ผ่าน wscript ต้องไม่มีหน้าต่างเด้ง และต้องรอดแม้คนเปิดจบไปก่อน', () => {
  test('probe จับ 0 หน้าต่าง · .bat ทำงานจนจบ', { timeout: 60_000 }, async (t) => {
    if (process.platform !== 'win32') return t.skip('Windows เท่านั้น');
    if (!fs.existsSync(PROBE)) return t.skip('ไม่พบ window-flash-probe.ps1');
    if (!hasPowerShell()) return t.skip('ไม่มี powershell');

    const dir = tmpDir();
    const marker = `SOVFLASH${Date.now().toString(36).toUpperCase()}`;
    const bat = path.join(dir, 'work.bat');
    const started = path.join(dir, 'started.txt');
    const finished = path.join(dir, 'finished.txt');
    const probeLog = path.join(dir, 'probe.log');
    const launcher = path.join(dir, 'launch.cjs');

    // .bat เหมือนของจริง: มี inline powershell (ตัวที่เคยเด้ง) + ทำงานค้างพอให้พ่อแม่จบก่อน
    fs.writeFileSync(
      bat,
      [
        '@echo off',
        `echo started > "${started}"`,
        `powershell -NoProfile -Command "Start-Sleep -Milliseconds 1500; # ${marker}"`,
        `echo finished > "${finished}"`,
        '',
      ].join('\r\n'),
      'ascii',
    );

    const plan = planHiddenLaunch({ rootDir: ROOT, cli: buildHiddenCli({ file: bat }), tmpDir: dir, tag: 'livetest' });
    assert.ok(plan, 'ต้องวางแผนแบบซ่อนได้');

    // ตัวเปิด: spawn wscript แล้ว "จบตัวเองทันที" — .bat ต้องทำงานต่อได้เอง
    fs.writeFileSync(
      launcher,
      [
        "const { spawn } = require('node:child_process');",
        `spawn(${JSON.stringify(plan.file)}, ${JSON.stringify(plan.args)}, { detached: true, windowsHide: true, stdio: 'ignore' }).unref();`,
        'setTimeout(() => process.exit(0), 200);',
        '',
      ].join('\n'),
      'ascii',
    );

    const probeCmd = `& '${PROBE}' -Seconds 9 -Out '${probeLog}'`;
    const probe = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', probeCmd], {
      windowsHide: true, stdio: 'ignore',
    });
    await sleep(700);

    const launcherRun = spawnSync(process.execPath, [launcher], { windowsHide: true, timeout: 30_000 });
    assert.equal(launcherRun.status, 0, 'ตัวเปิดต้องจบได้เอง (exit 0)');

    // รอ .bat จบ (สูงสุด 15 วิ) — ต้องจบได้ทั้งที่ตัวเปิดออกไปแล้ว
    const deadline = Date.now() + 15_000;
    while (!fs.existsSync(finished) && Date.now() < deadline) await sleep(200);
    assert.ok(fs.existsSync(started), '.bat ต้องเริ่มทำงาน');
    assert.ok(fs.existsSync(finished), '.bat ต้องทำงานจนจบแม้ตัวเปิดจบไปก่อน (นี่คือเหตุผลที่ต้อง detached ที่ wscript)');

    await new Promise((r) => probe.on('exit', r));
    const seen = fs.existsSync(probeLog) ? fs.readFileSync(probeLog, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    const flashed = seen.filter((l) => l.includes(marker));
    assert.deepEqual(
      flashed,
      [],
      `เจอหน้าต่างเด้งจริง ${flashed.length} บรรทัด — hidden launcher ไม่ทำงาน:\n  ${flashed.slice(0, 3).join('\n  ')}`,
    );
  });
});
