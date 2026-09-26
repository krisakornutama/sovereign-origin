import { test, expect, request } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// self-contained credentials (เดียวกับ auth.setup — สาย task→nightly ไม่มีตัวโหลด env ให้ · มี fallback ไป MAIN)
function loadEnvPlaywright(): void {
  if (process.env.E2E_BOT_USER && process.env.E2E_BOT_PASS) return;
  const candidates = ['.env.playwright', '../../../../sovereign-frontend/.env.playwright'];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const k = line.slice(0, line.indexOf('=')).trim();
        let v = line.slice(line.indexOf('=') + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (k === 'E2E_BOT_USER' && !process.env.E2E_BOT_USER) process.env.E2E_BOT_USER = v;
        if (k === 'E2E_BOT_PASS' && !process.env.E2E_BOT_PASS) process.env.E2E_BOT_PASS = v;
      }
    } catch { continue; }
  }
}
loadEnvPlaywright();

/** รัน SQL ใน container ผ่าน stdin — เลี่ยงปัญหา quoting อักขระไทย/quotes บน Windows shell */
function psql(sql: string): boolean {
  const r = spawnSync(
    'docker',
    // DB จริงชื่อ sovereign — เดิมเขียน sovereign_v2 (ไม่มีอยู่!) → cleanup เงียบมาตลอด (H7)
    // ทิ้งร้าน 'E2E-ทดสอบอัตโนมัติ' ซ้ำใน DB จริง → option ซ้ำ → suite พังตอน 27/9 04:50
    ['exec', '-i', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign'],
    { input: sql, encoding: 'utf8' }
  );
  return r.status === 0;
}

// ── POS flow เต็มวงจรผ่าน UI จริง ──
// beforeAll: สร้างร้าน+เมนูผ่าน API (e2e-bot) → เทสต์เลือกร้าน เพิ่มตะกร้า จ่ายเงิน
// afterAll: ลบข้อมูลทดสอบผ่าน psql ใน container (ถ้า docker ไม่อยู่ = ข้าม ทิ้งไว้ไม่เป็นพิษ)

const REST_NAME = 'E2E-ทดสอบอัตโนมัติ';
const MENU_NAME = 'ข้าวผัด E2E';
const API = 'http://localhost:3001';

let restaurantId = '';
let menuId = '';

/** ลบร้าน/เมนู/ออเดอร์ทดสอบที่ค้างอยู่ (ใช้ทั้งก่อนสร้างและหลังจบ) — คืน true เมื่อ psql สำเร็จ */
function cleanupDb(): boolean {
  if (!restaurantId) return true; // ไม่มีอะไรให้ลบ = สำเร็จโดยดุษณี
  const sql = `delete from restaurant_order_lines where "orderId" in (select id from restaurant_orders where "restaurantId"='${restaurantId}');
delete from restaurant_orders where "restaurantId"='${restaurantId}';
delete from recipe_lines where "menuId"='${menuId}';
delete from menu_items where "restaurantId"='${restaurantId}';
delete from restaurants where id='${restaurantId}';`;
  const ok = psql(sql);
  if (!ok) console.error('[e2e] เคลียร์ข้อมูลทดสอบไม่สำเร็จ (docker/psql อาจไม่พร้อม)');
  return ok;
}

/** ลบร้านชื่อซ้ำจากรอบก่อน (ทำให้ suite รันซ้ำกี่รอบก็สะอาด) — คืน true เมื่อ psql สำเร็จ */
function cleanupByName(): boolean {
  const sql = `delete from restaurant_order_lines where "orderId" in (select o.id from restaurant_orders o join restaurants r on r.id=o."restaurantId" where r.name='${REST_NAME}');
delete from restaurant_orders where "restaurantId" in (select id from restaurants where name='${REST_NAME}');
delete from recipe_lines where "menuId" in (select m.id from menu_items m join restaurants r on r.id=m."restaurantId" where r.name='${REST_NAME}');
delete from menu_items where "restaurantId" in (select id from restaurants where name='${REST_NAME}');
delete from restaurants where name='${REST_NAME}';`;
  return psql(sql);
}

test.beforeAll(async () => {
  // cleanup ต้องสำเร็จจริง — เคสจริง 27/9: psql ล่มช่วงหนึ่ง → ลบไม่ได้ → option ร้านซ้ำ 2 รายการ
  // ทำให้ toHaveCount(1) fail ทั้ง suite (H7) — retry 3 รอบแล้ว throw ไม่เงียบ
  let cleaned = false;
  for (let i = 0; i < 3 && !cleaned; i++) {
    cleaned = cleanupByName();
    if (!cleaned) await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!cleaned) throw new Error('[e2e] cleanup ร้านทดสอบไม่สำเร็จ 3 รอบ — psql/docker ไม่พร้อม');
  const ctx = await request.newContext({ baseURL: API });
  const login = await ctx.post('/api/auth/login', {
    data: { username: process.env.E2E_BOT_USER ?? 'e2e-bot', password: process.env.E2E_BOT_PASS ?? '' },
  });
  const token = (await login.json()).token;
  const H = { Authorization: `Bearer ${token}` };

  const r = await ctx.post('/api/restaurant', { headers: H, data: { name: REST_NAME } });
  restaurantId = (await r.json()).id;
  const m = await ctx.post('/api/restaurant/menus', {
    headers: H,
    data: { restaurantId, name: MENU_NAME, priceTHB: 50 },
  });
  menuId = (await m.json()).id;
  await ctx.dispose();
});

test.afterAll(() => {
  cleanupDb();
});

test('สั่งออเดอร์และจ่ายเงินผ่านหน้า POS จริง', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/restaurant');

  // เลือกร้านทดสอบใน dropdown (option label = "ชื่อร้าน [cam:..]" — ใช้ label ตรง)
  const select = page.locator('select').first();
  await select.waitFor({ state: 'visible' });
  const option = select.locator('option', { hasText: REST_NAME });
  await expect(option).toHaveCount(1, { timeout: 10_000 });
  await select.selectOption({ label: await option.textContent() });

  // รอเมนูโหลด แล้วกดการ์ดเมนูเพิ่มลงตะกร้า
  const menuCard = page.getByRole('button', { name: new RegExp(MENU_NAME) });
  await expect(menuCard).toBeVisible({ timeout: 15_000 });
  await menuCard.click();

  // ตะกร้ามีรายการ (ยอด 50 บาทจะยืนยันผ่านข้อความสำเร็จหลังจ่าย)
  await expect(page.getByText('ตะกร้า (1)')).toBeVisible();

  // จ่ายเงิน/ปิดบิล
  await page.getByRole('button', { name: /จ่ายเงิน \/ ปิดบิล/ }).click();
  // ข้อความสำเร็จ: "ออเดอร์ ORD-... สำเร็จ 50 บาท ..."
  await expect(page.getByText(/สำเร็จ 50/).first()).toBeVisible({ timeout: 15_000 });
});
