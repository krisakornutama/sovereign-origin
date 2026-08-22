import { test, expect, request } from '@playwright/test';
import { spawnSync } from 'node:child_process';

/** รัน SQL ใน container ผ่าน stdin — เลี่ยงปัญหา quoting อักขระไทย/quotes บน Windows shell */
function psql(sql: string): boolean {
  const r = spawnSync(
    'docker',
    ['exec', '-i', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign_v2'],
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

/** ลบร้าน/เมนู/ออเดอร์ทดสอบที่ค้างอยู่ (ใช้ทั้งก่อนสร้างและหลังจบ) — ถ้า docker ไม่อยู่ = ข้าม */
function cleanupDb() {
  if (!restaurantId) return;
  const sql = `delete from restaurant_order_lines where "orderId" in (select id from restaurant_orders where "restaurantId"='${restaurantId}');
delete from restaurant_orders where "restaurantId"='${restaurantId}';
delete from recipe_lines where "menuId"='${menuId}';
delete from menu_items where "restaurantId"='${restaurantId}';
delete from restaurants where id='${restaurantId}';`;
  if (!psql(sql)) console.error('[e2e] เคลียร์ข้อมูลทดสอบไม่สำเร็จ (docker/psql อาจไม่พร้อม)');
}

/** ลบร้านชื่อซ้ำจากรอบก่อน (ทำให้ suite รันซ้ำกี่รอบก็สะอาด) */
function cleanupByName() {
  const sql = `delete from restaurant_order_lines where "orderId" in (select o.id from restaurant_orders o join restaurants r on r.id=o."restaurantId" where r.name='${REST_NAME}');
delete from restaurant_orders where "restaurantId" in (select id from restaurants where name='${REST_NAME}');
delete from recipe_lines where "menuId" in (select m.id from menu_items m join restaurants r on r.id=m."restaurantId" where r.name='${REST_NAME}');
delete from menu_items where "restaurantId" in (select id from restaurants where name='${REST_NAME}');
delete from restaurants where name='${REST_NAME}';`;
  psql(sql);
}

test.beforeAll(async () => {
  cleanupByName();
  const ctx = await request.newContext({ baseURL: API });
  const login = await ctx.post('/api/auth/login', {
    data: { username: 'e2e-bot', password: 'E2E-Sovereign-Run-2026!' },
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
