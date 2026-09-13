import { numberToThaiWords, bahtText } from './bahtText';
import assert from 'node:assert/strict';

// ── numberToThaiWords ──
assert.equal(numberToThaiWords(0), 'ศูนย์');
assert.equal(numberToThaiWords(1), 'หนึ่ง');
assert.equal(numberToThaiWords(2), 'สอง');
assert.equal(numberToThaiWords(6), 'หก');
assert.equal(numberToThaiWords(10), 'สิบ');
assert.equal(numberToThaiWords(11), 'สิบเอ็ด');
assert.equal(numberToThaiWords(20), 'ยี่สิบ');
assert.equal(numberToThaiWords(21), 'ยี่สิบเอ็ด');
assert.equal(numberToThaiWords(22), 'ยี่สิบสอง');
assert.equal(numberToThaiWords(100), 'หนึ่งร้อย');
assert.equal(numberToThaiWords(101), 'หนึ่งร้อยเอ็ด');
assert.equal(numberToThaiWords(111), 'หนึ่งร้อยสิบเอ็ด');
assert.equal(numberToThaiWords(120), 'หนึ่งร้อยยี่สิบ');
assert.equal(numberToThaiWords(321), 'สามร้อยยี่สิบเอ็ด');
assert.equal(numberToThaiWords(1000), 'หนึ่งพัน');
assert.equal(numberToThaiWords(1111), 'หนึ่งพันหนึ่งร้อยสิบเอ็ด');
assert.equal(numberToThaiWords(3210), 'สามพันสองร้อยสิบ');
assert.equal(numberToThaiWords(1_000_000), 'หนึ่งล้าน');
assert.equal(numberToThaiWords(1_111_111), 'หนึ่งล้านหนึ่งแสนหนึ่งหมื่นหนึ่งพันหนึ่งร้อยสิบเอ็ด');
assert.equal(numberToThaiWords(1_100_000), 'หนึ่งล้านหนึ่งแสน');
assert.equal(numberToThaiWords(2_500_000), 'สองล้านห้าแสน');
// rising ล้าน: กลุ่มว่างในกลางต้องเลื่อนถูกตัว
assert.equal(numberToThaiWords(1_000_001), 'หนึ่งล้านเอ็ด');
assert.equal(numberToThaiWords(1_000_000_000_000 + 1), 'หนึ่งล้านล้านเอ็ด');

// ── bahtText ──
assert.equal(bahtText(0), 'ศูนย์บาทถ้วน');
assert.equal(bahtText(32100), 'สามหมื่นสองพันหนึ่งร้อยบาทถ้วน');
assert.equal(bahtText(4140), 'สี่พันหนึ่งร้อยสี่สิบบาทถ้วน');
assert.equal(bahtText(121.5), 'หนึ่งร้อยยี่สิบเอ็ดบาทจุดห้าสิบสตางค์');
assert.equal(bahtText(52.25), 'ห้าสิบสองบาทจุดยี่สิบห้าสตางค์');
assert.equal(bahtText(0.25), 'จุดยี่สิบห้าสตางค์');
assert.equal(bahtText(-80.5), 'แปดสิบบาทจุดห้าสิบสตางค์');
// FP rounding: 0.1+0.2 แบบ float จะได้สตางค์ 30
assert.equal(bahtText(0.1 + 0.2), 'จุดสามสิบสตางค์');
// rounding สตางค์ที่แทนใน float ได้จริง (1.005 เป็น 1.00499… ใน binary — ไม่ใช้เป็นเคส)
assert.equal(bahtText(1.01), 'หนึ่งบาทจุดหนึ่งสตางค์');

console.log('bahtText: all', 31, 'assertions passed');
