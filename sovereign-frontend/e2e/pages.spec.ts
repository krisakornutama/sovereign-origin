import { test, expect } from '@playwright/test';

// ── หน้าหลักหลังล็อกอิน: render ครบ ไม่มีหน้าไหนพัง (คลาสบั๊ก .map is not a function) ──
// ใช้ storageState จาก auth.setup.ts

test('dashboard เปิดได้และมีเนื้อหา', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByText('SOVEREIGN').first()).toBeVisible();
  await expect(page.locator('main').first()).toBeVisible();
});

test('หน้า OTA เปิดได้ — regression บั๊ก firmware.map (ต้องไม่พังแม้ backend ตอบผิดรูป)', async ({ page }) => {
  await page.goto('/ota');
  await expect(page.getByText('อัปเดต OTA').first()).toBeVisible();
  // รอข้อมูลโหลด (poll ทุก 5s) แล้วหน้าต้องยังอยู่ ไม่มี Application error
  await page.waitForTimeout(6000);
  await expect(page.getByText('Application error')).toHaveCount(0);
});

test('หน้า POS ร้านอาหารเปิดได้', async ({ page }) => {
  await page.goto('/restaurant');
  await expect(page.getByText('ร้านอาหาร — POS จักรวรรดิ').first()).toBeVisible();
});

test('หน้าครัว IOT เปิดได้', async ({ page }) => {
  await page.goto('/restaurant/kitchen');
  await expect(page.getByText('ครัว IOT — น้ำหนัก + ตู้เย็น').first()).toBeVisible();
});

test('หน้ารายงานร้านอาหารเปิดได้', async ({ page }) => {
  await page.goto('/restaurant/reports');
  await expect(page.getByText('รายงานร้านอาหาร').first()).toBeVisible();
});

test('หน้าคลังความรู้ (หลังแตกไฟล์) เปิดได้', async ({ page }) => {
  await page.goto('/knowledge');
  await expect(page.getByText('คลังความรู้').first()).toBeVisible({ timeout: 20_000 });
});
