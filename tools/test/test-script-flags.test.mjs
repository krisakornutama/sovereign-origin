// ด่านกันการใส่ `--test-force-exit` กลับเข้า `test:tools`
//
// เหตุผล (เจอจริง 15/11/69, บันทึกไว้ใน AGENTS.md):
//   `tsx --test ... --test-force-exit` บน Windows เครื่องนี้ทำให้เกิด
//   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`
//   แล้วรายงานว่า "เทสต์ล้มทั้งไฟล์" **ทั้งที่ assertion ข้างในผ่านครบ**
//   (force-exit ฆ่า process ตอน handle ของ libuv กำลังปิด)
//   ⇒ `npm run verify` ล้มหลอกซ้ำ ๆ และคนอ่าน log จะไปสงสัยโค้ด/Prisma ผิดตัว
//
// flag นี้ถูกใส่ไว้เมื่อ 19/10/69 เพื่อกัน CI ค้าง (`desktop-shell-functions.test.mjs`
// เปิด keep-alive socket ค้าง 60 วิ) — ต้นเหตุนั้นถูกปิดแล้ว (ปิด socket ของ test server)
// จึงไม่ต้องพึ่ง flag ที่สร้างความเสียหายมากกว่าที่กัน
//
// กติกา:
//   1. `test:tools` ต้องไม่มี `--test-force-exit`
//   2. ต้องมี `--test-timeout` — ถ้าไม่มี เทสต์ที่ค้างจะค้างทั้ง gate แทนที่จะล้มเป็นไฟล์
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

function readScripts() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return pkg.scripts ?? {};
}

test('test:tools ต้องไม่ใช้ --test-force-exit (ทำให้เทสต์ล้มหลอกบน Windows)', () => {
  const script = readScripts()['test:tools'];
  assert.ok(script, 'ต้องมีสคริปต์ test:tools ใน package.json');
  assert.doesNotMatch(
    script,
    /--test-force-exit/,
    'ถอด --test-force-exit ออก: บน Windows มันฆ่า process ตอน handle ปิด ⇒ ' +
      'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ⇒ รายงานว่าไฟล์นั้นล้ม ' +
      'ทั้งที่ assertion ข้างในผ่านครบ (AGENTS.md 15/11/69)'
  );
});

test('test:tools ต้องมี --test-timeout เพื่อให้เทสต์ที่ค้างล้มเป็นไฟล์ ไม่ค้างทั้ง gate', () => {
  const script = readScripts()['test:tools'];
  assert.ok(script, 'ต้องมีสคริปต์ test:tools ใน package.json');
  assert.match(
    script,
    /--test-timeout=\d+/,
    'ต้องมี --test-timeout=<ms> กำกับ: ถ้าไม่มีเทสต์ที่ค้างจะค้างทั้ง verify แทนที่จะล้มเฉพาะไฟล์'
  );
});

// บั๊กจริง 17/11/69: dumpOnce ส่ง `{ ...step, meta }` ⇒ ไม่มี stdout/stderr ติดไป
// ⇒ log ที่ได้มีแต่ metadata (0 ไบต์ output) ทั้งที่โปรเซสลูกพิมพ์ 146 KB
// ทำให้ต้องรัน verify ซ้ำอีก 8 นาทีเพื่อดูสาเหตุ — เทสต์นี้กันไม่ให้กลับมา
test('verify.mjs ต้องส่ง stdout/stderr ของผลรันเข้า dumpVerifyFailure', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'verify.mjs'), 'utf8');
  assert.match(
    src,
    /dumpVerifyFailure\(\s*\{[^}]*stdout:\s*r\.stdout/s,
    'dumpVerifyFailure ต้องได้ stdout ของผลรัน (r.stdout) ไม่ใช่ของ step'
  );
  assert.match(
    src,
    /dumpVerifyFailure\(\s*\{[^}]*stderr:\s*r\.stderr/s,
    'dumpVerifyFailure ต้องได้ stderr ของผลรัน (r.stderr) ไม่ใช่ของ step'
  );
});
