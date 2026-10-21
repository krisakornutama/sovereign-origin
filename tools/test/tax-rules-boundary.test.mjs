#!/usr/bin/env node
/* ── Tax Rules config — ล็อก "ที่มาเดียว" และความบริสุทธิ์ของตัวโหลด ─────────
   เจ้าของขอให้แก้ภาษีผ่าน Config File ได้ แต่ต้องไม่เปิดช่องให้การเงินเพี้ยนเงียบ ๆ
   เทสต์นี้คุมโครงสร้าง (ส่วนกติกาตัวเลขอยู่ใน core-api/tests/taxRules.test.ts):
   1) ตัวโหลดห้ามต่อ DB/เครือข่าย (อ่านไฟล์เท่านั้น)
   2) ฟังก์ชันคำนวณห้ามอ่าน RATES ตรง ๆ — ต้องผ่าน getTaxRules()
   3) ห้ามมีไฟล์ override ถูก commit ไว้ใน repo (runtime เท่านั้น)
*/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const LOADER = 'sovereign-os/core-api/src/services/tax-rules.ts';
const TAX = 'sovereign-os/core-api/src/services/thai-tax.service.ts';
const RUNTIME_FILE = 'sovereign-os/core-api/data/tax-rules.json';

describe('Tax Rules — ที่มาเดียว + fail-closed', () => {
  test('ตัวโหลดเป็นตรรกะบริสุทธิ์ ไม่แตะ DB/เครือข่าย/ไฟล์', () => {
    const src = read(LOADER);
    assert.doesNotMatch(src, /@prisma|from ['"]axios['"]|\bfetch\s*\(|from ['"]node:fs['"]/, 'ตัวโหลดต้องเป็นตรรกะล้วน');
    assert.match(src, /export function validateTaxRulesFile/, 'ต้องมี validator ให้เทสต์ได้');
    assert.match(src, /export function mergeTaxRules/, 'ต้องมีตัวรวมค่าเริ่มต้นกับ override');
    assert.match(read(TAX), /from 'node:fs'/, 'การอ่านไฟล์ต้องอยู่ที่ service ไม่ใช่ตัวโหลด');
  });

  test('ฟังก์ชันคำนวณใช้ getTaxRules() ไม่ใช่ RATES ตรง ๆ', () => {
    const src = read(TAX);
    const sections = {
      currentVatRate: src.slice(src.indexOf('export function currentVatRate'), src.indexOf('// 2) ภาษีเงินได้นิติบุคคล')),
      computeCit: src.slice(src.indexOf('export function computeCit'), src.indexOf('// 3) ภาษีเงินได้บุคคลธรรมดา')),
      computePit: src.slice(src.indexOf('export function computePit')),
    };
    for (const [name, body] of Object.entries(sections)) {
      assert.ok(body.length > 0, `ไม่พบฟังก์ชัน ${name}`);
      assert.doesNotMatch(body, /RATES\./, `${name} ยังอ่าน RATES ตรง ๆ — ต้องผ่าน getTaxRules()`);
    }
    assert.match(sections.currentVatRate, /getTaxRules\(\)/);
    assert.match(sections.computeCit, /getTaxRules\(\)/);
    assert.match(sections.computePit, /getTaxRules\(\)/);
  });

  test('ไม่มีไฟล์ override ถูก commit และ path เป็น runtime ใน data/', () => {
    assert.ok(!fs.existsSync(path.join(ROOT, RUNTIME_FILE)), `ห้าม commit ${RUNTIME_FILE} — ต้องวางที่เครื่องผู้ใช้เท่านั้น`);
    const src = read(TAX);
    assert.match(src, /'data', 'tax-rules\.json'/, 'path เริ่มต้นต้องเป็น data/tax-rules.json');
    assert.match(src, /process\.env\.TAX_RULES_PATH/, 'ต้อง override path ได้ (สำหรับเทสต์/องค์กร)');
  });
});
