/**
 * Tax Rules config — เทสต์กติกาการโหลด/ตรวจ/ใช้ไฟล์ `data/tax-rules.json`
 *
 * เหตุผล: เจ้าของขอ "ให้แก้ภาษีผ่าน Config File" แต่การเงินห้ามเพี้ยนเงียบ ๆ
 *   ⇒ ค่าเริ่มต้นต้องเท่า RATES เดิมเป๊ะ, ไฟล์เสีย/ผิดรูปต้อง fallback (fail-closed),
 *     และค่าแปลก (rate > 1, ขั้นบันไดไม่เรียง, ไม่มีขั้นสุดท้าย) ต้องถูกปฏิเสธ
 *
 * เขียนแบบ red-first: ก่อนมี `tax-rules.ts` ไฟล์นี้ import ไม่ได้ = แดง
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RATES,
  computeCit,
  computePit,
  getTaxRules,
  getTaxRulesStatus,
  resetTaxRulesCacheForTests,
} from '../src/services/thai-tax.service';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(HERE, '..', '.tmp-taxrules');
let seq = 0;

function useRulesFile(content: unknown, raw = false): string {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const file = path.join(TMP_DIR, `rules-${process.pid}-${Date.now()}-${seq++}.json`);
  fs.writeFileSync(file, raw ? String(content) : JSON.stringify(content), 'utf8');
  process.env.TAX_RULES_PATH = file;
  resetTaxRulesCacheForTests();
  return file;
}

function clearRulesFile() {
  delete process.env.TAX_RULES_PATH;
  resetTaxRulesCacheForTests();
}

before(() => fs.mkdirSync(TMP_DIR, { recursive: true }));
beforeEach(clearRulesFile);
after(() => {
  clearRulesFile();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('ค่าเริ่มต้น — ต้องเท่า RATES เดิมเป๊ะ', () => {
  test('VAT / CIT / PIT ตรงกับ RATES และมีแหล่งที่มา = default', () => {
    const rules = getTaxRules();
    assert.equal(rules.VAT.REDUCED, RATES.VAT.REDUCED);
    assert.equal(rules.VAT.STANDARD, RATES.VAT.STANDARD);
    assert.equal(rules.VAT.REDUCED_UNTIL, RATES.VAT.REDUCED_UNTIL);
    assert.equal(rules.CIT_STANDARD, RATES.CIT_STANDARD);
    assert.equal(rules.SME_CIT.CAPITAL_CAP, RATES.SME_CIT.CAPITAL_CAP);
    assert.equal(rules.PIT.PERSONAL_ALLOWANCE, RATES.PIT.PERSONAL_ALLOWANCE);
    assert.equal(rules.PIT.BRACKETS.length, RATES.PIT.BRACKETS.length);
    assert.equal(getTaxRulesStatus().source, 'default');
    assert.deepEqual(getTaxRulesStatus().errors, []);
  });

  test('ผลคำนวณไม่เปลี่ยนเมื่อไม่มีไฟล์', () => {
    const cit = computeCit({ netProfit: 1_000_000, capitalRegistered: 1_000_000, totalRevenue: 5_000_000 });
    // 300,000 แรก 0% + 700,000 × 15% = 105,000
    assert.equal(cit.grossTax, 105_000);
    const pit = computePit({ totalIncome: 500_000 });
    // (500,000 − 60,000) = 440,000 → 150k 0% + 150k 5% (7,500) + 140k 10% (14,000) = 21,500
    assert.equal(pit.grossTax, 21_500);
  });
});

describe('ไฟล์ถูกต้อง — ใช้ค่าจากไฟล์จริง', () => {
  test('ปรับ CIT_STANDARD มีผลกับ computeCit และบอก source=file', () => {
    useRulesFile({ CIT_STANDARD: 0.17, version: 'test-1' });
    assert.equal(getTaxRules().CIT_STANDARD, 0.17);
    assert.equal(getTaxRulesStatus().source, 'file');
    assert.equal(getTaxRulesStatus().version, 'test-1');
    // ไม่ใช่ SME → 20% เดิม / 17% ใหม่
    const cit = computeCit({ netProfit: 1_000_000, capitalRegistered: 10_000_000, totalRevenue: 100_000_000 });
    assert.equal(cit.grossTax, 170_000);
  });

  test('ปรับค่าใช้จ่ายส่วนตัว PIT มีผลกับ computePit', () => {
    useRulesFile({ PIT: { PERSONAL_ALLOWANCE: 100_000 } });
    const pit = computePit({ totalIncome: 500_000 });
    // (500,000 − 100,000) = 400,000 → 150k 0% + 150k 5% (7,500) + 100k 10% (10,000) = 17,500
    assert.equal(pit.grossTax, 17_500);
  });

  test('ขั้นบันไดใหม่แทนของเดิมทั้งชุด (ไม่ผสม)', () => {
    useRulesFile({ PIT: { BRACKETS: [{ upTo: 500_000, rate: 0.05 }, { upTo: null, rate: 0.25 }] } });
    const pit = computePit({ totalIncome: 560_000 });
    // taxable 500,000 → 500,000 × 5% = 25,000 (ขั้นแรกไม่มี 0%)
    assert.equal(pit.grossTax, 25_000);
  });
});

describe('ไฟล์เสีย/ผิดรูป — ต้อง fallback ค่าเดิมเสมอ', () => {
  test('JSON พัง → default + มี error ให้เห็น', () => {
    useRulesFile('{ not json', true);
    assert.equal(getTaxRules().CIT_STANDARD, RATES.CIT_STANDARD);
    assert.equal(getTaxRulesStatus().source, 'default');
    assert.ok(getTaxRulesStatus().errors.length > 0);
  });

  test('อัตราภาษี > 1 ถูกปฏิเสธ', () => {
    useRulesFile({ CIT_STANDARD: 1.5 });
    assert.equal(getTaxRules().CIT_STANDARD, RATES.CIT_STANDARD);
    assert.match(getTaxRulesStatus().errors.join(' '), /CIT_STANDARD/);
  });

  test('ขั้นบันไดไม่เรียงจากน้อยไปมาก ถูกปฏิเสธ', () => {
    useRulesFile({ PIT: { BRACKETS: [{ upTo: 300_000, rate: 0.05 }, { upTo: 150_000, rate: 0.1 }, { upTo: null, rate: 0.2 }] } });
    assert.deepEqual(getTaxRules().PIT.BRACKETS, RATES.PIT.BRACKETS.map((b) => ({ upTo: b.upTo, rate: b.rate })));
    assert.ok(getTaxRulesStatus().errors.length > 0);
  });

  test('ขั้นสุดท้ายต้องเปิด (null) ไม่ใช่เพดานจำนวนจำกัด', () => {
    useRulesFile({ PIT: { BRACKETS: [{ upTo: 500_000, rate: 0.1 }] } });
    assert.equal(getTaxRules().PIT.BRACKETS.at(-1)?.upTo, Infinity);
    assert.ok(getTaxRulesStatus().errors.some((e) => /ขั้นสุดท้าย|unbounded|null/.test(e)));
  });

  test('คีย์ผิด/พิมพ์ผิด ถูกปฏิเสธ (กันแก้แล้วเงียบ)', () => {
    useRulesFile({ PIT: { PERSONAL_ALLOWENCE: 120_000 } });
    assert.equal(getTaxRules().PIT.PERSONAL_ALLOWANCE, RATES.PIT.PERSONAL_ALLOWANCE);
    assert.match(getTaxRulesStatus().errors.join(' '), /PERSONAL_ALLOWENCE/);
  });

  test('effectiveFrom ในอนาคต → ยังไม่ใช้ไฟล์', () => {
    useRulesFile({ CIT_STANDARD: 0.17, effectiveFrom: '2999-01-01' });
    assert.equal(getTaxRules().CIT_STANDARD, RATES.CIT_STANDARD);
    assert.equal(getTaxRulesStatus().source, 'default');
    assert.ok(getTaxRulesStatus().errors.some((e) => /effectiveFrom/.test(e)));
  });
});
