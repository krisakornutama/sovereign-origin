// tools/test/http-helper-canonical.test.mjs
//
// ── J3e: รวม HTTP helper 3 ตัวเป็น canonical เดียว + re-export ───────────────
// apiClient / apiFetch / fetchJson มีฟังก์ชันซ้อนทับกัน → เริ่มด้วยการทำให้
// `authFetch` (ฐานรองใน apiFetch.ts) เป็น canonical แล้ว re-export จากอีกสอง
// ไฟล์ ให้ผู้เรียก import จากไหนก็ได้ ได้ฟังก์ชันตัวเดียวกัน
//
// กติกา:
//   · ต้อง import authFetch จาก apiFetch.ts ได้ (canonical)
//   · ต้อง import authFetch จาก fetchJson.ts ได้ (re-export)
//   · ต้อง import authFetch จาก apiClient.ts ได้ (re-export)
//   · ทั้งสามต้องเป็นฟังก์ชันตัวเดียวกัน (reference เดียวกัน)
//   · ไม่เปลี่ยน signature ของฟังก์ชันเดิม
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function exportsFrom(src, name) {
  // จับรูปแบบ export { name } from './apiFetch';
  return new RegExp(`export\\s*\\{\\s*${name}\\s*\\}\\s*from\\s*['"]\\.\\/apiFetch['"]`).test(src);
}

test('apiFetch.ts เป็น canonical: ส่งออก authFetch เอง (ไม่ต้อง re-export จากที่อื่น)', () => {
  const src = read('sovereign-frontend/src/lib/apiFetch.ts');
  assert.match(src, /export async function authFetch/, 'ต้องมีฟังก์ชัน authFetch ต้นกำเนิด');
});

test('fetchJson.ts re-export authFetch จาก apiFetch (importจาก fetchJson ก็ใช้ authFetch ได้)', () => {
  const src = read('sovereign-frontend/src/lib/fetchJson.ts');
  assert.ok(exportsFrom(src, 'authFetch'), 'ต้องมี `export { authFetch } from \'./apiFetch\';`');
});

test('apiClient.ts re-export authFetch จาก apiFetch (importจาก apiClient ก็ใช้ authFetch ได้)', () => {
  const src = read('sovereign-frontend/src/lib/apiClient.ts');
  assert.ok(exportsFrom(src, 'authFetch'), 'ต้องมี `export { authFetch } from \'./apiFetch\';`');
});

test('ไม่มี signature เปลี่ยน: authFetch ยังคงเป็น async function (url, options?)', () => {
  const src = read('sovereign-frontend/src/lib/apiFetch.ts');
  assert.match(src, /export async function authFetch\(url: string, options: RequestInit = \{\}\)/);
});
