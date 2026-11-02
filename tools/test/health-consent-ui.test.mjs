// tools/test/health-consent-ui.test.mjs
//
// ด่านความยินยอมฝั่ง UI — "ห้ามประกาศว่าบันทึกแล้วเมื่อเซิร์ฟเวอร์ปฏิเสธ"
//
// ทำไมต้องมีเทสต์นี้: backend ตอบ 403 `consent_required` ได้แล้ว แต่ถ้าหน้าเว็บ
// ยังขึ้น "บันทึกแล้ว" ผู้ใช้จะเชื่อว่าข้อมูลถูกเก็บ (ข้อมูลสุขภาพ = เรื่องอ่อนไหว)
// และจะไม่มีวันไปให้ความยินยอม — เทสต์นี้ล็อกลำดับ "ตรวจ res.ok ก่อนประกาศสำเร็จ"
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const HEALTH = 'sovereign-frontend/src/pages/health.tsx';
const SELF_CHECK = 'sovereign-frontend/src/pages/health/self-check.tsx';
const TH = 'sovereign-frontend/src/i18n/th/pages/health.ts';
const EN = 'sovereign-frontend/src/i18n/en/pages/health.ts';

function sliceFn(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `หาไม่เจอ: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `หาไม่เจอจุดจบ: ${endMarker}`);
  return source.slice(start, end);
}

test('health.tsx: addObservation ตรวจ !res.ok ก่อนประกาศ "บันทึกแล้ว"', () => {
  const src = read(HEALTH);
  const fn = sliceFn(src, 'const addObservation = async', 'const clearFlag = async');
  const guard = fn.indexOf('if (!res.ok)');
  const success = fn.indexOf("health.observation.saved");
  assert.notEqual(guard, -1, 'ต้องมี if (!res.ok) ใน addObservation');
  assert.notEqual(success, -1, 'ต้องมีข้อความบันทึกสำเร็จ');
  assert.ok(guard < success, 'ต้องตรวจ res.ok ก่อนเสมอ — ไม่ใช่ประกาศสำเร็จแล้วค่อยเช็ค');
  assert.ok(src.includes('consent_required'), 'ต้องแยกเคส consent_required เพื่อบอกทางแก้');
  assert.ok(src.includes('consentMessage'), 'ต้องแปลงรหัส consent_* เป็นข้อความบอกทางแก้');
});

test('health.tsx: toggleProfileCode / toggleConsent ก็ไม่กลืน 403', () => {
  const src = read(HEALTH);
  const profileFn = sliceFn(src, 'const toggleProfileCode = async', 'if (!isHydrated)');
  const consentFn = sliceFn(src, 'const toggleConsent = async', 'const toggleProfileCode = async');
  assert.ok(profileFn.includes('if (!res.ok)'), 'บันทึกโปรไฟล์สุขภาพต้องเช็คผลลัพธ์');
  assert.ok(consentFn.includes('if (!res.ok)'), 'สวิตช์ความยินยอมต้องเช็คผลลัพธ์');
});

test('self-check.tsx: ตรวจผลทุกข้อในลูปก่อนไปหน้าสรุป', () => {
  const src = read(SELF_CHECK);
  const loop = sliceFn(src, 'for (const qq of QUESTIONS)', '// ดึงสรุปใหม่');
  assert.ok(loop.includes('if (!r.ok)'), 'ต้องมี if (!r.ok) ในลูปบันทึก');
  assert.ok(loop.includes('consent_version_stale'), 'ต้องแยกเคสนโยบายเปลี่ยน');
  assert.ok(loop.includes('consent_required'), 'ต้องแยกเคสยังไม่ยินยอม');
  assert.ok(
    loop.indexOf('if (!r.ok)') < loop.indexOf('throw new Error'),
    'ต้องตรวจก่อน แล้วจึงโยนข้อความ (ไม่ปล่อยผ่านไปหน้าสรุป)'
  );
});

test('self-check.tsx: หน้าสรุป "บันทึกเสร็จแล้ว" อยู่หลังการตรวจเท่านั้น', () => {
  const src = read(SELF_CHECK);
  const guard = src.indexOf('if (!r.ok)');
  const done = src.indexOf('บันทึกเสร็จแล้ว');
  assert.ok(guard !== -1 && done !== -1);
  assert.ok(guard < done, 'ข้อความสำเร็จต้องอยู่หลังด่านตรวจ');
});

test('พจนานุกรม th/en มีข้อความบอกทางแก้ครบทั้งสองเคส', () => {
  for (const [name, rel] of [
    ['th', TH],
    ['en', EN],
  ]) {
    const src = read(rel);
    assert.ok(src.includes('consentRequired:'), `${name}: ต้องมี consentRequired`);
    assert.ok(src.includes('consentVersionStale:'), `${name}: ต้องมี consentVersionStale`);
    assert.ok(src.includes('/consent'), `${name}: ต้องบอกทางไปศูนย์ความยินยอม (/consent)`);
  }
});
