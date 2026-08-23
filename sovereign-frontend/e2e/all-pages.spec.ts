import { test, expect } from '@playwright/test';
import { NAV_GROUPS } from '../src/lib/navigation';

// ── กวาดทุกหน้าจากเมนูจริง (NAV_GROUPS) — จับ "หน้าไหนเข้าไม่ได้" อัตโนมัติ ──
// ใช้ SUPERADMIN (e2e-bot) ผ่าน feature gate ได้ทุกหน้า + ยกเว้นหน้า #hash sub-view
const pages = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter((href) => href.startsWith('/'));

test.describe('ทุกหน้าจากเมนูต้องเปิดได้', () => {
  for (const href of pages) {
    test(`${href} เปิดได้ ไม่พัง`, async ({ page }) => {
      test.setTimeout(30_000);
      const res = await page.goto(href, { waitUntil: 'domcontentloaded' });
      // ต้องไม่ error ทั้งระดับ HTTP และระดับแอป (Next error overlay / หน้าเปล่า)
      expect(res?.status(), `HTTP ${href}`).toBeLessThan(400);
      await page.waitForTimeout(800);
      expect(page.getByText('Application error'), `${href} พังตอน render`).toHaveCount(0);
      // หน้าที่ถูก NoAccessScreen/redirect กลับ login ถือว่าใช้ไม่ได้สำหรับ SUPERADMIN
      expect(page.url(), `${href} โดน redirect`).not.toContain('/?');
      const main = page.locator('main').first();
      if (await main.count()) {
        expect(await main.innerText()).not.toBe('');
      }
    });
  }
});
