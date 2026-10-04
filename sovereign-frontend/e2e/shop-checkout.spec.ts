import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// ────────────────────────────────────────────────────────────────────────────
// แผง "ชำระผ่านบัตร" บน /shop — ฝั่งที่ล็อกอินแล้ว
//
// ── ทำไมต้อง "ย้าย token" แทนที่จะพึ่ง storageState ตรง ๆ ──────────────────────
// storageState ของ Playwright ผูกกับ origin ที่บันทึกไว้ตอน auth.setup
// ซึ่งคือ http://localhost:3000 แต่ชุดนี้อาจรันบนพอร์ตอื่น (เช่น 3100
// ตอนต้อง serve build ปัจจุบันโดยไม่ไปแตะ :3000 ของเจ้าของเครื่อง)
// → localStorage ของ origin ที่ทดสอบจะว่างเปล่า → isAuthenticated = false
//
// วิธีแก้คือเอา "token ตัวเดียวกันที่ harness ออกมาจริง" ไปวางที่ origin ที่กำลังทดสอบ
// ไม่ forge token และไม่ผ่านหน้า login — ถ้าไม่มี token ที่ผ่าน MFA
// ให้ fail ทันทีแทนที่จะเงียบ ๆ แล้วไปเข้าเคส "ยังไม่ล็อกอิน"
//
// ทุก request ที่หน้านี้ยิงถูก mock ทั้งหมด ของที่ต้องพิสูจน์คือ "หน้าจอส่งอะไร"
// ถ้ายิงจริงจะเป็นการสร้าง order ขยะใน DB ทุกรอบเทสต์
// ────────────────────────────────────────────────────────────────────────────

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3100';
const API = 'http://localhost:3001';

const SHOP = {
  id: 'e2e-shop',
  name: 'ร้าน E2E',
  vatRate: 0,
  products: [
    { id: 'p1', name: 'แพ็กเกจทดสอบ A', category: 'GENERAL', specs: 'ข้อมูลตัวอย่าง', salePrice: 9900, warrantyMonths: 12, inStock: true },
    { id: 'p2', name: 'แพ็กเกจทดสอบ B', category: 'GENERAL', specs: null, salePrice: 2500, warrantyMonths: 0, inStock: true },
  ],
};

// ยอดที่ server คืนกลับ — หน้าต้องส่งตัวเลขนี้ไปเป๊ะ ๆ
const ORDER_TOTAL = 9900;
const PUBLIC_TOKEN = '11111111-2222-3333-4444-555555555555';

function harnessStoredAuth(): string {
  const p = 'e2e/.auth/state.json';
  if (!existsSync(p)) throw new Error(`ไม่พบ ${p} — รัน auth.setup (project "setup") ก่อน`);
  const state = JSON.parse(readFileSync(p, 'utf8'));
  const raw = (state.origins ?? [])
    .flatMap((o: any) => o.localStorage ?? [])
    .find((i: any) => i.name === 'sovereign-auth')?.value;
  if (!raw) throw new Error(`${p} ไม่มีคีย์ sovereign-auth`);
  const token = JSON.parse(raw).state?.token;
  const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
  if (!payload.mfa_verified) throw new Error('token จาก harness ยังไม่ผ่าน MFA — เทสต์นี้ต้องการผู้ใช้ที่ยืนยันตัวตนแล้ว');
  if (Date.now() / 1000 >= payload.exp) throw new Error('token หมดอายุแล้ว — รัน auth.setup ใหม่');
  return raw;
}

async function asSignedIn(page: any) {
  const raw = harnessStoredAuth();
  await page.addInitScript((value: string) => {
    try { window.localStorage.setItem('sovereign-auth', value); } catch { /* about:blank ไม่มี localStorage */ }
  }, raw);
}

async function mockShop(page: any, opts: { checkout?: () => any; onCheckoutBody?: (b: any) => void } = {}) {
  await page.route(`${API}/api/shop/community`, (r: any) => r.fulfill({ json: { shops: [{ id: SHOP.id }] } }));
  await page.route(`${API}/api/shop/${SHOP.id}/orders`, (r: any) =>
    r.fulfill({ status: 201, json: { id: 'bo_1', orderNo: 'S20261004-0001', status: 'QUOTE', total: ORDER_TOTAL, publicToken: PUBLIC_TOKEN } }));
  await page.route(`${API}/api/shop/${SHOP.id}`, (r: any) => r.fulfill({ json: SHOP }));
  await page.route(`${API}/api/trace/products*`, (r: any) => r.fulfill({ json: { products: [] } }));
  // handler ต้องเป็น async + await ค่าที่ fulfill จะได้จริง
  // (ส่ง Promise เข้า fulfill ตรง ๆ = ตอบทันที ปุ่มเลยไม่เคยถูก disable ให้เห็น)
  await page.route(`${API}/api/payments/checkout-session`, async (r: any) => {
    const body = r.request().postDataJSON();
    opts.onCheckoutBody?.(body);
    const res = opts.checkout
      ? await opts.checkout()
      : { status: 201, json: { success: true, url: `${BASE}/shop?order=${PUBLIC_TOKEN}&stub=1`, refCode: PUBLIC_TOKEN, mode: 'mock' } };
    return r.fulfill(res);
  });
}

async function fillBuyer(page: any) {
  await page.getByLabel('ชื่อผู้สนับสนุน').fill('ทดสอบ ระบบ');
  await page.getByLabel('เบอร์ติดต่อ').fill('0812345678');
}

/**
 * ข้อความ error ของแผงนี้
 *
 * ต้อง scope เข้าไปใน panel เพราะ Next มี <p role="alert" id="__next-route-announcer">
 * ของตัวเองอยู่ในหน้าด้วย → getByRole('alert') ทั้งหน้าจะชนกัน 2 อัน (strict mode)
 */
function panelAlert(page: any) {
  return page.locator('section[aria-label="ชำระผ่านบัตร"]').getByRole('alert');
}

test.describe('แผงชำระผ่านบัตร (ล็อกอินแล้ว)', () => {
  test('ต้องเห็นปุ่มชำระต่อแพ็กเกจ', async ({ page }) => {
    await asSignedIn(page);
    await mockShop(page);
    await page.goto(`${BASE}/shop?id=${SHOP.id}`);
    await expect(page.getByRole('heading', { name: /ชำระผ่านบัตร/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ซื้อแพ็กเกจ แพ็กเกจทดสอบ A' })).toBeVisible();
  });

  test('กดซื้อโดยยังไม่กรอกชื่อ/เบอร์ → ต้องเตือน และไม่ยิง checkout', async ({ page }) => {
    await asSignedIn(page);
    let called = false;
    await mockShop(page, { onCheckoutBody: () => { called = true; } });
    await page.goto(`${BASE}/shop?id=${SHOP.id}`);
    await page.getByRole('button', { name: 'ซื้อแพ็กเกจ แพ็กเกจทดสอบ A' }).click();
    await expect(panelAlert(page)).toContainText('กรอกชื่อและเบอร์โทร');
    expect(called, 'ต้องไม่ยิง checkout-session ตอนฟอร์มยังไม่ครบ').toBe(false);
  });

  test('กำลังส่ง → ปุ่มถูกปิดและขึ้น "กำลังเปิดหน้าชำระ…"', async ({ page }) => {
    await asSignedIn(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await mockShop(page, { checkout: async () => { await gate; return { status: 201, json: { success: true, url: `${BASE}/` } }; } });
    await page.goto(`${BASE}/shop?id=${SHOP.id}`);
    await fillBuyer(page);
    await page.getByRole('button', { name: 'ซื้อแพ็กเกจ แพ็กเกจทดสอบ A' }).click();
    await expect(page.getByRole('button', { name: /กำลังเปิดหน้าชำระ/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'ซื้อแพ็กเกจ แพ็กเกจทดสอบ B' })).toBeDisabled();
    release();
    await page.waitForURL(/stub=|\/$/);
  });

  test('backend ตอบผิดพลาด → ต้องเห็นข้อความ และปุ่มกดใหม่ได้', async ({ page }) => {
    await asSignedIn(page);
    await mockShop(page, { checkout: () => ({ status: 400, json: { error: 'ยอดเงินเกินเพดาน' } }) });
    await page.goto(`${BASE}/shop?id=${SHOP.id}`);
    await fillBuyer(page);
    await page.getByRole('button', { name: 'ซื้อแพ็กเกจ แพ็กเกจทดสอบ A' }).click();
    await expect(panelAlert(page)).toContainText('ยอดเงินเกินเพดาน');
    await expect(page.getByRole('button', { name: 'ซื้อแพ็กเกจ แพ็กเกจทดสอบ A' })).toBeEnabled();
  });

  // ข้อสำคัญที่สุด: ยอดที่ส่งต้องเป็น order.total ตัวเดียวกันเป๊ะ ๆ
  // ต่างกันแม้แต่สตางค์เดียว = webhook ไม่ apply = ลูกค้าจ่ายแล้วเงินไม่เข้าออเดอร์
  test('ต้องส่งยอดเท่ากับ order.total และผูกด้วย publicToken', async ({ page }) => {
    await asSignedIn(page);
    let sent: any = null;
    await mockShop(page, { onCheckoutBody: (b) => { sent = b; } });
    await page.goto(`${BASE}/shop?id=${SHOP.id}`);
    await fillBuyer(page);
    await page.getByRole('button', { name: 'ซื้อแพ็กเกจ แพ็กเกจทดสอบ A' }).click();
    await page.waitForURL(/stub=1/);
    expect(sent.amountBaht, 'amountBaht ต้องเท่ากับ order.total ที่ server คืนมา').toBe(ORDER_TOTAL);
    expect(sent.refCode, 'refCode ต้องเป็น publicToken ไม่ใช่ orderNo').toBe(PUBLIC_TOKEN);
    expect(sent.productName).toBe('แพ็กเกจทดสอบ A');
  });

  test('จ่ายสำเร็จ → ต้องพาไปหน้าที่ Stripe คืนมา', async ({ page }) => {
    await asSignedIn(page);
    await mockShop(page);
    await page.goto(`${BASE}/shop?id=${SHOP.id}`);
    await fillBuyer(page);
    await page.getByRole('button', { name: 'ซื้อแพ็กเกจ แพ็กเกจทดสอบ B' }).click();
    await page.waitForURL(/stub=1/);
  });
});
