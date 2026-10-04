import { test, expect } from '@playwright/test';

// ────────────────────────────────────────────────────────────────────────────
// แผง "ชำระผ่านบัตร" ฝั่งยังไม่ล็อกอิน
//
// หน้าร้านเป็นหน้าสาธารณะ แต่ /api/payments/checkout-session ต้องมี JWT
// → คนที่ยังไม่ล็อกอินต้องเห็น "ทางออก" (เข้าสู่ระบบ) ไม่ใช่ปุ่มชำระที่กดแล้วเงียบ
// ถ้าวันหนึ่งปุ่มชำระหลุดมาให้คนไม่ล็อกอินเห็น เทสต์นี้จะแดงทันที
// ────────────────────────────────────────────────────────────────────────────

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API = 'http://localhost:3001';

const SHOP = {
  id: 'e2e-shop',
  name: 'ร้าน E2E',
  vatRate: 0,
  products: [
    { id: 'p1', name: 'แพ็กเกจทดสอบ A', category: 'GENERAL', specs: null, salePrice: 9900, warrantyMonths: 12, inStock: true },
  ],
};

test('ยังไม่ล็อกอิน → เห็นช่องทางเข้าสู่ระบบ และไม่มีปุ่มชำระ', async ({ page }) => {
  await page.route(`${API}/api/shop/community`, (r) => r.fulfill({ json: { shops: [{ id: SHOP.id }] } }));
  await page.route(`${API}/api/shop/${SHOP.id}`, (r) => r.fulfill({ json: SHOP }));
  await page.route(`${API}/api/trace/products*`, (r) => r.fulfill({ json: { products: [] } }));

  await page.goto(`${BASE}/shop?id=${SHOP.id}`);
  await expect(page.getByRole('heading', { name: /ชำระผ่านบัตร/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /เข้าสู่ระบบเพื่อชำระ/ })).toBeVisible();
  await expect(page.getByText('ต้องเข้าสู่ระบบ').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /ชำระผ่านบัตร/ })).toHaveCount(0);
});
