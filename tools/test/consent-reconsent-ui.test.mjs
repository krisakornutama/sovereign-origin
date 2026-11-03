// tools/test/consent-reconsent-ui.test.mjs
//
// ── UI ของการขอความยินยอมใหม่ (นโยบายเวอร์ชันเปลี่ยน) ───────────────────────
// ทำไมต้องมี: backend บอกได้แล้วว่า "วัตถุประสงค์นี้ต้องยืนยันฉบับใหม่"
// แต่ถ้าหน้าเว็บยังกดปุ่มเดิม (สลับ granted = !granted) ผู้ใช้ที่เคยยอมรับไว้
// จะกดแล้วกลายเป็น "ถอน" — ไม่มีทางยืนยันฉบับใหม่ได้เลยจาก UI
// เทสต์นี้ล็อกว่า: มีแบนเนอร์ + ปุ่มเปลี่ยนเป็น "ยืนยันใหม่" + ส่ง granted:true เสมอในเคสนั้น
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const PAGE = 'sovereign-frontend/src/pages/consent.tsx';
const TH = 'sovereign-frontend/src/i18n/th/pages/consent.ts';
const EN = 'sovereign-frontend/src/i18n/en/pages/consent.ts';

function slice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `หาไม่เจอ: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `หาไม่เจอจุดจบ: ${endMarker}`);
  return source.slice(start, end);
}

test('ปุ่มยืนยันใหม่ต้องส่ง granted:true (ไม่ใช่ !granted ที่กลายเป็นการถอน)', () => {
  const toggle = slice(read(PAGE), 'const toggle = useCallback', 'const deleteAccount = useCallback');
  assert.match(toggle, /needsReconsent\s*\?\s*true\s*:\s*!purpose\.granted/, 'ต้องมี nextGranted = needsReconsent ? true : !granted');
  assert.match(toggle, /granted:\s*nextGranted/, 'ต้องส่งค่าที่คำนวณแล้ว ไม่ใช่ !purpose.granted ตรง ๆ');
  assert.doesNotMatch(toggle, /granted:\s*!purpose\.granted/, 'ห้ามส่ง !granted ตรง ๆ (เคสขอใหม่จะกลายเป็นถอน)');
});

test('ป้ายปุ่มแยก "ยืนยันใหม่" ออกจาก "ยินยอมแล้ว"', () => {
  const src = read(PAGE);
  const reconfirmAt = src.indexOf("t('consent.reconfirm')");
  const grantedAt = src.indexOf("t('consent.granted')");
  assert.notEqual(reconfirmAt, -1, 'ต้องมีป้าย reconfirm สำหรับเคสขอใหม่');
  assert.notEqual(grantedAt, -1, 'ต้องมีป้าย granted เดิม');
  assert.ok(reconfirmAt < grantedAt, 'ต้องเช็ค needsReconsent ก่อน granted (ไม่งั้นป้ายผิดเคส)');
});

test('หน้าเว็บขึ้นแบนเนอร์เมื่อมีวัตถุประสงค์ที่ต้องยืนยันใหม่', () => {
  const src = read(PAGE);
  assert.match(src, /reconsentRequired/, 'ต้องอ่านสัญญาณ reconsentRequired จาก API');
  assert.match(src, /consent\.reconsentBanner/, 'ต้องมีข้อความแบนเนอร์ (ไม่ใช่เงียบ ๆ)');
});

test('ชนิดข้อมูลฝั่ง UI รับฟิลด์ใหม่ (ไม่ตกหล่นตอน map)', () => {
  const src = read(PAGE);
  assert.match(src, /needsReconsent\??:\s*boolean/, 'ConsentPurpose ต้องมี needsReconsent');
  assert.match(src, /reconsentRequired\??:\s*boolean/, 'ConsentPayload ต้องมี reconsentRequired');
});

test('พจนานุกรม th/en มีข้อความขอความยินยอมใหม่ครบ', () => {
  for (const [name, rel] of [
    ['th', TH],
    ['en', EN],
  ]) {
    const src = read(rel);
    assert.match(src, /reconsentBanner:/, `${name}: ต้องมี reconsentBanner`);
    assert.match(src, /reconfirm:/, `${name}: ต้องมี reconfirm`);
  }
});
