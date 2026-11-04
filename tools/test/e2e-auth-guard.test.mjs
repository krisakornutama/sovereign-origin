// H2 — e2e ต้องไม่ล้มทั้งกองเพราะ login จุดเดียวพัง
// เทสต์นี้เป็นด่าน static: spec ที่ต้อง storageState ต้องมีด่าน skip ของตัวเอง
// (เคสจริง 26/9: auth setup ล้ม → 63 spec "did not run" ทั้งที่ไม่เกี่ยวกับ login)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FE = join(ROOT, 'sovereign-frontend');
const GUARD = join(FE, 'e2e', 'helpers', 'authGuard.ts');

// spec ที่อยู่ใน project "authenticated" ของ playwright.config.ts
const AUTH_SPECS = ['pages.spec.ts', 'pos-flow.spec.ts', 'spa-nav.spec.ts'];

test('มี helper กลางสำหรับ skip เมื่อ auth ล่ม', () => {
  assert.ok(existsSync(GUARD), 'ไม่พบ e2e/helpers/authGuard.ts');
  const src = readFileSync(GUARD, 'utf8');
  assert.match(src, /export function skipIfAuthStateMissing/, 'helper ต้อง export skipIfAuthStateMissing');
  assert.match(src, /test\.skip/, 'helper ต้องเรียก test.skip จริง (ไม่ใช่แค่ log)');
});

for (const spec of AUTH_SPECS) {
  test(`${spec} มีด่าน skip เมื่อไม่มี storageState`, () => {
    const p = join(FE, 'e2e', spec);
    assert.ok(existsSync(p), `ไม่พบ ${spec}`);
    const src = readFileSync(p, 'utf8');
    assert.match(src, /import .*skipIfAuthStateMissing/, `${spec} ต้อง import helper`);
    assert.match(src, /skipIfAuthStateMissing\(\)/, `${spec} ต้องเรียก helper ก่อนลงทะเบียนเทสต์`);
  });
}

test('playwright.config ยังประกาศ project authenticated และอ้าง spec ในลิสต์', () => {
  // config เขียน testMatch เป็น regex (มี backslash หนีจุด) → ตัด backslash ก่อนเทียบ
  const cfg = readFileSync(join(FE, 'playwright.config.ts'), 'utf8').split(String.fromCharCode(92)).join('');
  assert.match(cfg, /name: 'authenticated'/, 'ไม่พบ project authenticated');
  for (const spec of AUTH_SPECS) {
    assert.ok(cfg.includes(spec), `config ไม่ได้อ้าง ${spec} แล้ว — อัปเดตลิสต์ในเทสต์นี้`);
  }
});
