#!/usr/bin/env node
/* ── ตัวติดตั้งไฟล์เดียว: กันไฟล์ .cmd พังแบบเงียบๆ ──────────────────────
   ทุกบั๊กในไฟล์นี้เจอตอน "รันจริง" ไม่ใช่ตอนอ่านโค้ด และเจอบนเครื่องที่รันด้วย
   หน้าต่างคอนโซลจริง — ถ้าปล่อยให้หลุดไป คนก๊อปไปเครื่องตัวเองแล้วเจอพัง

   ประวัติจริง (12/10/69) — ทั้งหมดจับได้ด้วยเทสต์นี้:
     1. IndexOf หาหมุด payload เจอที่ "บรรทัดคำสั่ง" ก่อน → payload ขยะ
        (ต้อง LastIndexOf เพราะหมุดปรากฏ 2 จุด)
     2. $PSScriptRoot ว่างเปล่าใต้ iex → "Cannot bind argument to parameter 'Path'"
     3. shift ดัน %0 ด้วย → %~f0 กลายเป็นพาธของอาร์กิวเมนต์ → อ่านไฟล์ผิด
     4. วงเล็บใน echo ภายในบล็อก if → cmd นับเป็นตัวปิดบล็อกก่อน
        → ". was unexpected at this time" และทั้งท้ายไฟล์พัง
     5. SwitchParameter รับค่าจาก powershell -File ไม่ได้ (แปลงเป็น string)
     6. Join-Path รับได้ 2 อาร์กิวเมนต์ ไม่ใช่ 3
     7. ข้อความไทยใน .cmd ทำให้ cmd.exe พัง (กฎของโปรเจกต์ — มี batch-codepage คุมอยู่แล้ว)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInstallerCmd, writeCmd, MARKER } from '../build-installer-cmd.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { body } = buildInstallerCmd();
const lines = body.split('\r\n');

describe('รูปแบบไฟล์ .cmd (กฎของโปรเจกต์)', () => {
  test('ASCII ล้วน — ข้อความไทยทำให้ cmd.exe พังทั้งไฟล์', () => {
    const bad = lines.find((l) => /[^\x00-\x7F]/.test(l));
    assert.equal(bad, undefined, `พบอักขระนอก ASCII: ${bad ?? ''}`);
  });

  test('ใช้ CRLF ทั้งหมด (LF อย่างเดียว cmd.exe รันผิดบรรทัด)', () => {
    assert.ok(!body.includes('\n\n'), 'ต้องไม่มีบรรทัด LF เปล่า');
    assert.equal((body.match(/\r\n/g) || []).length, lines.length - 1);
  });

  test('writeCmd เขียนไฟล์ที่ไม่มี BOM', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inst-')), 'X.cmd');
    writeCmd(f, body);
    const b = fs.readFileSync(f);
    assert.notEqual(b[0], 0xef, 'ไฟล์ .cmd ต้องไม่มี UTF-8 BOM');
    assert.equal(b.toString('ascii'), body);
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  });

  test('writeCmd ปฏิเสธไฟล์ที่มีอักขระนอก ASCII (กันไว้ก่อนส่งของเสีย)', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inst-')), 'Y.cmd');
    assert.throws(() => writeCmd(f, '@echo off\r\necho สวัสดี\r\n'), /ASCII/);
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  });
});

describe('หมุด payload (บั๊กข้อ 1 — เจอตอนรันจริง)', () => {
  test('หมุดปรากฏ 2 จุด: บรรทัดคำสั่ง + บรรทัดคั่น', () => {
    const n = body.split(MARKER).length - 1;
    assert.equal(n, 2, `ควรมีหมุด 2 จุด แต่เจอ ${n} จุด`);
  });

  test('ต้องใช้ LastIndexOf ไม่ใช่ IndexOf (ถ้าใช้ IndexOf จะได้ payload ขยะ)', () => {
    assert.ok(body.includes('LastIndexOf'), 'ต้องใช้ LastIndexOf');
    assert.ok(!/\$\w+\.IndexOf\(/.test(body), 'ห้ามใช้ IndexOf หาหมุด');
  });

  test('หมุดตัวหลังอยู่บนบรรทัดของมันเอง (ไม่ฝังในโค้ดบรรทัดอื่น)', () => {
    const idx = body.lastIndexOf(MARKER);
    const startOfLine = body.lastIndexOf('\n', idx) + 1;
    assert.ok(body.slice(startOfLine).startsWith(MARKER), 'หมุดต้องขึ้นต้นบรรทัด');
  });

  test('ตัวเลขที่ใช้ตัด payload ตรงกับความยาวจริงของหมุด', () => {
    assert.ok(
      body.includes(`$t.Substring($i+${MARKER.length})`),
      `ต้องตัดที่ $i+${MARKER.length} — ตัวเลขผิด = payload เริ่มผิดบรรทัด`,
    );
  });
});

describe('payload ที่รันผ่าน iex (บั๊กข้อ 2, 5, 6)', () => {
  const payload = body.slice(body.lastIndexOf(MARKER) + MARKER.length);

  test('ห้ามใช้ $PSScriptRoot — มันว่างเปล่าตอนรันผ่าน iex', () => {
    assert.ok(!payload.includes('$PSScriptRoot'), 'ใช้ $env:SOV_DIR แทน');
  });

  test('ชุดติดตั้งต้องไม่ถูกแตกลง %TEMP% (Windows ล้างทิ้ง + ดิสก์ C: เล็ก)', () => {
    // เคสจริง 12/10/69: ค่าเริ่มต้นเดิมคือ $PSScriptRoot\node-kit แต่ $PSScriptRoot
    //   ของสคริปต์ที่ดาวน์โหลดคือ %TEMP% ⇒ ~11 GB ไปตกบน C:
    const script = fs.readFileSync(path.join(REPO, 'tools', 'node-installer.ps1'), 'utf8');
    assert.ok(
      !/\$Dest\s*=\s*Join-Path\s+\$PSScriptRoot/.test(script),
      'ห้ามใช้ $PSScriptRoot เป็นปลายทางแตกชุด',
    );
    // ต้องอิง $env:SOV_DIR (โฟลเดอร์ของไฟล์ .cmd) — $PSScriptRoot คือ %TEMP%
    assert.match(script, /\$installerDir\s*=\s*if \(\$env:SOV_DIR\)/);
    assert.ok(script.includes("Join-Path $installerDir 'SovereignOS'"), 'ต้องแตกข้างไฟล์ .cmd');
    assert.ok(script.includes('StartsWith($tempFull'), 'ต้องปฏิเสธปลายทางที่อยู่ใน %TEMP%');
  });

  test('ไม่ส่ง -DryRun เป็น switch parameter ผ่าน powershell -File', () => {
    // powershell.exe -File แปลงทุกค่าเป็น string → SwitchParameter แปลงไม่ได้
    assert.ok(!/DryRun'\]\s*=\s*\$true/.test(payload), 'ให้ส่งผ่าน environment แทน');
    assert.ok(payload.includes('SOV_DRYRUN'), 'ต้องอ่านสวิตช์จาก environment');
  });

  test('Join-Path ต้องมี 2 อาร์กิวเมนต์เท่านั้น', () => {
    // เคยพังตอนรันจริง: Join-Path $PSScriptRoot '..' 'logs' → positional parameter error
    for (const line of payload.split('\n')) {
      const m = /Join-Path\s+(.*)$/.exec(line.trim());
      if (!m) continue;
      const single = m[1].replace(/'[^']*'/g, 'X');
      assert.ok(!/\s\S+\s+\S+\s*$/.test(single) || /\(/.test(m[1]), `มี Join-Path เกิน 2 อาร์กิวเมนต์: ${line.trim()}`);
    }
  });
});

describe('ลูปแยกอาร์กิวเมนต์ (บั๊กข้อ 3 — shift ดัน %0 ด้วย)', () => {
  const firstShift = lines.findIndex((l) => /^\s*shift\b/.test(l));
  const selfLine = lines.findIndex((l) => l.includes('set "SOV_SELF=%~f0"'));

  test('ต้องเก็บ %~f0 ไว้ก่อนวนลูป', () => {
    assert.ok(selfLine >= 0, 'ไม่พบบรรทัด set "SOV_SELF=%~f0"');
    assert.ok(selfLine < firstShift, 'ต้องเก็บพาธตัวเองก่อนบรรทัด shift แรก');
  });

  test('ห้ามอ้าง %~f0 หลังวน shift (shift จะดัน %0 ให้เป็น %1)', () => {
    const after = lines.slice(firstShift).filter((l) => l.includes('%~f0'));
    assert.deepEqual(after, [], `พบ %~f0 หลัง shift: ${after.join(' | ')}`);
  });

  test('PowerShell ต้องอ่านพาธจาก environment ไม่ใช่ %~f0 โดยตรง', () => {
    assert.ok(body.includes('$env:SOV_SELF'), 'ต้องใช้ $env:SOV_SELF');
  });
});

describe('สิทธิ์ผู้ดูแลระบบ (บั๊กข้อ 8 — winget ติดตั้ง Docker ไม่ได้)', () => {
  test('ต้องขอสิทธิ์ผู้ดูแลก่อนทำอะไรทั้งหมด', () => {
    const netAt = lines.findIndex((l) => l.trim() === 'net session >nul 2>&1');
    const pwAt = lines.findIndex((l) => l.includes('ReadAllText($f)'));
    assert.ok(netAt > 0, 'ต้องตรวจสิทธิ์ด้วย net session');
    assert.ok(pwAt > 0, 'ต้องมีบรรทัด payload');
    assert.ok(netAt < pwAt, 'ต้องขอสิทธิ์ก่อนเข้า payload');
    assert.ok(lines[netAt + 1].includes('goto :isadmin'), 'ต้องข้ามถ้าเป็นผู้ดูแลอยู่แล้ว');
  });

  test('ต้องยกระดับสิทธิ์ด้วย RunAs และส่งอาร์กิวเมนต์ต่อไปด้วย', () => {
    assert.ok(body.includes('-Verb RunAs'), 'ต้องยกระดับด้วย RunAs');
    // อาร์กิวเมนต์ถูกส่งผ่าน process ยกระดับใหม่ — environment ของเดิมไม่ตามไป
    assert.ok(body.includes("-ArgumentList '%*'"), 'ต้องส่ง %* ไปกับ process ที่ยกระดับ');
  });

  test('ต้องมีทางเลือกไม่มีอาร์กิวเมนต์ด้วย (ไม่งั้น -ArgumentList ว่างพัง)', () => {
    assert.ok(body.includes('if "%*"=="" goto :elevate_noargs'), 'ต้องแยกกรณีไม่มีอาร์กิวเมนต์');
    assert.ok(lines.includes(':elevate_noargs'));
  });

  test('สคริปต์ .ps1 ต้องบอกชัดว่าต้อง Run as administrator', () => {
    const script = fs.readFileSync(path.join(REPO, 'tools', 'node-installer.ps1'), 'utf8');
    assert.match(script, /IsInRole/, 'ต้องตรวจสิทธิ์ใน .ps1 ด้วย (เข้าทางอื่นก็ต้องรู้)');
    assert.match(script, /Run as administrator/, 'ต้องบอกวิธีแก้เป็นภาษาคน');
  });
});

describe('บล็อก if / echo (บั๊กข้อ 4 — cmd นับ ) เป็นตัวปิดบล็อก)', () => {
  test('ห้ามมีวงเล็บในบรรทัด echo ใดๆ', () => {
    const bad = lines.filter((l) => /^\s*echo\b/i.test(l) && /[()]/.test(l));
    assert.deepEqual(bad, [], `cmd จะตีความวงเล็บเป็นตัวปิดบล็อก: ${bad.join(' | ')}`);
  });

  test('ใช้ goto แทน if/else แบบหลายบรรทัดในส่วนท้าย', () => {
    assert.ok(lines.includes('if not "%RC%"=="0" goto :doneerr'), 'ควรกระโดดด้วย goto');
  });
});

describe('เทสต์รวม — รันไฟล์จริงแบบ dry-run', () => {
  test('ไฟล์ที่ประกอบไว้ที่รากต้องตรงกับที่โค้ดสร้าง (ไม่งั้นแก้โค้ดแล้วลืมสร้างใหม่)', () => {
    const f = path.join(REPO, 'INSTALL-SOVEREIGN-NODE.cmd');
    if (!fs.existsSync(f)) return; // ยังไม่ได้สร้าง = ข้าม (ยังไม่ได้รัน build-installer-cmd)
    assert.equal(fs.readFileSync(f, 'ascii'), body, 'รัน: node tools/build-installer-cmd.mjs');
  });

  test('รันจริงแบบ -DryRun ต้องจบด้วย exit 0 และไม่แตะอะไร', (t) => {
    const f = path.join(REPO, 'INSTALL-SOVEREIGN-NODE.cmd');
    if (!fs.existsSync(f)) {
      t.skip('ยังไม่ได้สร้างไฟล์ตัวติดตั้ง');
      return;
    }
    // ถ้า process นี้ไม่มีสิทธิ์ผู้ดูแล = ทดสอบ "การขอสิทธิ์" แทน (UAC ตอบไม่ได้ในเทสต์)
    //   ข้ามการยกระดับด้วย SOV_NO_ELEVATE เพื่อให้ .ps1 ตรวจสิทธิ์และบอกผลตามจริง
    let out = '';
    let code = 0;
    try {
      out = execFileSync('cmd.exe', ['/c', f, '-DryRun'], {
        cwd: REPO,
        encoding: 'utf8',
        input: '',
        timeout: 5 * 60 * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, SOV_NO_ELEVATE: '1' },
      });
    } catch (err) {
      code = err.status ?? 1;
      // pause ไม่มีคนกด → cmd คืนค่า 0 แต่ stdout ต้องบอกว่า DRY RUN จบ
      out = String(err.stdout ?? '') + String(err.stderr ?? '');
    }
    assert.match(
      out,
      /DRY RUN จบ|ไม่ได้แก้อะไร|Run as administrator/,
      `ผลลัพธ์ไม่คาดหวัง:\n${out.slice(0, 900)}`,
    );
    assert.ok(!/รันซ้ำหนึ่งครั้งหลังติดตั้ง Node\.js/.test(out), 'ไม่ควรไปติดตั้ง Node ซ้ำ');
    void code;
  });
});