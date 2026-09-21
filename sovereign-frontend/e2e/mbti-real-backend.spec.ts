import { test, expect, type Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────────────────────
// A5 — E2E ชุด MBTI กับ **backend จริง** (:3001) — ไม่ผ่าน mock
//
// หลักความปลอดภัยข้อมูลจริง:
//   • login จริงด้วยบัญชีทดสอบ (MBTI_E2E_USER / MBTI_E2E_PASS — บัญชี USER ธรรมดา)
//     ไม่มี env → test นี้ skip พร้อมข้อความ (ไม่เดารหัส, ไม่แตะบัญชีคนจริง)
//   • ผล MBTI = localStorage ของ browser ทดสอบเท่านั้น (local-first — ไม่แตะ DB)
//   • แชทสร้างข้อความจริงใน chat_messages ของ actor = บัญชีทดสอบ → afterEach ลบด้วย
//     DELETE /api/ai/history ของ actor เดียวกัน (ไม่แตะของผู้ใช้อื่น)
//
// รัน (ต้องมี backend :3001):
//   MBTI_E2E_USER=... MBTI_E2E_PASS=... npx playwright test --config=playwright.mbti-real.config.ts
// ────────────────────────────────────────────────────────────────────────────

const MBTI_KEY = 'sovereign.mbti.results.v1';
const CHAT_INPUT = 'input[placeholder*="พิมพ์"]';
const HAS_CREDS = Boolean(process.env.MBTI_E2E_USER && process.env.MBTI_E2E_PASS);

test.skip(!HAS_CREDS, 'A5 ต้องการบัญชีทดสอบ: ตั้ง MBTI_E2E_USER + MBTI_E2E_PASS (บัญชี USER ธรรมดาบน backend จริง) — ข้ามเพื่อไม่แตะบัญชีจริง');

function mbtiResult(code: string) {
  const pairs: Record<string, [string, string]> = {
    E: ['E', 'I'], I: ['E', 'I'], S: ['S', 'N'], N: ['S', 'N'],
    T: ['T', 'F'], F: ['T', 'F'], J: ['J', 'P'], P: ['J', 'P'],
  };
  const dims = (['EI', 'SN', 'TF', 'JP'] as const).map((dim, i) => {
    const letter = code[i];
    const [first, second] = pairs[letter];
    const firstCount = letter === first ? 3 : 1;
    const secondCount = letter === second ? 3 : 1;
    const firstPct = Math.round((firstCount / (firstCount + secondCount)) * 100);
    return { dim, first, second, firstCount, secondCount, firstPct, clarity: Math.abs(firstPct * 2 - 100), letter };
  });
  return { code, dims, answered: 12, date: new Date().toISOString() };
}

async function loginAndOpen(page: Page, codes: string[]) {
  await page.goto('/');
  await page.locator('input[autocomplete="username"]').fill(process.env.MBTI_E2E_USER!);
  await page.locator('input[autocomplete="current-password"]').fill(process.env.MBTI_E2E_PASS!);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 60_000 });
  // ผลล่าสุดของ "เครื่องนี้" (local-first) — เขียนหลัง login เพื่อไม่ให้ใครทับ
  await page.evaluate(({ key, codes }) => {
    localStorage.setItem(key, JSON.stringify(codes.map((c) => ({
      code: c,
      dims: [],
      answered: 12,
      date: new Date().toISOString(),
    }))));
  }, { key: MBTI_KEY, codes });
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(CHAT_INPUT).first()).toBeVisible({ timeout: 30_000 });
  if (codes.length > 0) {
    await expect(page.locator('[data-testid="mbti-tone-chip"]')).toBeVisible({ timeout: 15_000 });
  }
}

async function sendChat(page: Page, text: string) {
  const reqP = page.waitForRequest((r) => r.url().includes('/api/ai/chat') && r.method() === 'POST');
  const resP = page.waitForResponse((r) => r.url().includes('/api/ai/chat') && r.request().method() === 'POST');
  const input = page.locator(CHAT_INPUT).first();
  await input.fill(text);
  await input.press('Enter');
  const [req, res] = await Promise.all([reqP, resP]);
  const data = await res.json();
  return { body: req.postDataJSON() as Record<string, unknown>, reply: String(data?.reply ?? '') };
}

test.describe('A5: MBTI กับ backend จริง', () => {
  test('แนบโค้ดล่าสุดถูกต้อง + โทนหลวงพี่ขึ้นตามผล (แชทกับ Ollama จริงถ้าออนไลน์)', async ({ page }) => {
    await loginAndOpen(page, ['INTJ']);
    // ชิปต้องโชว์โค้ดจาก localStorage ฝั่ง client — ไม่ขึ้นกับ Ollama
    await expect(page.locator('[data-testid="mbti-tone-chip"]')).toContainText('INTJ');
    const { body } = await sendChat(page, 'ทดสอบ A5 — แนบโค้ด INTJ');
    expect(body.mbti).toBe('INTJ'); // สิ่งที่ test นี้พิสูจน์กับของจริง: client แนบโค้ดถูกต้องเสมอ
    // คำตอบจริง (Ollama) มาถึงหรือไม่ขึ้นกับสถานะ Ollama — แต่หน้าต้องไม่พัง
    await expect(page.locator('main')).toBeVisible();
  });

  test('เปลี่ยนผลล่าสุด → โค้ดที่แนบเปลี่ยนตาม (ESFP หลัง INTJ)', async ({ page }) => {
    await loginAndOpen(page, ['ESFP', 'INTJ']);
    const chip = page.locator('[data-testid="mbti-tone-chip"]');
    await expect(chip).toContainText('ESFP');
    const { body } = await sendChat(page, 'ทดสอบ A5 — ล่าสุด ESFP');
    expect(body.mbti).toBe('ESFP');
  });

  test.afterEach(async ({ page }) => {
    // เก็บกวาด: ล้างประวัติแชทของ actor ทดสอบ (ปุ่มในหน้าเดียวกัน — ยิง API เดียวกันกับที่ UI ใช้)
    await page.evaluate(async () => {
      try {
        const token = JSON.parse(localStorage.getItem('sovereign-auth') || '{}')?.state?.token;
        if (!token) return;
        await fetch(`${localStorage.getItem('sovereign-api-url') || 'http://localhost:3001'}/api/ai/history`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* ทิ้งไว้ — ไม่ทำ test พังเพราะ cleanup */ }
    });
  });
});
