// ─────────────────────────────────────────────────────────────────────────────
// tools/test/bat-window-flash.test.mjs
// กติกา: สคริปต์ .cmd/.bat ของระบบ ห้าม "fork หน้าต่าง console" เด็ดขาด
//
// เคสจริง (13/10/69 — เจอด้วย process sampler จับ process ที่เด้งขึ้นจริง):
//   cmd.exe /d /c call "E:\...\start-sovereign.bat"          ← ตัวแม่ (ซ่อนอยู่แล้ว)
//     └─ cmd.exe /S /D /c " pause  1>nul 2>&1"                ← ลูก! ได้ console ใหม่ = หน้าต่างเด้ง
//          └─ conhost.exe 0x4                                 ← หน้าต่างที่เจ้าของเห็น
//
// ราก: `echo | pause` — pipe บังคับให้ cmd.exe fork ลูกเป็น process ใหม่เพื่อรัน
//  built-in ฝั่งขวา ลูกนั้นได้ console ของตัวเอง (แม้ตัวแม่ถูกซ่อนด้วย wscript/windowsHide)
// ทางแก้: ห้าม pipe built-in ที่ต้องรอผู้ใช้ · ใช้ `timeout /t N /nobreak >nul 2>&1` ซึ่ง
//   · ไม่ fork (ไม่มี pipe) → ไม่มีหน้าต่างใหม่
//   · stdin เป็น console (โหมดคนดู) → รอให้อ่านผล / กดคีย์ข้ามได้
//   · stdin ถูก redirect (โหมด headless: electron / scheduled task) → timeout จบทันที
//     = ไม่ค้าง ไม่เด้ง พร้อมกันทั้งสองทาง
//
// รัน: npm run test:tools
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function gitFiles(filter) {
  const out = execFileSync('git', ['ls-files', filter], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

const BAT_FILES = gitFiles('*.cmd').concat(gitFiles('*.bat'));

describe('กติกากันหน้าต่างเด้ง (13/10/69)', () => {
  test('มีไฟล์ .cmd/.bat ให้สแกนอยู่จริง (กัน false pass ตอน clone สด)', () => {
    assert.ok(BAT_FILES.length > 0, 'ไม่พบไฟล์ .cmd/.bat เลย — เทสต์นี้จะผ่านมั่ว');
  });

  test('ไม่มีไฟล์ไหนใช้ "echo | pause" (pipe ที่ fork console ใหม่)', () => {
    const bad = [];
    for (const rel of BAT_FILES) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      // ข้ามบรรทัดคอมเมนต์ (rem / ::) — คอมเมนต์ที่อธิบาย "ห้ามใช้ echo | pause" ไม่ใช่คำสั่ง
      const hit = text.split(/\r?\n/).filter((l) => !/^\s*(rem|::)/i.test(l) && /echo\s*\|\s*pause/i.test(l));
      if (hit.length) bad.push(`${rel} :: ${hit[0].trim()}`);
    }
    assert.deepEqual(bad, [], `เจอ echo | pause ที่ทำให้หน้าต่างเด้ง:\n  ${bad.join('\n  ')}`);
  });

  test('ไม่มี pipe ของ built-in ที่ต้องรอผู้ใช้ (… | pause แบบอื่น)', () => {
    const bad = [];
    for (const rel of BAT_FILES) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const hit = text.split(/\r?\n/).filter((l) => /\|\s*pause\b/i.test(l) && !/^\s*(rem|::)/i.test(l));
      if (hit.length) bad.push(`${rel} :: ${hit[0].trim()}`);
    }
    assert.deepEqual(bad, [], `เจอ pipe เข้า pause:\n  ${bad.join('\n  ')}`);
  });
});

describe('start-sovereign.bat (ตัวที่ถูกจับได้ว่าเด้งจริง)', () => {
  const REL = 'start-sovereign.bat';
  const text = fs.readFileSync(path.join(ROOT, REL), 'utf8');

  test('ไม่มี pause เปล่า (ค้างถาวรตอนรันแบบไม่มี stdin)', () => {
    const bare = text
      .split(/\r?\n/)
      .filter((l) => /^\s*pause\s*$/i.test(l));
    assert.deepEqual(bare, [], `เจอ pause เปล่าใน ${REL} — จะค้างรอคีย์ตอนรัน headless`);
  });

  test('มี :settle ที่ใช้ timeout และไม่มี pipe', () => {
    assert.match(text, /^:settle\s*$/m, 'ต้องมี subroutine :settle');
    const body = text.split(/\r?\n/).filter((l) => /timeout\s+\/t/i.test(l));
    assert.ok(body.length >= 1, 'ต้องมี timeout /t เป็นตัวหน่วงเวลา');
    assert.ok(
      body.every((l) => !/\s\|\s/.test(l)),
      'timeout ต้องไม่อยู่ใน pipe (pipe = fork console ใหม่)',
    );
    assert.match(text, /call :settle/, 'ทุกจุดที่เดิมรอผู้ใช้ต้องเรียก call :settle');
  });

  test('chcp 65001 ยังอยู่ก่อนข้อความไทย (กฎ AGENTS.md)', () => {
    const lines = text.split(/\r?\n/);
    const chcpAt = lines.findIndex((l) => /^\s*chcp\s+65001/i.test(l));
    const firstThai = lines.findIndex((l) => /[^\x00-\x7F]/.test(l));
    assert.ok(chcpAt >= 0, 'ไม่พบ chcp 65001');
    assert.ok(firstThai < 0 || chcpAt < firstThai, 'chcp 65001 ต้องมาก่อนข้อความไทยบรรทัดแรก');
  });

  test('ยังเป็น CRLF (LF ล้วนทำให้ cmd.exe อ่านเพี้ยน)', () => {
    const lone = text.split('\n').filter((line, i, all) => !(i === all.length - 1) && !line.endsWith('\r'));
    assert.deepEqual(lone, [], 'ต้องไม่มี LF เดี่ยว');
  });
});