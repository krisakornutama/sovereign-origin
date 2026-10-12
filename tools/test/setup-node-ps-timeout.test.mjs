#!/usr/bin/env node
/* ── PowerShell encoding + timeout: บั๊กที่ทำให้ทั้งตัวติดตั้งพังเงียบๆ ─────────
   ทั้งสองเรื่องเจอจากการรันจริงบนเครื่องเป้าหมาย ไม่ใช่จากการอ่านโค้ด

   PowerShell:
     1. `wsl --status` ตอบเป็น UTF-16LE (null byte คั่นทุกตัวอักษร)
        อ่านเป็น UTF-8 ได้ "D e f a u l t" → เทียบคำไม่มีวันตรง → วินิจฉัยผิดเงียบๆ
     2. PowerShell ที่ถูก spawn โดยไม่มี console เขียนอักษรไทยออกมาเป็น "?"
        ⇒ ต้องบังคับ UTF-8 ที่ต้นทาง ไม่ใช่ฝั่งผู้เรียก
     3. บรรทัด PS ที่เราสั่งต้องมี OutputEncoding เสมอ

   Timeout / การค้าง:
     4. รอเฉพาะ 'close' = รอ stdio ปิดด้วย ถ้าลูกหลาน (docker compose) ถือ stdio
        ⇒ 'close' ไม่มีวันมา ⇒ ทั้งตัวติดตั้งค้าง ไม่มีข้อความ ไม่มี exit code
     5. spawn มี timeout ของมันเอง แต่ฆ่าแล้วไม่รับประกันว่าตาย ⇒ ต้องมี grace period
     6. หมดเวลาแล้วต้องบอกว่าหมดเวลา ไม่ใช่รายงานเหมือนล้มธรรมดา
     7. start-sovereign.bat เดิมตั้ง 15 นาที ทั้งที่ดึง Docker หลาย GB = ฆ่าทิ้งงานที่กำลังเดิน
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExec, decodeOutput, runBatch, PS_UTF8_PREFIX } from '../setup-node.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/** เขียนไฟล์ .cmd จำลองที่ผูก stdout ค้างไว้ (จำลองลูกหลานที่ยังไม่ปิด) */
function writeFakeBat(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.from(body, 'ascii'));
  return p;
}

describe('decodeOutput — encoding ของ PowerShell/WSL บน Windows', () => {
  test('UTF-16LE พร้อม BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Default Version: 2', 'utf16le')]);
    assert.equal(decodeOutput(buf), 'Default Version: 2');
  });

  test('UTF-16LE ไม่มี BOM (กรณีของ wsl --status จริง)', () => {
    const s = 'Default Version: 2';
    const buf = Buffer.from(s, 'utf16le'); // มี \0 คั่นทุกตัวอักษร
    assert.ok(buf.includes(0), 'ตัวอย่างต้องมี null byte จริง');
    assert.equal(decodeOutput(buf), s);
  });

  test('UTF-16LE สั้นมาก (ต้องไม่สับสนกับ UTF-8)', () => {
    assert.equal(decodeOutput(Buffer.from('OK', 'utf16le')), 'OK');
  });

  test('UTF-8 ปกติ = ไม่ถูกแตะ', () => {
    assert.equal(decodeOutput(Buffer.from('hello world', 'utf8')), 'hello world');
  });

  test('ว่าง = ว่าง ไม่ล้ม', () => {
    assert.equal(decodeOutput(Buffer.alloc(0)), '');
    assert.equal(decodeOutput(null), '');
  });

  test('ไทย UTF-8 = อ่านออก', () => {
    assert.equal(decodeOutput(Buffer.from('พื้นที่ว่าง', 'utf8')), 'พื้นที่ว่าง');
  });
});

describe('ทุกคำสั่ง PowerShell ต้องบังคับ UTF-8 ที่ต้นทาง', () => {
  const src = fs.readFileSync(path.join(REPO, 'tools', 'setup-node.mjs'), 'utf8');

  test('wsl --status ต้องวิ่งผ่าน PowerShell + OutputEncoding', () => {
    assert.ok(src.includes('PS_UTF8_PREFIX'), 'ต้องมีตัวแปร PS_UTF8_PREFIX');
    // ต้องดูบรรทัด "โค้ดจริง" ไม่ใช่คำอธิบายในคอมเมนต์
    //   (indexOf แรกไปโดนคำอธิบาย UTF-16LE ที่พูดถึง wsl --status เสมอ)
    const codeLine = src.split('\n').find((l) => /\$\{PS_UTF8_PREFIX\}wsl/.test(l));
    assert.ok(codeLine, 'ต้องเรียก wsl ผ่าน PS_UTF8_PREFIX ในโค้ดจริง');
    const at = src.indexOf(codeLine);
    const window = src.slice(Math.max(0, at - 400), at);
    assert.match(window, /'powershell\.exe'/, 'wsl ต้องถูกห่อด้วย powershell.exe');
  });

  test('PS_UTF8_PREFIX ต้องตั้ง OutputEncoding จริง', () => {
    assert.match(PS_UTF8_PREFIX, /\[Console\]::OutputEncoding=\[Text\.Encoding\]::UTF8/);
  });

  test('ห้ามเรียก wsl ตรงโดยไม่ห่อ (จะได้ UTF-16 แล้ววิเคราะห์ผิด)', () => {
    assert.ok(
      !/'wsl',\s*\['--status'\]/.test(src),
      'เรียก wsl ตรง = ได้ UTF-16LE ที่อ่านยาก',
    );
  });
});

describe('timeout และการค้าง', () => {
  test('หมดเวลา = คืนค่า + บอกว่าหมดเวลา ไม่ใช่ล้มเงียบๆ', async () => {
    const r = await defaultExec('powershell.exe', [
      '-NoProfile', '-Command', 'Start-Sleep -Seconds 30',
    ], { timeout: 800, onOutput: null });
    assert.equal(r.timedOut, true, 'ต้องบอกว่าหมดเวลา');
    assert.match(r.stderr, /หมดเวลา/, 'ต้องเขียนบอกใน stderr');
    assert.equal(r.code, 124, 'ใช้รหัส 124 ตามมาตรฐาน timeout');
  });

  test('ไม่หมดเวลา = timedOut false', async () => {
    const r = await defaultExec('cmd.exe', ['/c', 'echo ok'], { timeout: 30_000, onOutput: null });
    assert.equal(r.timedOut, false);
    assert.equal(r.code, 0);
  });

  test('process ที่ปล่อยลูกหลานค้าง stdio = ต้องจบทันทีที่พ่อออก ไม่รอลูกหลาน', async () => {
    const dir = fs.mkdtempSync(path.join(REPO, '.freebuff', 'hang-'));
    try {
      // start /b = พ่อออกทันที แต่ลูกหลานยังถือ handle ของ stdout
      //   ⇒ 'close' จะไม่มีวันมา ถ้าโค้ดรอ 'close' ตัวติดตั้งจะค้างตลอดการติดตั้ง
      //   (เคสจริง: docker compose ทำแบบนี้ตอน pull image)
      const bat = writeFakeBat(dir, 'hang.cmd', '@echo off\r\nstart /b cmd /c "ping -n 30 127.0.0.1 >nul"\r\necho started\r\n');
      const t0 = Date.now();
      const r = await defaultExec('cmd.exe', ['/c', bat], { timeout: 30_000, onOutput: null });
      const secs = (Date.now() - t0) / 1000;
      assert.ok(secs < 10, `ต้องจบทันทีที่พ่อออก ไม่ใช่รอ stdio ปิด (ใช้ ${secs.toFixed(1)} วิ)`);
      assert.match(r.stdout, /started/);
      assert.equal(r.timedOut, false, 'งานจริงจบแล้ว ไม่ใช่หมดเวลา');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('ไม่มี timeout = ต้องไม่ตั้งนาฬิกาฆ่า (งานยาวต้องได้ทำจนจบ)', async () => {
    const r = await defaultExec('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500'], {
      onOutput: null,
    });
    assert.equal(r.code, 0, 'ถ้ามี timeout แฝง งานจะถูกหยุดกลางคัน');
    assert.equal(r.timedOut, false);
  });
});

describe('runBatch ต้องให้เวลายาวพอสำหรับการดึง Docker', () => {
  test('ค่าเริ่มต้นต้องไม่ใช่ 15 นาที (ดึง Docker หลาย GB ไม่ทัน)', () => {
    const src = fs.readFileSync(path.join(REPO, 'tools', 'setup-node.mjs'), 'utf8');
    const m = /runAsync|export async function runBatch\([^)]*timeoutMs\s*=\s*([^)]*)\)/.exec(src);
    assert.ok(m, 'ต้องมีพารามิเตอร์เวลาที่ตั้งได้');
    assert.match(m[1], /60\s*\*\s*60\s*\*\s*1000/, 'ค่าเริ่มต้นควรเป็น 60 นาที');
  });

  test('บอกได้ว่าหมดเวลา ไม่ใช่ exit นิรนัย', async () => {
    const dir = fs.mkdtempSync(path.join(REPO, '.freebuff', 'bat-'));
    try {
      const bat = writeFakeBat(dir, 'slow.cmd', '@echo off\r\nping -n 30 127.0.0.1 >nul\r\n');
      const r = await runBatch(bat, defaultExec, 2000);
      assert.equal(r.ok, false);
      assert.match(r.reason, /หมดเวลา/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});