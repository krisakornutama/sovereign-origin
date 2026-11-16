// SEC-045: SSRF guard สำหรับ URL ที่ผู้ใช้ส่งมาให้เซิร์ฟเวอร์ไป fetch
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeUrl, assertPublicHttpUrl, isPrivateAddress } from '../src/lib/ssrf-guard';

test('analyzeUrl: ปล่อย URL สาธารณะผ่าน', () => {
  for (const ok of [
    'https://huggingface.co/model.gguf',
    'http://1.1.1.1/file.bin',
    'https://8.8.8.8:8443/a',
  ]) {
    const v = analyzeUrl(ok);
    assert.equal(v.ok, true, ok);
  }
});

test('analyzeUrl: ปฏิเสธ loopback / private / link-local (พร้อม scheme ที่ไม่ใช่ http)', () => {
  const blocked = [
    'http://127.0.0.1:3001/api/health',
    'http://127.1.2.3/x',
    'http://localhost/x',
    'http://localhost:11434/api/tags',
    'http://foo.localhost/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/x',
    'http://172.16.4.4/x',
    'http://192.168.1.1/x',
    'http://0.0.0.0/x',
    'http://100.64.0.1/x',
    'http://[::1]/x',
    'http://[fe80::1]/x',
    'http://[fd00::1]/x',
    'http://[::ffff:127.0.0.1]/x',
    'ftp://example.com/x',
    'file:///etc/passwd',
    'http://user:pass@example.com/x',
    'not a url',
  ];
  for (const bad of blocked) {
    const v = analyzeUrl(bad);
    assert.equal(v.ok, false, bad);
  }
});

test('isPrivateAddress: ครอบช่วงสำคัญ', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('169.254.169.254'), true);
  assert.equal(isPrivateAddress('172.31.255.255'), true);
  assert.equal(isPrivateAddress('172.32.0.1'), false);
  assert.equal(isPrivateAddress('1.1.1.1'), false);
  assert.equal(isPrivateAddress('2606:4700::1111'), false);
});

test('assertPublicHttpUrl: literal IP ภายในถูกปฏิเสธก่อนแตะ network', async () => {
  const v = await assertPublicHttpUrl('http://127.0.0.1:3001/x');
  assert.equal(v.ok, false);
});

test('assertPublicHttpUrl: hostname ที่ resolve ไม่ได้ถูกปฏิเสธ (fail-closed)', async () => {
  const v = await assertPublicHttpUrl('http://this-host-does-not-exist.invalid/x.gguf');
  assert.equal(v.ok, false);
});
