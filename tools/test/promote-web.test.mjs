#!/usr/bin/env node
// promote-web — ตัวตรวจ "ไม่มี chunk 404" หลังสลับ build
//
// เหตุผลที่ต้องมีไฟล์นี้: ตัวตรวจเองเคยพลาด เพราะ regex ตัดชื่อ chunk ขาด
// (char class ที่เผลอกันตัวเลข/x ออก) ⇒ รายงาน 404 ปลอมทั้งชุด
// เทสต์นี้จึงปักหมุดทั้ง "สกัด URL ได้ครบ" และ "จับ 404 จริงได้"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStaticUrls,
  collectPrecacheUrls,
  findBrokenUrls,
  PROMOTE_PAGES,
} from '../promote-web.mjs';

describe('extractStaticUrls', () => {
  test('ดึง chunk ที่มีตัวเลข/x/ขีด ได้ครบไม่ขาดกลาง', () => {
    const html = `
      <script src="/_next/static/chunks/0-8sc_8wsp3k4.js"></script>
      <script src="/_next/static/chunks/1up4-abc123.js"></script>
      <script src="/_next/static/chunks/35qn63pvhtfy.js"></script>
      <link href="/_next/static/css/7on9MGHwl70IV-KKjIjT8.css">
      <script src="/_next/static/j1lrePAhvZ55Q3-5wA-T4/_buildManifest.js"></script>`;
    const urls = extractStaticUrls(html);
    assert.ok(urls.includes('/_next/static/chunks/1up4-abc123.js'));
    assert.ok(urls.includes('/_next/static/chunks/35qn63pvhtfy.js'));
    assert.ok(urls.includes('/_next/static/css/7on9MGHwl70IV-KKjIjT8.css'));
    assert.ok(urls.includes('/_next/static/j1lrePAhvZ55Q3-5wA-T4/_buildManifest.js'));
  });

  test('ตัด URL ซ้ำออก', () => {
    const html = '<img src="/_next/static/a.png"><img src="/_next/static/a.png">';
    assert.deepEqual(extractStaticUrls(html), ['/_next/static/a.png']);
  });

  test('HTML ไม่มี asset → คืน []', () => {
    assert.deepEqual(extractStaticUrls('<html><body>hi</body></html>'), []);
  });
});

describe('collectPrecacheUrls', () => {
  test('อ่านรูป { urls: [...] } ของ generate-sw-precache', () => {
    assert.deepEqual(collectPrecacheUrls({ version: 1, urls: ['/a.js'] }), ['/a.js']);
  });

  test('อ่านรูป { assets: [{url}] } ได้ด้วย', () => {
    assert.deepEqual(collectPrecacheUrls({ assets: [{ url: '/b.js' }] }), ['/b.js']);
  });

  test('ไฟล์ว่าง/ผิดรูป → [] ไม่ throw', () => {
    assert.deepEqual(collectPrecacheUrls(null), []);
    assert.deepEqual(collectPrecacheUrls({}), []);
  });
});

describe('findBrokenUrls', () => {
  test('จับ 404 และปล่อย 200 ผ่าน', async () => {
    const fake = async (url) => ({ status: url.endsWith('ok.js') ? 200 : 404 });
    const broken = await findBrokenUrls('http://x', ['/ok.js', '/missing.js'], fake);
    assert.deepEqual(broken, [{ url: '/missing.js', status: 404 }]);
  });

  test('ทุกอย่าง 200 → ไม่มีปัญหา', async () => {
    const fake = async () => ({ status: 200 });
    assert.deepEqual(await findBrokenUrls('http://x', ['/a.js'], fake), []);
  });
});

describe('PROMOTE_PAGES', () => {
  test('ครอบ 3 หน้าหลักที่ Slice 2/3 แก้', () => {
    assert.ok(PROMOTE_PAGES.includes('/dashboard/'));
    assert.ok(PROMOTE_PAGES.includes('/security/'));
    assert.ok(PROMOTE_PAGES.includes('/sensors/'));
  });
});
