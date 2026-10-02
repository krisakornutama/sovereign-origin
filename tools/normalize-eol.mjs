#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// normalize-eol.mjs — ทำให้โฟลเดอร์ทำงานเป็น LF ทั้งหมด ตามกติกาใน .gitattributes
// ใช้: node tools/normalize-eol.mjs           (แก้ไฟล์ที่ยังมี CR)
//       node tools/normalize-eol.mjs --check   (รายงานอย่างเดียว · exit 1 ถ้ายังมี · ใช้ใน CI)
//
// ทำไมต้องมี (เคสจริง 2/10/69): `git ls-files --eol` รายงาน EOL จาก stat cache ไม่ใช่จากไฟล์จริง
// → ไฟล์ที่เคยถูกเขียนทับโดยเครื่องมือ (ไม่ใช่ git checkout) ยังเป็น CRLF แต่ git บอกว่า LF
//    และ git status สะอาดเสมอ (เพราะ clean filter แปลง CRLF→LF ก่อนเทียบ) = มองไม่เห็น
// ผลคือ build จาก commit เดียวกันได้ byte ต่างกัน → Prod-Truth Gate เทียบ fingerprint ไม่ตรง
//    แล้วรายงานว่า "prod รันโค้ดเก่า" ทั้งที่โค้ดเหมือนกันเป๊ะ (ไล่หาเสียเวลาหลายชั่วโมง)
//
// ปลอดภัยโดยการออกแบบ: แก้เฉพาะไฟล์ที่ git มองว่าเป็น "ข้อความ" + ไม่มีไบต์ NUL (binary)
// และข้ามไฟล์ที่ .gitattributes กำหนด eol=crlf (.bat/.cmd) เพราะ git จัดการเอง
// ────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECK_ONLY = process.argv.includes('--check');
const SKIP_BIG = 8 * 1024 * 1024; // asset ใหญ่ผิดปกติ = ไม่ต้องอ่านทั้งก้อน

const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8').split('\0').filter(Boolean);

// git เป็นเจ้าของการตัดสินว่าไฟล์ไหน "เป็นข้อความ" — อ่านครั้งเดียวทั้งชุด (check-attr รับ --stdin)
// รูปแบบ -z: <path>\0<attr>\0<value>\0<attr>\0<value>\0 ... (หนึ่ง path มีหลาย attr)
// (เคยพังตรงนี้: วนทีละ 3 ช่องทั้งที่ขอ 2 attr = 5 ช่อง → .ttf/.png ถูกแก้จนเสีย ต้องกู้คืน)
const attrInfo = new Map();
{
  const raw = execFileSync('git', ['check-attr', '-z', 'text', 'eol', '--stdin'],
    { cwd: ROOT, input: files.join('\0') + '\0', maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  const parts = raw.split('\0').filter((s) => s !== '');
  let i = 0;
  while (i < parts.length) {
    const p = parts[i++];
    const info = { text: null, eol: null };
    while (i + 1 < parts.length && (parts[i] === 'text' || parts[i] === 'eol')) {
      info[parts[i]] = parts[i + 1];
      i += 2;
    }
    attrInfo.set(p, info);
  }
}

const changed = [];
const skipped = [];
for (const rel of files) {
  const info = attrInfo.get(rel) ?? {};
  if (info.text === 'false' || info.text === 'unspecified' || info.eol === 'crlf') { skipped.push(rel); continue; }
  const abs = join(ROOT, rel);
  let buf;
  try {
    if (statSync(abs).size > SKIP_BIG) continue;
    buf = readFileSync(abs);
  } catch { continue; } // ไฟล์หาย/ล็อก = ข้าม (soft)
  if (!buf.includes(0x0d)) continue; // ไม่มี CR = สะอาดแล้ว
  if (buf.subarray(0, 8192).includes(0)) { skipped.push(rel); continue; } // มี NUL = binary แน่นอน
  changed.push(rel);
  if (!CHECK_ONLY) writeFileSync(abs, Buffer.from(buf.toString('binary').replace(/\r\n/g, '\n'), 'binary'));
}

console.log(`normalize-eol: ${CHECK_ONLY ? 'ตรวจ' : 'แก้'} ${changed.length} ไฟล์ จากทั้งหมด ${files.length} tracked · ข้าม ${skipped.length} ไฟล์ (binary ตาม .gitattributes)`);
for (const rel of changed.slice(0, 20)) console.log(`  ${CHECK_ONLY ? 'CRLF' : '→LF '} ${rel}`);
if (changed.length > 20) console.log(`  … อีก ${changed.length - 20} ไฟล์`);
if (CHECK_ONLY && changed.length) {
  console.log('❌ ยังมีไฟล์ CRLF — รัน: node tools/normalize-eol.mjs');
  process.exitCode = 1;
} else if (changed.length) {
  // stat cache ของ git ยังจำไฟล์เก่าอยู่ → add+reset เพื่อล้าง (เนื้อหาใน index ไม่เปลี่ยน)
  execFileSync('git', ['add', '-A'], { cwd: ROOT, stdio: 'ignore' });
  execFileSync('git', ['reset', '-q'], { cwd: ROOT, stdio: 'ignore' });
  console.log('✅ โฟลเดอร์ทำงานเป็น LF ทั้งหมดแล้ว (ตรวจซ้ำด้วย: node tools/normalize-eol.mjs --check)');
}
