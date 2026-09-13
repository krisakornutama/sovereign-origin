import './setup-env';
import { randomUUID } from 'node:crypto';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import businessShopRoutes from '../src/modules/business/business-shop.routes';
import businessRoutes from '../src/modules/business/business.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// PUBLIC SHOP — หน้าร้านสาธารณะ + สั่งซื้อ + ชำระเงินผ่านลิงก์ลับ (publicToken)
// ใช้ in-memory store จำลอง Prisma delegate (แบบเดียวกับ businessPlatform.test.ts)
// ────────────────────────────────────────────────────────────────────────────

const BIZ_ID = '11111111-1111-1111-1111-111111111111';
const CLOSED_BIZ_ID = '15151515-1515-1515-1515-151515151515';
const OWNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MANAGER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const PRODUCT2_ID = '23232323-2323-2323-2323-232323232323';

// ── in-memory stores ──
const businesses = new Map<string, any>();
const members = new Map<string, any>();
const products = new Map<string, any>();
const customers = new Map<string, any>();
const orders = new Map<string, any>();
const orderLines = new Map<string, any[]>();
const payments = new Map<string, any[]>();
const ledger = new Map<string, any[]>();
const users = new Map<string, any>();
const treasuryEvents: any[] = [];
const sheets = new Map<string, any>();

let memberSeq = 0;
let customerSeq = 0;
let orderSeq = 0;
let ledgerSeq = 0;

before(async () => {
  businesses.set(BIZ_ID, {
    id: BIZ_ID, name: 'Siam IoT Shop', shopName: null, shopOpen: false, shopPromptPay: null,
    bizType: 'IOT_RETAIL', vatRate: 0.07, isActive: true, ownerId: OWNER_ID,
  });
  businesses.set(CLOSED_BIZ_ID, {
    id: CLOSED_BIZ_ID, name: 'ร้านปิด', shopName: null, shopOpen: false, shopPromptPay: null,
    bizType: 'IOT_RETAIL', vatRate: 0.07, isActive: true, ownerId: OWNER_ID,
  });
  members.set(`m-${memberSeq}`, { id: `m-${memberSeq++}`, businessId: BIZ_ID, userId: OWNER_ID, position: 'OWNER' });
  members.set(`m-${memberSeq}`, { id: `m-${memberSeq++}`, businessId: BIZ_ID, userId: MANAGER_ID, position: 'MANAGER' });
  users.set(OWNER_ID, { id: OWNER_ID, username: 'owner', role: 'SUPERADMIN' });
  users.set(MANAGER_ID, { id: MANAGER_ID, username: 'manager', role: 'OPERATOR' });
  products.set(PRODUCT_ID, {
    id: PRODUCT_ID, businessId: BIZ_ID, sku: 'ESP32-01', name: 'ESP32 Sensor Kit',
    category: 'SENSOR', specs: 'วัด 3 เฟส', costPrice: 80, salePrice: 107, stockQty: 5,
    reorderPoint: 2, warrantyMonths: 12, inventoryItemId: null, isActive: true,
  });
  products.set(PRODUCT2_ID, {
    id: PRODUCT2_ID, businessId: BIZ_ID, sku: 'CAM-00', name: 'IP Cam สต็อกหมด',
    category: 'CAMERA', specs: null, costPrice: 300, salePrice: 500, stockQty: 0,
    reorderPoint: 0, warrantyMonths: 6, inventoryItemId: null, isActive: true,
  });

  // ── prisma delegates ──
  (prisma as any).business = {
    findUnique: async ({ where }: any) => businesses.get(where.id) ?? null,
    findMany: async ({ where }: any) =>
      [...businesses.values()].filter((b) => (where?.isActive === undefined || b.isActive === where.isActive) && (where?.shopOpen === undefined || b.shopOpen === where.shopOpen)),
    update: async ({ where, data }: any) => {
      const b = { ...businesses.get(where.id), ...data };
      businesses.set(b.id, b);
      return b;
    },
  };
  (prisma as any).businessMember = {
    findUnique: async ({ where }: any) => {
      if (where.businessId_userId) {
        for (const m of members.values()) {
          if (m.businessId === where.businessId_userId.businessId && m.userId === where.businessId_userId.userId) return m;
        }
        return null;
      }
      for (const m of members.values()) if (m.id === where.id) return m;
      return null;
    },
  };
  (prisma as any).user = {
    findUnique: async ({ where }: any) => users.get(where.id) ?? null,
  };
  (prisma as any).businessProduct = {
    findUnique: async ({ where }: any) => products.get(where.id) ?? null,
    findMany: async ({ where }: any) => {
      let list = [...products.values()].filter((p) => !where?.businessId || p.businessId === where.businessId);
      if (where?.isActive !== undefined) list = list.filter((p) => p.isActive === where.isActive);
      if (where?.id?.in) list = list.filter((p) => where.id.in.includes(p.id));
      return list;
    },
  };
  (prisma as any).businessCustomer = {
    findFirst: async ({ where }: any) =>
      [...customers.values()].find((c) => c.businessId === where.businessId && c.phone === where.phone) ?? null,
    create: async ({ data }: any) => {
      const c = { id: `cust-${customerSeq++}`, ...data };
      customers.set(c.id, c);
      return c;
    },
  };
  (prisma as any).businessOrder = {
    findUnique: async ({ where, include }: any) => {
      const o = where.publicToken
        ? [...orders.values()].find((x) => x.publicToken === where.publicToken)
        : orders.get(where.id);
      if (!o) return null;
      return enrichOrder(o, include);
    },
    findFirst: async ({ where }: any) => {
      const prefix = where?.orderNo?.startsWith;
      if (!prefix) return null;
      let last: any = null;
      for (const o of orders.values()) {
        if (o.businessId === where.businessId && o.orderNo.startsWith(prefix)) last = last && last.orderNo > o.orderNo ? last : o;
      }
      return last ?? null;
    },
    findMany: async ({ where }: any) =>
      [...orders.values()].filter((o) => !where?.businessId || o.businessId === where.businessId),
    create: async ({ data }: any) => {
      const id = '44444444-4444-4444-4444-' + String(orderSeq++).padStart(12, '0');
      const o = {
        id, status: 'QUOTE', paidAmount: 0, createdAt: new Date(), updatedAt: new Date(),
        customerId: null, channel: 'ONLINE', assignedToId: null, note: null,
        ...data, // publicToken ไม่ default — service ต้องสร้างเอง (ทดสอบจับถ้าลืม)
      };
      orders.set(id, o);
      orderLines.set(id, (data.lines?.create ?? []).map((l: any, i: number) => ({ id: `${id}-l${i}`, orderId: id, description: null, ...l })));
      return o;
    },
    update: async ({ where, data }: any) => {
      const o = { ...orders.get(where.id), ...data, updatedAt: new Date() };
      orders.set(o.id, o);
      return o;
    },
  };
  (prisma as any).businessOrderLine = {
    findMany: async ({ where }: any) => orderLines.get(where.orderId) ?? [],
  };
  (prisma as any).businessPayment = {
    findMany: async ({ where }: any) => payments.get(where.orderId) ?? [],
    create: async ({ data }: any) => {
      const list = payments.get(data.orderId) ?? [];
      const p = { id: `pay-${list.length}`, paidAt: new Date(), ...data };
      list.push(p);
      payments.set(data.orderId, list);
      return p;
    },
  };
  (prisma as any).businessLedgerEntry = {
    findFirst: async () => (ledger.get(BIZ_ID) ?? []).find((l) => l.refOrderId) ?? null,
    create: async ({ data }: any) => {
      const list = ledger.get(data.businessId) ?? [];
      const entry = { id: `led-${ledgerSeq++}`, createdAt: new Date(), ...data };
      list.push(entry);
      ledger.set(data.businessId, list);
      return entry;
    },
  };
  // treasury delegates — เช็คว่ารายได้ร้านไหลเข้า Treasury ของเจ้าของจริง (SHOP_INCOME)
  (prisma as any).personalBalanceSheet = {
    findUnique: async ({ where }: any) => sheets.get(where.user_id) ?? null,
    upsert: async ({ where, create }: any) => {
      const s = { liquid_cash_usd: 0, monthly_burn_usd: 0, monthly_income_usd: 0, liabilities_usd: 0, ...create };
      sheets.set(where.user_id, s);
      return s;
    },
    update: async ({ where, data }: any) => {
      const s = { ...sheets.get(where.user_id), ...data };
      sheets.set(where.user_id, s);
      return s;
    },
    updateMany: async () => ({ count: 0 }),
  };
  (prisma as any).treasuryEvent = {
    create: async ({ data }: any) => {
      const e = { id: `ev-${treasuryEvents.length}`, created_at: new Date(), ...data };
      treasuryEvents.push(e);
      return e;
    },
    findMany: async () => treasuryEvents,
  };

  // $transaction (callback form) — รองรับ raw query ทั้งของ business (ล็อกด้วย id) และ shop (ล็อกด้วย publicToken)
  const fakeTx: any = {
    $queryRaw: async (_sql: any, ...vals: any[]) => {
      const sql = String(_sql?.[0] ?? '');
      if (sql.includes('publicToken')) {
        const o = [...orders.values()].find((x) => x.publicToken === vals[0]);
        return o ? [o] : [];
      }
      const [id, businessId] = vals;
      const o = orders.get(id);
      return o && o.businessId === businessId ? [o] : [];
    },
    $executeRaw: async (_sql: any, ...vals: any[]) => {
      const sql = String(_sql?.[0] ?? '');
      if (sql.includes('stockQty" = "stockQty" -')) {
        const [qty, productId, needQty] = vals;
        const p = products.get(productId);
        if (!p || p.stockQty < needQty) return 0;
        p.stockQty -= qty;
        return 1;
      }
      if (sql.includes('stockQty" = "stockQty" +')) {
        const [qty, productId] = vals;
        const p = products.get(productId);
        if (!p) return 0;
        p.stockQty += qty;
        return 1;
      }
      return 0;
    },
    businessOrder: (prisma as any).businessOrder,
    businessOrderLine: (prisma as any).businessOrderLine,
    businessProduct: (prisma as any).businessProduct,
    businessPayment: (prisma as any).businessPayment,
    businessLedgerEntry: (prisma as any).businessLedgerEntry,
    business: (prisma as any).business,
    personalBalanceSheet: (prisma as any).personalBalanceSheet,
    treasuryEvent: (prisma as any).treasuryEvent,
  };
  mock.method(prisma, '$transaction', async (fn: any) => (typeof fn === 'function' ? fn(fakeTx) : Promise.all(fn)));

  server = await createTestServer((app) => {
    app.use('/api/shop', businessShopRoutes);
    app.use('/api/business', businessRoutes);
  });
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function enrichOrder(o: any, include?: any): any {
  const out = { ...o };
  if (include?.lines) out.lines = (orderLines.get(o.id) ?? []).map((l) => (include.lines?.include?.product ? { ...l, product: products.get(l.productId) } : l));
  if (include?.payments) out.payments = payments.get(o.id) ?? [];
  if (include?.customer) out.customer = customers.get(o.customerId) ?? null;
  if (include?.business) out.business = businesses.get(o.businessId) ?? null;
  return out;
}

const SHOP = '/api/shop';
const API = '/api/business';
function get(path: string, token?: string) {
  return fetch(server.baseUrl + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}
function post(path: string, body: unknown, token?: string) {
  return fetch(server.baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}
const shopOrder = (body: unknown) => post(`${SHOP}/${BIZ_ID}/orders`, body);

// ── กฎการเปิดร้าน ──
test('ร้านยังไม่เปิด / ธุรกิจไม่มีจริง = 404 ทั้งหน้าร้านและสั่งซื้อ (ไม่เผยว่ามีอยู่)', async () => {
  assert.equal((await get(`${SHOP}/${BIZ_ID}`)).status, 404);
  assert.equal((await get(`${SHOP}/${CLOSED_BIZ_ID}`)).status, 404);
  const order = await post(`${SHOP}/${CLOSED_BIZ_ID}/orders`, { items: [], customerName: 'x', customerPhone: 'y' });
  assert.equal(order.status, 404);
});

// ── เปิดร้านผ่าน settings ฝั่งร้าน (MANAGER ขึ้นไป) ──
test('MANAGER เปิดร้าน + ตั้งชื่อร้านได้ — แล้วหน้าร้านเห็นสินค้าไม่มีต้นทุน', async () => {
  const noAuth = await get(`${API}/${BIZ_ID}/shop`);
  assert.equal(noAuth.status, 401);
  const opened = await (await fetch(server.baseUrl + `${API}/${BIZ_ID}/shop`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('OPERATOR', { userId: MANAGER_ID })}` },
    body: JSON.stringify({ shopOpen: true, shopName: 'Siam IoT ร้านออนไลน์' }),
  })).json();
  assert.equal(opened.shopOpen, true);
  assert.equal(opened.shopName, 'Siam IoT ร้านออนไลน์');

  const shopPage = await (await get(`${SHOP}/${BIZ_ID}`)).json();
  assert.equal(shopPage.name, 'Siam IoT ร้านออนไลน์');
  assert.equal(shopPage.products.length, 2);
  const p = shopPage.products.find((x: any) => x.id === PRODUCT_ID);
  assert.equal(p.salePrice, 107);
  assert.equal(p.inStock, true);
  assert.ok(!('costPrice' in p), 'ห้ามโผล่ราคาทุนบนหน้าสาธารณะ');
  assert.ok(!('reorderPoint' in p) && !('inventoryItemId' in p));
  const out = shopPage.products.find((x: any) => x.id === PRODUCT2_ID);
  assert.equal(out.inStock, false);
});

// ── สั่งซื้อ ──
test('สั่งซื้อผ่านหน้าร้าน → QUOTE + publicToken + ไม่หักสต็อก + ได้ลูกค้า walk-in', async () => {
  const stockBefore = products.get(PRODUCT_ID).stockQty;
  const res = await shopOrder({
    items: [{ productId: PRODUCT_ID, qty: 2 }],
    customerName: 'ลูกค้าเว็บ',
    customerPhone: '0891112222',
  });
  assert.equal(res.status, 201);
  const o = await res.json();
  assert.ok(/^S\d{8}-\d{4}$/.test(o.orderNo)); // S20260913-0001 (คนละชุดกับ B… ในระบบ)
  assert.equal(o.status, 'QUOTE');
  assert.equal(o.total, 228.98);
  assert.equal(o.total, 228.98);
  assert.ok(o.publicToken, 'ต้องได้ลิงก์ลับสำหรับเช็คสถานะ/ชำระเงิน');
  assert.match(o.publicToken, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'token ต้องเป็น UUID — ห้ามใช้ id ภายในเป็นลิงก์ลับ');
  assert.equal(products.get(PRODUCT_ID).stockQty, stockBefore, 'สั่งจากเว็บยังไม่หักสต็อก — หักตอนร้านยืนยัน');
  assert.ok([...customers.values()].some((c) => c.phone === '0891112222' && c.name === 'ลูกค้าเว็บ'));

  // สินค้าไม่อยู่ในร้าน → 400
  assert.equal((await shopOrder({ items: [{ productId: '99999999-9999-9999-9999-999999999999', qty: 1 }], customerName: 'a', customerPhone: 'b' })).status, 400);
  // จำนวนไม่ใช่ตัวเลข → 400
  assert.equal((await shopOrder({ items: [{ productId: PRODUCT_ID, qty: 'abc' }], customerName: 'a', customerPhone: 'b' })).status, 400);
  // เกินสต็อก → 400 + ระบุสินค้า
  const over = await shopOrder({ items: [{ productId: PRODUCT_ID, qty: 99 }], customerName: 'a', customerPhone: 'b' });
  assert.equal(over.status, 400);
  assert.ok((await over.json()).error.includes('สต็อกไม่พอ'));
  // ไม่กรอกชื่อ/เบอร์ → 400
  assert.equal((await shopOrder({ items: [{ productId: PRODUCT_ID, qty: 1 }] })).status, 400);
});

// ── สถานะผ่านลิงก์ลับ ──
test('เช็คสถานะผ่านลิงก์ลับ → เห็นยอดครบ ไม่เห็นข้อมูลส่วนเกิน · token ผิด = 404', async () => {
  const created = await (await shopOrder({ items: [{ productId: PRODUCT_ID, qty: 2 }], customerName: 'สถานะ', customerPhone: '0893334444' })).json();
  const st = await (await get(`${SHOP}/orders/${created.publicToken}`)).json();
  assert.equal(st.orderNo, created.orderNo);
  assert.equal(st.total, 228.98);
  assert.equal(st.remaining, 228.98);
  assert.equal(st.lines[0].name, 'ESP32 Sensor Kit');
  assert.ok(!('costPrice' in st.lines[0]));
  assert.equal(st.shop.name, 'Siam IoT ร้านออนไลน์', 'สถานะต้องบอกชื่อร้านด้วย (ตอนนี้เปิดร้านแล้ว)');

  assert.equal((await get(`${SHOP}/orders/${randomUUID()}`)).status, 404);
  assert.equal((await get(`${SHOP}/orders/not-a-uuid`)).status, 404);
});

// ── แจ้งชำระผ่านลิงก์ลับ ──
test('แจ้งชำระ: จ่ายเกินโดนโต้ง · จ่ายบางส่วน → remaining ถูก · ครบแล้วจ่ายซ้ำไม่ได้', async () => {
  const created = await (await shopOrder({ items: [{ productId: PRODUCT_ID, qty: 2 }], customerName: 'จ่ายเอง', customerPhone: '0895556666' })).json();
  const token = created.publicToken;

  // จ่ายเกินยอด → 400
  const over = await post(`${SHOP}/orders/${token}/pay`, { amount: 9999 });
  assert.equal(over.status, 400);
  assert.ok((await over.json()).error.includes('คงเหลือ'));

  // token ผิดรูปแบบ → 404 (กัน prisma uuid cast error รั่วเป็น 500)
  assert.equal((await post(`${SHOP}/orders/not-a-uuid/pay`, { amount: 1 })).status, 404);

  // จ่ายบางส่วน 100 → remaining 128.98
  const part = await (await post(`${SHOP}/orders/${token}/pay`, { amount: 100 })).json();
  assert.equal(part.orderNo, created.orderNo);
  assert.ok(Math.abs(part.remaining - 128.98) < 0.001);

  // จ่ายที่เหลือ → remaining 0 (ร้านยังต้องตรวจเงินเข้าจริงก่อน mark-paid เอง)
  const rest = await (await post(`${SHOP}/orders/${token}/pay`, { amount: 128.98 })).json();
  assert.equal(rest.remaining, 0);

  // ครบแล้ว → 400
  const again = await post(`${SHOP}/orders/${token}/pay`, { amount: 1 });
  assert.equal(again.status, 400);
  assert.ok((await again.json()).error.includes('ชำระครบแล้ว'));

  // payments บันทึกจริง (method PROMPTPAY + reference = token)
  const st = await (await get(`${SHOP}/orders/${token}`)).json();
  assert.equal(st.payments.length, 2);
  assert.equal(st.payments[0].method, 'PROMPTPAY');
});

// ── ร้านยืนยันออเดอร์ที่ลูกค้าสั่งจากเว็บ → หักสต็อก (รวมกับ state machine เดิม) ──
test('ร้านยืนยันออเดอร์จากเว็บผ่าน router เดิม → ORDERED + หักสต็อกจริง', async () => {
  const stockBefore = products.get(PRODUCT_ID).stockQty;
  const created = await (await shopOrder({ items: [{ productId: PRODUCT_ID, qty: 2 }], customerName: 'ยืนยันผ่าน', customerPhone: '0897778888' })).json();
  const mgr = makeToken('OPERATOR', { userId: MANAGER_ID });
  const confirmed = await (await post(`${API}/${BIZ_ID}/orders/${created.id}/transition`, { action: 'confirm' }, mgr)).json();
  assert.equal(confirmed.status, 'ORDERED');
  assert.equal(products.get(PRODUCT_ID).stockQty, stockBefore - 2);
});

// ── รายได้ร้านเข้า Treasury ของเจ้าของอัตโนมัติ ──
test('ร้าน mark-paid → เงินเข้า Treasury เจ้าของเป็น SHOP_INCOME (แปลง ฿→$ ด้วย USD_THB_RATE)', async () => {
  const created = await (await shopOrder({ items: [{ productId: PRODUCT_ID, qty: 1 }], customerName: 'ทรสอ', customerPhone: '0890001111' })).json();
  const mgr = makeToken('OPERATOR', { userId: MANAGER_ID });
  await post(`${API}/${BIZ_ID}/orders/${created.id}/transition`, { action: 'confirm' }, mgr);
  const paid = await (await post(`${API}/${BIZ_ID}/orders/${created.id}/transition`, { action: 'mark-paid' }, mgr)).json();
  assert.equal(paid.status, 'PAID');

  const rate = Number(process.env.USD_THB_RATE || 35) || 35;
  const ev = treasuryEvents.find((e) => e.type === 'SHOP_INCOME' && e.note.includes(created.orderNo));
  assert.ok(ev, 'ต้องมี SHOP_INCOME event อ้างออเดอร์ร้าน');
  assert.ok(Math.abs(ev.amount_usd - created.total / rate) < 0.0001, 'ยอดเป็นดอลลาร์ถูกต้อง');
  assert.equal(sheets.get(OWNER_ID).liquid_cash_usd, ev.amount_usd, 'เงินสดของเจ้าของเพิ่มจริง');
});

// ── PromptPay ──
test('PromptPay: ยังไม่ตั้ง = configured:false · ตั้งผิดรูปแบบโดนปฏิเสธ · payload EMVCo มียอดถูกต้อง', async () => {
  const none = await (await get(`${SHOP}/${BIZ_ID}/promptpay?amount=228.98`)).json();
  assert.equal(none.configured, false);

  // ตั้งค่าผิดรูปแบบ → 400 (ร้านต้องรู้ตัว ไม่ใช่ QR เงียบ)
  const bad = await fetch(server.baseUrl + `${API}/${BIZ_ID}/shop`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('OPERATOR', { userId: MANAGER_ID })}` },
    body: JSON.stringify({ shopPromptPay: '123' }),
  });
  assert.equal(bad.status, 400);

  const ok = await fetch(server.baseUrl + `${API}/${BIZ_ID}/shop`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken('OPERATOR', { userId: MANAGER_ID })}` },
    body: JSON.stringify({ shopPromptPay: '0812345678' }),
  });
  assert.equal(ok.status, 200);
  const settings = await ok.json();
  assert.equal(settings.promptPaySet, true);
  assert.ok(settings.promptPayMasked.includes('5678'), 'คืนแบบ mask ไม่ให้ UI อ่านเลขเต็มกลับ');

  const info = await (await get(`${SHOP}/${BIZ_ID}/promptpay?amount=228.98`)).json();
  assert.equal(info.configured, true);
  assert.equal(info.amountThb, 228.98); // payload/ยอดของ EMVCo ทดสอบแล้วใน promptpay.test.ts — ที่นี่เช็คแค่ QR + mask
  assert.ok(info.maskedTarget.includes('5678'));
  assert.ok(info.qrDataUrl.startsWith('data:image/png;base64,'), 'ได้ QR สำเร็จรูปเป็น data URL วาดใน <img> ได้เลย');
});

// ── Rate limit (public ต้องมี) — ทดสอบท้ายสุดเพราะ bucket โดนบล็อกต่อเนื่อง ──
test('ยิงสั่งซื้อถี่เกิน → 429 (rate limit ระดับ public)', async () => {
  let got429 = false;
  for (let i = 0; i < 60 && !got429; i++) {
    const res = await shopOrder({ items: [{ productId: PRODUCT_ID, qty: 'abc' }], customerName: 'x', customerPhone: 'y' });
    if (res.status === 429) got429 = true;
  }
  assert.ok(got429, 'ควรโดน 429 เมื่อยิงเกิน limiter');
});
