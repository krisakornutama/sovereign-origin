#!/usr/bin/env node
/* ── คำสั่งที่ยาวต้อง "หายใจ" ออกทางจอขณะรัน ───────────────────────────────
   เคสจริง 12/10/69: คนใช้เห็นบรรทัดเดียวแล้วหน้าต่างเงียบ 40 นาที
     (npm ci 5 นาที · next build 3 นาที · docker pull ~5.2 GB)
     เข้าใจว่าค้าง → กดปิด → เสียเวลาทั้งวัน
   เดิมใช้ execFile → stdout ถูกผูกเป็น pipe แล้วทิ้งทิ้งทั้งหมด

   เทสต์นี้ล็อก:
     1) onOutput ต้องถูกเรียก "ขณะรัน" ไม่ใช่หลังเสร็จ
     2) คืนค่าเดิม {code, stdout, stderr} — เทสต์เดิมต้องไม่พัง
     3) บัฟเฟอร์ต้องไม่บวม (docker pull ผลิต log หลักพันบรรทัด)
     4) คำสั่งที่ไม่มีจริง = คืนค่า ไม่ค้าง
     5) checkTools ต้องไม่โชว์ผลลัพธ์ (docker info ยาวเป็นสิบบรรทัด)
     6) สคริปต์ตัวติดตั้งต้องวัดพื้นที่ของดิสก์ที่จะติดตั้งจริง ไม่ใช่ %TEMP%
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExec, checkTools } from '../setup-node.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/**
 * คำสั่งที่พิมพ์ทีละนิด แล้วหน่วง 300 มิลลิวินาที
 *
 * ⚠ ใช้ข้อความ ASCII เท่านั้น
 *   PowerShell ที่ถูก spawn โดยไม่มี console จะเขียนอักขระไทยออกมาเป็น "?"
 *   ทำให้เทสต์พังเพราะเรื่อง encoding ไม่ใช่เพราะโค้ดผิด (เจอตอนรันครั้งแรก)
 */
const SLOW = [
  '-NoProfile', '-Command',
  '1..4 | ForEach-Object { Write-Host "line $_"; Start-Sleep -Milliseconds 300 }',
];

describe('defaultExec — สตรีมผลลัพธ์ขณะรัน', () => {
  test('onOutput ถูกเรียกก่อนคำสั่งจบ (ไม่ใช่รอจนเสร็จค่อยส่ง)', async () => {
    const chunks = [];
    let finished = false;
    const p = defaultExec('powershell.exe', SLOW, {
      onOutput: (s) => { chunks.push(s); assert.equal(finished, false, 'ส่งผลลัพธ์หลังจบไปแล้ว'); },
    }).then((r) => { finished = true; return r; });
    const res = await p;
    assert.ok(chunks.length > 1, `ควรได้หลายชิ้นสด ๆ แต่ได้ ${chunks.length}`);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /line 4/);
  });

  test('คืนค่า shape เดิม {code, stdout, stderr} — เทสต์เดิมต้องไม่พัง', async () => {
    const r = await defaultExec('cmd.exe', ['/c', 'echo hello'], { onOutput: null });
    // เพิ่ม timedOut ตั้งแต่แก้เรื่อง timeout — ของเดิมต้องยังอยู่ครบ
    //   (โค้ดเดิมไม่บอกว่าหมดเวลาหรือล้ม ผู้เรียกตัดสินใจผิด)
    assert.deepEqual(Object.keys(r).sort(), ['code', 'stderr', 'stdout', 'timedOut']);
    for (const k of ['code', 'stdout', 'stderr']) {
      assert.ok(k in r, `ของเดิม ${k} ต้องยังอยู่`);
    }
    assert.equal(r.code, 0);
    assert.equal(r.timedOut, false);
    assert.match(r.stdout, /hello/);
  });

  test('คำสั่งล้ม = code ไม่ใช่ 0 (ไม่โยน error)', async () => {
    const r = await defaultExec('cmd.exe', ['/c', 'exit 7'], { onOutput: null });
    assert.equal(r.code, 7);
  });

  test('คำสั่งที่ไม่มีอยู่ = คืนค่า ไม่ค้าง (เคยเป็นจุดที่คนกดปิดจอ)', async () => {
    const r = await defaultExec('definitely-not-a-real-binary-xyz', [], { onOutput: null });
    assert.equal(r.code, 1);
    assert.ok(r.stderr.length > 0, 'ต้องบอกเหตุผล ไม่ใช่คืนค่าเงียบๆ');
  });

  test('stderr ถูกจับไว้เหมือนเดิม', async () => {
    const r = await defaultExec('cmd.exe', ['/c', 'echo oops 1>&2'], { onOutput: null });
    assert.match(r.stderr, /oops/);
  });
});

describe('บัฟเฟอร์ไม่บวม', () => {
  test('ผลลัพธ์ยาวมาก = เก็บไว้แค่ท้าย 64 KB ไม่ใช่ทั้งหมด', async () => {
    const r = await defaultExec('powershell.exe', [
      '-NoProfile', '-Command',
      '1..5000 | ForEach-Object { Write-Host ("long-line-" + $_ + "--------------------------------") }',
    ], { onOutput: null });
    assert.ok(r.stdout.length <= 64 * 1024 + 4096, `บัฟเฟอร์ใหญ่เกิน: ${r.stdout.length}`);
    assert.ok(r.stdout.length > 0, 'ต้องยังได้ข้อความ ไม่ใช่เปล่า');
    // ต้องเป็น "ท้ายสุด" คือบรรทัดท้ายของจริงยังอยู่
    assert.match(r.stdout, /4999/);
  });
});

describe('checkTools ต้องเงียบ', () => {
  test('ไม่ส่งผลลัพธ์ probe ออกทางจอ (docker info ยาวเป็นสิบบรรทัด)', async () => {
    const seen = [];
    const tools = await checkTools(
      [{ id: 'echo', label: 'echo', probe: 'cmd.exe /c echo ready' }],
      // ครอบ exec แล้วฟัง onOutput — แต่ถ้าโค้ดสั่งปิด (null) ต้องเคารพ ไม่งั้นเทสต์นี้โกง
      (cmd, args, o) =>
        defaultExec(cmd, args, {
          ...o,
          onOutput: o?.onOutput === null ? null : (s) => seen.push(s),
        }),
    );
    assert.equal(tools[0].ok, true);
    assert.deepEqual(seen, [], `ไม่ควรมีอะไรหลุดออกมา: ${seen.join('|')}`);
  });
});

describe('สคริปต์ตัวติดตั้งต้องวัดดิสก์ที่จะติดตั้งจริง', () => {
  const script = fs.readFileSync(path.join(REPO, 'tools', 'node-installer.ps1'), 'utf8');

  test('ห้ามวัดพื้นที่จาก $PSScriptRoot (มันคือ %TEMP% = ดิสก์ C: เสมอ)', () => {
    // เคสจริง 12/10/69: เจ้าของวางไฟล์ไว้บน E: แต่โค้ดวัด C: → บอกว่าว่าง 3.5 GB แล้วหยุด
    assert.ok(
      !/GetPathRoot\(\$PSScriptRoot\)/.test(script),
      'ห้ามวัดดิสก์จาก $PSScriptRoot — ต้องวัดจาก $Dest',
    );
    assert.match(script, /GetPathRoot\(\$Dest\)/, 'ต้องวัดดิสก์ของ $Dest');
  });

  test('ต้องหาปลายทางก่อนตรวจพื้นที่', () => {
    const destAt = script.search(/\$Dest\s*=\s*Join-Path \$installerDir/);
    const checkAt = script.search(/Get-FreeGb \(\$root/);
    assert.ok(destAt > 0 && checkAt > 0, 'ต้องมีทั้งสองจุด');
    assert.ok(destAt < checkAt, 'ต้องหา $Dest ก่อนตรวจพื้นที่');
  });

  test('พื้นที่ไม่พอต้องบอกดิสก์อื่นที่ว่างพอ (ไม่ใช่ปล่อยให้เดาว่าจะย้ายไหน)', () => {
    assert.match(script, /Get-PSDrive -PSProvider FileSystem/);
    assert.match(script, /ดิสก์อื่นบนเครื่องนี้/);
  });
});