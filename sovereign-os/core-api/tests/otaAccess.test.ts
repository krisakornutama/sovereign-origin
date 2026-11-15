// ─────────────────────────────────────────────────────────────
// OTA access policy — ทดสอบ "ใครโหลดเฟิร์มแวร์ได้" และ "ให้ deploy ไปที่ URL แบบไหนได้"
//
// ของเดิม: `GET /firmwares/:file` เปิดให้ใครก็ได้เมื่อไม่ได้ตั้ง OTA_TOKEN (ค่าเริ่มต้น)
// ⇒ ใครที่เข้าถึง API ได้ก็ดาวน์โหลดเฟิร์มแวร์ทั้งคลัง (และรู้ว่ามีรุ่นอะไรให้โจมตี)
// และการเทียบ token ใช้ `!==` (เทียบทีละไบต์จนเจอต่าง — จับเวลาเดาได้)
// ─────────────────────────────────────────────────────────────
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import {
  checkDeployBaseUrl,
  isDownloadAllowed,
  secureTokenMatch,
} from '../src/modules/ota/ota.access';
import { isPrivatePeer } from '../src/lib/net';

test('isPrivatePeer: รู้จักวง LAN/loopback/link-local และไม่หลงกับ IP สาธารณะ', () => {
  for (const ip of [
    '127.0.0.1',
    '::1',
    '10.0.0.7',
    '172.16.5.4',
    '172.31.255.254',
    '192.168.1.20',
    '169.254.10.10',
    '::ffff:192.168.0.2',
    'fe80::1',
    'fd00::abcd',
  ]) {
    assert.equal(isPrivatePeer(ip), true, `${ip} ต้องถือว่าอยู่ในวงภายใน`);
  }
  for (const ip of ['', '8.8.8.8', '203.0.113.9', '172.32.0.1', '2001:4860:4860::8888']) {
    assert.equal(isPrivatePeer(ip), false, `${ip} ต้องไม่ถือว่าอยู่ในวงภายใน`);
  }
});

test('secureTokenMatch: เทียบแบบคงเวลา และไม่ตั้ง token = ไม่ผ่านเสมอ', () => {
  assert.equal(secureTokenMatch('s3cret', 's3cret'), true);
  assert.equal(secureTokenMatch('s3cres', 's3cret'), false);
  assert.equal(secureTokenMatch('s3cret-longer', 's3cret'), false);
  assert.equal(secureTokenMatch('', ''), false, 'ไม่ได้ตั้ง OTA_TOKEN ⇒ ห้ามถือว่าผ่าน');
  assert.equal(secureTokenMatch(null, 's3cret'), false);
  assert.equal(secureTokenMatch('s3cret', null), false);
});

test('isDownloadAllowed: ไม่ตั้ง token ⇒ เปิดเฉพาะวงภายใน, ตั้ง token ⇒ ต้องส่งให้ตรง', () => {
  // ไม่ตั้ง token (ค่าเริ่มต้นของระบบเดิม = เปิดโล่ง) — ตอนนี้ต้องปิดประตูสู่สาธารณะ
  assert.equal(isDownloadAllowed({ peer: '8.8.8.8', configuredToken: '', providedToken: null }), false);
  assert.equal(isDownloadAllowed({ peer: '192.168.1.30', configuredToken: '', providedToken: null }), true);
  assert.equal(isDownloadAllowed({ peer: '127.0.0.1', configuredToken: '', providedToken: null }), true);

  // ตั้ง token แล้ว: LAN ก็ยังต้องมี token (ไม่ใช่ผ่านเพราะอยู่ในวง)
  assert.equal(isDownloadAllowed({ peer: '192.168.1.30', configuredToken: 'abc', providedToken: null }), false);
  assert.equal(isDownloadAllowed({ peer: '192.168.1.30', configuredToken: 'abc', providedToken: 'abd' }), false);
  assert.equal(isDownloadAllowed({ peer: '192.168.1.30', configuredToken: 'abc', providedToken: 'abc' }), true);
});

test('checkDeployBaseUrl: URL ที่อุปกรณ์ต้องโหลดต้องไม่เป็น http สาธารณะ', () => {
  assert.equal(checkDeployBaseUrl('https://ota.example.com').ok, true);
  assert.equal(checkDeployBaseUrl('http://192.168.1.10:3001').ok, true);
  assert.equal(checkDeployBaseUrl('http://localhost:3001').ok, true);
  assert.equal(checkDeployBaseUrl('http://127.0.0.1:3999').ok, true);

  // http + host สาธารณะ = token/เฟิร์มแวร์วิ่งแบบอ่านได้กลางทาง ⇒ ปฏิเสธ
  const rejected = checkDeployBaseUrl('http://ota.example.com:3001');
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason || '', /https|วงภายใน/);

  assert.equal(checkDeployBaseUrl('ftp://192.168.1.10').ok, false);
  assert.equal(checkDeployBaseUrl('not a url').ok, false);
  assert.equal(checkDeployBaseUrl('').ok, false);
});
