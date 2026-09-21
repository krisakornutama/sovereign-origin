import { test, expect, type Page } from '@playwright/test';

// ────────────────────────────────────────────────────────────────────────────
// E2E: AI chat กลางบน dashboard จำ MBTI ของผู้ใช้
//
// พิสูจน์ 3 อย่าง (local-first — ผลแบบทดสอบอยู่ใน localStorage):
//   1. client แนบ `mbti` = โค้ดผลล่าสุด ไปกับ POST /api/ai/chat ทุกครั้ง (withMbti)
//   2. เมื่อทำแบบทดสอบใหม่ (ผลล่าสุดเปลี่ยน) → โค้ดที่แนบเปลี่ยนตาม
//   3. ยังไม่เคยทำแบบทดสอบ → ไม่แนบ mbti เลย (พฤติกรรมเดิมคงเดิม)
//   + คำตอบของ AI ที่ render ในฟองแชทสะท้อนโค้ดที่แนบ (เทียบกับ response จริง)
//
// วิธีรัน (คู่กับ preview ของโปรเจ็ก):
//   1. node tools/mock-api-preview.mjs            → mock API บน :3101
//   2. dev-themes-preview.cmd (หรือ dev :3100 ที่ตั้ง NEXT_PUBLIC_API_URL=http://localhost:3101)
//   3. npm run test:mbti   (playwright.mbti.config.ts → baseURL :3100 เปลี่ยนได้ด้วย PLAYWRIGHT_TEST_BASE_URL)
//
// spec นี้ self-bootstrapping: ไม่ใช้ storageState/DB — ปลอม JWT (client decode เอง)
// และ seed ผล MBTI ลง localStorage ตรง ๆ รันได้ทั้งกับ mock (:3101) และ backend จริง
// ────────────────────────────────────────────────────────────────────────────

const AUTH_KEY = 'sovereign-auth'; // zustand persist ของ useAuthStore
const MBTI_KEY = 'sovereign.mbti.results.v1'; // MBTI_STORE_KEY (mbtiData.ts)
const API_URL_KEY = 'sovereign-api-url'; // override ของ config.ts (getApiUrl) — ชี้ API ที่จะยิงจริง
const CHAT_INPUT = 'input[placeholder*="พิมพ์"]'; // ช่องพิมพ์ของ AiChatPanel

// API ที่หน้าเว็บจะยิงจริง — เรา seed ลง localStorage ตรง ๆ จึงไม่ต้องง้อ env ของ dev server
// (preview: mock-api :3101 | รันกับ backend จริง: MBTI_E2E_API_URL=http://localhost:3001 npm run test:mbti)
const API_URL = process.env.MBTI_E2E_API_URL || 'http://localhost:3101';

/** JWT ปลอมที่ decodeJwt + useAuthStore ยอมรับ (client-side ไม่ตรวจ signature) */
function makeToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = {
    userId: 'e2e-mbti-preview',
    role: 'SUPERADMIN',
    assigned_node_id: null,
    mfa_verified: true,
    must_change_password: false,
    iat: now,
    exp: now + 3600,
  };
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
}

/** MbtiResult ย่อ (โครงเดียวกับ mbtiData.ts) — คะแนน 3:1 ชัดเจนทุกมิติ */
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

/** seed auth + ผล MBTI (เรียงล่าสุดก่อน — เหมือนที่หน้า /mbti บันทึก) แล้วเปิด dashboard */
async function seedAndOpen(page: Page, codes: string[]) {
  const token = makeToken();
  const results = codes.map((c) => mbtiResult(c));
  await page.goto('/');
  await page.evaluate(
    ({ authKey, mbtiKey, apiUrlKey, apiUrl, token, results }) => {
      localStorage.setItem(authKey, JSON.stringify({ state: { token }, version: 0 }));
      localStorage.setItem(apiUrlKey, apiUrl);
      if (results.length > 0) localStorage.setItem(mbtiKey, JSON.stringify(results));
      else localStorage.removeItem(mbtiKey);
    },
    { authKey: AUTH_KEY, mbtiKey: MBTI_KEY, apiUrlKey: API_URL_KEY, apiUrl: API_URL, token, results }
  );
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(CHAT_INPUT).first()).toBeVisible({ timeout: 30_000 });
}

/** ส่งข้อความผ่านแชทกลาง แล้วคืน request body + reply ที่ backend ตอบกลับมาจริง */
async function sendChat(page: Page, text: string) {
  const reqP = page.waitForRequest((r) => r.url().includes('/api/ai/chat') && r.method() === 'POST');
  // Response ไม่มี .method() — ต้องขอผ่าน request ของมัน
  const resP = page.waitForResponse((r) => r.url().includes('/api/ai/chat') && r.request().method() === 'POST');
  const input = page.locator(CHAT_INPUT).first();
  await input.fill(text);
  await input.press('Enter');
  const [req, res] = await Promise.all([reqP, resP]);
  const data = await res.json();
  return { body: req.postDataJSON() as Record<string, unknown>, reply: String(data?.reply ?? '') };
}

test.describe('Dashboard AI chat แนบ MBTI จาก localStorage', () => {
  test('แนบโค้ดผลล่าสุด (ESFP) และคำตอบที่ render ตรงกับ response จริง', async ({ page }) => {
    await seedAndOpen(page, ['ESFP', 'INTJ']); // ESFP = ล่าสุด (index 0), INTJ = ผลเก่า
    const { body, reply } = await sendChat(page, 'วันนี้บ้านเป็นไงบ้าง');
    expect(body.mbti).toBe('ESFP');
    expect(String(body.message)).toContain('วันนี้บ้านเป็นไงบ้าง');
    // ฟองแชทต้องแสดงคำตอบที่ backend ส่งกลับจริง (ไม่ใช่ข้อความ error เงียบ ๆ)
    await expect(page.getByText(reply).first()).toBeVisible();
  });

  test('ทำแบบทดสอบใหม่ → โค้ดที่แนบเปลี่ยนตามผลล่าสุด (ESFP → INTJ)', async ({ page }) => {
    await seedAndOpen(page, ['ESFP']);
    const first = await sendChat(page, 'ช่วยดูแลใจหน่อย');
    expect(first.body.mbti).toBe('ESFP');

    // ผลใหม่มาแทน (บันทึกเรียงล่าสุดก่อนเหมือนหน้า /mbti)
    await seedAndOpen(page, ['INTJ', 'ESFP']);
    const second = await sendChat(page, 'ช่วยดูแลใจหน่อย');
    expect(second.body.mbti).toBe('INTJ');
    await expect(page.getByText(second.reply).first()).toBeVisible();
  });

  test('ยังไม่เคยทำแบบทดสอบ → ไม่แนบ mbti (ไม่พัง, พฤติกรรมเดิมคงเดิม)', async ({ page }) => {
    await seedAndOpen(page, []);
    const { body, reply } = await sendChat(page, 'สถานะแบตเตอรี่');
    expect('mbti' in body).toBe(false);
    expect(reply.length).toBeGreaterThan(0);
    await expect(page.getByText(reply).first()).toBeVisible();
  });

  test('ชิปโทนหลวงพี่: มีผลล่าสุด → แสดงโค้ด+ชื่อหลวงพี่ / ไม่มีผล → ชวนไป /mbti', async ({ page }) => {
    await seedAndOpen(page, ['ESFP']);
    const chip = page.locator('[data-testid="mbti-tone-chip"]');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toContainText('ESFP');
    await expect(chip).toContainText('หลวงพี่ผู้เบิกบาน'); // ESFP → หลวงพี่ผู้เบิกบาน (MBTI_CARE_TONES)

    // เคสไม่มีผล: seed ใหม่แบบไม่มี mbti → ชิปหาย และมีลิงก์ชวนทำแบบทดสอบ
    await seedAndOpen(page, []);
    await expect(page.locator('[data-testid="mbti-tone-chip"]')).toHaveCount(0);
    await expect(page.getByText('MBTI', { exact: false }).first()).toBeVisible(); // ลิงก์เชิญชวน (มีคำ MBTI)
  });
});
