import { test as setup, expect } from '@playwright/test';

// setup ครั้งเดียว: ล็อกอิน e2e-bot ผ่าน UI แล้วเก็บ localStorage (token) ให้ suite อื่นใช้
// เพิ่ม timeout 3 นาทีสำหรับ setup นี้

setup('authenticate as e2e-bot', async ({ page }) => {
  await page.goto('/', { timeout: 60_000 });
  await page.locator('input[autocomplete="username"]').fill(process.env.E2E_BOT_USER ?? 'e2e-bot');
  await page.locator('input[autocomplete="current-password"]').fill(process.env.E2E_BOT_PASS ?? '');
  await page.locator('button[type="submit"]').click();
  // รอ redirect ไป dashboard - เพิ่ม timeout ให้พอ
  await page.waitForURL('**/dashboard', { timeout: 120_000 });
  // รอให้หน้าโหลดเสร็จ
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await expect(page).toHaveURL(/dashboard/);
  await page.context().storageState({ path: 'e2e/.auth/state.json' });
});