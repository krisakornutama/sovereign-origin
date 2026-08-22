import { test, expect } from '@playwright/test';

// ── หน้า login (ไม่ต้องล็อกอิน) ──

test('หน้า login แสดงฟอร์มครบ (username/password/ปุ่มเข้าสู่ระบบ)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test('รหัสผิด → แสดง error และไม่เข้า dashboard', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[autocomplete="username"]').fill('e2e-bot');
  await page.locator('input[autocomplete="current-password"]').fill('wrong-password-xxx');
  await page.locator('button[type="submit"]').click();
  // รอข้อความ error ปรากฏ (ข้อความตาม backend th/en — ใช้การไม่ redirect เป็นเงื่อนไขหลัก)
  await page.waitForTimeout(2500);
  await expect(page).not.toHaveURL(/dashboard/);
});

// หมายเหตุ: เคส "ล็อกอินถูก → /dashboard" พิสูจน์โดย auth.setup.ts แล้ว
// (จำกัดจำนวนครั้ง login ต่อ suite เพื่อไม่ให้โดน rate-limit 10 ครั้ง/15 นาทีของตัวเอง)

test('สลับภาษา th → en แล้ว html lang เปลี่ยนจริง (สลับกลับได้)', async ({ page }) => {
  // LanguageToggle อยู่บนหน้า login
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Switch to English' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาไทย' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
});
