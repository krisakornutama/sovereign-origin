import { test, expect } from '@playwright/test';

// ── หน้า /settings หลังแยก component (OfflineQueuePanel · Telegram · MFA · Voice) ──
// กันการแตกของการ refactor: ถ้า component ไหนหลุด/พัง import หน้า settings จะไม่ขึ้น
// ใช้ storageState จาก auth.setup (ล็อกอินจริงผ่าน API + บัญชี e2e ที่เปิดชั่วคราว)

test.describe('settings — section หลัก', () => {
  test('แสดงครบทุก section หลังแยก component', async ({ page }) => {
    await page.goto('/settings/');

    // heading ของแต่ละ panel (ข้อความมาจาก i18n th)
    await expect(page.getByText('คิว Offline', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Telegram Alerts', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('2FA / MFA', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('พูดคุยอัตโนมัติ', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Export & Clone', { exact: false }).first()).toBeVisible();
  });

  test('คิวออฟไลน์: แสดง empty state หรือตาราง (ไม่ค้างที่ loading)', async ({ page }) => {
    await page.goto('/settings/');
    const queueSection = page.locator('section', { hasText: 'คิว Offline' }).first();
    await expect(queueSection).toBeVisible({ timeout: 30_000 });

    const empty = queueSection.getByText('ไม่มี action ค้าง', { exact: false });
    const rows = queueSection.locator('tbody tr');
    // อย่างใดอย่างหนึ่งต้องมี — ไม่ปล่อยให้เป็น section เปล่าที่แปลว่า component ไม่ mount
    await expect
      .poll(async () => (await empty.count()) + (await rows.count()), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('แท็บและช่องค้นหาของหน้าตั้งค่ายังใช้งานได้', async ({ page }) => {
    await page.goto('/settings/');
    await expect(page.getByPlaceholder('ค้นหาตั้งค่า...')).toBeVisible({ timeout: 30_000 });
    for (const label of ['ทั่วไป', 'การเชื่อมต่อ', 'แอป & ข้อมูล', 'ความปลอดภัย']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
    // ปุ่ม "รีเซ็ตทั้งหมด" อยู่ท้ายหน้า — ยืนยันว่าเนื้อหาหน้ายังครบ (ไม่กด เพราะจะล้างค่าจริง)
    await expect(page.getByRole('button', { name: /รีเซ็ตการตั้งค่าทั้งหมด/ })).toHaveCount(1);
  });
});
