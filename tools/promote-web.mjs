#!/usr/bin/env node
// ยืนยันว่า production build ที่เพิ่งสลับเข้าไป "ไม่มี chunk 404"
//
// ทำไมต้องมี: ตอนสลับ `.next` (build ใหม่) ถ้า HTML อ้าง chunk ของ build เก่า
// หรือ service worker precache ชุดเก่า ผู้ใช้จะเห็นหน้าเปล่า/ค้าง "กำลังโหลด..."
// โดยไม่มี error ให้จับ (เจอจริง 22/10/69: build เขียนทับ .next โดยไม่ restart)
//
// วิธีใช้ (รันหลังสลับ .next และ start prod แล้วเท่านั้น):
//   node tools/promote-web.mjs --check                 # ตรวจ http://127.0.0.1:3000
//   node tools/promote-web.mjs --check http://host:3000
//
// ตรวจ: (1) หน้าเป้าหมายตอบ 200 (2) ทุก URL `/_next/static/...` ที่ HTML อ้าง
// ตอบ 200 (3) ทุกไฟล์ใน public/sw-precache.json ตอบ 200 (ชุดที่ SW จะ precache)
//
// หมายเหตุ: หน้าที่ยังเป็น 404 ตามดีไซน์ (เช่น /login/ ซึ่งแอปไม่มี) ข้ามชื่อได้
import { pathToFileURL } from 'node:url';

/** หน้าเว็บหลักที่ต้องเสิร์ฟได้หลังสลับ (ไม่รวม /login/ — แอปนี้ไม่มีหน้านั้น) */
export const PROMOTE_PAGES = ['/', '/dashboard/', '/security/', '/sensors/', '/relay/'];

/**
 * ดึง URL asset ของ Next ออกจาก HTML
 * ⚠️ ต้องไม่ตัดที่ตัวเลข/x/2/7 — เคยเขียน char class พลาดแล้วตัดชื่อ chunk ขาด
 * กลายเป็น 404 ปลอมทั้งชุด
 */
export function extractStaticUrls(html) {
  const found = String(html).match(/\/_next\/static\/[A-Za-z0-9_./~-]+/g) || [];
  return [...new Set(found)];
}

/** รวม URL จากหลายหน้า + sw-precache.json (รองรับทั้งรูป string และ {url}) */
export function collectPrecacheUrls(json) {
  const list = (json && (json.urls || json.assets)) || [];
  return list.map((a) => (typeof a === 'string' ? a : a.url)).filter(Boolean);
}

/** ตรวจทีละ URL — คืนรายการที่ "ไม่ 200" พร้อมสถานะ */
export async function findBrokenUrls(baseUrl, urls, fetchImpl = fetch) {
  const broken = [];
  for (const u of urls) {
    const res = await fetchImpl(baseUrl + u);
    if (res.status !== 200) broken.push({ url: u, status: res.status });
  }
  return broken;
}

async function check(baseUrl) {
  const urls = new Set();
  const failedPages = [];
  for (const p of PROMOTE_PAGES) {
    const res = await fetch(baseUrl + p);
    if (res.status !== 200) failedPages.push({ page: p, status: res.status });
    for (const u of extractStaticUrls(await res.text())) urls.add(u);
  }

  const swRes = await fetch(baseUrl + '/sw-precache.json');
  if (!swRes.ok) return { ok: false, reason: `sw-precache.json = ${swRes.status}` };
  const swUrls = collectPrecacheUrls(await swRes.json());
  for (const u of swUrls) urls.add(u);

  const broken = await findBrokenUrls(baseUrl, [...urls]);
  const ok = failedPages.length === 0 && broken.length === 0;
  return { ok, checked: urls.size, swPrecache: swUrls.length, failedPages, broken };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== '--check') {
    console.log('ใช้: node tools/promote-web.mjs --check [baseUrl]');
    process.exit(2);
  }
  const baseUrl = (args[1] || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const result = await check(baseUrl);
  if (result.reason) {
    console.error(`✗ ${result.reason}`);
    process.exit(1);
  }
  for (const f of result.failedPages) console.error(`✗ หน้า ${f.page} = ${f.status}`);
  for (const b of result.broken.slice(0, 15)) console.error(`✗ chunk ${b.url} = ${b.status}`);
  console.log(
    `ตรวจ ${result.checked} static URLs (sw precache ${result.swPrecache}) — ` +
      (result.ok ? 'ไม่มี chunk 404 ✅' : `พบปัญหา ${result.broken.length + result.failedPages.length} จุด`),
  );
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('✗ ตรวจไม่สำเร็จ:', e?.message || e);
    process.exit(1);
  });
}
