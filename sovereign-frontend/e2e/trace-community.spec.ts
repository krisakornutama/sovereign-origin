import { test, expect } from '@playwright/test';

// ────────────────────────────────────────────────────────────────────────────
// trace-community.spec.ts — E2E flow ผู้ใช้จริงบน production (:3000 + :3001)
//
// พิสูจน์ว่าหน้า /trace และ /community "เปิดใช้ได้จริงบนเบราว์เซอร์" พร้อมข้อมูล seed:
//   1) /community — เห็นร้าน opt-in + สินค้า กดสินค้า → ไปหน้าร้านต้นทาง /shop?id=<id>
//   2) /trace — พิมพ์รหัสล็อต → เห็นไทม์ไลน์เหตุการณ์ครบ (HARVESTED → PROCESSED → TESTED)
//   3) /trace?lot=... — จำลองสแกน QR ติดสินค้า → เปิดตามรอยเอง + ป้าย "ขายแล้ว"
//   4) /trace (login) — รายการล็อตล่าสุด กดเปิดล็อตได้
// ใช้ storageState จาก auth.setup.ts (e2e-bot) — ข้อมูล seed ด้วย scripts/seed-trace-community.ts
// ────────────────────────────────────────────────────────────────────────────

test('community → เห็นร้าน opt-in + สินค้า กดสินค้าไปหน้าร้านต้นทาง', async ({ page }) => {
  await page.goto('/community');

  // หัวหน้า catalog + ร้านที่ seed (opt-in เข้าชุมชน)
  await expect(page.getByText('Catalog กลางชุมชน')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('ร้านผักสดตามรอย')).toBeVisible();

  // สินค้าที่ seed โชว์ใน catalog พร้อมราคาขาย
  const tomato = page.getByText('มะเขือเทศออร์แกนิก 1 กก.');
  await expect(tomato).toBeVisible();
  await expect(page.getByText('45 ฿')).toBeVisible();
  await expect(page.getByText('ผักสลัดฟาร์มรวม 300 กรัม')).toBeVisible();

  // กดสินค้า → ไปหน้าร้านต้นทาง (ผู้ใช้จริงต้องซื้อต่อที่ร้าน)
  await tomato.click();
  await page.waitForURL(/\/shop\?id=/);

  // หน้าร้านโหลดข้อมูลจริงจาก API สาธารณะ
  await expect(page.getByText('ร้านผักสดตามรอย')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('ผักสลัดฟาร์มรวม 300 กรัม')).toBeVisible();
  await expect(page.getByText('มะเขือเทศออร์แกนิก 1 กก.')).toBeVisible();
});

test('trace → พิมพ์รหัสล็อต เห็นไทม์ไลน์เหตุการณ์ครบ', async ({ page }) => {
  await page.goto('/trace');

  // ค้นหาด้วยรหัสล็อตจาก seed
  const input = page.getByPlaceholder('LOT-XXXXXX');
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.fill('LOT-T4ST2H');
  await page.getByRole('button', { name: /ตามรอย/ }).click();

  // การ์ดล็อต: รหัส + พืช + แปลงต้นทาง
  await expect(page.getByText('LOT-T4ST2H')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('แปลงมะเขือเทศโซน A').first()).toBeVisible();

  // ไทม์ไลน์ครบ 3 เหตุการณ์ตาม seed (chip ต้อง exact กันชนกับข้อความรายละเอียด)
  await expect(page.getByText('ไทม์ไลน์ตามรอย')).toBeVisible();
  await expect(page.getByText('เก็บเกี่ยว', { exact: true })).toHaveCount(1);
  await expect(page.getByText('แปรรูป/ทำอาหาร', { exact: true })).toHaveCount(1);
  await expect(page.getByText('ตรวจคุณภาพ', { exact: true })).toHaveCount(1);
  await expect(page.getByText('ตรวจคุณภาพ: ไม่พบสารฆ่าแมลงตกค้าง — ผ่านเกณฑ์')).toBeVisible();

  // URL sync เพื่อให้ QR ติดสินค้าเปิดกลับมาที่ล็อตเดิมได้
  await expect(page).toHaveURL(/lot=LOT-T4ST2H/);
});

test('trace?lot= → สแกน QR ติดสินค้า (ลิงก์ลึก) เปิดตามรอยเอง พร้อมป้ายขายแล้ว', async ({ page }) => {
  // เข้าผ่านลิงก์จาก QR โดยตรง — หน้าต้องค้นหาให้เอง
  await page.goto('/trace?lot=LOT-D3M9C4');

  await expect(page.getByText('LOT-D3M9C4')).toBeVisible({ timeout: 20_000 });
  // ป้าย "ขายแล้ว" (การ์ดล็อต) + chip SOLD (ไทม์ไลน์) = อย่างน้อย 2 จุด
  await expect(page.getByText('ขายแล้ว').first()).toBeVisible();
  await expect(page.getByText('ขายผ่านออเดอร์ ORD-DEMO-0001')).toBeVisible();
});

test('trace → ผู้ใช้ที่ล็อกอินเห็นล็อตล่าสุด กดเปิดล็อตได้', async ({ page }) => {
  await page.goto('/trace');

  // รายการล็อตล่าสุด (GET /api/trace — ต้อง login) โชว์ล็อตจาก seed
  const lotCard = page.getByText('LOT-T4ST2H').first();
  await expect(lotCard).toBeVisible({ timeout: 20_000 });

  // กดการ์ดล็อต → เปิดไทม์ไลน์ของล็อตนั้น
  await lotCard.click();
  await expect(page.getByText('ไทม์ไลน์ตามรอย')).toBeVisible({ timeout: 20_000 });
});
