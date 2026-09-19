// ตรวจ prod :3000 จริง — หน้า /audit ต้องแสดงช่องค้นหา + ปุ่มกรอง + ไฮไลต์ + ผล q จริง
// session: mint แบบ read-only (30 นาที) โหลดจากไฟล์ — ไม่พิมพ์ token/secret ที่ใด
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.PROD_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:3001';
const TOKEN = readFileSync('E:/My work/Project Sovereign Origin/.freebuff/prod-session.jwt', 'utf8').trim();

let failures = [];
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) failures.push(name); };

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: 'th-TH' });
  // ใส่ session ก่อนทุก script ของหน้า → ไม่มี hydration race
  await context.addInitScript((token) => {
    localStorage.setItem('sovereign-auth', JSON.stringify({ state: { token }, version: 0 }));
  }, TOKEN);
  const page = await context.newPage();

  await page.goto(`${BASE}/audit`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('tbody tr', { timeout: 20000 });
  await page.waitForTimeout(2000);

  ok('หน้า /audit โหลดและล็อกอินผ่าน (ไม่ติด Unauthorized)', !/Unauthorized/.test(await page.locator('body').innerText()));
  ok('มีช่องค้นหา', await page.locator('input[placeholder*="ค้น action"]').count() > 0);
  ok('มีปุ่ม "เรื่องรหัสผ่าน"', await page.locator('button', { hasText: 'เรื่องรหัสผ่าน' }).count() > 0);
  const rows0 = await page.locator('tbody tr').count();
  ok(`แสดง audit แถวจริง (${rows0} แถว)`, rows0 > 0);

  // กดปุ่มกรอง → ทุกแถวต้องเป็น USER_PASSWORD*
  await page.locator('button', { hasText: 'เรื่องรหัสผ่าน' }).click();
  await page.waitForTimeout(1500);
  const actions = await page.locator('tbody tr td:nth-child(3)').allInnerTexts();
  ok(`กรองแล้วเหลือเฉพาะ USER_PASSWORD (${actions.length} แถว)`, actions.length > 0 && actions.every((a) => a.startsWith('USER_PASSWORD')));

  // ค้น q= (ค้นคำใน payload/action แบบ case-insensitive)
  await page.locator('input[placeholder*="ค้น action"]').fill('user_password');
  await page.locator('button', { hasText: 'ค้นหา' }).first().click();
  await page.waitForTimeout(1500);
  const qRows = await page.locator('tbody tr').count();
  ok(`ค้นหา "user_password" (ตัวเล็ก) เจอ (${qRows} แถว)`, qRows > 0);

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  ok('ไม่มี pageerror ในหน้า', errors.length === 0);
} finally {
  await browser.close().catch(() => {});
}
console.log(failures.length ? `=== FAIL ${failures.length} รายการ` : '=== ผ่านทั้งหมด (prod จริง)');
process.exit(failures.length ? 1 : 0);
