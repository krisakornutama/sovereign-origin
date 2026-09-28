import './setup-env';
import { test, describe } from 'node:test';
import assert from 'node:assert';

// F2 (28/9/69): ต้องรันจาก cwd ที่มี data/ เขียนได้ — setup-env จัดการแล้ว
import { encryptField, decryptField } from '../src/services/field-crypto.service';

describe('F2 field-crypto (AES-256-GCM)', () => {
  test('roundtrip: เข้ารหัส → ถอดได้ค่าเดิม', () => {
    const secret = '123456:AAHxyz-EXAMPLE_token';
    const enc = encryptField(secret);
    assert.notEqual(enc, secret);
    assert.ok(enc.startsWith('enc:v1:'));
    assert.equal(decryptField(enc), secret);
  });

  test('ค่าเก่า plaintext (ยังไม่ migrate) ผ่านกลับได้ตามปกติ', () => {
    assert.equal(decryptField('old-plain-token'), 'old-plain-token');
    assert.equal(decryptField(null), '');
    assert.equal(decryptField(''), '');
  });

  test('เข้ารหัสซ้ำไม่ซ้อน (idempotent ต่อค่าที่ enc แล้ว)', () => {
    const enc = encryptField('secret-value');
    assert.equal(encryptField(enc), enc);
  });

  test('แก้ไข ciphertext = ถอดไม่ได้ แต่ไม่ crash (คืนว่าง → ผู้ใช้ตั้งใหม่)', () => {
    const enc = encryptField('secret-value');
    const tampered = enc.slice(0, -4) + 'AAAA';
    assert.equal(decryptField(tampered), '');
  });

  test('ค่าว่างไม่ถูกห่อ', () => {
    assert.equal(encryptField(''), '');
  });

  test('iv สุ่มทุกครั้ง (ciphertext คนละแบบแม้ค่าเดิม)', () => {
    assert.notEqual(encryptField('same'), encryptField('same'));
  });
});
