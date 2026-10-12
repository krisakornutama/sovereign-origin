#!/usr/bin/env node
/* ── bash ที่ agent ใช้ ต้องมีเครื่องมือพื้นฐานของตัวเอง ไม่ใช่ bash เปล่า ──────
   เคสจริง 12/10/69 (เครื่องนี้): ตั้ง CODEBUFF_GIT_BASH_PATH ชี้ไป
     E:\My work\Project Sovereign Origin\tools\Git\bin\bash.exe
   ซึ่งเป็น Git ที่ถูกตัดเหลือ 12 ไฟล์ (bash.exe + msys DLL + tail.exe)
   ⇒ shell ของ agent ไม่มี sed/grep/ls/head/cat/wc/cut/tr/awk/find/env/xargs
   ⇒ ทุกคำสั่งที่ใช้เครื่องมือ POSIX ล้ม "command not found" แล้วต้องหันไปสั่งผ่าน
     PowerShell ซึ่งเริ่มช้า + spawn แบบไม่มี console (ไทยกลายเป็น "?") + หมดเวลา
     อาการที่เห็นจริงบนจอ = "PowerShell และ timeout ขึ้นตลอดเวลา"

   เทสต์นี้ล็อกกติกา: bash ที่ถูกชี้ให้ agent ใช้ ต้องพกเครื่องมือของตัวเองมาด้วย
   · ไม่ได้ตั้ง CODEBUFF_GIT_BASH_PATH = ข้าม (เครื่องอื่นไม่ต้องสนใจเทสต์นี้)
   · ตรวจด้วย PATH ที่เหลือแค่ /usr/bin:/bin ของ bash นั้น
     เพื่อไม่ให้เครื่องมือจากที่อื่นมาช่วยกลบความจริงว่า bash ตัวนี้ถูกตัดทิ้ง
*/
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** เครื่องมือที่สคริปต์/tools ของโปรเจ็กต์ใช้จริง — ขาดตัวเดียวคือใช้ไม่ได้ */
const COREUTILS = ['sed', 'grep', 'ls', 'head', 'cat', 'wc', 'cut', 'tr', 'awk', 'find', 'env', 'xargs'];

/** bash ที่ agent ถูกชี้ไปใช้ (ตัวเดียวที่เรารับผิดชอบ) */
function configuredBash() {
  const p = process.env.CODEBUFF_GIT_BASH_PATH;
  return p && fs.existsSync(p) ? p : null;
}

/** จำนวนไฟล์ใน <usr/bin ที่ใกล้ที่สุด> — bash เปล่าแบบเคสจริงมี 5 ไฟล์ */
function usrBinCount(bash) {
  let dir = path.dirname(bash);
  for (let i = 0; i < 4; i += 1) {
    try { return fs.readdirSync(path.join(dir, 'usr', 'bin')).length; } catch { /* ขึ้นชั้นบน */ }
    dir = path.dirname(dir);
  }
  return null;
}

/** coreutils ที่หาไม่เจอเมื่อเหลือ PATH แค่ของ bash ตัวเอง */
function missingOwnCoreutils(bash) {
  const script = `for b in ${COREUTILS.join(' ')}; do command -v "$b" >/dev/null 2>&1 || printf '%s ' "$b"; done`;
  const out = execFileSync(bash, ['-c', script], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true, env: { PATH: '/usr/bin:/bin' },
  });
  return out.trim().split(/\s+/).filter(Boolean);
}

describe('shell ของ agent ต้องใช้ได้จริง', () => {
  let bash = null;
  before(() => { bash = configuredBash(); });

  test('ไม่ได้ตั้ง CODEBUFF_GIT_BASH_PATH = ข้าม', (t) => {
    if (!bash) t.skip('เครื่องนี้ไม่ได้ชี้ bash ให้ agent — ไม่มีอะไรต้องตรวจ');
    else assert.ok(fs.existsSync(bash));
  });

  test('bash ที่ชี้ไว้ต้องพก coreutils ของตัวเองมาครบ', (t) => {
    if (!bash) { t.skip('ไม่ได้ตั้ง CODEBUFF_GIT_BASH_PATH'); return; }
    const missing = missingOwnCoreutils(bash);
    assert.deepEqual(
      missing,
      [],
      `bash ที่ตั้งไว้ไม่มีเครื่องมือของตัวเอง: ${missing.join(', ')} — `
      + 'นี่คือ bash เปล่า (Git ที่ถูกตัดไฟล์) ⇒ agent ต้องหันไปใช้ PowerShell แล้วหมดเวลา '
      + 'ทางแก้: ชี้ CODEBUFF_GIT_BASH_PATH ไป Git ตัวจริง (เช่น E:\\Tool\\Git\\bin\\bash.exe) '
      + 'หรือเติม usr/bin + mingw64/bin จาก Git ตัวจริงกลับเข้าโฟลเดอร์นั้น',
    );
  });

  test('usr/bin ของ bash นั้นต้องไม่ถูกตัดเหลือโครง', (t) => {
    if (!bash) { t.skip('ไม่ได้ตั้ง CODEBUFF_GIT_BASH_PATH'); return; }
    const n = usrBinCount(bash);
    if (n === null) return; // โครงสร้างไม่เหมือน Git for Windows — ไม่ตัดสินแทน
    assert.ok(
      n >= COREUTILS.length,
      `usr/bin ของ bash ที่ชี้ไว้มีแค่ ${n} ไฟล์ — เหมือน Git ที่ถูกตัดเหลือโครง `
      + '(เคสจริง 12/10/69 เหลือ 5 ไฟล์: bash.exe + msys DLL + tail.exe)',
    );
  });
});
