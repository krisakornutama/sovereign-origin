import { test as setup, expect } from '@playwright/test';

// setup ครั้งเดียว: ล็อกอิน e2e-bot ผ่าน UI แล้วเก็บ localStorage (token) ให้ suite อื่นใช้
setup('authenticate as e2e-bot', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[autocomplete="username"]').fill('e2e-bot');
  await page.locator('input[autocomplete="current-password"]').fill('E2E-Sovereign-Run-2026!');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await expect(page).toHaveURL(/dashboard/);
  await page.context().storageState({ path: 'e2e/.auth/state.json' });
});
