#!/usr/bin/env node
/* ── ตัด WAL เก่า: ลบผิดไฟล์ = พังนอกจากพื้นที่ดิสก์ ──────────────────────────
   ปัญหาจริง 11/10/69: wal-archive โต 3.04 GB/วัน ไม่มีอะไรมาลบ → ดิสก์เต็มใน ~6 วัน
     และถ้าดิสก์เต็ม archive_command จะล้ม → Postgres อาจหยุดเขียน

   เทสต์นี้ล็อก "กันพลาด" 3 ชั้นที่ตัวลบมี:
     1) ลบเฉพาะชื่อที่หน้าตาเป็น segment (^[0-9A-F]{24}$) — .backup/อื่น ไม่แตะ
     2) เก่ากว่า N วันเท่านั้น — ไฟล์ใหม่ (กำลังถูกเขียน) ต้องอยู่
     3) --dry-run ต้องไม่ลบอะไรเลย และฟอลเดอร์ที่ไม่มีอยู่ต้องไม่ crash
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRUNE = path.join(ROOT, 'tools', 'prune-wal.mjs');

const day = 86400_000;
const seg = (hex) => `${hex}`.toUpperCase().padStart(24, '0');

/** สร้าง wal-archive ปลอม: เก่า/ใหม่/ของแปลกปลอม คืนพาธ + รายการคาดหวัง */
function makeArchive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-archive-'));
  const old1 = seg('000000010000000000000030');
  const old2 = seg('000000010000000000000031');
  const fresh = seg('000000010000000000000032');
  const backup = `${old1}.backup`;   // ไฟล์ประวัติ — ห้ามแตะ
  const readme = 'README.txt';        // ไม่ใช่ WAL เลย — ห้ามแตะ
  const now = Date.now();
  for (const [name, age] of [[old1, 30 * day], [old2, 31 * day], [fresh, 1 * day], [backup, 30 * day], [readme, 30 * day]]) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x'.repeat(1024));
    const t = new Date(now - age);
    fs.utimesSync(p, t, t);
  }
  return { dir, old1, old2, fresh, backup, readme, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function run(args) {
  return spawnSync(process.execPath, [PRUNE, ...args], { encoding: 'utf8' });
}

// ระวัง regex: เวลาในบรรทัดมี colon ("19:52") ห้ามใช้ [^:]* จะหยุดผิดจุด
const countToDelete = (out) => Number(out.match(/จะลบ.*?(\d+) ไฟล์/)?.[1] ?? -1);

describe('ตัด WAL เก่า — กันพลาด', () => {
  test('ลบเฉพาะ segment ที่เก่ากว่า N วัน และไม่แตะไฟล์อื่น', () => {
    const a = makeArchive();
    try {
      const r = run([`--dir=${a.dir}`, '--days=7']);
      assert.equal(r.status, 0, `ต้องผ่าน แต่ล้ม:\n${r.stderr}`);
      const left = fs.readdirSync(a.dir);
      assert.ok(!left.includes(a.old1), 'segment เก่าต้องถูกลบ');
      assert.ok(!left.includes(a.old2), 'segment เก่าต้องถูกลบ');
      assert.ok(left.includes(a.fresh), 'segment ใหม่ห้ามโดน — อาจเป็นตัวที่กำลังถูกเขียน');
      assert.ok(left.includes(a.backup), 'ไฟล์ .backup ห้ามโดน');
      assert.ok(left.includes(a.readme), 'ไฟล์อื่นที่ไม่ใช่ segment ห้ามโดน');
    } finally {
      a.cleanup();
    }
  });

  test('--dry-run ไม่ลบอะไรเลย แต่ยังบอกได้ว่าจะลบอะไร', () => {
    const a = makeArchive();
    try {
      const r = run([`--dir=${a.dir}`, '--days=7', '--dry-run']);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /--dry-run/, 'ต้องบอกว่าเป็นรูปแบบ dry-run');
      const left = fs.readdirSync(a.dir);
      assert.equal(left.length, 5, `dry-run ต้องไม่ลบเลย แต่เหลือ ${left.length} จาก 5`);
      assert.match(r.stdout, /จะลบ/, 'ต้องรายงานว่าจะลบอะไรไว้ตรวจสอบ');
    } finally {
      a.cleanup();
    }
  });

  test('โฟลเดอร์ไม่มีอยู่ = ข้ามแบบเงียบ ไม่ crash (task รันกลางคืนต้องไม่พัง)', () => {
    const missing = path.join(os.tmpdir(), `wal-does-not-exist-${Date.now()}`);
    const r = run([`--dir=${missing}`, '--days=7']);
    assert.equal(r.status, 0, 'ต้องจบด้วย exit 0 ไม่ใช่ error');
    assert.match(r.stdout, /ไม่พบโฟลเดอร์/, 'ต้องบอกว่าข้ามเพราะไม่พบ');
  });

  test('เก็บย้อนหลังมากขึ้น = ลบน้อยลง (N วันต้องมีผลจริง)', () => {
    const a = makeArchive();
    try {
      const wide = run([`--dir=${a.dir}`, '--days=7', '--dry-run']);
      const narrow = run([`--dir=${a.dir}`, '--days=1', '--dry-run']);
      const wideN = countToDelete(wide.stdout);
      const narrowN = countToDelete(narrow.stdout);
      assert.equal(wideN, 2, 'เก็บ 7 วัน = ลบไฟล์เก่า 30 วัน 2 ไฟล์');
      assert.ok(narrowN >= wideN, 'เก็บน้อยลง (1 วัน) ต้องลบมากกว่าเท่า');
    } finally {
      a.cleanup();
    }
  });
});

describe('ตัวตัด WAL ถูกผูกกับงานอัตโนมัติ', () => {
  test('มีตัวสคริปต์อยู่ใน git (clone ใหม่ต้องตัดได้ด้วย)', () => {
    const tracked = spawnSync('git', ['ls-files', 'tools/'], { cwd: ROOT, encoding: 'utf8' });
    assert.ok(tracked.status === 0, 'git ต้องตอบได้');
    assert.match(
      tracked.stdout,
      /tools\/prune-wal\.mjs/,
      'tools/prune-wal.mjs ยังไม่ถูก git track — .gitignore มี tools/* อย่าลืมเพิ่ม !tools/prune-wal.mjs',
    );
  });

  test('มีตัวห่อสำหรับ scheduled task', () => {
    const p = path.join(ROOT, 'tools', 'hidden-tasks', 'sovereign-prune-wal.cmd');
    assert.ok(fs.existsSync(p), 'ต้องมี tools/hidden-tasks/sovereign-prune-wal.cmd ให้ task เรียก');
  });

  // เคสจริง 11/10/69: ไฟล์ .cmd เป็น LF ล้วน + .ps1 ไม่มี UTF-8 BOM
  //   → cmd.exe อ่านไม่ออก / PowerShell 5.1 อ่านไทยเป็น ANSI แล้ว parse error
  //   → task รันแล้วไม่มี log แต่ดูเหมือน "รันสำเร็จ" (exit 0) = อันตรายกว่าพัง
  test('.cmd ต้องเป็น CRLF ทั้งไฟล์ (cmd.exe อ่าน LF เพี้ยน)', () => {
    const p = path.join(ROOT, 'tools', 'hidden-tasks', 'sovereign-prune-wal.cmd');
    const buf = fs.readFileSync(p);
    const lfOnly = (buf.toString('utf8').match(/(?<!\r)\n/g) || []).length;
    assert.equal(lfOnly, 0, `พบ LF เดี่ยว ${lfOnly} จุด — cmd.exe จะรันไฟล์นี้ไม่ถูกต้อง`);
  });

  test('.ps1 ต้องมี UTF-8 BOM (ไม่งั้นข้อความไทยกลายเป็นมะกรุกจน parse error)', () => {
    const p = path.join(ROOT, 'tools', 'prune-wal.ps1');
    const b = fs.readFileSync(p);
    assert.ok(
      b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf,
      'tools/prune-wal.ps1 ต้องมี UTF-8 BOM — Windows PowerShell 5.1 อ่านไฟล์ไม่มี BOM เป็น ANSI',
    );
  });

  test('.ps1 ต้องบังคับ UTF-8 ก่อนเรียก node (ไม่งั้น stdout ไทยเป็นมะกรุกใน log)', () => {
    const p = path.join(ROOT, 'tools', 'prune-wal.ps1');
    const src = fs.readFileSync(p, 'utf8');
    assert.match(
      src,
      /OutputEncoding\s*=\s*\[System\.Text\.Encoding\]::UTF8/,
      'ต้องตั้ง [Console]::OutputEncoding = UTF8 ก่อนเรียก node — ไม่งั้นข้อความไทยใน log อ่านไม่ออก',
    );
  });

  test('task ถูกตั้งไว้จริงบนเครื่อง (ข้อความใน log ต้องอ่านออก)', () => {
    const ps1 = fs.readFileSync(path.join(ROOT, 'tools', 'prune-wal.ps1'), 'utf8');
    assert.match(ps1, /logs.*prune-wal\.log|Out-File/, 'ต้องเขียน log ไว้ตรวจย้อนหลังได้');
  });
});