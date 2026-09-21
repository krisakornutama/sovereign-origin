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
// โหมด backend จริง: กันหน้า seed api-url ทับทางที่ dev server เสิร์ฟ (เพราะของจริง env ถูกต้องอยู่แล้ว)
// + เราจะไม่ seed api-url key ใด ๆ ให้หน้าเว็บ เพื่อให้ config.ts ใช้ค่า NEXT_PUBLIC_API_URL ของ dev จริง
const REAL_BACKEND = Boolean(process.env.MBTI_E2E_API_URL);

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
    ({ authKey, mbtiKey, apiUrlKey, apiUrl, token, results, realBackend }) => {
      localStorage.setItem(authKey, JSON.stringify({ state: { token }, version: 0 }));
      // โหมด mock (:3101): seed api-url ให้หน้ายิง mock (สแตก preview ก็ seed ค่าเดียวกันอยู่แล้ว)
      // โหมด backend จริง: ห้าม seed — ให้ config.ts ใช้ NEXT_PUBLIC_API_URL ของ dev server จริง
      if (!realBackend) localStorage.setItem(apiUrlKey, apiUrl);
      if (results.length > 0) localStorage.setItem(mbtiKey, JSON.stringify(results));
      else localStorage.removeItem(mbtiKey);
    },
    { authKey: AUTH_KEY, mbtiKey: MBTI_KEY, apiUrlKey: API_URL_KEY, apiUrl: API_URL, token, results, realBackend: REAL_BACKEND }
  );
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(CHAT_INPUT).first()).toBeVisible({ timeout: 30_000 });
  // B5 กัน flake: รอให้ hydrate + effect อ่าน localStorage จริง (ไม่ fix เวลา — poll จน state ขึ้นหรือ timeout)
  // ชิป (ถ้ามีผล) ต้องขึ้นสม่ำเสมอ — กันกรณีหน้า render รอบแรกก่อน effect แล้วชิปโผล่ทีหลัง/หาย
  if (codes.length > 0) {
    await expect(page.locator('[data-testid="mbti-tone-chip"]')).toBeVisible({ timeout: 15_000 });
  }
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

// ── กัน fake JWT หลุดไป backend จริง: โหมด backend จริง (MBTI_E2E_API_URL) ต้องตั้ง MBTI_E2E_ALLOW_REAL=1
// และยอมรับข้อจำกัดชัดเจน: token ปลอม signature ไม่ผ่าน → backend จริงตอบ 401 → แชทโชว์ข้อความ offline
// (พฤติกรรมนี้ถูกต้องตามระบบ — test ชุดนี้กับของจริงจึงพิสูจน์ได้แค่ "แนบ mbti ถูกต้องเสมอ ไม่มีทางหลุดไปยิง API อื่น"
// ส่วนเนื้อหาคำตอบต้องทดสอบด้วยบัญชีจริงแบบมีคนดูแล หรือรันกับ mock ตามชุดปกติ)
test.beforeAll(() => {
  if (REAL_BACKEND && process.env.MBTI_E2E_ALLOW_REAL !== '1') {
    throw new Error(
      'MBTI_E2E_API_URL ถูกตั้ง (โหมด backend จริง) แต่ยังไม่ตั้ง MBTI_E2E_ALLOW_REAL=1 — ' +
      'spec นี้ใช้ fake JWT (client-side decode) ซึ่ง backend จริงจะปฏิเสธที่ 401; ' +
      'ตั้ง MBTI_E2E_ALLOW_REAL=1 เพื่อยอมรับข้อจำกัดนี้ หรือเอา MBTI_E2E_API_URL ออกเพื่อรันกับ mock'
    );
  }
});

test.afterEach(async ({ request }) => {
  // เก็บกวาด: ล้างประวัติแชทที่เราสร้าง (mock: ล้างในหน่วยความจำ | backend จริง: 401 เพราะ token ปลอม = ไม่กระทบข้อมูล)
  await request.delete(`${API_URL}/api/ai/history`, { headers: { Authorization: 'Bearer e2e-mbti-cleanup' } }).catch(() => {});
});

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

test.describe('มือถือ: MobileNav ไม่บัง/ไม่รับคลิกที่ทับเนื้อหา (C4)', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone-ish

  test('ปุ่มส่งแชท (ท้ายพาเนล) คลิกได้จริง — คลิกแล้ว POST ออก ไม่เจาะไปโดนเมนูล่าง', async ({ page }) => {
    await seedAndOpen(page, ['ESFP']);
    const send = page.locator('button[aria-label*="ส่ง"], button[aria-label*="Send"]').first();
    await expect(send).toBeVisible();
    await page.locator(CHAT_INPUT).first().fill('เช็คดินเค็ม'); // ปุ่ม disabled เมื่อ input ว่าง
    // คลิกผ่าน bounding box จริง — ถ้า nav ทับปุ่มอยู่ คลิกจะไปโดนเมนูและ POST ไม่เกิด
    const reqP = page.waitForRequest((r) => r.url().includes('/api/ai/chat') && r.method() === 'POST', { timeout: 10_000 });
    await send.click();
    const req = await reqP;
    expect(req.postDataJSON().mbti).toBe('ESFP');
  });

  test('ตัวอักษรสุดท้ายของหน้าไม่ถูก nav บัง — สกอล์ลถึงล่างสุดแล้วท้ายเนื้อหาอยู่เหนือแถบเมนู', async ({ page }) => {
    await seedAndOpen(page, []);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); // สกอลล์ลงสุดก่อนวัด
    await page.waitForTimeout(300); // รอ scroll จบ
    const overlap = await page.evaluate((): { px: number; what: string } => {
      const nav = document.querySelector('nav[aria-label*="เมนู"], nav[aria-label*="Menu"]') as HTMLElement | null;
      if (!nav) return { px: 0, what: '' };
      const nb = nav.getBoundingClientRect();
      // หา element ใด ๆ ที่คลิกได้ (input/button) ที่ทับกับ nav
      const clickables = Array.from(document.querySelectorAll('input, button, a')) as HTMLElement[];
      let maxOverlap = 0;
      let what = '';
      for (const el of clickables) {
        const b = el.getBoundingClientRect();
        const vOverlap = Math.min(b.bottom, nb.bottom) - Math.max(b.top, nb.top);
        const hOverlap = Math.min(b.right, nb.right) - Math.max(b.left, nb.left);
        if (vOverlap > 0 && hOverlap > 0) {
          // ทับกันจริงเฉพาะเมื่อ nav ทำให้ element นั้นคลิกไม่ได้ (elementFromPoint ไม่ใช่ el และไม่ใช่ลูกของ el)
          const cx = (Math.max(b.left, nb.left) + Math.min(b.right, nb.right)) / 2;
          const cy = (Math.max(b.top, nb.top) + Math.min(b.bottom, nb.bottom) - vOverlap) / 2; // จุดบนสุดของแนวทับ
          const hit = document.elementFromPoint(cx, cy);
          if (hit && hit !== el && !el.contains(hit)) {
            if (vOverlap > maxOverlap) {
              maxOverlap = vOverlap;
              what = `${el.tagName}.${String(el.className).slice(0, 60)} (top=${Math.round(b.top)} bottom=${Math.round(b.bottom)}) hit=${hit.tagName}.${String(hit.className).slice(0, 40)}`;
            }
          }
        }
      }
      return { px: maxOverlap, what };
    });
    expect(overlap.px, `มี element ถูก nav บังคลิกไม่ได้: ${overlap.what}`).toBe(0);
  });
});
