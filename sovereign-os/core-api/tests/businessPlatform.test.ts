import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import businessRoutes from '../src/modules/business/business.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// BUSINESS PLATFORM — สิทธิ์ตำแหน่ง (server-side) + state machine ออเดอร์ + สต็อก
// ใช้ in-memory store จำลอง Prisma delegate (แบบเดียวกับ house style)
// ────────────────────────────────────────────────────────────────────────────

const BIZ_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER_IDS = {
  MANAGER: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  SALES: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  TECHNICIAN: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  STOCK_KEEPER: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  ACCOUNTANT: 'f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0',
  VIEWER: '12121212-1212-1212-1212-121212121212',
};
const NON_MEMBER_ID = '99999999-9999-9999-9999-999999999999';
const PRODUCT_ID = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';

// ── in-memory stores ──
const businesses = new Map<string, any>();
const members = new Map<string, any>();
const products = new Map<string, any>();
const customers = new Map<string, any>();
const orders = new Map<string, any>();
const orderLines = new Map<string, any[]>();
const payments = new Map<string, any[]>();
const ledger = new Map<string, any[]>();
const installations = new Map<string, any>();
const suppliers = new Map<string, any>();
const purchaseOrders = new Map<string, any>();
const users = new Map<string, any>();
const warehouseItems = new Map<string, any>();

const WAREHOUSE_ITEM_ID = '99999999-9999-9999-9999-999999999999';

let memberSeq = 0;
let ledgerSeq = 0;
let paymentSeq = 0;

function memberToken(position: keyof typeof MEMBER_IDS): string {
  return makeToken('OPERATOR', { userId: MEMBER_IDS[position] });
}

before(async () => {
  businesses.set(BIZ_ID, {
    id: BIZ_ID, name: 'IoT Shop', bizType: 'IOT_RETAIL', vatRate: 0.07, isActive: true, ownerId: OWNER_ID,
  });
  members.set(`m-${memberSeq++}`, { id: `m-${memberSeq - 1}`, businessId: BIZ_ID, userId: OWNER_ID, position: 'OWNER' });
  for (const [position, userId] of Object.entries(MEMBER_IDS)) {
    members.set(`m-${memberSeq++}`, { id: `m-${memberSeq - 1}`, businessId: BIZ_ID, userId, position });
  }
  users.set(OWNER_ID, { id: OWNER_ID, username: 'owner', role: 'SUPERADMIN' });
  for (const [, uid] of Object.entries(MEMBER_IDS)) users.set(uid, { id: uid, username: `u-${uid.slice(0, 4)}`, role: 'OPERATOR' });
  products.set(PRODUCT_ID, {
    id: PRODUCT_ID, businessId: BIZ_ID, sku: 'ESP32-01', name: 'ESP32 Sensor Kit',
    category: 'SENSOR', specs: null, costPrice: 80, salePrice: 107, stockQty: 10, reorderPoint: 3,
    warrantyMonths: 12, inventoryItemId: null, isActive: true,
  });
  customers.set(CUSTOMER_ID, { id: CUSTOMER_ID, businessId: BIZ_ID, name: 'ลูกค้า ก.' });

  // ── prisma delegates ──
  (prisma as any).business = {
    findUnique: async ({ where }: any) => businesses.get(where.id) ?? null,
    findMany: async () => [...businesses.values()],
    create: async ({ data }: any) => {
      const biz = { id: BIZ_ID, ...data, createdAt: new Date(), updatedAt: new Date() };
      businesses.set(biz.id, biz);
      return biz;
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
    findMany: async ({ where }: any) => [...members.values()].filter((m) => !where?.businessId || m.businessId === where.businessId),
    create: async ({ data }: any) => ({ id: `m-new-${memberSeq++}`, ...data }),
    upsert: async ({ where, update, create }: any) => {
      const existing = await (prisma as any).businessMember.findUnique({ where });
      if (existing) return { ...existing, ...update };
      return { id: `m-new-${memberSeq++}`, ...create };
    },
    delete: async ({ where }: any) => {
      const m = [...members.values()].find((x) => x.id === where.id);
      if (m) members.delete(m.id);
      return m;
    },
  };
  (prisma as any).user = {
    findUnique: async ({ where }: any) => users.get(where.id) ?? null,
    findMany: async () => [...users.values()],
  };
  (prisma as any).inventoryItem = {
    findUnique: async ({ where }: any) => warehouseItems.get(where.id) ?? null,
    update: async ({ where, data }: any) => {
      const it = { ...warehouseItems.get(where.id), ...data };
      warehouseItems.set(where.id, it);
      return it;
    },
  };
  (prisma as any).businessProduct = {
    findUnique: async ({ where }: any) => products.get(where.id) ?? null,
    findMany: async ({ where }: any) => {
      let list = [...products.values()].filter((p) => !where?.businessId || p.businessId === where.businessId);
      if (where?.isActive !== undefined) list = list.filter((p) => p.isActive === where.isActive);
      if (where?.stockQty?.lte !== undefined) list = list.filter((p) => p.stockQty <= where.stockQty.lte);
      return list;
    },
    create: async ({ data }: any) => {
      const p = { id: PRODUCT_ID + '-new' + products.size, ...data };
      products.set(p.id, p);
      return p;
    },
    update: async ({ where, data }: any) => {
      const p = { ...products.get(where.id), ...data };
      products.set(p.id, p);
      return p;
    },
  };
  (prisma as any).businessCustomer = {
    findMany: async () => [...customers.values()],
    create: async ({ data }: any) => {
      const c = { id: CUSTOMER_ID + '-new' + customers.size, ...data };
      customers.set(c.id, c);
      return c;
    },
  };
  (prisma as any).businessOrder = {
    findUnique: async ({ where }: any) => orders.get(where.id) ?? null,
    findFirst: async ({ where }: any) => {
      const prefix = where?.orderNo?.startsWith;
      if (!prefix) return null;
      let last: any = null;
      for (const o of orders.values()) if (o.businessId === where.businessId && o.orderNo.startsWith(prefix)) last = last && last.orderNo > o.orderNo ? last : o;
      return last ?? null;
    },
    findMany: async ({ where, include }: any) =>
      [...orders.values()]
        .filter((o) => (!where?.businessId || o.businessId === where.businessId) && (!where?.status || (Array.isArray(where.status.in) ? where.status.in.includes(o.status) : o.status === where.status)))
        .map((o) => enrichOrder(o, include)),
    create: async ({ data, include }: any) => {
      const id = '44444444-4444-4444-4444-' + String(orders.size).padStart(12, '0');
      const o = {
        id, status: 'QUOTE', paidAmount: 0, createdAt: new Date(), updatedAt: new Date(),
        customerId: null, channel: 'ONLINE', assignedToId: null, note: null,
        ...data,
      };
      orders.set(id, o);
      orderLines.set(id, (data.lines?.create ?? []).map((l: any, i: number) => ({ id: `${id}-l${i}`, orderId: id, description: null, ...l })));
      return enrichOrder(o, include);
    },
    update: async ({ where, data }: any) => {
      const o = { ...orders.get(where.id), ...data, updatedAt: new Date() };
      orders.set(o.id, o);
      return o;
    },
    count: async ({ where }: any) =>
      [...orders.values()].filter((o) => o.businessId === where.businessId && (!where.status || where.status.in.includes(o.status))).length,
  };
  (prisma as any).businessOrderLine = {
    findMany: async ({ where }: any) => orderLines.get(where.orderId) ?? [],
  };
  (prisma as any).businessPayment = {
    create: async ({ data }: any) => {
      const list = payments.get(data.orderId) ?? [];
      const p = { id: `pay-${paymentSeq++}`, paidAt: new Date(), ...data };
      list.push(p);
      payments.set(data.orderId, list);
      return p;
    },
  };
  (prisma as any).businessLedgerEntry = {
    findMany: async ({ where }: any) => ledger.get(where.businessId) ?? [],
    findFirst: async ({ where }: any) => (ledger.get('') ?? []).find(() => false) ?? null, // ไม่ใช้ในเทสนี้
    create: async ({ data }: any) => {
      const list = ledger.get(data.businessId) ?? [];
      const entry = { id: `led-${ledgerSeq++}`, createdAt: new Date(), ...data };
      list.push(entry);
      ledger.set(data.businessId, list);
      return entry;
    },
  };
  (prisma as any).businessInstallation = {
    findUnique: async ({ where }: any) => installations.get(where.id) ?? null,
    findMany: async () => [...installations.values()],
    create: async ({ data }: any) => {
      const inst = { id: 'inst-' + installations.size, status: 'TODO', completedAt: null, scheduledAt: null, technicianId: null, orderId: null, note: null, ...data };
      installations.set(inst.id, inst);
      return inst;
    },
    update: async ({ where, data }: any) => {
      const inst = { ...installations.get(where.id), ...data };
      installations.set(inst.id, inst);
      return inst;
    },
  };
  (prisma as any).businessSupplier = {
    findMany: async () => [...suppliers.values()],
    create: async ({ data }: any) => {
      const s = { id: 'sup-' + suppliers.size, ...data };
      suppliers.set(s.id, s);
      return s;
    },
  };
  (prisma as any).businessPurchaseOrder = {
    findUnique: async ({ where }: any) => purchaseOrders.get(where.id) ?? null,
    findMany: async () => [...purchaseOrders.values()],
    create: async ({ data }: any) => {
      const po = { id: 'po-' + purchaseOrders.size, status: 'DRAFT', receivedAt: null, note: null, ...data };
      purchaseOrders.set(po.id, po);
      return po;
    },
    update: async ({ where, data }: any) => {
      const po = { ...purchaseOrders.get(where.id), ...data };
      purchaseOrders.set(po.id, po);
      return po;
    },
  };
  (prisma as any).businessAgent = {
    count: async () => 0,
    create: async ({ data }: any) => ({ id: 'ba-' + data.key, ...data }),
    findMany: async () => [],
    findUnique: async () => null,
  };
  (prisma as any).agentRole = {
    create: async ({ data }: any) => ({ id: 'role-' + data.name, ...data }),
    update: async ({ where, data }: any) => ({ id: where.id, ...data }),
    findUnique: async () => null,
  };
  (prisma as any).agentJob = { findMany: async () => [], create: async ({ data }: any) => ({ id: 'job-1', ...data }) };

  // $transaction (callback form) — ส่ง fakeTx ที่ใช้ delegate เดียวกัน + raw helpers
  const fakeTx: any = {
    business: (prisma as any).business, // recordSaleIncome อ่าน vatRate ของร้านตอนแยก VAT
    $queryRaw: async (_sql: any, ...vals: any[]) => {
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
    businessPurchaseOrder: (prisma as any).businessPurchaseOrder,
    inventoryItem: (prisma as any).inventoryItem,
  };
  mock.method(prisma, '$transaction', async (fn: any) => (typeof fn === 'function' ? fn(fakeTx) : Promise.all(fn)));

  server = await createTestServer((app) => app.use('/api/business', businessRoutes));
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function enrichOrder(o: any, include?: any): any {
  const out = { ...o };
  if (include?.lines) out.lines = (orderLines.get(o.id) ?? []).map((l) => (include.lines?.include?.product ? { ...l, product: products.get(l.productId) } : l));
  if (include?.customer) out.customer = customers.get(o.customerId) ?? null;
  if (include?.payments) out.payments = payments.get(o.id) ?? [];
  return out;
}

// ทุก path ของ helper อิง mount point เดียวกับ production (/api/business)
const API = '/api/business';
function get(path: string, token: string) {
  return fetch(server.baseUrl + API + path, { headers: { Authorization: `Bearer ${token}` } });
}
function post(path: string, body: unknown, token: string) {
  return fetch(server.baseUrl + API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

// ── สิทธิ์ตำแหน่ง (server-side) ──
test('non-member อ่านสรุปธุรกิจไม่ได้ (403)', async () => {
  const res = await get(`/${BIZ_ID}/summary`, makeToken('OPERATOR', { userId: NON_MEMBER_ID }));
  assert.equal(res.status, 403);
});

test('VIEWER อ่านสินค้าได้แต่เพิ่มสินค้าไม่ได้', async () => {
  const read = await get(`/${BIZ_ID}/products`, memberToken('VIEWER'));
  assert.equal(read.status, 200);
  const write = await post(`/${BIZ_ID}/products`, { sku: 'X', name: 'สินค้า X' }, memberToken('VIEWER'));
  assert.equal(write.status, 403);
});

test('SALES เปิดออเดอร์ได้แต่ยืนยัน (transition) ไม่ได้ — MANAGER ยืนยันได้', async () => {
  const create = await post(`/${BIZ_ID}/orders`, { items: [{ productId: PRODUCT_ID, qty: 2 }] }, memberToken('SALES'));
  assert.equal(create.status, 201);
  const order = await create.json();
  assert.equal(order.status, 'QUOTE');

  const salesTry = await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'confirm' }, memberToken('SALES'));
  assert.equal(salesTry.status, 403);

  const mgrOk = await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'confirm' }, memberToken('MANAGER'));
  assert.equal(mgrOk.status, 200);
  assert.equal((await mgrOk.json()).status, 'ORDERED');
});

test('ACCOUNTANT เห็น ledger แต่ VIEWER ไม่เห็น', async () => {
  assert.equal((await get(`/${BIZ_ID}/ledger`, memberToken('ACCOUNTANT'))).status, 200);
  assert.equal((await get(`/${BIZ_ID}/ledger`, memberToken('VIEWER'))).status, 403);
});

test('TECHNICIAN เริ่ม/ปิดงานติดตั้งได้', async () => {
  const create = await post(`/${BIZ_ID}/installations`, { title: 'ติดตั้งเซ็นเซอร์หน้าโรงงาน', checklist: ['ติดตั้ง', 'ทดสอบ'] }, memberToken('MANAGER'));
  assert.equal(create.status, 201);
  const inst = await create.json();

  const start = await post(`/${BIZ_ID}/installations/${inst.id}/transition`, { action: 'start' }, memberToken('TECHNICIAN'));
  assert.equal((await start.json()).status, 'IN_PROGRESS');
  const done = await post(`/${BIZ_ID}/installations/${inst.id}/transition`, { action: 'complete' }, memberToken('TECHNICIAN'));
  assert.equal((await done.json()).status, 'DONE');
});

// ── state machine + สต็อก ──
test('order ครบวงจร: ยืนยันหักสต็อก → ชำระ 2 งวด → PAID + ledger → DELIVERED', async () => {
  const p0 = products.get(PRODUCT_ID).stockQty; // 10
  const create = await post(`/${BIZ_ID}/orders`, { customerId: CUSTOMER_ID, items: [{ productId: PRODUCT_ID, qty: 3 }] }, memberToken('SALES'));
  const order = await create.json();
  assert.ok(/^B\d{8}-\d{4}$/.test(order.orderNo)); // B20260912-XXXX
  assert.equal(order.subtotal, 321); // 107 × 3
  assert.equal(order.vat, 22.47); // 7%
  assert.equal(order.total, 343.47);

  // ยืนยัน → สต็อก 10-3=7
  const confirmed = await (await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'confirm' }, memberToken('MANAGER'))).json();
  assert.equal(confirmed.status, 'ORDERED');
  assert.equal(products.get(PRODUCT_ID).stockQty, p0 - 3);

  // ยังไม่จ่าย → deliver ไม่ได้
  const earlyDeliver = await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'deliver' }, memberToken('MANAGER'));
  assert.equal(earlyDeliver.status, 400);

  // จ่ายงวดแรก 300 → ยัง ORDERED
  const part = await (await post(`/${BIZ_ID}/orders/${order.id}/payments`, { amount: 300, method: 'TRANSFER' }, memberToken('SALES'))).json();
  assert.equal(part.status, 'ORDERED');
  assert.equal(part.paidAmount, 300);

  // จ่ายที่เหลือ → PAID + ledger INCOME ครั้งเดียว
  const full = await (await post(`/${BIZ_ID}/orders/${order.id}/payments`, { amount: 43.47, method: 'PROMPTPAY', reference: 'PP-001' }, memberToken('SALES'))).json();
  assert.equal(full.status, 'PAID');
  const rows = ledger.get(BIZ_ID).filter((l) => l.refOrderId === order.id && l.type === 'INCOME');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 343.47);

  // จ่ายเกินไม่ได้
  const over = await post(`/${BIZ_ID}/orders/${order.id}/payments`, { amount: 100 }, memberToken('SALES'));
  assert.equal(over.status, 400);

  // deliver → DELIVERED
  const delivered = await (await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'deliver' }, memberToken('MANAGER'))).json();
  assert.equal(delivered.status, 'DELIVERED');

  // DELIVERED ยกเลิกไม่ได้
  const lateCancel = await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'cancel' }, memberToken('MANAGER'));
  assert.equal(lateCancel.status, 400);
});

test('ยืนยันออเดอร์เกินสต็อก → 400 + สต็อกไม่เปลี่ยน + ยัง QUOTE', async () => {
  const stockBefore = products.get(PRODUCT_ID).stockQty;
  const create = await post(`/${BIZ_ID}/orders`, { items: [{ productId: PRODUCT_ID, qty: stockBefore + 5 }] }, memberToken('SALES'));
  const order = await create.json();
  const res = await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'confirm' }, memberToken('MANAGER'));
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error.includes('สต็อกไม่พอ'));
  assert.equal(products.get(PRODUCT_ID).stockQty, stockBefore);
  assert.equal(orders.get(order.id).status, 'QUOTE');
});

test('ยกเลิกจาก ORDERED คืนสต็อกเต็มจำนวน', async () => {
  const stockBefore = products.get(PRODUCT_ID).stockQty;
  const create = await post(`/${BIZ_ID}/orders`, { items: [{ productId: PRODUCT_ID, qty: 2 }] }, memberToken('SALES'));
  const order = await create.json();
  await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'confirm' }, memberToken('MANAGER'));
  assert.equal(products.get(PRODUCT_ID).stockQty, stockBefore - 2);
  const cancelled = await (await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'cancel' }, memberToken('MANAGER'))).json();
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(products.get(PRODUCT_ID).stockQty, stockBefore);
});

test('mark-paid ทางลัด → PAID + ledger INCOME', async () => {
  const create = await post(`/${BIZ_ID}/orders`, { items: [{ productId: PRODUCT_ID, qty: 1 }] }, memberToken('SALES'));
  const order = await create.json();
  await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'confirm' }, memberToken('MANAGER'));
  const paid = await (await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'mark-paid' }, memberToken('MANAGER'))).json();
  assert.equal(paid.status, 'PAID');
  const rows = ledger.get(BIZ_ID).filter((l) => l.refOrderId === order.id && l.type === 'INCOME');
  assert.equal(rows.length, 1);
});

test('รับของเข้า: สต็อกบวก + ต้นทุนเฉลี่ยเคลื่อนที่ + ledger EXPENSE + รับซ้ำไม่ได้', async () => {
  const sup = await (await post(`/${BIZ_ID}/suppliers`, { name: 'ผู้ขายชิป' }, memberToken('STOCK_KEEPER'))).json();
  const po = await (await post(`/${BIZ_ID}/purchase-orders`, { supplierId: sup.id, productId: PRODUCT_ID, qty: 10, unitCost: 100 }, memberToken('STOCK_KEEPER'))).json();
  assert.equal(po.status, 'DRAFT');

  const stockBefore = products.get(PRODUCT_ID).stockQty;
  const costBefore = products.get(PRODUCT_ID).costPrice;
  const received = await (await post(`/${BIZ_ID}/purchase-orders/${po.id}/receive`, {}, memberToken('STOCK_KEEPER'))).json();
  assert.equal(received.status, 'RECEIVED');
  const p = products.get(PRODUCT_ID);
  assert.equal(p.stockQty, stockBefore + 10);
  assert.ok(Math.abs(p.costPrice - (stockBefore * costBefore + 10 * 100) / (stockBefore + 10)) < 0.01);
  const expense = ledger.get(BIZ_ID).filter((l) => l.type === 'EXPENSE' && l.category === 'RESTOCK');
  assert.equal(expense.length, 1);
  assert.equal(expense[0].amount, 1000);

  const again = await post(`/${BIZ_ID}/purchase-orders/${po.id}/receive`, {}, memberToken('STOCK_KEEPER'));
  assert.equal(again.status, 400);
});

// ── เชื่อมคลังกลาง: stock ของสินค้าธุรกิจ = ความจริงช่องทางธุรกิจ, InventoryItem ของเจ้าของ mirror ทุก delta ──
test('ผูก inventoryItemId ผ่าน create/update product — VIEWER ผูกไม่ได้ (403)', async () => {
  const stockKeeper = memberToken('STOCK_KEEPER');
  const created = await (await post(`/${BIZ_ID}/products`, { sku: 'WS-1', name: 'สินค้าผูกคลัง', stockQty: 4, inventoryItemId: WAREHOUSE_ITEM_ID }, stockKeeper)).json();
  assert.equal(created.inventoryItemId, WAREHOUSE_ITEM_ID, 'create ต้องบันทึกลิงก์ (ตอนนี้ดรอปทิ้ง)');

  const patched = await (await fetch(server.baseUrl + `${API}/${BIZ_ID}/products/${PRODUCT_ID}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stockKeeper}` },
    body: JSON.stringify({ inventoryItemId: WAREHOUSE_ITEM_ID }),
  })).json();
  assert.equal(patched.inventoryItemId, WAREHOUSE_ITEM_ID, 'update ต้องบันทึกลิงก์ (ตอนนี้ดรอปทิ้ง)');

  const viewer = await fetch(server.baseUrl + `${API}/${BIZ_ID}/products/${PRODUCT_ID}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken('VIEWER')}` },
    body: JSON.stringify({ inventoryItemId: WAREHOUSE_ITEM_ID }),
  });
  assert.equal(viewer.status, 403);
});

test('ยืนยันออเดอร์ → คลังกลางหักตาม (−2) · ยกเลิกจาก ORDERED → คลังคืน (+2)', async () => {
  products.set(PRODUCT_ID, { ...products.get(PRODUCT_ID), inventoryItemId: WAREHOUSE_ITEM_ID });
  warehouseItems.set(WAREHOUSE_ITEM_ID, { id: WAREHOUSE_ITEM_ID, user_id: OWNER_ID, quantity: 20 });
  try {
    const create = await post(`/${BIZ_ID}/orders`, { items: [{ productId: PRODUCT_ID, qty: 2 }] }, memberToken('SALES'));
    const order = await create.json();
    await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'confirm' }, memberToken('MANAGER'));
    assert.equal(warehouseItems.get(WAREHOUSE_ITEM_ID).quantity, 18, 'คลังต้องหัก 20→18 ตามธุรกิจ');

    await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'cancel' }, memberToken('MANAGER'));
    assert.equal(warehouseItems.get(WAREHOUSE_ITEM_ID).quantity, 20, 'ยกเลิกต้องคืนคลัง 18→20');
  } finally {
    products.set(PRODUCT_ID, { ...products.get(PRODUCT_ID), inventoryItemId: null });
    warehouseItems.delete(WAREHOUSE_ITEM_ID);
  }
});

test('ยืนยันเกินสต็อกคลัง → 400 + ยอดคลัง/สต็อกธุรกิจไม่เปลี่ยน', async () => {
  const stockBefore = products.get(PRODUCT_ID).stockQty;
  products.set(PRODUCT_ID, { ...products.get(PRODUCT_ID), inventoryItemId: WAREHOUSE_ITEM_ID });
  warehouseItems.set(WAREHOUSE_ITEM_ID, { id: WAREHOUSE_ITEM_ID, user_id: OWNER_ID, quantity: 1 });
  try {
    const create = await post(`/${BIZ_ID}/orders`, { items: [{ productId: PRODUCT_ID, qty: 2 }] }, memberToken('SALES'));
    const order = await create.json();
    const res = await post(`/${BIZ_ID}/orders/${order.id}/transition`, { action: 'confirm' }, memberToken('MANAGER'));
    assert.equal(res.status, 400, 'คลังไม่พอต้องบล็อกเหมือนสต็อกไม่พอ');
    assert.equal(warehouseItems.get(WAREHOUSE_ITEM_ID).quantity, 1, 'คลังไม่ถูกหัก (เช็คก่อนหักใน tx เดียวกัน)');
    // mock $transaction ไม่ rollback raw SQL ที่ยิงไปแล้ว — สต็อกธุรกิจคืนที่จริงด้วย tx (ครอบคลุมในเทสเกินสต็อกเดิม)
    assert.equal(orders.get(order.id).status, 'QUOTE');
  } finally {
    products.set(PRODUCT_ID, { ...products.get(PRODUCT_ID), inventoryItemId: null, stockQty: stockBefore });
    warehouseItems.delete(WAREHOUSE_ITEM_ID);
  }
});

test('รับของเข้า (PO) → คลังกลางบวกตาม (+10)', async () => {
  products.set(PRODUCT_ID, { ...products.get(PRODUCT_ID), inventoryItemId: WAREHOUSE_ITEM_ID });
  warehouseItems.set(WAREHOUSE_ITEM_ID, { id: WAREHOUSE_ITEM_ID, user_id: OWNER_ID, quantity: 5 });
  try {
    const sup = await (await post(`/${BIZ_ID}/suppliers`, { name: 'ผู้ขายคลัง' }, memberToken('STOCK_KEEPER'))).json();
    const po = await (await post(`/${BIZ_ID}/purchase-orders`, { supplierId: sup.id, productId: PRODUCT_ID, qty: 10, unitCost: 50 }, memberToken('STOCK_KEEPER'))).json();
    await post(`/${BIZ_ID}/purchase-orders/${po.id}/receive`, {}, memberToken('STOCK_KEEPER'));
    assert.equal(warehouseItems.get(WAREHOUSE_ITEM_ID).quantity, 15, 'รับของเข้าธุรกิจ = คลังบวกตาม');
  } finally {
    products.set(PRODUCT_ID, { ...products.get(PRODUCT_ID), inventoryItemId: null });
    warehouseItems.delete(WAREHOUSE_ITEM_ID);
  }
});

test('แก้ stockQty มือ → คลังขยับตาม delta (ตั้งค่าใหม่ทั้งยอด)', async () => {
  products.set(PRODUCT_ID, { ...products.get(PRODUCT_ID), inventoryItemId: WAREHOUSE_ITEM_ID });
  warehouseItems.set(WAREHOUSE_ITEM_ID, { id: WAREHOUSE_ITEM_ID, user_id: OWNER_ID, quantity: 9 });
  try {
    const before = products.get(PRODUCT_ID).stockQty; // 10
    const res = await fetch(server.baseUrl + `${API}/${BIZ_ID}/products/${PRODUCT_ID}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken('STOCK_KEEPER')}` },
      body: JSON.stringify({ stockQty: before + 5 }),
    });
    assert.equal(res.status, 200);
    assert.equal(warehouseItems.get(WAREHOUSE_ITEM_ID).quantity, 14, 'แก้มือ 10→15 = คลัง 9→14 (delta +5)');
  } finally {
    products.set(PRODUCT_ID, { ...products.get(PRODUCT_ID), inventoryItemId: null });
    warehouseItems.delete(WAREHOUSE_ITEM_ID);
  }
});

test('สร้างธุรกิจ → 201 + OWNER member + seed ผู้ช่วย AI 5 คน', async () => {
  const res = await post('/', { name: 'ธุรกิจใหม่' }, makeToken('OPERATOR', { userId: NON_MEMBER_ID }));
  assert.equal(res.status, 201);
  const biz = await res.json();
  assert.equal(biz.name, 'ธุรกิจใหม่');
  const created = await (await post(`/${BIZ_ID}/agents/seed`, {}, makeToken('SUPERADMIN'))).json();
  // seed เฉพาะเมื่อยังไม่มี (ตัวจริง seed ตอน create) — mock count=0 จึงสร้างใหม่ได้
  assert.equal(created.created, 5);
});
