import { test, expect, type Page } from '@playwright/test';

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

// ── บันทึกจริง → ตรวจผ่าน API ──
// เจตนา: "component ขึ้น" ไม่พอ — ต้องพิสูจน์ว่าปุ่มบันทึกยังเรียก API จริงและค่าเข้า DB
// เลือก 2FA เพราะเป็นการตั้งค่า **ต่อผู้ใช้** (ไม่แตะ config ระดับเครื่อง) และปิดคืนได้ด้วย API เดียว
// ขั้นตอน: อ่านสถานะ → enroll → API ต้องเห็น pending → reload แล้ว UI ยังแสดง flow → disable คืนสภาพ
const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3001';

async function authToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('sovereign-auth');
    if (raw) {
      try {
        const t = JSON.parse(raw)?.state?.token;
        if (typeof t === 'string' && t) return t;
      } catch {
        // ไม่ใช่ JSON — ลองคีย์ตรง
      }
    }
    return localStorage.getItem('sovereign-token') ?? '';
  });
  expect(token, 'ต้องมี token ใน localStorage (มาจาก auth.setup)').toBeTruthy();
  return token;
}

test.describe('settings — บันทึกค่าจริงและตรวจผ่าน API', () => {
  test('เปิด 2FA: API เห็น pending, reload ยังแสดง flow, แล้วปิดคืนสภาพ', async ({ page, request }) => {
    test.setTimeout(120_000);
    // หน้าเว็บเรียก API ผ่าน same-origin proxy ของ Next (`/api/*` → core-api)
    // ถ้าไม่ตั้งค่านี้ getApiUrl() จะใช้ http://localhost:3001 ซึ่ง CORS ของ core-api
    // อนุญาตเฉพาะ :3000 → browser บล็อก POST (เห็น preflight 204 แต่ไม่มี POST ตามมา)
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sovereign-api-url', window.location.origin);
      } catch {
        // about:blank — ข้าม
      }
    });
    await page.goto('/settings/');
    const token = await authToken(page);
    const headers = { Authorization: `Bearer ${token}` };
    const statusUrl = `${API_BASE}/api/auth/mfa/status`;
    const readStatus = async () => (await request.get(statusUrl, { headers })).json();

    const before = await readStatus();
    test.skip(before.enabled === true, 'บัญชีนี้เปิด 2FA อยู่ — ไม่แตะเพื่อกัน lockout');

    const section = page.locator('section', { hasText: '2FA / MFA' }).first();
    await expect(section).toBeVisible({ timeout: 30_000 });

    try {
      await section.getByRole('button', { name: /ตั้งค่า 2FA ใหม่/ }).click();
      // คีย์ base32 โผล่ = ปุ่มเรียก POST /api/auth/mfa/enroll สำเร็จ (ไม่ใช่แค่ state ฝั่ง client)
      await expect(section.locator('code').first()).toHaveText(/^[A-Z2-7]{16,}$/, { timeout: 20_000 });

      const saved = await readStatus();
      expect(saved.pending, 'enroll ต้องถูกบันทึกลง DB (pending=true)').toBe(true);
      expect(saved.enabled, 'ยังไม่ confirm → ต้องยังไม่เปิดใช้จริง').toBe(false);

      // reload = mount component ใหม่ทั้งหน้า; ถ้า refactor ทำ state หลุด flow จะหาย
      await page.reload();
      const afterReload = page.locator('section', { hasText: '2FA / MFA' }).first();
      await expect(afterReload.getByPlaceholder('รหัส 6 หลักจากแอป')).toBeVisible({ timeout: 30_000 });
    } finally {
      // คืนสภาพเสมอ — disable ล้างทั้ง secret และ pending secret (auth.service.disableMfa)
      const reset = await request.post(`${API_BASE}/api/auth/mfa/disable`, { headers });
      expect(reset.ok(), 'ปิด 2FA คืนสภาพต้องสำเร็จ').toBeTruthy();
    }

    const after = await readStatus();
    expect(after).toMatchObject({ enabled: false, pending: false });
  });
});
