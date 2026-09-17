import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import restaurantRoutes from '../src/modules/restaurant/restaurant.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// Restaurant Empire — mock suite (ไม่แตะ DB จริง)
// ครอบ: สิทธิ์ระดับบทบาท · กันเลขผิด (numInRange) · PDPA face-enroll ·
// วงจรออเดอร์ PENDING→PREPARING→READY→PAID (ตัดสต็อก/แต้ม/treasury) · รายงาน
// ────────────────────────────────────────────────────────────────────────────

const H = { Authorization: `Bearer ${makeToken('SUPERADMIN')}`, 'Content-Type': 'application/json' };
const OWNER_AUTH = { Authorization: `Bearer ${makeToken('OPERATOR', { userId: 'owner-user' })}`, 'Content-Type': 'application/json' };
const STRANGER_AUTH = { Authorization: `Bearer ${makeToken('OPERATOR', { userId: 'stranger' })}`, 'Content-Type': 'application/json' };

// ── in-memory stores ──
const restaurants = new Map<string, any>();
const menus = new Map<string, any>();
const customers = new Map<string, any>();
const faces = new Map<string, any>();
const orders = new Map<string, any>();
const inv = new Map<string, any>();
const treasury = new Map<string, any>();
const telemetry: any[] = [];
let seq = 0;
const nid = () => `row-${++seq}`;

before(async () => {
  (prisma as any).restaurant = {
    create: async ({ data }: any) => {
      const r = { id: nid(), cameraId: null, createdAt: new Date(), ...data };
      restaurants.set(r.id, r);
      return r;
    },
    findUnique: async ({ where }: any) => restaurants.get(where.id) ?? null,
    findMany: async ({ where }: any = {}) => {
      let list = [...restaurants.values()];
      if (where?.ownerId) list = list.filter((r) => r.ownerId === where.ownerId);
      return list;
    },
    update: async ({ where, data }: any) => {
      const r = restaurants.get(where.id);
      if (!r) throw new Error('Record to update not found');
      const merged = { ...r, ...data };
      restaurants.set(r.id, merged);
      return merged;
    },
  };

  (prisma as any).menuItem = {
    create: async ({ data }: any) => {
      const m = { id: nid(), isActive: true, recipes: [], createdAt: new Date(), ...data };
      menus.set(m.id, m);
      return m;
    },
    findUnique: async ({ where }: any) => menus.get(where.id) ?? null,
    findMany: async ({ where }: any = {}) => {
      let list = [...menus.values()];
      if (where?.restaurantId) list = list.filter((m) => m.restaurantId === where.restaurantId);
      if (where?.isActive !== undefined) list = list.filter((m) => m.isActive === where.isActive);
      return list;
    },
  };

  (prisma as any).recipeLine = {
    deleteMany: async ({ where }: any) => {
      const m = menus.get(where.menuId);
      if (m) m.recipes = [];
      return { count: m ? 0 : 0 };
    },
    create: async ({ data }: any) => {
      const line = { id: nid(), ...data };
      menus.get(data.menuId)?.recipes.push(line);
      return line;
    },
  };

  (prisma as any).inventoryItem = {
    findUnique: async ({ where }: any) => inv.get(where.id) ?? null,
    findFirst: async ({ where }: any) => [...inv.values()].find((i) => i.user_id === where.user_id && i.name === where.name) ?? null,
    create: async ({ data }: any) => {
      const row = { id: nid(), ...data };
      inv.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = inv.get(where.id);
      if (!row) throw new Error('Record to update not found');
      const merged = { ...row, ...data };
      inv.set(row.id, merged);
      return merged;
    },
  };

  (prisma as any).knownFace = {
    create: async ({ data }: any) => {
      const row = { id: nid(), ...data };
      faces.set(row.id, row);
      return row;
    },
  };

  (prisma as any).restaurantCustomer = {
    create: async ({ data }: any) => {
      const c = { id: nid(), points: 0, createdAt: new Date(), ...data };
      customers.set(c.id, c);
      return c;
    },
    findUnique: async ({ where }: any) => customers.get(where.id) ?? null,
    findMany: async () => [...customers.values()],
    update: async ({ where, data }: any) => {
      const c = customers.get(where.id);
      if (!c) throw new Error('Record to update not found');
      const merged = { ...c, ...data };
      // รองรับ operator ของ Prisma: { points: { increment } } / { points: { decrement } }
      if (typeof merged.points === 'object' && merged.points !== null) {
        merged.points = (c.points ?? 0) + (merged.points.increment ?? 0) - (merged.points.decrement ?? 0);
      }
      customers.set(c.id, merged);
      return merged;
    },
  };

  (prisma as any).restaurantOrder = {
    create: async ({ data }: any) => {
      const o = { id: nid(), lines: [], createdAt: new Date(), customerId: null, tableNo: null, type: 'DINE_IN', ...data };
      orders.set(o.id, o);
      return { ...o };
    },
    findUnique: async ({ where }: any) => {
      const o = orders.get(where.id);
      return o ? { ...o, lines: [...o.lines] } : null;
    },
    findMany: async ({ where }: any = {}) => {
      let list = [...orders.values()];
      if (where?.restaurantId) {
        if (typeof where.restaurantId === 'string') list = list.filter((o) => o.restaurantId === where.restaurantId);
        else if (where.restaurantId.in) list = list.filter((o) => where.restaurantId.in.includes(o.restaurantId));
      }
      if (where?.status) list = list.filter((o) => o.status === where.status);
      if (where?.createdAt?.gte) list = list.filter((o) => o.createdAt >= where.createdAt.gte);
      return list.map((o) => ({ ...o, lines: [...o.lines] }));
    },
    update: async ({ where, data }: any) => {
      const o = orders.get(where.id);
      if (!o) throw new Error('Record to update not found');
      const merged = { ...o, ...data };
      orders.set(o.id, merged);
      return { ...merged };
    },
  };

  (prisma as any).restaurantOrderLine = {
    create: async ({ data }: any) => {
      const line = { id: nid(), ...data };
      orders.get(data.orderId)?.lines.push(line);
      return line;
    },
  };

  (prisma as any).treasuryEvent = {
    create: async ({ data }: any) => {
      const row = { id: nid(), ...data };
      treasury.set(row.id, row);
      return row;
    },
  };

  (prisma as any).$transaction = async (fn: any) => fn(prisma);
  (prisma as any).$queryRawUnsafe = async (...args: any[]) => {
    telemetry.push(args);
    return [];
  };
});

let ts: TestServer;
before(async () => {
  ts = await createTestServer((app) => app.use('/api/restaurant', restaurantRoutes));
});
after(async () => {
  await ts.close(); // ปิด server — ไม่งั้น event loop ค้าง ตัวรันเทสไม่ยอมจบ
});

// ─── Restaurant: สิทธิ์ + กล้อง ───

test('POST / ปฏิเสธชื่อว่าง + สร้างร้านได้ (owner = ผู้สร้าง)', async () => {
  const bad = await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: '  ' }) });
  assert.equal(bad.status, 400);

  const res = await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้านก๋วยเตี๋ยว'.slice(0, 5) + ' โซเวอริน' }) });
  assert.equal(res.status, 201);
  const r = await res.json();
  assert.ok(r.id);
});

test('PUT /:id/camera — 404 ไม่พบร้าน · 403 คนนอก · เจ้าของ/SUPERADMIN ผ่าน', async () => {
  const created = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: OWNER_AUTH, body: JSON.stringify({ name: 'ร้านของเจ้าของ' }) })).json();

  const missing = await fetch(`${ts.baseUrl}/api/restaurant/unknown-id/camera`, { method: 'PUT', headers: H, body: JSON.stringify({ cameraId: 'cam-1' }) });
  assert.equal(missing.status, 404);

  const stranger = await fetch(`${ts.baseUrl}/api/restaurant/${created.id}/camera`, { method: 'PUT', headers: STRANGER_AUTH, body: JSON.stringify({ cameraId: 'cam-1' }) });
  assert.equal(stranger.status, 403);

  const owner = await fetch(`${ts.baseUrl}/api/restaurant/${created.id}/camera`, { method: 'PUT', headers: OWNER_AUTH, body: JSON.stringify({ cameraId: 'cam-front' }) });
  assert.equal(owner.status, 200);
  const body = await owner.json();
  assert.equal(body.cameraId, 'cam-front');

  const superOk = await fetch(`${ts.baseUrl}/api/restaurant/${created.id}/camera`, { method: 'PUT', headers: H, body: JSON.stringify({ cameraId: null }) });
  assert.equal(superOk.status, 200);
  assert.equal((await superOk.json()).cameraId, null);
});

// ─── Customers: PDPA ───

test('POST /customers — ปฏิเสธชื่อว่าง · เก็บ consentFace ตามที่ส่ง (PDPA: knownFaceId โดยไม่ยินยอม = false)', async () => {
  const bad = await fetch(`${ts.baseUrl}/api/restaurant/customers`, { method: 'POST', headers: H, body: JSON.stringify({ name: '' }) });
  assert.equal(bad.status, 400);

  const res = await fetch(`${ts.baseUrl}/api/restaurant/customers`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ name: 'ลูกค้า A', phone: '0812345678', knownFaceId: 'face-xyz' }),
  });
  assert.equal(res.status, 201);
  const c = await res.json();
  assert.equal(c.consentFace, false, 'ไม่ยินยอม → false (ห้าม default เป็น true)');
  assert.equal(c.knownFaceId, 'face-xyz');

  const list = await (await fetch(`${ts.baseUrl}/api/restaurant/customers`, { headers: H })).json();
  assert.ok(list.length >= 1);
});

test('POST /customers/face-enroll — PDPA: ไม่ยินยอม → 400 · ขาดรูป → 400 · ผ่าน → เก็บรูป base64 ตัดที่ 8000', async () => {
  const noImage = await fetch(`${ts.baseUrl}/api/restaurant/customers/face-enroll`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'B' }) });
  assert.equal(noImage.status, 400);

  const noConsent = await fetch(`${ts.baseUrl}/api/restaurant/customers/face-enroll`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ name: 'B', imageBase64: 'aGk=', consentFace: false }),
  });
  assert.equal(noConsent.status, 400);
  assert.ok((await noConsent.json()).error.includes('PDPA'));

  const ok = await fetch(`${ts.baseUrl}/api/restaurant/customers/face-enroll`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ name: 'ลูกค้าใบหน้า', imageBase64: 'x'.repeat(9000), consentFace: true }),
  });
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.equal(body.customer.consentFace, true);
  assert.equal(faces.get(body.faceId).photo_data.length, 8000, 'base64 ถูกตัดที่ 8000');
});

// ─── Menu + Recipe ───

test('POST /menus — ขาด field → 400 · ราคาไม่ใช่เลข/เกิน 1,000,000 → 400 (numInRange) · default category FOOD', async () => {
  const missing = await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ข้าวผัด' }) });
  assert.equal(missing.status, 400);

  const badPrice = await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: 'r1', name: 'ข้าวผัด', priceTHB: 'แพง' }) });
  assert.equal(badPrice.status, 400);

  const huge = await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: 'r1', name: 'ข้าวผัด', priceTHB: 1_000_001 }) });
  assert.equal(huge.status, 400);
});

test('POST /menus สร้างสำเร็จ + GET /menus กรองตามร้าน', async () => {
  const rest = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้านเมนู' }) })).json();
  const m1 = await (await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, name: 'ข้าวผัดกะเพรา', priceTHB: 60 }) })).json();
  assert.equal(m1.priceTHB, 60);
  assert.equal(m1.category, 'FOOD');
  await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, name: 'ข้าวผัดหมู', priceTHB: 55, category: 'FOOD' }) });
  await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: 'other-rest', name: 'กาแฟ', priceTHB: 40 }) });

  const list = await (await fetch(`${ts.baseUrl}/api/restaurant/menus?restaurantId=${rest.id}`, { headers: H })).json();
  assert.equal(list.length, 2);
  assert.ok(list.every((m: any) => m.restaurantId === rest.id));
});

test('PUT /menus/:id/recipe — เกิน 200 บรรทัด/บรรทัดไม่ใช่ object/qtyGram ผิด → 400 · ผ่าน → แทนที่สูตรเดิม', async () => {
  const rest = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้านสูตร' }) })).json();
  const menu = await (await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, name: 'แกงเขียวหวาน', priceTHB: 70 }) })).json();

  const tooMany = await fetch(`${ts.baseUrl}/api/restaurant/menus/${menu.id}/recipe`, { method: 'PUT', headers: H, body: JSON.stringify({ lines: Array.from({ length: 201 }, () => ({})) }) });
  assert.equal(tooMany.status, 400);

  const notObject = await fetch(`${ts.baseUrl}/api/restaurant/menus/${menu.id}/recipe`, { method: 'PUT', headers: H, body: JSON.stringify({ lines: ['กะเพรา'] }) });
  assert.equal(notObject.status, 400);

  const badQty = await fetch(`${ts.baseUrl}/api/restaurant/menus/${menu.id}/recipe`, { method: 'PUT', headers: H, body: JSON.stringify({ lines: [{ farmCrop: 'กะเพรา', qtyGram: -5 }] }) });
  assert.equal(badQty.status, 400);

  const invItem = inv.set('inv-basil', { id: 'inv-basil', name: 'ใบกะเพรา', quantity: 2, user_id: 'test-user' });
  const ok = await fetch(`${ts.baseUrl}/api/restaurant/menus/${menu.id}/recipe`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ lines: [{ farmCrop: 'ใบกะเพรา', qtyGram: 50, inventoryItemId: 'inv-basil' }, { farmCrop: 'พริกแกง', qtyGram: 30, isSelfProduced: true }, { farmCrop: 'น้ำตาล', qtyGram: 0, isOptional: true }] }),
  });
  assert.equal(ok.status, 200);
  const saved = await ok.json();
  assert.equal(saved.recipes.length, 3, 'สูตรใหม่แทนที่ของเดิมทั้งชุด');
});

test('GET /menus/available — ขาด restaurantId → 400 · optional ไม่บังคับ · self-produced ไม่มีสต็อก → ทำไม่ได้', async () => {
  const missing = await fetch(`${ts.baseUrl}/api/restaurant/menus/available`, { headers: H });
  assert.equal(missing.status, 400);

  const rest = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้าน available' }) })).json();
  const invBasil = inv.get('inv-basil');
  invBasil.quantity = 2; // 2000g — พอทำเมนู 50g
  const menu = await (await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, name: 'ผัดกะเพราทะเล', priceTHB: 80 }) })).json();
  await fetch(`${ts.baseUrl}/api/restaurant/menus/${menu.id}/recipe`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ lines: [
      { farmCrop: 'ใบกะเพรา', qtyGram: 50, inventoryItemId: 'inv-basil' },
      { farmCrop: 'พริกแกง', qtyGram: 30, isSelfProduced: true },
      { farmCrop: 'น้ำตาล', qtyGram: 10, isOptional: true },
    ] }),
  });

  let rows = await (await fetch(`${ts.baseUrl}/api/restaurant/menus/available?restaurantId=${rest.id}`, { headers: H })).json();
  let row = rows.find((r: any) => r.id === menu.id);
  assert.equal(row.canMake, false, 'พริกแกง self-produced ไม่มีใน inventory → ทำไม่ได้');
  assert.ok(row.missing.includes('พริกแกง'));

  // เปลี่ยนสูตร: พริกแกง optional → ทำได้
  await fetch(`${ts.baseUrl}/api/restaurant/menus/${menu.id}/recipe`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ lines: [
      { farmCrop: 'ใบกะเพรา', qtyGram: 50, inventoryItemId: 'inv-basil' },
      { farmCrop: 'พริกแกง', qtyGram: 30, isSelfProduced: true, isOptional: true },
    ] }),
  });
  rows = await (await fetch(`${ts.baseUrl}/api/restaurant/menus/available?restaurantId=${rest.id}`, { headers: H })).json();
  row = rows.find((r: any) => r.id === menu.id);
  assert.equal(row.canMake, true, 'ตัวเลือก isOptional ไม่ถูกบังคับ');
});

// ─── Orders: validation + วงจรสถานะ ───

test('POST /orders — กันข้อมูลผิดรูปทุกกรณี (ขาด items / เกิน 100 / item ไม่มี menuId / qty 0 / qty ทศนิยม / menu ไม่พบ)', async () => {
  const rest = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้านออเดอร์' }) })).json();
  const noItems = await fetch(`${ts.baseUrl}/api/restaurant/orders`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, items: [] }) });
  assert.equal(noItems.status, 400);

  const tooMany = await fetch(`${ts.baseUrl}/api/restaurant/orders`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, items: Array.from({ length: 101 }, () => ({ menuId: 'm', qty: 1 })) }) });
  assert.equal(tooMany.status, 400);

  const badShape = await fetch(`${ts.baseUrl}/api/restaurant/orders`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, items: [{ qty: 1 }] }) });
  assert.equal(badShape.status, 400);

  const qtyZero = await fetch(`${ts.baseUrl}/api/restaurant/orders`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, items: [{ menuId: 'm1', qty: 0 }] }) });
  assert.equal(qtyZero.status, 400);

  const qtyFloat = await fetch(`${ts.baseUrl}/api/restaurant/orders`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, items: [{ menuId: 'm1', qty: 1.5 }] }) });
  assert.equal(qtyFloat.status, 400);

  const noMenu = await fetch(`${ts.baseUrl}/api/restaurant/orders`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, items: [{ menuId: 'no-such-menu', qty: 1 }] }) });
  assert.equal(noMenu.status, 400);
  assert.ok((await noMenu.json()).error.includes('not found'));
});

test('POST /orders สร้างสำเร็จ — ราคารวมคิดจากเมนูจริง + บรรทัดออเดอร์จับราคาตอนสั่ง', async () => {
  const rest = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้านจ่าย' }) })).json();
  const menu = await (await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, name: 'ข้าวมันไก่', priceTHB: 50 }) })).json();
  await fetch(`${ts.baseUrl}/api/restaurant/menus/${menu.id}/recipe`, { method: 'PUT', headers: H, body: JSON.stringify({ lines: [{ farmCrop: 'ข้าว', qtyGram: 200, inventoryItemId: 'inv-rice' }] }) });
  inv.set('inv-rice', { id: 'inv-rice', name: 'ข้าว', quantity: 5, user_id: 'test-user' });

  const res = await fetch(`${ts.baseUrl}/api/restaurant/orders`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ restaurantId: rest.id, items: [{ menuId: menu.id, qty: 3 }, { menuId: menu.id, qty: 1 }], tableNo: 'T7', type: 'TAKEAWAY' }),
  });
  assert.equal(res.status, 201);
  const order = await res.json();
  assert.equal(order.totalTHB, 200, '50×4 = 200');
  assert.equal(order.status, 'PENDING');
  assert.equal(order.type, 'TAKEAWAY');
  assert.match(order.orderNo, /^ORD-\d{8}-[A-Z0-9]{4}$/);
  assert.equal(order.lines.length, 2);
  assert.ok(order.lines.every((l: any) => l.priceAtOrder === 50));
});

test('POST /orders/:id/status — สถานะนอกระบบ/หลังปิดบิล → 400 · PENDING→PREPARING→READY ผ่าน', async () => {
  const rest = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้านคิว' }) })).json();
  const menu = await (await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, name: 'ก๋วยเตี๋ยว', priceTHB: 40 }) })).json();
  const order = await (await fetch(`${ts.baseUrl}/api/restaurant/orders`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, items: [{ menuId: menu.id, qty: 1 }] }) })).json();

  const bad = await fetch(`${ts.baseUrl}/api/restaurant/orders/${order.id}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'PAID' }) });
  assert.equal(bad.status, 400, 'ปิดบิลต้องผ่าน /pay เท่านั้น');

  const prep = await fetch(`${ts.baseUrl}/api/restaurant/orders/${order.id}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'PREPARING' }) });
  assert.equal((await prep.json()).status, 'PREPARING');

  const ready = await fetch(`${ts.baseUrl}/api/restaurant/orders/${order.id}/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'READY' }) });
  assert.equal((await ready.json()).status, 'READY');

  const missing = await fetch(`${ts.baseUrl}/api/restaurant/orders/nope/status`, { method: 'POST', headers: H, body: JSON.stringify({ status: 'READY' }) });
  assert.equal(missing.status, 404);
});

test('POST /orders/:id/cancel — ยกเลิกได้เฉพาะ PENDING', async () => {
  const rest = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้านยกเลิก' }) })).json();
  const menu = await (await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, name: 'โกโก้', priceTHB: 35 }) })).json();
  const o1 = await (await fetch(`${ts.baseUrl}/api/restaurant/orders`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, items: [{ menuId: menu.id, qty: 2 }] }) })).json();

  const cancelled = await fetch(`${ts.baseUrl}/api/restaurant/orders/${o1.id}/cancel`, { method: 'POST', headers: H });
  assert.equal((await cancelled.json()).status, 'CANCELLED');

  // ยกเลิกซ้ำ → ไม่ใช่ PENDING แล้ว
  const again = await fetch(`${ts.baseUrl}/api/restaurant/orders/${o1.id}/cancel`, { method: 'POST', headers: H });
  assert.equal(again.status, 400);

  const missing = await fetch(`${ts.baseUrl}/api/restaurant/orders/nope/cancel`, { method: 'POST', headers: H });
  assert.equal(missing.status, 404);
});

// ─── Pay: ตัดสต็อก + แต้ม + treasury ───

test('POST /orders/:id/pay — วงจรเต็ม: ตัดสต็อกตามสูตร×จำนวน · แต้ม clamp ตามที่มี/ยอดจริง · treasury SALE · จ่ายซ้ำ idempotent', async () => {
  const rest = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้านจ่ายจริง' }) })).json();
  const menu = await (await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, name: 'ส้มตำ', priceTHB: 100 }) })).json();
  await fetch(`${ts.baseUrl}/api/restaurant/menus/${menu.id}/recipe`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ lines: [{ farmCrop: 'มะละกอ', qtyGram: 300, inventoryItemId: 'inv-papaya' }] }),
  });
  inv.set('inv-papaya', { id: 'inv-papaya', name: 'มะละกอ', quantity: 5, user_id: 'test-user' });

  // ลูกค้ามี 5 แต้ม — ขอใช้ 999 → clamp เหลือ 5
  const cust = await (await fetch(`${ts.baseUrl}/api/restaurant/customers`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'สมชาย' }) })).json();
  customers.get(cust.id).points = 5;

  const order = await (await fetch(`${ts.baseUrl}/api/restaurant/orders`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ restaurantId: rest.id, items: [{ menuId: menu.id, qty: 4 }], customerId: cust.id }),
  })).json();
  assert.equal(order.totalTHB, 400);

  const res = await fetch(`${ts.baseUrl}/api/restaurant/orders/${order.id}/pay`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ payment: 'PROMPTPAY', usePoints: 999 }),
  });
  assert.equal(res.status, 200);
  const paid = await res.json();
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.payment, 'PROMPTPAY');
  assert.equal(paid.totalTHB, 395, '400 − 5 แต้ม (1 แต้ม = 1 บาท)');
  assert.equal(inv.get('inv-papaya').quantity, 5 - 1.2, 'สต็อกถูกตัด 300g×4 = 1.2kg');

  const custAfter = customers.get(cust.id);
  assert.equal(custAfter.points, 5 - 5 + Math.floor(395 / 20), 'หักแต้มที่ใช้ + ได้แต้มจากยอดสุทธิ (floor/20)');

  const sale = [...treasury.values()].find((e) => e.type === 'SALE');
  assert.ok(sale, 'ต้องบันทึกรายได้ร้านลง treasury');
  assert.ok(sale.amount_usd > 0);
  assert.ok(sale.note.includes('ใช้ 5 แต้ม'));

  // จ่ายซ้ำ → คืนออเดอร์เดิม ไม่ตัดสต็อกซ้ำ
  const again = await fetch(`${ts.baseUrl}/api/restaurant/orders/${order.id}/pay`, { method: 'POST', headers: H });
  assert.equal((await again.json()).id, order.id);
  assert.equal(inv.get('inv-papaya').quantity, 3.8, 'ไม่ตัดสต็อกซ้ำ');

  const missing = await fetch(`${ts.baseUrl}/api/restaurant/orders/nope/pay`, { method: 'POST', headers: H });
  assert.equal(missing.status, 404);
});

test('POST /orders/:id/pay — ใช้แต้มโดยไม่มีลูกค้า → ไม่มีส่วนลด', async () => {
  const rest = await (await fetch(`${ts.baseUrl}/api/restaurant/`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ร้านไม่มีแต้ม' }) })).json();
  const menu = await (await fetch(`${ts.baseUrl}/api/restaurant/menus`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, name: 'ชาเย็น', priceTHB: 25 }) })).json();
  const order = await (await fetch(`${ts.baseUrl}/api/restaurant/orders`, { method: 'POST', headers: H, body: JSON.stringify({ restaurantId: rest.id, items: [{ menuId: menu.id, qty: 2 }] }) })).json();

  const res = await fetch(`${ts.baseUrl}/api/restaurant/orders/${order.id}/pay`, { method: 'POST', headers: H, body: JSON.stringify({ payment: 'CASH', usePoints: 10 }) });
  const paid = await res.json();
  assert.equal(paid.totalTHB, 50, 'ไม่มี customerId → ไม่หักแต้ม');
});

// ─── Kitchen IoT + purchases ───

test('POST /iot/weight — ปฏิเสธข้อมูลผิด/น้ำหนักเกินช่วง + ผ่าน → ตั้งสต็อก + บันทึก telemetry', async () => {
  const missing = await fetch(`${ts.baseUrl}/api/restaurant/iot/weight`, { method: 'POST', headers: H, body: JSON.stringify({}) });
  assert.equal(missing.status, 400);

  const bad = await fetch(`${ts.baseUrl}/api/restaurant/iot/weight`, { method: 'POST', headers: H, body: JSON.stringify({ inventoryItemId: 'inv-rice', weightKg: 99999 }) });
  assert.equal(bad.status, 400);

  const ok = await fetch(`${ts.baseUrl}/api/restaurant/iot/weight`, { method: 'POST', headers: H, body: JSON.stringify({ inventoryItemId: 'inv-rice', weightKg: 3.5, deviceId: 'hx711-01' }) });
  assert.equal(ok.status, 200);
  assert.equal(inv.get('inv-rice').quantity, 3.5);
  assert.equal(telemetry.length, 1, 'ต้องแทรก sensor_telemetry ด้วย');
});

test('GET /kitchen-sensors — อ่านค่าจาก telemetry ล่าสุด + เตือนตู้เย็นร้อน/ของใกล้หมด', async () => {
  (prisma as any).$queryRawUnsafe = async (sql: string) => {
    if (sql.includes('INSERT INTO')) return [];
    return [
      { metric: 'fridge_temp', value: 12.5, time: new Date() },
      { metric: 'kitchen_weight', value: 0.4, time: new Date() },
    ];
  };
  const res = await fetch(`${ts.baseUrl}/api/restaurant/kitchen-sensors`, { headers: H });
  const body = await res.json();
  assert.equal(body.sensors.fridge_temp.value, 12.5);
  assert.ok(body.alerts.some((a: string) => a.includes('ตู้เย็นร้อน')));
  assert.ok(body.alerts.some((a: string) => a.includes('ใกล้หมด')));
});

test('POST /purchases — กันเลขผิด + สร้าง/บวกสต็อก + treasury PURCHASE ติดลบ', async () => {
  const noName = await fetch(`${ts.baseUrl}/api/restaurant/purchases`, { method: 'POST', headers: H, body: JSON.stringify({ name: '', qtyKg: 1, priceTHB: 10 }) });
  assert.equal(noName.status, 400);

  const badQty = await fetch(`${ts.baseUrl}/api/restaurant/purchases`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ข้าวหอม', qtyKg: -1, priceTHB: 10 }) });
  assert.equal(badQty.status, 400);

  const badPrice = await fetch(`${ts.baseUrl}/api/restaurant/purchases`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ข้าวหอม', qtyKg: 1, priceTHB: -5 }) });
  assert.equal(badPrice.status, 400);

  const first = await fetch(`${ts.baseUrl}/api/restaurant/purchases`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ข้าวหอมมะลิ', qtyKg: 10, priceTHB: 500, supplier: 'ร้านแถวบ้าน' }) });
  assert.equal(first.status, 201);
  const b1 = await first.json();
  assert.equal(b1.quantity, 10);
  assert.equal(b1.spentTHB, 500);

  const second = await fetch(`${ts.baseUrl}/api/restaurant/purchases`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'ข้าวหอมมะลิ', qtyKg: 5, priceTHB: 250 }) });
  const b2 = await second.json();
  assert.equal(b2.quantity, 15, 'ชื่อเดิม → บวกเพิ่มไม่สร้างซ้ำ');

  const purchase = [...treasury.values()].find((e) => e.type === 'PURCHASE');
  assert.ok(purchase);
  assert.ok(purchase.amount_usd < 0, 'รายจ่ายติดลบ');
  assert.ok(purchase.note.includes('ซื้อวัตถุดิบ'));
});

// ─── Reports ───

test('GET /reports/summary — นับเฉพาะ PAID + คิดเฉลี่ย/แยกร้าน/รายวัน + days clamp', async () => {
  const res = await fetch(`${ts.baseUrl}/api/restaurant/reports/summary?days=999`, { headers: H });
  const body = await res.json();
  assert.ok(body.totalRevenue > 0);
  assert.equal(body.totalOrders, 2, 'เฉพาะออเดอร์ PAID (จ่ายแล้ว 2 ในไฟล์นี้)');
  assert.ok(Math.abs(body.avgPerOrder - body.totalRevenue / body.totalOrders) < 1e-9);
  assert.ok(body.byRestaurant.length >= 1);
  assert.ok(body.byRestaurant.every((r: any) => typeof r.name === 'string'));
  assert.ok(Object.keys(body.daily).every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)));
  assert.equal(body.days, 90, 'days=999 ถูก clamp เหลือ 90');
});

test('GET /reports/summary — เจ้าของที่ยังไม่มีร้าน → ศูนย์ล้วน (ไม่พัง)', async () => {
  const res = await fetch(`${ts.baseUrl}/api/restaurant/reports/summary`, { headers: STRANGER_AUTH });
  const body = await res.json();
  assert.deepEqual(body, { totalRevenue: 0, totalOrders: 0, byRestaurant: [], daily: [] });
});
