// tools/test/login-privacy-links.test.mjs
//
// ── นโยบายความเป็นส่วนตัวต้องถึงได้ "ก่อน" เข้าสู่ระบบ ────────────────────
// ทำไมต้องมี: ระบบนี้ไม่มีสมัครเอง (ผู้ดูแลสร้างบัญชี) หน้าจอแรกที่คนใหม่เห็นคือ
// หน้า login — ถ้าไม่มีลิงก์นโยบายตรงนั้น ผู้ใช้ต้องกดยอมรับเรื่องข้อมูลส่วนบุคคล
// โดยไม่เคยเห็นนโยบายเลย (และหน้า /privacy จะเข้าถึงได้เฉพาะคนที่ล็อกอินแล้ว)
//
// กติกาที่ล็อก:
//   · หน้า login มีลิงก์ไป /privacy
//   · หน้า /privacy อ่านนโยบายด้วย fetch ตรง (ไม่ใช้ authFetch) ⇒ เปิดได้ก่อนล็อกอิน
//   · endpoint /api/consent/policy ไม่มี authenticate กั้น
//   · ข้อความมีทั้ง th/en (ไม่มีคีย์ขาด)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const LOGIN_FORM = 'sovereign-frontend/src/components/auth/LoginForm.tsx';
const PRIVACY = 'sovereign-frontend/src/pages/privacy.tsx';
const ROUTES = 'sovereign-os/core-api/src/modules/consent/consent.routes.ts';
const TH = 'sovereign-frontend/src/i18n/th/pages/login.ts';
const EN = 'sovereign-frontend/src/i18n/en/pages/login.ts';

test('หน้า login มีลิงก์ไป /privacy (ผู้ใช้ใหม่เห็นนโยบายก่อนกดยอมรับ)', () => {
  const src = read(LOGIN_FORM);
  assert.match(src, /href="\/privacy"/, 'ต้องมีลิงก์ /privacy ในหน้า login');
  assert.match(src, /login\.privacyLink/, 'ข้อความลิงก์ต้องผ่าน i18n (th/en)');
});

test('ลิงก์อยู่ในส่วนฟอร์ม login จริง ไม่ใช่คอมเมนต์', () => {
  const src = read(LOGIN_FORM);
  const formStart = src.indexOf('<form');
  const formEnd = src.indexOf('</form>');
  assert.ok(formStart > 0 && formEnd > formStart, 'หา <form> ไม่เจอ');
  const form = src.slice(formStart, formEnd);
  assert.match(form, /href="\/privacy"/, 'ลิงก์ต้องอยู่ในฟอร์ม (เห็นได้จริงตอนล็อกอิน)');
});

test('/privacy เปิดได้ก่อนล็อกอิน: ใช้ fetch ตรงกับ endpoint สาธารณะ', () => {
  const src = read(PRIVACY);
  assert.match(src, /\/api\/consent\/policy/, 'ต้องอ่านนโยบายจาก /api/consent/policy');
  assert.match(src, /await fetch\(/, 'ต้องใช้ fetch ตรง (ไม่แนบ token)');
  assert.doesNotMatch(src, /authFetch/, 'ห้ามใช้ authFetch — ผู้ใช้ก่อนล็อกอินจะโดน 401 แล้วอ่านนโยบายไม่ได้');
});

test('endpoint /api/consent/policy ไม่มี authenticate กั้น', () => {
  const src = read(ROUTES);
  const route = src.indexOf("router.get('/policy'");
  assert.notEqual(route, -1, 'หา route /policy ไม่เจอ');
  const nextRoute = src.indexOf('router.', route + 10);
  const block = src.slice(route, nextRoute === -1 ? undefined : nextRoute);
  assert.doesNotMatch(block, /authenticate/, '/policy ต้องเป็นสาธารณะ (อ่านได้ก่อนสมัคร/ก่อนยอมรับ)');
});

test('พจนานุกรม th/en มีข้อความลิงก์นโยบายครบ', () => {
  for (const [name, rel] of [
    ['th', TH],
    ['en', EN],
  ]) {
    const src = read(rel);
    assert.match(src, /privacyLink:/, `${name}: ต้องมี privacyLink`);
    assert.match(src, /privacyHint:/, `${name}: ต้องมี privacyHint (บอกว่าจะขอความยินยอมเมื่อไร)`);
  }
});
