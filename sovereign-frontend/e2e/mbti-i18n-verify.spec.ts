import { test, expect, Page } from "@playwright/test";

// ยืนยันพฤติกรรมจริงของ i18n หัวเรื่อง+แถบนำทางหน้า MBTI (commit 6cc09aa)
// — ทั้งสองภาษา และ flow คลัง 16 ประเภท (nav → grid → detail → กลับ) ยังทำงานครบ

const AUTH_KEY = "sovereign-auth";
const LANG_KEY = "sovereign-lang";

async function seed(page: Page, lang: "th" | "en") {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ authKey, langKey, lang }) => {
      localStorage.setItem(
        authKey,
        JSON.stringify({ state: { token: "e2e-mock-token", user: { id: "e2e-user", name: "E2E", role: "admin" } }, version: 0 })
      );
      localStorage.setItem(langKey, JSON.stringify({ state: { lang }, version: 0 }));
    },
    { authKey: AUTH_KEY, langKey: LANG_KEY, lang }
  );
  await page.goto("/mbti", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main, [class*=flex]").first()).toBeVisible({ timeout: 30_000 });
}

test("EN: หัวเรื่อง/eyebrow/แถบนำทาง render จาก key ใหม่ + flow คลังทำงานจริง", async ({ page }) => {
  await seed(page, "en");
  const header = page.locator("text=16-Type Personality Test").first();
  await expect(header).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Life & Health")).toBeVisible();
  await expect(page.getByText("done on your device")).toBeVisible();

  // แถบนำทาง (PageHeader actions) — ปุ่ม library ตัวแรกใน header
  const navLibrary = page.locator("button", { hasText: "Browse all 16 types" }).first();
  await expect(navLibrary).toBeVisible();
  await expect(page.locator("text=Compare with partner/family").first()).toBeVisible();
  await expect(page.locator("text=หน้าหลัก")).toHaveCount(0); // EN ต้องไม่มี TH หลงเหลือใน header

  // คลิก → คลังเปิด (grid 4 ตระกูล + รหัสครบ)
  await navLibrary.click();
  await expect(page.getByText("นักวิเคราะห์ (NT)")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("button", { hasText: "INTJ" }).first()).toBeVisible();

  // เปิด detail INTJ → ปุ่มกลับขึ้น (locator ต้อง .first() — ปุ่ม INTJ มีทั้งการ์ดกริดและแถวกราฟหายาก)
  await page.locator("button", { hasText: "INTJ" }).first().click();
  const back = page.locator("button", { hasText: "ดูทั้ง 16 ประเภท" }).first();
  await expect(back).toBeVisible({ timeout: 10_000 });

  // กลับ → grid กลับมา (state ต่อเนื่อง ไม่หลุดไป intro)
  await back.click();
  await expect(page.getByText("นักวิเคราะห์ (NT)")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Forced-choice: pick A or B")).toHaveCount(0); // ไม่รีเซ็ตเป็น intro
});

test("TH: หัวเรื่อง/แถบนำทางเป็นไทยจาก key เดียวกัน + nav ยังคลิกเปิดคลังได้", async ({ page }) => {
  await seed(page, "th");
  const header = page.locator("text=แบบทดสอบบุคลิกภาพ 16 ประเภท").first();
  await expect(header).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("ชีวิต & สุขภาพ")).toBeVisible();
  await expect(page.locator("text=ทำเอง เก็บเองในเบราว์เซอร์").first()).toBeVisible();

  const navLibrary = page.locator("button", { hasText: "ดูคลัง 16 ประเภท" }).first();
  await expect(navLibrary).toBeVisible();
  await expect(page.locator("text=เทียบผลกับคนรัก/ครอบครัว").first()).toBeVisible();

  await navLibrary.click();
  await expect(page.getByText("นักวิเคราะห์ (NT)")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("button", { hasText: "INTJ" }).first()).toBeVisible();
});
