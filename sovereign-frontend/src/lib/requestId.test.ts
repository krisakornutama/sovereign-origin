// src/lib/requestId.test.ts — รันด้วย: npx tsx src/lib/requestId.test.ts
// ล็อกกติกาที่ backend บังคับ (SAFE_REQUEST_ID): ถ้าฝั่งเว็บสร้าง id ที่ backend
// ไม่รับ มันจะถูกแทนด้วย uuid ใหม่เงียบ ๆ ⇒ ไล่ log ไม่เจอ = จุดประสงค์ของฟีเจอร์หายทั้งอัน
import { newRequestId } from './requestId';
import assert from 'node:assert/strict';

const SAFE = /^[A-Za-z0-9._:-]+$/; // ตรงกับ SAFE_REQUEST_ID ใน core-api

for (let i = 0; i < 200; i++) {
  const id = newRequestId();
  assert.ok(id.length > 0 && id.length <= 64, `ความยาวต้อง 1-64 — ได้ ${id.length}`);
  assert.match(id, SAFE, `ต้องมีแต่อักขระที่ backend รับ — ได้ "${id}"`);
  assert.doesNotMatch(id, /[\r\n\t]/, 'ห้ามมีอักขระขึ้นบรรทัดใหม่ (log injection)');
}

// ต้องไม่ซ้ำกันในทางปฏิบัติ (ถ้าซ้ำ = trace ผิดคำขอ)
const set = new Set(Array.from({ length: 500 }, () => newRequestId()));
assert.equal(set.size, 500, '500 คำขอต้องได้ 500 id ไม่ซ้ำ');

// crypto ปิด (WebView เก่า) ต้องยังคืนค่าที่ใช้ได้ ไม่ throw
const realCrypto = (globalThis as { crypto?: Crypto }).crypto;
try {
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  const fallback = newRequestId();
  assert.match(fallback, SAFE);
  assert.ok(fallback.startsWith('web-'), `fallback ต้องบอกที่มา — ได้ "${fallback}"`);
} finally {
  Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });
}

console.log('✅ requestId: ผ่านทุกกติกา (200 ค่า + uniqueness + fallback)');
