#!/usr/bin/env node
/* ── หาสาเหตุจริงที่ Docker Desktop ติดตั้งไม่ได้ ───────────────────────────
   เคสจริง 12/10/69: winget ล้ม exit 1 บอกแค่ "Installer failed with exit code: 1"
     แล้วตัวติดตั้งบอก "ติดตั้งเองแล้วรันซ้ำ" — คนไม่มีทางรู้ว่าเพราะอะไร ต้องเดา

   สาเหตุที่เจอบ่อยที่สุด: WSL2 ไม่ได้เปิด (Docker Desktop บังคับใช้)
   รองลงมา: Virtualization ปิดใน BIOS

   เทสต์นี้ล็อก:
     1) WSL ไม่มี = ต้องบอกคำสั่งแก้ที่กดได้จริง
     2) Virtualization ปิด = ต้องบอก
     3) ต้องดึงบรรทัด error จาก log ของตัวติดตั้ง Docker
     4) wsl --status ตอบเป็น UTF-16 (มี null byte) = ต้องอ่านให้ได้ ไม่ใช่เทียบแบบตรงๆ
     5) runSetup ต้องเรียกมันตอนติดตั้งไม่สำเร็จ
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnoseDockerInstall } from '../setup-node.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/** exec จำลอง: wsl/virtualization ตอบตามที่ตั้ง */
function fakeExec({ wslOk = true, virtOn = true } = {}) {
  return async (cmd, args = []) => {
    const line = [cmd, ...args].join(' ');
    // ⚠ โค้ดจริงห่อ wsl --status ด้วย PowerShell (บังคับ UTF-8) — ตัวจำลองจึงต้องดู
    //   "ข้อความคำสั่ง" ไม่ใช่ชื่อโปรแกรม ไม่งั้นจะตอบผิดและกลบว่า WSL ขาดจริง
    if (/\bwsl\b/.test(line)) {
      // จริงๆ แล้ว wsl --status ตอบเป็น UTF-16LE (มี \0 คั่นทุกตัวอักษร)
      //   ถ้าไม่ล้าง \0 ตอนเทียบ จะไม่มีวันเจอว่า virtualization เปิดหรือไม่
      return {
        code: wslOk ? 0 : 1,
        stdout: wslOk ? 'D\u0000e@f\u0000a\u0000u@l\u0000t\u0000 \u0000V\u0000e@Configuration' : '',
        stderr: wslOk ? '' : 'The system cannot find the WSL command.',
      };
    }
    if (/VirtualizationFirmwareEnabled/i.test(line)) {
      return { code: 0, stdout: virtOn ? 'True\r\n' : 'False\r\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

describe('diagnoseDockerInstall', () => {
  test('WSL2 ไม่มี = บอกคำสั่งแก้ที่กดได้จริง', async () => {
    const lines = await diagnoseDockerInstall({ exec: fakeExec({ wslOk: false }) });
    const text = lines.join('\n');
    assert.match(text, /WSL2/, 'ต้องบอกว่าเกี่ยวกับ WSL2');
    assert.match(text, /wsl --install/, 'ต้องให้คำสั่งที่แก้ได้ ไม่ใช่แค่บอกว่าล้ม');
    assert.match(text, /รีสตาร์ท|restart/i, 'WSL ต้องรีสตาร์ท — ต้องบอก');
  });

  test('ทุกอย่างปกติ = บอกว่าปกติ (ไม่ปล่อยให้คนหาสาเหตุเอง)', async () => {
    const lines = await diagnoseDockerInstall({ exec: fakeExec() });
    const text = lines.join('\n');
    assert.match(text, /WSL2: พร้อม/);
    assert.match(text, /Virtualization: เปิดแล้ว/);
  });

  test('Virtualization ปิด = ต้องบอกให้เปิดใน BIOS', async () => {
    const lines = await diagnoseDockerInstall({ exec: fakeExec({ virtOn: false }) });
    assert.match(lines.join('\n'), /Virtualization ปิด/, 'ต้องบอกว่า virtualization ปิด');
  });

  test('wsl --status เป็น UTF-16 (มี null byte) = ยังวิเคราะห์ virtualization ได้', async () => {
    // ถ้าวิเคราะห์จาก stdout ของ wsl โดยไม่ล้าง \0 จะไม่มีวันเจอ
    const lines = await diagnoseDockerInstall({ exec: fakeExec({ virtOn: true }) });
    assert.match(lines.join('\n'), /Virtualization: เปิดแล้ว/);
  });

  test('ดึงบรรทัด error จาก installer.error.json ก่อน (ที่ Docker เขียนไว้ตอนล้ม)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dkerr-'));
    const dir = path.join(tmp, 'Docker');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'installer.error.json'), '{ "error": "WSL 2 not installed", "code": 1 }');
    const prev = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = tmp;
    try {
      const text = (await diagnoseDockerInstall({ exec: fakeExec() })).join('\n');
      assert.match(text, /Docker installer error:/);
      assert.match(text, /WSL 2 not installed/);
    } finally {
      if (prev === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

test('ดึงบรรทัด error จาก install-log.txt (รอบที่ยังไม่มีไฟล์ json)', async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dklog-'));
    const dir = path.join(tmp, 'Docker');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'install-log.txt'),
      'CommandLine: "C:\\Temp\\Docker Desktop Installer.exe" install --errfile=C:\\Temp\\x.json\n'
      + 'step 1 ok\nError: WSL 2 installation is incomplete\nFailed with code 0x80370102\n',
    );
    const prev = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = tmp;
    try {
      const text = (await diagnoseDockerInstall({ exec: fakeExec({ wslOk: false }) })).join('\n');
      assert.match(text, /Docker install log:/);
      assert.match(text, /0x80370102|WSL 2 installation is incomplete/);
      // บรรทัด CommandLine ต้องถูกตัดทิ้ง — เป็นแค่พาธ ไม่ใช่คำตอบ
      assert.ok(!/CommandLine/.test(text), 'ไม่ควรรายงานบรรทัดคำสั่ง มันไม่ใช่สาเหตุ');
    } finally {
      if (prev === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
      void t;
    }
  });

  test('installer.error.json ว่างเปล่า = ไม่รายงาน (ติดตั้งสำเร็จไฟล์นี้ก็ว่าง)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dkempty-'));
    const dir = path.join(tmp, 'Docker');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'installer.error.json'), '  \n');
    const prev = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = tmp;
    try {
      const text = (await diagnoseDockerInstall({ exec: fakeExec() })).join('\n');
      assert.ok(!/Docker installer error:/.test(text), 'ไฟล์ว่าง = ไม่มีความหมาย อย่ารายงาน');
    } finally {
      if (prev === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('ไม่มี log = ไม่ล้ม และไม่ทำให้ขั้นตอนอื่นพัง', async () => {
    const prev = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = path.join(os.tmpdir(), 'definitely-not-here-xyz');
    try {
      const lines = await diagnoseDockerInstall({ exec: fakeExec() });
      assert.ok(Array.isArray(lines) && lines.length > 0);
      assert.ok(!lines.some((l) => /install log:|installer error:/.test(l)), 'ไม่ควรแตะ log ที่ไม่มี');
    } finally {
      if (prev === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = prev;
    }
  });

  test('runSetup ต้องเรียกวินิจฉัยตอนติดตั้ง docker ไม่สำเร็จ', () => {
    const src = fs.readFileSync(path.join(REPO, 'tools', 'setup-node.mjs'), 'utf8');
    const at = src.indexOf('await installTool(t, exec)');
    assert.ok(at > 0);
    const after = src.slice(at, at + 900);
    assert.match(after, /!r\.ok && t\.id === 'docker'/, 'ต้องวินิจฉัยเฉพาะตอนล้ม');
    assert.match(after, /diagnoseDockerInstall/);
  });
});