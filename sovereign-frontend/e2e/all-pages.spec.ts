import { test, expect } from '@playwright/test';
import { NAV_GROUPS } from '../src/lib/navigation';

// ── กวาดทุกหน้าจากเมนูจริง (NAV_GROUPS) — จับ "หน้าไหนเข้าไม่ได้" + console/JS error อัตโนมัติ ──
// ใช้ SUPERADMIN (e2e-bot) ผ่าน feature gate ได้ทุกหน้า + ยกเว้นหน้า #hash sub-view
const pages = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter((href) => href.startsWith('/'));

// noise ที่ไม่ใช่บั๊กของเรา (env: ไม่มี Ollama / net::ERR_ABORTED จาก navigation) + vision 404 ชั่วคราว (known-faces empty)
const IGNORE = [/ECONNREFUSED/i, /net::ERR_ABORTED/i, /favicon/i, /ResizeObserver/i, /Download the React DevTools/i, /404.*vision/i, /Failed to load resource.*404/i];

test.describe('ทุกหน้าจากเมนูต้องเปิดได้', () => {
  for (const href of pages) {
    test(`${href} เปิดได้ ไม่พัง`, async ({ page }) => {
      test.setTimeout(30_000);
      const jsErrors: string[] = [];
      page.on('pageerror', (err) => jsErrors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !IGNORE.some((re) => re.test(msg.text()))) {
          jsErrors.push(`console: ${msg.text().slice(0, 200)}`);
        }
      });

      const res = await page.goto(href, { waitUntil: 'domcontentloaded' });
      // ต้องไม่ error ทั้งระดับ HTTP และระดับแอป (Next error overlay / หน้าเปล่า)
      expect(res?.status(), `HTTP ${href}`).toBeLessThan(400);
      await page.waitForTimeout(1500);
      expect(page.getByText('Application error'), `${href} พังตอน render`).toHaveCount(0);
      // หน้าที่ถูก NoAccessScreen/redirect กลับ login ถือว่าใช้ไม่ได้สำหรับ SUPERADMIN
      expect(page.url(), `${href} โดน redirect`).not.toContain('/?');
      const main = page.locator('main').first();
      if (await main.count()) {
        expect(await main.innerText()).not.toBe('');
      }
      // error ฝั่งเบราว์เซอร์ตอนใช้งานจริง (JS exception / console.error ที่ไม่ใช่ noise)
      expect(jsErrors, `${href} มี JS/console error:\n${jsErrors.join('\n')}`).toEqual([]);
    });
  }
});
