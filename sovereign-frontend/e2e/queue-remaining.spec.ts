import { test, expect } from '@playwright/test';

// QUEUE remaining coverage: selfreliance + restaurant/* + crisis/skills + system/wan
// ไม่ต้อง seed DB — แค่ตรวจหน้า render + i18n + ไม่ 500
const PAGES = [
  { href: '/selfreliance', title: /วันรอด|Days of Autonomy/ },
  { href: '/restaurant', title: /POS|ร้านอาหาร/ },
  { href: '/restaurant/admin', title: /เมนู|Menu/ },
  { href: '/restaurant/kitchen', title: /ครัว|Kitchen/ },
  { href: '/restaurant/reports', title: /รายงาน|Reports/ },
  { href: '/crisis', title: /Crisis|วิกฤต/ },
  { href: '/skills', title: /ทักษะ|Skills/ },
  { href: '/system', title: /ระบบ|System/ },
];

test.describe('คิวที่เหลือ — หน้าใหม่ต้อง render ไม่พัง + i18n', () => {
  for (const { href, title } of PAGES) {
    test(`${href} โหลดได้ + มีหัวข้อ`, async ({ page }) => {
      await page.goto(href, { waitUntil: 'domcontentloaded' });
      // ไม่ติด error overlay
      await expect(page.getByText('Application error')).toHaveCount(0);
      // heading ต้องตรง (ไทยหรืออังกฤษก็ได้)
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
    });
  }

  test('สลับภาษา th/en ที่ restaurant ต้องเปลี่ยนหัวข้อ', async ({ page }) => {
    await page.goto('/restaurant', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Application error')).toHaveCount(0);
    // ตั้ง EN แล้ว reload — หัวข้อต้องเป็นอังกฤษ
    await page.evaluate(() => localStorage.setItem('sovereign-lang', JSON.stringify({ state: { lang: 'en' } })));
    await page.reload({ waitUntil: 'domcontentloaded' });
    // รอ hydration
    await page.waitForTimeout(800);
    await expect(page.getByText(/Empire POS|Restaurant/ ).first()).toBeVisible({ timeout: 10000 });
    // กลับไทย
    await page.evaluate(() => localStorage.setItem('sovereign-lang', JSON.stringify({ state: { lang: 'th' } })));
  });
});
