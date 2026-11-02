// tools/test/crypto-key-check.test.mjs
//
// ── เทสต์ของด่านตรวจ "กุญแจเข้ารหัส field" ──────────────────────────────────
// บทเรียนที่ต้องกัน: field-crypto.service สร้าง key ใหม่เงียบ ๆ เมื่อไฟล์หาย
// → ค่า enc:v1: ทั้งหมดกลายเป็นค่าว่างโดยไม่มี error
// ด่านนี้ต้องตอบให้ได้ว่า "key หาย + ยังมีข้อมูลเข้ารหัสอยู่" = อันตราย
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assessCryptoKey, backupKey, keyFingerprint } from '../verify/crypto-key-check.mjs';

describe('assessCryptoKey — ตัดสินว่ากุญแจพร้อมใช้หรือไม่', () => {
  const key32 = Buffer.alloc(32, 7);

  test('key ครบ 32 ไบต์ + มีข้อมูลเข้ารหัส = ผ่าน', () => {
    const r = assessCryptoKey({ keyBytes: key32, encryptedCount: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.level, 'ok');
    assert.match(r.message, /32/);
  });

  test('key หาย แต่ยังมีข้อมูลเข้ารหัส = ไม่ผ่าน (ระดับ critical)', () => {
    const r = assessCryptoKey({ keyBytes: null, encryptedCount: 3 });
    assert.equal(r.ok, false);
    assert.equal(r.level, 'critical');
    assert.match(r.message, /ไม่พบกุญแจ|กุญแจหาย/);
    assert.match(r.message, /อ่านไม่ได้/);
  });

  test('key หาย และยังไม่มีข้อมูลเข้ารหัส = เตือนได้ แต่ไม่ใช่ disaster', () => {
    const r = assessCryptoKey({ keyBytes: null, encryptedCount: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.level, 'warn');
    assert.match(r.message, /สร้างกุญแจใหม่/);
  });

  test('key ขนาดผิด (ไม่ใช่ 32 ไบต์) = ไม่ผ่านเสมอ', () => {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(16), Buffer.alloc(64)]) {
      const r = assessCryptoKey({ keyBytes: bytes, encryptedCount: 1 });
      assert.equal(r.ok, false, `ขนาด ${bytes.length} ต้องไม่ผ่าน`);
      assert.equal(r.level, 'critical');
    }
  });

  test('อ่าน DB ไม่ได้ (unknown) ต้องไม่สรุปว่าปลอดภัย', () => {
    const r = assessCryptoKey({ keyBytes: key32, encryptedCount: null });
    assert.equal(r.ok, true, 'key ยังอยู่ = ใช้งานได้');
    assert.equal(r.level, 'warn');
    assert.match(r.message, /ตรวจ.*ฐานข้อมูลไม่ได้|ไม่ทราบ/);
  });
});

describe('keyFingerprint — ใช้เทียบสำเนาโดยไม่เผย key', () => {
  test('คืนค่าเดียวกันสำหรับ key เดียวกัน และไม่ใช่ key ดิบ', () => {
    const key = Buffer.alloc(32, 9);
    const fp = keyFingerprint(key);
    assert.match(fp, /^[0-9a-f]{16}$/);
    assert.equal(fp, keyFingerprint(Buffer.from(key)));
    assert.equal(fp.includes(key.toString('base64')), false);
  });

  test('key ต่างกัน = fingerprint ต่างกัน', () => {
    assert.notEqual(keyFingerprint(Buffer.alloc(32, 1)), keyFingerprint(Buffer.alloc(32, 2)));
  });
});

describe('backupKey — สำเนากุญแจแบบ explicit เท่านั้น', () => {
  test('คัดลอก key ไปปลายทางที่กำหนด และคงไบต์เดิมเป๊ะ', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-key-'));
    try {
      const src = path.join(tmp, 'field-crypto.key');
      const key = Buffer.alloc(32, 5);
      fs.writeFileSync(src, key);
      const dest = path.join(tmp, 'backup', 'field-crypto.key');
      const out = backupKey(src, dest);
      assert.equal(out.ok, true);
      assert.equal(out.bytes, 32);
      assert.deepEqual(fs.readFileSync(dest), key, 'สำเนาต้องเหมือนต้นฉบับทุกไบต์');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('ต้นทางหาย = คืน ok:false ไม่ throw', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-key-'));
    try {
      const out = backupKey(path.join(tmp, 'nope.key'), path.join(tmp, 'dest.key'));
      assert.equal(out.ok, false);
      assert.match(out.message, /ไม่พบ|หาย/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
