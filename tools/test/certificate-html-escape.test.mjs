// tools/test/certificate-html-escape.test.mjs
//
// ── เกียรติบัตร: ต้อง escape ค่าที่ผู้ใช้ตั้งเองก่อนเขียนลงหน้าต่างพิมพ์ ──────
//
// ทำไมต้องมี (17/11/69): `printCertificate` ประกอบ HTML ด้วย template literal
// ที่ฝัง `${kid.name}` / `${cert.detail}` ตรง ๆ แล้ว `document.write` ลงหน้าต่าง
// ที่เปิดด้วย `window.open('', '_blank')` ซึ่ง "สืบทอด origin ของแอป" ⇒ ชื่อเด็ก
// ที่มี `<img src=x onerror=...>` รันสคริปต์ใน origin เดียวกับที่เก็บ JWT ใน
// localStorage (`sovereign-auth`) = ขโมย session ของคนที่กดพิมพ์
//
// ชื่อเด็กตั้งได้จาก `POST /api/knowledge/teach/kids` (authenticate เท่านั้น =
// ทุก role) และ `name` ยาวได้ถึง 100 ตัวอักษร ⇒ payload มาตรฐานใส่ได้สบาย
//
// เทสต์นี้ import ตัวสร้างจริง (`certificate-html.ts` — ไม่มี import ข้างใน
// จึง import ตรงได้ด้วย type stripping ของ Node 24) แล้วป้อน payload จริง
// ไม่ใช่ regex อ่านซอร์ส
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE = join(ROOT, 'sovereign-frontend', 'src', 'components', 'knowledge', 'certificate-html.ts');
const KID_PRINT = join(ROOT, 'sovereign-frontend', 'src', 'components', 'knowledge', 'kid-print.ts');

const { buildCertificateHtml } = await import(pathToFileURL(MODULE).href);

/** t ปลอมแบบง่าย: คืน fallback (แทน {var} ให้ด้วย) — เทสต์ไม่สนใจคำแปล */
const t = (_key, fallback, params) => {
  const text = fallback ?? _key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_m, k) => (k in params ? String(params[k]) : `{${k}}`));
};

const build = (over = {}) =>
  buildCertificateHtml({
    t,
    name: 'น้องมีนา',
    emoji: '🌸',
    level: 3,
    detail: 'สะสมคะแนนครบ 300 XP',
    dateLabel: '17 พฤศจิกายน 2569',
    ...over,
  });

test('ชื่อเด็กที่มี HTML ต้องถูก escape (ไม่ให้กลายเป็นแท็กจริง)', () => {
  const payload = '<img src=x onerror="alert(document.domain)">';
  const html = build({ name: payload });

  assert.ok(!/<img/i.test(html), 'ต้องไม่มีแท็ก <img> จริงในผลลัพธ์ (XSS ในหน้าต่างพิมพ์)');
  assert.ok(!/<[^>]*onerror/i.test(html), 'ต้องไม่มี event handler หลุดออกมาเป็นแอตทริบิวต์');
  assert.match(html, /&lt;img/, 'payload ต้องถูกทำให้เป็นข้อความ (&lt;img)');
});

test('อีโมจิและ detail จาก DB ต้องถูก escape ด้วย', () => {
  const html = build({ emoji: '<b>x</b>', detail: '<script>alert(1)</script>' });

  assert.ok(!/<b>/i.test(html), 'อีโมจิต้องไม่กลายเป็นแท็ก');
  assert.ok(!/<script/i.test(html), 'detail ต้องไม่กลายเป็น <script>');
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /&lt;script&gt;/);
});

test('ข้อมูลปกติยังแสดงตามเดิม (การ escape ต้องไม่ทำให้เกียรติบัตรเพี้ยน)', () => {
  const html = build();

  assert.match(html, /น้องมีนา/, 'ชื่อไทยต้องยังอยู่ครบ');
  assert.match(html, /🌸/, 'อีโมจิปกติต้องยังแสดง');
  assert.match(html, /สะสมคะแนนครบ 300 XP/, 'detail ปกติต้องยังอยู่');
  assert.match(html, /ระดับ 3/, 'ระดับต้องยังแสดง');
  assert.match(html, /17 พฤศจิกายน 2569/, 'วันที่ต้องยังแสดง');
  // แท็กที่ตัวสร้างเองต้องไม่ถูก escape จนเสียรูป
  assert.match(html, /<div class="name">/, 'โครง HTML ของตัวสร้างต้องไม่ถูก escape');
});

test('ตัว sink ต้องประกอบ HTML ผ่านตัวสร้างเท่านั้น (ห้าม interpolate ชื่อเด็กตรง ๆ อีก)', () => {
  const src = readFileSync(KID_PRINT, 'utf8');
  assert.match(src, /buildCertificateHtml\(/, 'kid-print ต้องเรียก buildCertificateHtml');
  assert.ok(!/\$\{name\}/.test(src), 'ห้ามกลับไป interpolate `${name}` ลง template ของหน้าต่างพิมพ์');
  assert.ok(!/<div class="name">/.test(src), 'ห้ามกลับไปประกอบ HTML เกียรติบัตรใน kid-print');
});
