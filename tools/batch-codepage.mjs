// tools/batch-codepage.mjs — กติกา "chcp ก่อนข้อความไทย" ของไฟล์ .cmd/.bat
//
// เหตุผล (ของจริง 10/10/69): cmd.exe อ่านไฟล์ batch ทีละบรรทัดด้วย codepage ของคอนโซล
// ตอนที่อ่านบรรทัดนั้น ⇒ ถ้าเจอข้อความไทย *ก่อน* บรรทัด `chcp 65001` ไบต์ไทยจะถูกตีความ
// ด้วย codepage เดิม (437/874) แล้ว cmd อาจกินตัวแบ่งบรรทัด/เครื่องหมายคำพูดจนเศษข้อความไทย
// กลายเป็นคำสั่ง:
//     'ง)' is not recognized as an internal or external command
//     '...โฟลเดอร์โปรเจ็กไม่ได้' is not recognized as an internal or external command
// ผลคือไฟล์ทำอะไรไม่สำเร็จเลยตั้งแต่บรรทัดแรก (เจอกับ tools\install\install.cmd และ
// SETUP-MACHINE.cmd ของชุดติดตั้งเครื่องลูก)
//
// กติกาที่ล็อกด้วยเทสต์: ไบต์แรกที่ไม่ใช่ ASCII ต้องอยู่ "หลัง" แถวที่สั่ง chcp 65001 เสมอ
// ตัวแก้: node tools/fix-batch-codepage.mjs --apply
import fs from 'node:fs';
import path from 'node:path';

/** โฟลเดอร์ที่ไม่ต้องสแกน (ของสร้าง/ของหนัก/โค้ดคนอื่น — ไม่ใช่สคริปต์ที่เราเขียน) */
export const SKIP_DIRS = new Set([
  '.git', '.freebuff', '.next', '.opencode', '.github', '.vscode', '.playwright-browsers',
  'node_modules', 'dist', 'build', 'coverage', 'backups', 'logs',
  'Docker', 'Ollama',
  // vendored / ของที่โหลดมาใช้ (สคริปต์ของเจ้าของเดิม ไม่ใช่ของโปรเจ็ก)
  'whisper.cpp', 'piper', 'E-Tipitaka', 'esp8266_multi_sensor',
  // PortableGit ที่แตกไว้ใน tools\Git (รวมสำเนาที่กันไว้ชื่อ Git.broken-*)
  'Git',
]);

/** ข้ามโฟลเดอร์ที่ตั้งชื่อตามนี้ด้วย (เช่นสำเนา Git.broken-20261010-120000) */
export const SKIP_PREFIXES = ['Git.broken-'];

const isBatch = (name) => /\.(cmd|bat)$/i.test(name);

/** ไล่หาไฟล์ .cmd/.bat ทั้งหมดใต้ root (ไม่ตาม symlink, ข้าม SKIP_DIRS) */
export function findBatchFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const skipped = SKIP_DIRS.has(e.name) || SKIP_PREFIXES.some((p) => e.name.startsWith(p));
        if (!skipped) walk(full);
        continue;
      }
      if (e.isFile() && isBatch(e.name)) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * ตรวจไฟล์เดียว — คืน { ok, hasNonAscii, ... }
 * ok = true หมายถึง "ไม่มีไบต์ที่ไม่ใช่ ASCII ก่อนบรรทัด chcp 65001" (ไฟล์ ASCII ล้วนก็ ok)
 */
export function inspectBatch(file) {
  const buf = fs.readFileSync(file);
  let firstNonAscii = -1;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] > 0x7f) { firstNonAscii = i; break; }
  }
  if (firstNonAscii === -1) return { file, hasNonAscii: false, ok: true, line: null };

  const head = buf.subarray(0, firstNonAscii).toString('utf8');
  const m = /chcp\s+65001/i.exec(head);
  const line = buf.subarray(0, firstNonAscii).toString('utf8').split(/\r?\n/).length;
  return { file, hasNonAscii: true, ok: Boolean(m), line, firstNonAscii };
}

const eolOf = (buf) => {
  const i = buf.indexOf(0x0a);
  return i > 0 && buf[i - 1] === 0x0d ? '\r\n' : '\n';
};

/**
 * วางแผนแก้ไฟล์ที่ยังผิดกติกา — คืน null ถ้าไม่ต้องแก้
 * ไม่แตะ EOL ของไฟล์: โหมด inline ต่อท้ายบรรทัดแรกด้วย `& chcp 65001 >nul`
 * ถ้าบรรทัดแรกไม่ใช่ `@echo off` จะแทรกบรรทัดใหม่หลังบรรทัดแรก (คง EOL เดิมของไฟล์)
 */
export function planFix(file) {
  const res = inspectBatch(file);
  if (res.ok) return null;

  const buf = fs.readFileSync(file);
  const eol = eolOf(buf);
  const nl = Buffer.from(eol);
  const firstBreak = buf.indexOf(nl);
  const head = firstBreak === -1 ? buf : buf.subarray(0, firstBreak);
  const rest = firstBreak === -1 ? Buffer.alloc(0) : buf.subarray(firstBreak);
  const firstLine = head.toString('utf8').replace(/^\uFEFF/, '').trim();
  const bare = firstLine.replace(/^@/, '').toLowerCase();

  if (bare === 'echo off') {
    const newFirst = Buffer.from(`${firstLine} & chcp 65001 >nul`);
    // chcp เดิมที่ยืนเป็นบรรทัดของตัวเอง (อยู่หลังบรรทัดแรก) ไม่ต้องมีซ้ำอีก
    const dup = Buffer.from(`${eol}chcp 65001 >nul${eol}`);
    let tail = rest;
    const at = tail.indexOf(dup);
    if (at !== -1) tail = Buffer.concat([tail.subarray(0, at + eol.length), tail.subarray(at + dup.length)]);
    return {
      file,
      mode: 'inline',
      detail: `${firstLine}  ->  ${firstLine} & chcp 65001 >nul`,
      apply: () => fs.writeFileSync(file, Buffer.concat([newFirst, tail])),
    };
  }

  return {
    file,
    mode: 'insert',
    detail: `insert "chcp 65001 >nul" as line 2 (first line: ${firstLine || '(empty)'})`,
    apply: () => fs.writeFileSync(file, Buffer.concat([head, nl, Buffer.from('chcp 65001 >nul'), rest])),
  };
}
