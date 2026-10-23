import './setup-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MANUAL_SLIP_ADAPTER,
  SlipError,
  amountToSatang,
  detectSlipMime,
  normalizeProvider,
  normalizeTransRef,
} from '../src/services/payment-slip.service';

describe('payment slip validation (pure)', () => {
  test('ตรวจ magic bytes ของ PNG/JPEG/WebP และปฏิเสธไฟล์อื่น', () => {
    assert.equal(detectSlipMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
    assert.equal(detectSlipMime(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
    assert.equal(detectSlipMime(Buffer.from('RIFF0000WEBP', 'latin1')), 'image/webp');
    assert.equal(detectSlipMime(Buffer.from('not an image')), null);
  });

  test('amount → สตางค์แบบจำนวนเต็ม และปฏิเสธค่าที่ไม่ปลอดภัย', () => {
    assert.equal(amountToSatang('123.45'), 12345);
    assert.equal(amountToSatang('1,234.50'), 123450);
    assert.equal(amountToSatang(0.1), 10);
    assert.throws(() => amountToSatang('0'), SlipError);
    assert.throws(() => amountToSatang('-1'), SlipError);
    assert.throws(() => amountToSatang('abc'), SlipError);
    assert.throws(() => amountToSatang('10000001'), SlipError);
  });

  test('provider/transRef ถูก normalize และปฏิเสธค่าที่เกินกติกา', () => {
    assert.equal(normalizeProvider(' manual '), 'MANUAL');
    assert.equal(normalizeProvider(undefined), 'MANUAL');
    assert.throws(() => normalizeProvider('bad provider!'), SlipError);
    assert.equal(normalizeTransRef('  REF-1 '), 'REF-1');
    assert.equal(normalizeTransRef(''), null);
    assert.throws(() => normalizeTransRef('x'.repeat(121)), SlipError);
  });

  test('MANUAL adapter ไม่เรียกเครือข่ายและคืนค่าว่าง', async () => {
    assert.equal(MANUAL_SLIP_ADAPTER.key, 'MANUAL');
    assert.deepEqual(await MANUAL_SLIP_ADAPTER.read({ image: Buffer.from('x'), mime: 'image/png' }), {});
  });
});
