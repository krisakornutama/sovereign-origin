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

// ── Telegram: บันทึกค่าจริง → ตรวจผ่าน API → คืนค่าเดิมของเครื่อง ──
// เจตนา: พิสูจน์ว่าปุ่ม "บันทึก" ของ panel Telegram เขียนลง DB จริง (ไม่ใช่แค่แสดงข้อความสำเร็จ)
// และ **ไม่ทิ้งค่าเทสต์ไว้ในเครื่อง**: จบเทสต์ต้องได้ config เดิมกลับมาเป๊ะ ๆ (source/mask/chatId)
//
// ข้อจำกัดที่ต้องออกแบบรับ: API คืน bot token แบบ mask เท่านั้น → ถ้าเครื่องมี override ใน DB อยู่
// (source='db') เราไม่สามารถเขียน token เดิมกลับได้ ⇒ เคสนั้นทดสอบเฉพาะ chatId (merge เก็บ token เดิมไว้)
// ส่วนเครื่องที่ยังไม่มี override (env/none) เขียน token ปลอมได้ เพราะล้างด้วย DELETE /config = กลับค่าเดิม
//
// ❌ ห้ามกด "ส่งข้อความทดสอบ": จะยิงออก Telegram จริงด้วย credential ของเจ้าของเครื่อง
const DUMMY_CHAT_ID = '1000000001';
const DUMMY_BOT_TOKEN = '123456789:AAFakeTokenForE2E2026110900';
/** จำลอง maskBotToken ของ core-api (4 ตัวหน้า … 4 ตัวท้าย) */
const maskOf = (t: string) => (t.length <= 8 ? '••••' : `${t.slice(0, 4)}…${t.slice(-4)}`);

type TelegramConfig = { configured: boolean; source: 'env' | 'db' | 'none'; botTokenMasked: string; chatId: string };
const pickConfig = (c: TelegramConfig) => ({
  configured: c.configured,
  source: c.source,
  botTokenMasked: c.botTokenMasked,
  chatId: c.chatId,
});

test.describe('settings — Telegram บันทึกค่าจริงและคืนค่าเดิม', () => {
  test('บันทึกผ่าน UI → API เห็นค่าใหม่ → คืนค่าเดิมของเครื่อง', async ({ page, request }) => {
    test.setTimeout(120_000);
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
    const configUrl = `${API_BASE}/api/telegram/config`;
    const readConfig = async (): Promise<TelegramConfig> => (await request.get(configUrl, { headers })).json();

    const probe = await request.get(configUrl, { headers });
    test.skip(probe.status() === 403, 'บัญชี e2e ไม่ใช่ SUPERADMIN — ตั้งค่า Telegram ไม่ได้');
    expect(probe.ok(), 'อ่าน /api/telegram/config ต้องได้ 200').toBeTruthy();
    const before = pickConfig(await probe.json());

    const section = page.locator('section', { hasText: 'Telegram Alerts' }).first();
    await expect(section).toBeVisible({ timeout: 30_000 });
    const chatInput = page.locator('#settings-telegram-chat-id');
    const tokenInput = page.locator('#settings-telegram-bot-token');
    const saveButton = section.getByRole('button', { name: /^บันทึก$/ });
    const savedMsg = page.getByText('บันทึก Telegram credentials แล้ว', { exact: false });

    // เครื่องที่มี override ใน DB อยู่ → แตะเฉพาะ chatId (token เดิมไม่ถูกเขียนทับ และกู้กลับได้)
    const chatIdOnly = before.source === 'db';

    try {
      await expect(chatInput).toBeVisible();
      if (!chatIdOnly) await tokenInput.fill(DUMMY_BOT_TOKEN);
      await chatInput.fill(DUMMY_CHAT_ID);
      await saveButton.click();

      // ข้อความสำเร็จ = PUT ผ่าน (ถ้า auth/permission พังจะขึ้น error แดงแทน)
      await expect(savedMsg).toBeVisible({ timeout: 20_000 });

      const afterSave = await readConfig();
      expect(afterSave.chatId, 'chatId ต้องถูกบันทึกลง DB จริง').toBe(DUMMY_CHAT_ID);
      if (chatIdOnly) {
        expect(afterSave.botTokenMasked, 'chatId-only ต้องไม่แตะ token เดิม').toBe(before.botTokenMasked);
        expect(afterSave.source).toBe('db');
      } else {
        expect(afterSave.botTokenMasked, 'token ปลอมต้องเข้า DB (เห็นได้จาก mask)').toBe(maskOf(DUMMY_BOT_TOKEN));
        expect(afterSave.configured).toBe(true);
        expect(afterSave.source).toBe('db');
      }

      // reload = mount ใหม่ทั้งหน้า → ค่าต้องมาจาก API ไม่ใช่ state ที่ค้างใน client
      await page.reload();
      await expect(page.locator('#settings-telegram-chat-id')).toHaveValue(DUMMY_CHAT_ID, { timeout: 30_000 });
    } finally {
      // คืนค่าเดิมเสมอ
      if (chatIdOnly) {
        const res = await request.put(configUrl, { headers, data: { chatId: before.chatId } });
        expect(res.ok(), 'คืน chatId เดิมต้องสำเร็จ').toBeTruthy();
      } else {
        const res = await request.delete(configUrl, { headers });
        expect(res.ok(), 'ลบ override เพื่อกลับไปใช้ค่าเดิมต้องสำเร็จ').toBeTruthy();
      }
      const restored = pickConfig(await readConfig());
      expect(restored, 'หลังจบเทสต์ config ของเครื่องต้องเหมือนก่อนรันเป๊ะ ๆ').toEqual(before);
    }
  });
});

// ── Telegram: ดึง Chat ID อัตโนมัติ (ไม่แตะ Telegram จริง) ──
// เจตนา: ปุ่ม "ดึง Chat ID อัตโนมัติ" เรียก `GET /api/telegram/updates` ซึ่งฝั่ง server จะไปยิง
//   api.telegram.org ด้วย token จริงของเครื่อง — เทสต์จึง **intercept ที่ชั้นเบราว์เซอร์**
//   (`page.route`) ให้ตอบ fixture แทน ⇒ ไม่มี request ใดออกไป Telegram และไม่ต้องมี token จริง
// ตรวจสองอย่าง: (1) รายการที่ได้มากดเลือกแล้วเติม chatId ให้ และ (2) ผลว่างต้องบอกผู้ใช้ตามจริง
// ไม่กด "บันทึก" เลย ⇒ ไม่มีการเขียน DB; ตอนจบยืนยันผ่าน API ว่า config ยังเหมือนก่อนรัน
test.describe('settings — Telegram ดึง Chat ID อัตโนมัติ', () => {
  test('กดดึง Chat ID → เติม chatId จากรายการที่ API คืน (ไม่ยิง Telegram จริง)', async ({ page, request }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sovereign-api-url', window.location.origin);
      } catch {
        // about:blank — ข้าม
      }
    });

    const telegramCalls: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('api.telegram.org')) telegramCalls.push(url);
    });

    // fixture: 1 แชท (จำลองผล getUpdates ที่ผ่านการ map ฝั่ง server แล้ว)
    let fixture = { chats: [{ chatId: '1000000001', title: 'E2E Room', type: 'group', text: 'สวัสดี' }] };
    await page.route('**/api/telegram/updates*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    });

    await page.goto('/settings/');
    const token = await authToken(page);
    const headers = { Authorization: `Bearer ${token}` };
    const configUrl = `${API_BASE}/api/telegram/config`;
    const before = await (await request.get(configUrl, { headers })).json();

    const section = page.locator('section', { hasText: 'Telegram Alerts' }).first();
    await expect(section).toBeVisible({ timeout: 30_000 });
    const tokenInput = page.locator('#settings-telegram-bot-token');
    const chatInput = page.locator('#settings-telegram-chat-id');
    const fetchButton = section.getByRole('button', { name: /ดึง Chat ID อัตโนมัติ/ });

    // ปุ่มต้องกดไม่ได้จนกว่าจะมี token ให้ลอง (กันการยิง API เปล่า ๆ) — ไม่ต้องมี token จริง
    await expect(fetchButton).toBeDisabled();
    await tokenInput.fill(DUMMY_BOT_TOKEN);
    await expect(fetchButton).toBeEnabled();

    await fetchButton.click();
    await expect(page.getByText('พบ 1 แชท', { exact: false })).toBeVisible({ timeout: 20_000 });
    const row = section.getByRole('button', { name: /1000000001/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('E2E Room');

    // กดเลือกแชท → chatId ถูกเติมให้ (ยังไม่บันทึก)
    await row.click();
    await expect(chatInput).toHaveValue('1000000001');

    // ผลว่าง: ต้องบอกผู้ใช้ ไม่ใช่ปล่อยเงียบ
    fixture = { chats: [] };
    await fetchButton.click();
    await expect(page.getByText('ยังไม่พบข้อความ', { exact: false })).toBeVisible({ timeout: 20_000 });

    // ไม่มีอะไรออกไป Telegram จริง และไม่มีอะไรถูกเขียนลง DB
    expect(telegramCalls, 'ต้องไม่มี request ไป api.telegram.org').toEqual([]);
    const after = await (await request.get(configUrl, { headers })).json();
    expect(after, 'การดึง Chat ID ต้องไม่เปลี่ยน config ของเครื่อง').toEqual(before);
  });
});

// ── Telegram: ห้องที่เป็นช่อง (channel) ต้องมีชื่อห้องในรายการ ──
// ที่มา: server เคยอ่าน chat จาก `message` เท่านั้น โพสต์ในช่อง (channel_post) จึงได้ title ว่าง
//   → แถวในหน้านี้เหลือแค่ตัวเลข + type ดูไม่ออกว่าห้องไหน (แก้ที่ route แล้ว + unit test ฝั่ง server)
// เทสต์นี้ล็อกสัญญาฝั่ง UI: payload ที่ server ส่งมา (chatId/title/type) ต้องถูกแสดงครบ
//   รวม chatId ติดลบของช่อง และกดเลือกแล้วเติมค่าติดลบได้ถูกต้อง
// ยัง intercept ที่ชั้นเบราว์เซอร์ ⇒ ไม่มีการเรียก Telegram จริง และไม่แตะ config ของเครื่อง
test.describe('settings — Telegram รายการห้องแบบช่อง (channel)', () => {
  test('แถวของช่องแสดงชื่อห้อง (ไม่ใช่แค่ตัวเลข) และเลือกแล้วได้ chatId ติดลบ', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('sovereign-api-url', window.location.origin);
      } catch {
        // about:blank — ข้าม
      }
    });

    await page.route('**/api/telegram/updates*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          // รูปเดียวกับที่ route คืนหลังแก้: ชื่อห้องมาจาก chat ของ channel_post
          chats: [{ chatId: '-1001234567890', title: 'ประกาศกรรมการ', type: 'channel', text: 'ข่าวสารประจำวัน' }],
        }),
      });
    });

    await page.goto('/settings/');
    const section = page.locator('section', { hasText: 'Telegram Alerts' }).first();
    await expect(section).toBeVisible({ timeout: 30_000 });

    await page.locator('#settings-telegram-bot-token').fill(DUMMY_BOT_TOKEN);
    await section.getByRole('button', { name: /ดึง Chat ID อัตโนมัติ/ }).click();

    const row = section.getByRole('button', { name: /-1001234567890/ });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row, 'ชื่อห้องต้องแสดง ไม่ใช่ปล่อยว่าง').toContainText('ประกาศกรรมการ');
    await expect(row).toContainText('channel');
    await expect(row).toContainText('ข่าวสารประจำวัน');

    await row.click();
    await expect(page.locator('#settings-telegram-chat-id')).toHaveValue('-1001234567890');
  });
});
