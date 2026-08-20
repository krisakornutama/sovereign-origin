// tests/transfersApi.test.ts — HTTP tests สำหรับ /api/treasury/transfers*
// ครอบ: สร้างคำสั่ง (PENDING, ไม่แตะ ledger), ยืนยัน IN/OUT → ledger อัปเดต + event,
//       ยอดเงินสดไม่พอ → หักเท่าที่มี, double-verify กันได้, ยกเลิก, เจ้าของพอร์ตกันข้ามคน
import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import treasuryRoutes, { prisma } from '../src/modules/treasury/treasury.routes';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let adminToken: string;
let memberToken: string;

const OWNER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

let sheets: Map<string, any>;
let events: any[];
let orders: Map<string, any>;
let orderSeq: number;

function orderRow(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    user_id: OWNER_A,
    direction: 'OUT',
    category: 'BILL',
    amount_usd: 0,
    amount_thb: null,
    payee: null,
    bank: null,
    account_number: null,
    note: null,
    ref_code: 'XFR-TEST',
    qr_payload: null,
    status: 'PENDING',
    txid: null,
    evidence_url: null,
    requested_by: OWNER_A,
    verified_by: null,
    verified_at: null,
    cancelled_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

before(async () => {
  sheets = new Map();
  events = [];
  orders = new Map();
  orderSeq = 0;

  sheets.set(OWNER_A, { id: 'sheet-1', user_id: OWNER_A, liquid_cash_usd: 500, liabilities_usd: 0, monthly_burn_usd: 500, monthly_income_usd: 0 });

  mockModel(prisma, 'transferOrder', {
    create: async ({ data }: any) => {
      orderSeq += 1;
      const o = orderRow({ ...data, id: `order-${orderSeq}` });
      orders.set(o.id, o);
      return o;
    },
    findMany: async ({ where }: any) =>
      [...orders.values()]
        .filter((o) => (!where?.user_id || o.user_id === where.user_id) && (!where?.status || o.status === where.status))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime()),
    findFirst: async ({ where }: any) => [...orders.values()].find((o) => o.id === where.id && o.user_id === where.user_id) || null,
    update: async ({ where, data }: any) => {
      const o = orders.get(where.id);
      if (!o) return null;
      Object.assign(o, data);
      return o;
    },
    updateMany: async ({ where, data }: any) => {
      const o = [...orders.values()].find((x) => x.id === where.id && x.user_id === where.user_id && (!where.status || x.status === where.status));
      if (!o) return { count: 0 };
      Object.assign(o, data);
      return { count: 1 };
    },
  });
  mockModel(prisma, 'personalBalanceSheet', {
    findUnique: async ({ where }: any) => sheets.get(where.user_id) || null,
    upsert: async ({ where, create }: any) => (sheets.get(where.user_id) ?? (() => { const s = { id: 'sheet-' + where.user_id.slice(0, 5), user_id: where.user_id, liquid_cash_usd: 0, liabilities_usd: 0, monthly_burn_usd: 0, monthly_income_usd: 0 }; sheets.set(where.user_id, s); return s; })()),
    update: async ({ where, data }: any) => {
      const s = sheets.get(where.user_id);
      Object.assign(s, data);
      return s;
    },
    updateMany: async ({ where, data }: any) => {
      const s = sheets.get(where.user_id);
      if (!s) return { count: 0 };
      const min = where?.liquid_cash_usd?.gte;
      if (min !== undefined && s.liquid_cash_usd < min) return { count: 0 };
      if (data?.liquid_cash_usd?.decrement !== undefined) s.liquid_cash_usd -= data.liquid_cash_usd.decrement;
      return { count: 1 };
    },
  });
  mockModel(prisma, 'treasuryEvent', {
    create: async ({ data }: any) => {
      const e = { id: `ev-${events.length + 1}`, created_at: new Date(), ...data };
      events.push(e);
      return e;
    },
    findMany: async ({ where }: any) => [...events].filter((e) => !where?.user_id || e.user_id === where.user_id).reverse(),
  });

  server = await createTestServer((app) => app.use('/api/treasury', treasuryRoutes));
  adminToken = makeToken('SUPERADMIN', { userId: OWNER_A });
  memberToken = makeToken('OPERATOR', { userId: OWNER_B });
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const J = { 'Content-Type': 'application/json' };

async function createOrder(body: any, token = adminToken) {
  return fetch(server.baseUrl + '/api/treasury/transfers', { method: 'POST', headers: { ...J, ...auth(token) }, body: JSON.stringify(body) });
}

// ═══════ Create ═══════

test('POST /transfers — OUT สร้างได้ ตอนนี้ยังไม่แตะ ledger (PENDING)', async () => {
  const beforeCash = sheets.get(OWNER_A).liquid_cash_usd;
  const res = await createOrder({ direction: 'OUT', category: 'BILL', amountUsd: 300, payee: 'ร้านค้า', note: 'ค่าน้ำ' });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.ok(body.order.refCode.startsWith('XFR-'));
  assert.strictEqual(body.order.status, 'PENDING');
  assert.strictEqual(body.order.amountUsd, 300);
  assert.strictEqual(sheets.get(OWNER_A).liquid_cash_usd, beforeCash); // ยังไม่หัก
});

test('POST /transfers — validation: ทิศทาง/ยอด/หมวด ไม่ถูกต้อง → 400', async () => {
  assert.strictEqual((await createOrder({ direction: 'X', amountUsd: 100 })).status, 400);
  assert.strictEqual((await createOrder({ direction: 'OUT', amountUsd: 0 })).status, 400);
  assert.strictEqual((await createOrder({ direction: 'OUT', amountUsd: -5 })).status, 400);
  assert.strictEqual((await createOrder({ direction: 'OUT', amountUsd: Number.POSITIVE_INFINITY })).status, 400);
  assert.strictEqual((await createOrder({ direction: 'OUT', amountUsd: 100, category: 'NOPE' })).status, 400);
});

test('POST /transfers — สร้างด้วย QR payload เมื่อตั้ง PROMPTPAY_TARGET', async () => {
  const prev = process.env.PROMPTPAY_TARGET;
  process.env.PROMPTPAY_TARGET = '0812345678';
  try {
    const res = await createOrder({ direction: 'IN', category: 'SALARY', amountUsd: 1000, amountThb: 35000 });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.promptpayConfigured, true);
    assert.ok(body.order.qrPayload.startsWith('00020101')); // EMVCo
    assert.ok(body.order.qrPayload.includes('35000')); // ยอดบาทจาก amountThb
  } finally {
    if (prev === undefined) delete process.env.PROMPTPAY_TARGET;
    else process.env.PROMPTPAY_TARGET = prev;
  }
});

test('POST /transfers — ไม่ตั้ง PROMPTPAY_TARGET → สร้างได้แต่ไม่มี QR', async () => {
  const prev = process.env.PROMPTPAY_TARGET;
  delete process.env.PROMPTPAY_TARGET;
  try {
    const res = await createOrder({ direction: 'OUT', category: 'FOOD', amountUsd: 50 });
    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.order.qrPayload, null);
    assert.strictEqual(body.promptpayConfigured, false);
  } finally {
    if (prev !== undefined) process.env.PROMPTPAY_TARGET = prev;
  }
});

// ═══════ Confirm ═══════

test('POST /transfers/:id/confirm — IN เครดิตเงินสด + event TRANSFER_IN', async () => {
  const before = sheets.get(OWNER_A).liquid_cash_usd;
  const created = await (await createOrder({ direction: 'IN', category: 'SALARY', amountUsd: 250, payee: 'บริษัท' })).json();
  const res = await fetch(server.baseUrl + `/api/treasury/transfers/${created.order.id}/confirm`, {
    method: 'POST', headers: { ...J, ...auth(adminToken) }, body: JSON.stringify({ txid: 'THB1234567890' }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.balanceUsd, before + 250);
  assert.strictEqual(sheets.get(OWNER_A).liquid_cash_usd, before + 250);
  const ev = events.filter((e) => e.type === 'TRANSFER_IN' && e.user_id === OWNER_A).pop();
  assert.ok(ev);
  assert.strictEqual(ev.amount_usd, 250);
  assert.ok(ev.note.includes('THB1234567890'));
});

test('POST /transfers/:id/confirm — OUT หักเงินสดจริง', async () => {
  const before = sheets.get(OWNER_A).liquid_cash_usd;
  const created = await (await createOrder({ direction: 'OUT', category: 'BILL', amountUsd: 200 })).json();
  const res = await fetch(server.baseUrl + `/api/treasury/transfers/${created.order.id}/confirm`, {
    method: 'POST', headers: { ...J, ...auth(adminToken) }, body: JSON.stringify({ txid: 'OUT-REF-001' }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.actualDebitedUsd, 200);
  assert.strictEqual(sheets.get(OWNER_A).liquid_cash_usd, before - 200);
  const ev = events.filter((e) => e.type === 'TRANSFER_OUT').pop();
  assert.strictEqual(ev.amount_usd, -200);
});

test('POST /transfers/:id/confirm — เงินสดไม่พอ → หักเท่าที่ยังมี + แจ้ง actualDebitedUsd', async () => {
  const created = await (await createOrder({ direction: 'OUT', category: 'BILL', amountUsd: 99999 })).json();
  const before = sheets.get(OWNER_A).liquid_cash_usd;
  const res = await fetch(server.baseUrl + `/api/treasury/transfers/${created.order.id}/confirm`, {
    method: 'POST', headers: { ...J, ...auth(adminToken) }, body: JSON.stringify({ txid: 'BIG-OUT' }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.actualDebitedUsd, before); // หักเท่าที่มี
  assert.strictEqual(sheets.get(OWNER_A).liquid_cash_usd, 0);
});

test('POST /transfers/:id/confirm — txid สั้นไป → 400 และไม่แตะ ledger', async () => {
  const created = await (await createOrder({ direction: 'IN', category: 'OTHER', amountUsd: 10 })).json();
  const before = sheets.get(OWNER_A).liquid_cash_usd;
  const res = await fetch(server.baseUrl + `/api/treasury/transfers/${created.order.id}/confirm`, {
    method: 'POST', headers: { ...J, ...auth(adminToken) }, body: JSON.stringify({ txid: 'abc' }),
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(sheets.get(OWNER_A).liquid_cash_usd, before);
});

test('POST /transfers/:id/confirm — double-confirm กันได้ (คำสั่งที่ VERIFIED แล้ว)', async () => {
  const created = await (await createOrder({ direction: 'IN', category: 'OTHER', amountUsd: 10 })).json();
  const before = sheets.get(OWNER_A).liquid_cash_usd;
  const ok = await fetch(server.baseUrl + `/api/treasury/transfers/${created.order.id}/confirm`, {
    method: 'POST', headers: { ...J, ...auth(adminToken) }, body: JSON.stringify({ txid: 'FIRST-TXN' }),
  });
  assert.strictEqual(ok.status, 200);
  const res = await fetch(server.baseUrl + `/api/treasury/transfers/${created.order.id}/confirm`, {
    method: 'POST', headers: { ...J, ...auth(adminToken) }, body: JSON.stringify({ txid: 'SECOND-TXN' }),
  });
  assert.strictEqual(res.status, 400);
  assert.ok((await res.json()).error.includes('ยืนยันไปแล้ว'));
  assert.strictEqual(sheets.get(OWNER_A).liquid_cash_usd, before + 10); // เครดิตแค่ครั้งเดียว
});

// ═══════ Cancel ═══════

test('POST /transfers/:id/cancel — ยกเลิกได้เฉพาะ PENDING', async () => {
  const created = await (await createOrder({ direction: 'OUT', category: 'OTHER', amountUsd: 5 })).json();
  const ok = await fetch(server.baseUrl + `/api/treasury/transfers/${created.order.id}/cancel`, {
    method: 'POST', headers: auth(adminToken),
  });
  assert.strictEqual(ok.status, 200);

  const again = await fetch(server.baseUrl + `/api/treasury/transfers/${created.order.id}/cancel`, {
    method: 'POST', headers: auth(adminToken),
  });
  assert.strictEqual(again.status, 400);

  const verified = await (await createOrder({ direction: 'IN', category: 'OTHER', amountUsd: 5 })).json();
  await fetch(server.baseUrl + `/api/treasury/transfers/${verified.order.id}/confirm`, {
    method: 'POST', headers: { ...J, ...auth(adminToken) }, body: JSON.stringify({ txid: 'VERIFIED-BEFORE-CANCEL' }),
  });
  const cancelVerified = await fetch(server.baseUrl + `/api/treasury/transfers/${verified.order.id}/cancel`, {
    method: 'POST', headers: auth(adminToken),
  });
  assert.strictEqual(cancelVerified.status, 400);
});

// ═══════ Ownership ═══════

test('GET/POST /transfers — สมาชิกข้ามไปแตะคำสั่งคนอื่นไม่ได้', async () => {
  const created = await (await createOrder({ direction: 'OUT', category: 'OTHER', amountUsd: 30 })).json();

  // member ดูง่ายๆ ด้วย ?userId=OWNER_A → resolveOwnerId ไม่ยอม (บังคับเป็น OWNER_B)
  const peek = await fetch(server.baseUrl + '/api/treasury/transfers?userId=' + OWNER_A, { headers: auth(memberToken) });
  const peekBody = await peek.json();
  assert.strictEqual(peek.status, 200);
  assert.ok(peekBody.transfers.every((o: any) => o.direction && o.id !== created.order.id)); // เห็นแต่ของตัวเอง (ว่าง)

  // confirm คำสั่งของคนอื่น → 404 (ห้ามแตะ)
  const res = await fetch(server.baseUrl + `/api/treasury/transfers/${created.order.id}/confirm`, {
    method: 'POST', headers: { ...J, ...auth(memberToken) }, body: JSON.stringify({ txid: 'SNEAKY' }),
  });
  assert.strictEqual(res.status, 404);
});

test('GET /transfers — filter status + รายการแสดงครบ', async () => {
  const res = await fetch(server.baseUrl + '/api/treasury/transfers?status=PENDING', { headers: auth(adminToken) });
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.ok(body.transfers.length > 0);
  assert.ok(body.transfers.every((o: any) => o.status === 'PENDING'));
  assert.ok('refCode' in body.transfers[0] && 'qrPayload' in body.transfers[0]);
});

// ═══════ Evidence (สลิป) ═══════

async function uploadSlip(orderId: string, token = adminToken, mime = 'image/png', body?: Buffer): Promise<Response> {
  const fd = new FormData();
  fd.append('file', new Blob([body || Buffer.alloc(256, 7)], { type: mime }), 'slip.png');
  return fetch(server.baseUrl + `/api/treasury/transfers/${orderId}/evidence`, { method: 'POST', headers: auth(token), body: fd });
}

test('POST /transfers/:id/evidence — อัปโหลดสลิป → evidence_url เป็น data URL', async () => {
  const created = await (await createOrder({ direction: 'OUT', category: 'OTHER', amountUsd: 20 })).json();
  const res = await uploadSlip(created.order.id);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.evidenceUrl.startsWith('data:image/png;base64,'));
  assert.ok(body.evidenceUrl.length > 100);
  const listed = await (await fetch(server.baseUrl + '/api/treasury/transfers', { headers: auth(adminToken) })).json();
  const row = listed.transfers.find((t: any) => t.id === created.order.id);
  assert.strictEqual(row.evidenceUrl, body.evidenceUrl);
});

test('POST /transfers/:id/evidence — ไฟล์ไม่ใช่ภาพ → 400 / ใหญ่เกิน → 400', async () => {
  const created = await (await createOrder({ direction: 'OUT', category: 'OTHER', amountUsd: 1 })).json();
  const bad = await uploadSlip(created.order.id, adminToken, 'text/plain');
  assert.strictEqual(bad.status, 400);
  const big = await uploadSlip(created.order.id, adminToken, 'image/png', Buffer.alloc(3 * 1024 * 1024));
  assert.strictEqual(big.status, 400);
});

test('POST /transfers/:id/evidence — คำสั่งที่ VERIFIED แล้ว/ของคนอื่น → 400/404', async () => {
  const verified = await (await createOrder({ direction: 'IN', category: 'OTHER', amountUsd: 3 })).json();
  await fetch(server.baseUrl + `/api/treasury/transfers/${verified.order.id}/confirm`, {
    method: 'POST', headers: { ...J, ...auth(adminToken) }, body: JSON.stringify({ txid: 'EVID-VERIFIED' }),
  });
  const onVerified = await uploadSlip(verified.order.id);
  assert.strictEqual(onVerified.status, 400);

  const other = await (await createOrder({ direction: 'OUT', category: 'OTHER', amountUsd: 3 })).json();
  const notOwner = await uploadSlip(other.order.id, memberToken);
  assert.strictEqual(notOwner.status, 404);
});