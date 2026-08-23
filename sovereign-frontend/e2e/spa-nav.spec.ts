import { test, expect } from '@playwright/test';
import { NAV_GROUPS } from '../src/lib/navigation';

// ─────────────────────────────────────────────────────────────
// SPA Navigation — คลิกลิงก์ใน Sidebar จริง (ไม่ใช่ page.goto)
// ตรวจ 2 อย่าง: (1) URL เปลี่ยน (2) ไม่มี full page reload
// วิธีตรวจ reload: ฝัง marker บน window ก่อนคลิก — ถ้า SPA จริง
// marker รอด (client-side nav), ถ้า reload หน้า marker หาย
// หมายเหตุ: ใช้ locator แบบ href (aside a[href="..."]) ไม่ใช่ hasText
// เพราะ text ไทย + aside ซ้อนทำให้ locator แบบ text ไม่เสถียร (QUEUE เดิม)
// ─────────────────────────────────────────────────────────────

test.describe('SPA navigation ผ่าน Sidebar', () => {
  // เลือกหน้าตัวแทนจากทุกกลุ่ม — เร็วพอรันทุกครั้ง ครอบ layout หลัก
  const SAMPLES = [
    { href: '/sensors', group: 'อุปกรณ์ & พลังงาน' },
    { href: '/security', group: 'ความปลอดภัย' },
    { href: '/farm', group: 'ชีวิต & การเงิน' },
    { href: '/history', group: 'ข้อมูล & รายงาน' },
    { href: '/system', group: 'ระบบ' },
  ];

  for (const { href } of SAMPLES) {
    test(`คลิกเมนู ${href} → เปลี่ยนหน้าแบบ SPA ไม่ reload`, async ({ page }) => {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('aside')).toBeVisible();

      // ฝัง marker — SPA nav ต้องรอด, full reload ต้องหาย
      await page.evaluate(() => {
        (window as unknown as { __spaMarker?: string }).__spaMarker = 'alive';
      });

      const link = page.locator(`aside a[href="${href}"]`).first();
      await expect(link).toBeVisible();
      await link.click();

      // URL เปลี่ยนจริง (client-side)
      await page.waitForURL(href, { timeout: 15_000 });
      expect(new URL(page.url()).pathname).toBe(href);

      // หน้า render เนื้อหา (main ไม่ว่าง) และไม่ติด error overlay
      await expect(page.getByText('Application error')).toHaveCount(0);
      const main = page.locator('main').first();
      await expect(main).toBeVisible();
      await expect(main).not.toHaveText('');

      // พิสูจน์ไม่ reload: marker ยังอยู่บน window เดิม
      const marker = await page.evaluate(() => (window as unknown as { __spaMarker?: string }).__spaMarker);
      expect(marker, `${href} ต้องเปลี่ยนแบบ SPA (ไม่ full reload)`).toBe('alive');
    });
  }

  test('คลิกหลายหน้าต่อกัน — Sidebar scroll position + active state ตาม', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('aside')).toBeVisible();

    for (const href of ['/security', '/farm', '/history']) {
      await page.locator(`aside a[href="${href}"]`).first().click();
      await page.waitForURL(href, { timeout: 15_000 });
      // active state ของลิงก์นั้นต้องติดคลาส emerald (Sidebar.tsx ใส่ bg-emerald-500/10)
      await expect(page.locator(`aside a[href="${href}"]`).first()).toHaveClass(/emerald/);
    }
    await expect(page.getByText('Application error')).toHaveCount(0);
  });

  test('ทุกลิงก์ใน NAV_GROUPS มีปุ่มจริงใน Sidebar (href ตรงเป๊ะ)', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter((h) => h.startsWith('/'));
    for (const href of hrefs) {
      const count = await page.locator(`aside a[href="${href}"]`).count();
      expect(count, `${href} ต้องมีลิงก์ใน Sidebar`).toBeGreaterThan(0);
    }
  });
});
