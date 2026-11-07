import { skipIfAuthStateMissing } from './helpers/authGuard';

skipIfAuthStateMissing();

import { test, expect } from '@playwright/test';

// ── ภาพรวมฟาร์ม (ผู้บริหาร) ────────────────────────────────────────────────
// ล็อกสิ่งที่ผู้ใช้ต้องเห็นจริง: KPI ครบ, ความเสี่ยงเรียงตามระดับ,
// และลิงก์ "เปิดหน้า" พาไปหน้าที่มีอยู่ (ไม่ 404)

test('เปิดหน้าได้ + KPI 9 การ์ดครบ', async ({ page }) => {
  await page.goto('/farm-executive', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'ภาพรวมฟาร์ม (ผู้บริหาร)' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('แปลงที่ยังผลิต')).toBeVisible();
  // 6 การ์ดหลัก + 3 การ์ดรอง
  await expect(page.getByTestId('farm-kpi-grid').locator('> div')).toHaveCount(6);
  await expect(page.getByTestId('farm-kpi-grid-secondary').locator('> div')).toHaveCount(3);
  await expect(page.getByText('Application error')).toHaveCount(0);
});

test('การ์ดความเสี่ยงเรียง critical → warning → info', async ({ page }) => {
  await page.goto('/farm-executive', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('farm-kpi-grid')).toBeVisible({ timeout: 20_000 });

  const cards = page.getByTestId('risk-card');
  const count = await cards.count();
  if (count === 0) test.skip(true, 'ฟาร์มนี้ยังไม่มีความเสี่ยง — ไม่มีอะไรให้ตรวจลำดับ');

  const severities = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-severity')));
  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const ranks = severities.map((s) => rank[String(s)] ?? 99);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

  // การ์ดวิกฤตต้องอยู่บนสุดเสมอเมื่อมี
  if (severities.includes('critical')) expect(severities[0]).toBe('critical');
});

test('ลิงก์ "เปิดหน้า" พาไปหน้าปลายทางที่มีอยู่จริง', async ({ page }) => {
  await page.goto('/farm-executive', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('farm-kpi-grid')).toBeVisible({ timeout: 20_000 });

  const links = page.getByTestId('risk-link');
  if ((await links.count()) === 0) test.skip(true, 'ยังไม่มีความเสี่ยง — ไม่มีลิงก์ให้กด');

  await links.first().click();
  await expect(page).toHaveURL(/\/(farm|livestock)(\/|$)/, { timeout: 15_000 });
  await expect(page.getByText('Application error')).toHaveCount(0);
});
