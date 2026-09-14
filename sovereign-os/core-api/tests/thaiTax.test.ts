import './setup-env';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert';
import businessRoutes from '../src/modules/business/business.routes';
import { prisma } from '../src/lib/prisma';
import {
  splitVatFromGross, computeVatMonthly, computeCit, computePit,
  taxCalendar, businessTaxOverview, currentVatRate, isSme,
} from '../src/services/thai-tax.service';
import { dueFilingsToday, notifyTaxDeadlines } from '../src/services/business.service';
import { endOfMonth } from '../src/services/thai-tax.service';
import { createTestServer, makeToken, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// ภาษีไทย — อัตรา/กำหนดยื่น (pure) + การไหลของ VAT/WHT ใน payments & ledger (HTTP)
// ตัวเลขอ้างอิง: VAT 7% (ถึง 30 ก.ย. 2027), SME CIT 0/15/20%, PIT 8 ขั้น, WHT ท.ป.4
// ────────────────────────────────────────────────────────────────────────────

const BIZ_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACCOUNTANT_ID = 'f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0';
const SALES_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const VIEWER_ID = '12121212-1212-1212-1212-121212121212';
const NON_MEMBER_ID = '99999999-9999-9999-9999-999999999999';
const ORDER_PAID_ID = '44444444-4444-4444-4444-444444444444';
const ORDER_OPEN_ID = '45454545-4545-4545-4545-454545454545';

// ── in-memory stores ──
const businesses = new Map<string, any>();
const members = new Map<string, any>();
const orders = new Map<string, any>();
const payments = new Map<string, any[]>();
const ledger = new Map<string, any[]>();
const sheets = new Map<string, any>();
const treasuryEvents: any[] = [];

const NOW = new Date('2026-09-13T04:00:00Z');
const thisMonth = (day: number) => new Date(`2026-09-${String(day).padStart(2, '0')}T04:00:00Z`);

before(async () => {
  businesses.set(BIZ_ID, {
    id: BIZ_ID, name: 'ร้านภาษีทดสอบ', vatRate: 0.07, bizType: 'IOT_RETAIL', isActive: true, ownerId: OWNER_ID,
    shopOpen: false, shopName: null, shopPromptPay: null,
  });
  for (const [uid, pos] of [
    [OWNER_ID, 'OWNER'], [ACCOUNTANT_ID, 'ACCOUNTANT'], [SALES_ID, 'SALES'], [VIEWER_ID, 'VIEWER'],
  ] as const) {
    members.set(`m-${uid}`, { id: `m-${uid}`, businessId: BIZ_ID, userId: uid, position: pos });
  }
  orders.set(ORDER_PAID_ID, {
    id: ORDER_PAID_ID, businessId: BIZ_ID, orderNo: 'B20260910-0001', status: 'PAID',
    subtotal: 3000, vat: 210, total: 3210, paidAmount: 3210, publicToken: null, channel: 'ONLINE',
  });
  payments.set(ORDER_PAID_ID, [{ id: 'p1', orderId: ORDER_PAID_ID, amount: 3210, method: 'TRANSFER', whtAmount: 0, paidAt: thisMonth(10) }]);
  orders.set(ORDER_OPEN_ID, {
    id: ORDER_OPEN_ID, businessId: BIZ_ID, orderNo: 'B20260912-0001', status: 'ORDERED',
    subtotal: 1000, vat: 70, total: 1070, paidAmount: 0, publicToken: null, channel: 'ONLINE',
  });
  payments.set(ORDER_OPEN_ID, []);
  ledger.set(BIZ_ID, [
    // ปีนี้: รายรับ 3210 (VAT 210, WHT 96.3 = 3% ของ 3210) + รายจ่าย 535 (VAT 35, WHT 16.05 = 3%)
    { id: 'led-1', businessId: BIZ_ID, type: 'INCOME', category: 'SALES', amount: 3210, vatAmount: 210, whtAmount: 96.3, note: 'ขาย B20260910-0001', refOrderId: ORDER_PAID_ID, createdAt: thisMonth(10) },
    { id: 'led-2', businessId: BIZ_ID, type: 'EXPENSE', category: 'SERVICE', amount: 535, vatAmount: 35, whtAmount: 16.05, note: 'ค่าจ้างทำของ', refOrderId: null, createdAt: thisMonth(11) },
  ]);

  // ── prisma delegates ──
  (prisma as any).business = {
    findUnique: async ({ where }: any) => businesses.get(where.id) ?? null,
    findMany: async () => [...businesses.values()],
  };
  (prisma as any).systemSetting = {
    findUnique: async () => null, // ไม่มี override → เตือนตาม default 7,3,1
  };
  (prisma as any).businessMember = {
    findUnique: async ({ where }: any) => {
      const k = where.businessId_userId;
      if (k) for (const m of members.values()) if (m.businessId === k.businessId && m.userId === k.userId) return m;
      for (const m of members.values()) if (m.id === where.id) return m;
      return null;
    },
  };
  (prisma as any).businessOrder = {
    findUnique: async ({ where }: any) => orders.get(where.id) ?? null,
    findMany: async (args: any) =>
      [...orders.values()]
        .filter((o) => !args?.where?.businessId || o.businessId === args.where.businessId)
        .filter((o) => !args?.where?.status?.in || args.where.status.in.includes(o.status))
        .map((o) => ({ ...o, payments: payments.get(o.id) ?? [] })), // select payments → ฝังตรง ๆ
    update: async ({ where, data }: any) => {
      const o = { ...orders.get(where.id), ...data };
      orders.set(o.id, o);
      return o;
    },
  };
  (prisma as any).businessPayment = {
    create: async ({ data }: any) => {
      const list = payments.get(data.orderId) ?? [];
      const p = { id: `pay-${list.length}`, paidAt: new Date(), ...data };
      list.push(p);
      payments.set(data.orderId, list);
      return p;
    },
  };
  (prisma as any).businessLedgerEntry = {
    findFirst: async ({ where }: any) => (ledger.get(where.refOrderId ? BIZ_ID : BIZ_ID) ?? []).find((l) => l.refOrderId === where.refOrderId && l.type === where.type && l.category === where.category) ?? null,
    findUnique: async ({ where }: any) => [...ledger.values()].flat().find((l) => l.id === where.id) ?? null,
    findMany: async ({ where }: any) => (ledger.get(where.businessId) ?? []),
    create: async ({ data }: any) => {
      const list = ledger.get(data.businessId) ?? [];
      const entry = { id: `led-${list.length + 10}`, createdAt: new Date(), ...data };
      list.push(entry);
      ledger.set(data.businessId, list);
      return entry;
    },
    update: async ({ where, data }: any) => {
      const entry = [...ledger.values()].flat().find((l) => l.id === where.id);
      if (!entry) throw new Error('record not found');
      return Object.assign(entry, data);
    },
    delete: async ({ where }: any) => {
      for (const [bizId, list] of ledger) {
        const i = list.findIndex((l) => l.id === where.id);
        if (i >= 0) return list.splice(i, 1)[0];
      }
      throw new Error('record not found');
    },
  };

  // treasury delegates — recordSaleIncome best-effort ต้องไม่ดัน PAID (และไม่ทำให้ log เตือนรก)
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
  };
  (prisma as any).treasuryEvent = { create: async ({ data }: any) => ({ id: `ev-${treasuryEvents.length}`, created_at: new Date(), ...data }) };

  // $transaction (callback) — raw query ล็อกด้วย id (แบบเดียวกับ businessShop.test.ts)
  const fakeTx: any = {
    $queryRaw: async (_sql: any, ...vals: any[]) => {
      const [id, businessId] = vals;
      const o = orders.get(id);
      return o && o.businessId === businessId ? [o] : [];
    },
    $executeRaw: async () => 0,
    businessOrder: (prisma as any).businessOrder,
    businessPayment: (prisma as any).businessPayment,
    businessLedgerEntry: (prisma as any).businessLedgerEntry,
    business: (prisma as any).business,
    personalBalanceSheet: (prisma as any).personalBalanceSheet,
    treasuryEvent: (prisma as any).treasuryEvent,
  };
  mock.method(prisma, '$transaction', async (fn: any) => (typeof fn === 'function' ? fn(fakeTx) : Promise.all(fn)));

  server = await createTestServer((app) => {
    app.use('/api/business', businessRoutes);
  });
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

let server: TestServer;
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
function patch(path: string, body: unknown, token?: string) {
  return fetch(server.baseUrl + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}
function del(path: string, token?: string) {
  return fetch(server.baseUrl + path, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });
}
const tok = (userId: string) => makeToken('OPERATOR', { userId });

// ══ Pure: แยก VAT จากราคารวม ══
test('splitVatFromGross — ราคารวม VAT 7% แยกเป็นฐาน+ภาษี ตรงเป๊ะ (10700 → 10000+700)', () => {
  const { base, vat } = splitVatFromGross(10700, 0.07);
  assert.equal(base, 10000);
  assert.equal(vat, 700);
  assert.equal(base + vat, 10700);
  assert.deepEqual(splitVatFromGross(0, 0.07), { base: 0, vat: 0 });
  assert.deepEqual(splitVatFromGross(-5, 0.07), { base: 0, vat: 0 });
  assert.deepEqual(splitVatFromGross(500, 0), { base: 500, vat: 0 }); // ไม่ VAT = ยอดเต็มเป็นฐาน
  // ปัดเงิน 2 ตำแหน่ง — 1,380.30 → ฐาน 1,290 + VAT 90.30
  const r = splitVatFromGross(1380.3, 0.07);
  assert.equal(r.base, 1290);
  assert.ok(Math.abs(r.vat - 90.3) < 0.001);
});

// ══ Pure: ภาษีขาย ภ.พ.30 ══
test('computeVatMonthly — ยอดขายรวม VAT แยกเป็นฐาน + ภาษีขาย (ข้ามกลุ่มไม่มี VAT)', () => {
  const r = computeVatMonthly({ vatRate: 0.07, salesGrossByRate: { '0.07': 10700, '0': 500 } });
  assert.equal(r.salesBase, 10000);
  assert.equal(r.outputVat, 700);
  assert.equal(r.salesWithoutVat, 500);
});

// ══ Pure: นิติบุคคล SME + WHT credit ══
test('computeCit — SME 0/15/20% ก้าวหน้า, เกินเพดาน = 20% แบบ, WHT ลดยอดจ่ายไม่ติดลบ', () => {
  // กำไร 500,000 → 0%×300k + 15%×200k = 30,000
  const a = computeCit({ netProfit: 500_000, capitalRegistered: 1_000_000, totalRevenue: 2_000_000, whtCredits: 0 });
  assert.equal(a.isSme, true);
  assert.equal(a.grossTax, 30_000);
  assert.equal(a.breakdown[0].rate, 0);
  assert.equal(a.breakdown[1].rate, 0.15);

  // กำไร 3,500,000 → 0 + 15%×2.7M (405,000) + 20%×0.5M (100,000) = 505,000
  const b = computeCit({ netProfit: 3_500_000, capitalRegistered: 4_000_000, totalRevenue: 10_000_000, whtCredits: 0 });
  assert.equal(b.grossTax, 505_000);
  assert.equal(b.breakdown.length, 3);

  // รายได้เกิน 30M → ไม่ SME → 20% แบบเดียว
  const c = computeCit({ netProfit: 1_000_000, capitalRegistered: 1_000_000, totalRevenue: 40_000_000, whtCredits: 0 });
  assert.equal(c.isSme, false);
  assert.equal(c.grossTax, 200_000);

  // WHT หักยอดจ่าย — เครดิตเกินไม่ติดลบ
  assert.equal(isSme(5_000_000, 30_000_000), true);
  assert.equal(isSme(5_000_001, 30_000_000), false);
  const d = computeCit({ netProfit: 500_000, capitalRegistered: 1_000_000, totalRevenue: 2_000_000, whtCredits: 50_000 });
  assert.equal(d.taxDue, 0);
});

// ══ Pure: บุคคลธรรมดา ══
test('computePit — หักค่าใช้จ่าย 60,000 แล้วขึ้นขั้น 0/5/10…', () => {
  // รายได้ 300,000 → ฐาน 240,000 → 0%×150k + 5%×90k = 4,500
  const a = computePit({ totalIncome: 300_000 });
  assert.equal(a.taxable, 240_000);
  assert.equal(a.grossTax, 4_500);
  // ต่ำกว่า 150,000 (หลังหัก) = ไม่จ่าย
  assert.equal(computePit({ totalIncome: 100_000 }).grossTax, 0);
  // WHT เครดิต
  const b = computePit({ totalIncome: 300_000, whtCredits: 5_000 });
  assert.equal(b.taxDue, 0);
  assert.equal(computePit({ totalIncome: 300_000, whtCredits: 1_000 }).taxDue, 3_500);
});

// ══ Pure: ปฏิทินยื่น ══
test('taxCalendar — ภ.พ.30 = 15 เดือนถัดไป, ภ.ง.ด.3 = 7 (เลื่อนเดือนเมื่อผ่านแล้ว), PND.50 = +150 วัน', () => {
  const cal = taxCalendar(new Date('2026-09-13T00:00:00Z'));
  const by = (k: string) => cal.find((c) => c.key === k)!;
  assert.equal(cal.length, 5);
  assert.equal(by('PP30').due, '2026-09-15'); // งวด ส.ค. — ยื่นภายใน 15 ก.ย.
  assert.equal(by('PND3').due, '2026-10-07'); // 7 ก.ย. ผ่านแล้ว → งวด ก.ย. ยื่น 7 ต.ค.
  assert.equal(by('PND50').due, '2027-05-30'); // ปิด 31 ธ.ค. 69 + 150 วัน
  assert.equal(by('PND51').due, '2026-08-31'); // ปิดครึ่งปี 30 มิ.ย. + 2 เดือน
  assert.equal(by('PND90').due, '2027-03-31');
  // ต้นเดือน — ยังอยู่ในงวดเดียวกัน
  const early = taxCalendar(new Date('2026-09-05T00:00:00Z'));
  assert.equal(early.find((c) => c.key === 'PND3')!.due, '2026-09-07');
  assert.equal(early.find((c) => c.key === 'PP30')!.due, '2026-09-15');
});

// ══ Pure: currentVatRate ตามวัน ══
test('อัตรา VAT ณ วันที่ — 7% ถึง 30 ก.ย. 2027 แล้วขึ้น 10%', () => {
  assert.equal(currentVatRate(new Date('2026-09-13')), 0.07);
  assert.equal(currentVatRate(new Date('2027-09-30')), 0.07);
  assert.equal(currentVatRate(new Date('2027-10-01')), 0.10);
});

// ══ Pure: ภาพรวมจากข้อมูลจริง (fixture เดียวกับ mock ด้านบน) ══
test('businessTaxOverview — VAT งวดนี้ 210−35, กำไรก่อนภาษีหัก VAT ออกก่อน, CIT SME จาก WHT เครดิต', () => {
  const ov = businessTaxOverview({
    vatRate: 0.07,
    salesPayments: [{ amount: 3210, vatRate: 0.07, paidAt: thisMonth(10) }],
    ledger: [
      { type: 'INCOME', category: 'SALES', amount: 3210, vatAmount: 210, whtAmount: 96.3, createdAt: thisMonth(10) },
      { type: 'EXPENSE', category: 'SERVICE', amount: 535, vatAmount: 35, whtAmount: 16.05, createdAt: thisMonth(11) },
    ],
    capitalRegistered: 1_000_000,
    now: NOW,
  });
  const v = (ov.vat as any).thisMonth;
  assert.equal(v.outputVat, 210); // 3210/1.07 → VAT 210
  assert.equal(v.inputVat, 35);
  assert.equal(v.netVat, 175);
  const y = ov.year as any;
  assert.equal(y.income, 3210);
  assert.equal(y.expense, 535);
  assert.equal(y.netProfitBeforeTax, 3210 - 210 - (535 - 35)); // 2500
  assert.equal(y.wht.received, 96.3);
  assert.equal(y.wht.paid, 16.05);
  const cit = ov.cit as any;
  assert.equal(cit.isSme, true);
  assert.equal(cit.grossTax, 0); // กำไร 2,500 อยู่ในขั้น 0% ทั้งหมด (ยกเว้น 300k แรก)
  assert.equal(cit.whtCredits, 96.3);
  assert.equal(cit.taxDue, 0); // เครดิต WHT 96.3 ≥ ภาษี 0
});

// ══ HTTP: สิทธิ์ + ผลจริง ══
test('GET /tax — ACCOUNTANT ขึ้นไปเท่านั้น · VIEWER/คนนอก 403 · ตัวเลขมาจากข้อมูลจริง', async () => {
  assert.equal((await get(`${API}/${BIZ_ID}/tax`)).status, 401);
  assert.equal((await get(`${API}/${BIZ_ID}/tax`, tok(VIEWER_ID))).status, 403);
  assert.equal((await get(`${API}/${BIZ_ID}/tax`, tok(NON_MEMBER_ID))).status, 403);
  const res = await get(`${API}/${BIZ_ID}/tax`, tok(ACCOUNTANT_ID));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.vat.thisMonth.outputVat, 210);
  assert.equal(body.vat.thisMonth.netVat, 175);
  assert.equal(body.cit.isSme, true);
  assert.equal(body.calendar.length, 5);
  // พารามิเตอร์ทุน/ปีบัญชี เข้าถึง CIT
  const big = await (await get(`${API}/${BIZ_ID}/tax?capital=9000000&fyEnd=2026-06-30`, tok(ACCOUNTANT_ID))).json();
  assert.equal(big.cit.isSme, false); // ทุนเกิน 5M → อัตรากลาง 20%
  assert.equal(big.calendar.find((c: any) => c.key === 'PND50').due, '2026-11-27'); // 30 มิ.ย. + 150 วัน
});

test('POST /ledger — รายรับไม่ส่ง vatAmount ระบบแยกให้เองด้วยอัตราร้าน · รายจ่ายเก็บ VAT+WHT ที่ให้มา', async () => {
  // เขียน ledger = MANAGER ขึ้นไป (ACCOUNTANT อ่านได้อย่างเดียวตามลำดับสิทธิ์)
  const inc = await (await post(`${API}/${BIZ_ID}/ledger`, { type: 'INCOME', amount: 1070, note: 'ขายหน้าร้าน' }, tok(OWNER_ID))).json();
  assert.ok(Math.abs(inc.vatAmount - 70) < 0.001, `รายรับ 1070 รวม VAT → VAT 70 (ได้ ${inc.vatAmount})`);
  // ระบุ vatAmount เองได้ (รายได้ยกเว้น VAT)
  const zero = await (await post(`${API}/${BIZ_ID}/ledger`, { type: 'INCOME', amount: 500, vatAmount: 0 }, tok(OWNER_ID))).json();
  assert.equal(zero.vatAmount, 0);
  // รายจ่าย — เก็บตามใบกำกับ + WHT ที่เราหัก
  const exp = await (await post(`${API}/${BIZ_ID}/ledger`, { type: 'EXPENSE', amount: 535, vatAmount: 35, whtAmount: 16.05, category: 'SERVICE' }, tok(OWNER_ID))).json();
  assert.equal(exp.vatAmount, 35);
  assert.equal(exp.whtAmount, 16.05);
  // WHT เกินยอด → ถูกจำกัดไม่ให้เกิน amount
  const clamp = await (await post(`${API}/${BIZ_ID}/ledger`, { type: 'EXPENSE', amount: 100, whtAmount: 999 }, tok(OWNER_ID))).json();
  assert.equal(clamp.whtAmount, 100);
});

test('POST payments พร้อม whtAmount — ลูกค้า B2B หัก ณ ที่จ่าย: ledger เก็บ WHT + รายได้ Treasury ลดตาม', async () => {
  // ยังไม่ยืนยัน → ห้ามรับชำระ (QUOTE) กันหลงทาง
  orders.get(ORDER_OPEN_ID)!.status = 'QUOTE';
  assert.equal((await post(`${API}/${BIZ_ID}/orders/${ORDER_OPEN_ID}/payments`, { amount: 1070 }, tok(SALES_ID))).status, 400);
  orders.get(ORDER_OPEN_ID)!.status = 'ORDERED';

  // WHT เกินยอด → 400
  assert.equal((await post(`${API}/${BIZ_ID}/orders/${ORDER_OPEN_ID}/payments`, { amount: 100, whtAmount: 200 }, tok(SALES_ID))).status, 400);

  // รับชำระเต็ม 1070 โดยลูกค้าหัก WHT 3% ของฐาน (1000×3% = 30) — โอนเข้าจริง 1040
  const res = await post(`${API}/${BIZ_ID}/orders/${ORDER_OPEN_ID}/payments`, { amount: 1070, whtAmount: 30, method: 'TRANSFER', reference: 'INV-42' }, tok(SALES_ID));
  assert.equal(res.status, 201);
  const o = await res.json();
  assert.equal(o.status, 'PAID');

  const entry = (ledger.get(BIZ_ID) ?? []).find((l) => l.refOrderId === ORDER_OPEN_ID)!;
  assert.ok(entry, 'ชำระครบต้องลง ledger อัตโนมัติ');
  assert.ok(Math.abs(entry.vatAmount - 70) < 0.001);
  assert.equal(entry.whtAmount, 30);
  const payRow = payments.get(ORDER_OPEN_ID)!.find((p) => p.reference === 'INV-42')!;
  assert.equal(payRow.whtAmount, 30);
});

test('mark-paid (ทางลัดไม่ผ่าน payments) — ledger ยังแยก VAT ให้เอง WHT = 0', async () => {
  const id = '46464646-4646-4646-4646-464646464646';
  orders.set(id, { id, businessId: BIZ_ID, orderNo: 'B20260913-0009', status: 'ORDERED', subtotal: 1000, vat: 70, total: 1070, paidAmount: 0, publicToken: null, channel: 'ONLINE' });
  payments.set(id, []);
  const res = await post(`${API}/${BIZ_ID}/orders/${id}/transition`, { action: 'mark-paid' }, tok(OWNER_ID)); // state machine = MANAGER ขึ้นไป
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'PAID');
  const entry = (ledger.get(BIZ_ID) ?? []).find((l) => l.refOrderId === id)!;
  assert.ok(Math.abs(entry.vatAmount - 70) < 0.001);
  assert.equal(entry.whtAmount, 0);
});

// ══ Ledger แก้/ลบ — รายการมือแก้ได้, รายการออเดอร์ (refOrderId) ห้ามแตะ ══
test('PATCH/DELETE /ledger — SALES 403 · แก้ยอด/WHT ได้ · รายการออเดอร์บล็อก · ลบรายการมือได้', async () => {
  // รายการมือ (จากเทส POST /ledger ก่อนหน้า — id led-*) สร้างใหม่ให้ชัวร์
  const created = await post(`${API}/${BIZ_ID}/ledger`, { type: 'EXPENSE', category: 'ADS', amount: 500, vatAmount: 35, whtAmount: 15, note: 'ค่าโฆษณา' }, tok(OWNER_ID));
  assert.equal(created.status, 201);
  const manual = await created.json();

  // SALES ต่ำกว่า MANAGER → 403
  assert.equal((await patch(`${API}/${BIZ_ID}/ledger/${manual.id}`, { amount: 1 }, tok(SALES_ID))).status, 403);

  // แก้ยอด + WHT → ตรงตามส่ง (รายจ่ายไม่แตะ VAT อัตโนมัติ) — เขียน ledger = MANAGER ขึ้นไปเท่านั้น (ACCOUNTANT อ่านอย่างเดียว)
  const upd = await patch(`${API}/${BIZ_ID}/ledger/${manual.id}`, { amount: 320, whtAmount: 9.6 }, tok(OWNER_ID));
  assert.equal(upd.status, 200);
  const u = await upd.json();
  assert.equal(u.amount, 320);
  assert.equal(u.whtAmount, 9.6);
  assert.equal(u.vatAmount, 35);

  // รายการจากออเดอร์ (refOrderId) — ห้ามแก้ ห้ามลบ (ยอดผูกกับเอกสารออเดอร์)
  const orderEntry = (ledger.get(BIZ_ID) ?? []).find((l) => l.refOrderId === ORDER_PAID_ID)!;
  assert.equal((await patch(`${API}/${BIZ_ID}/ledger/${orderEntry.id}`, { amount: 1 }, tok(OWNER_ID))).status, 400);
  assert.equal((await del(`${API}/${BIZ_ID}/ledger/${orderEntry.id}`, tok(OWNER_ID))).status, 400);

  // ลบรายการมือได้ → list หายจริง (เขียน ledger = MANAGER ขึ้นไป)
  assert.equal((await del(`${API}/${BIZ_ID}/ledger/${manual.id}`, tok(OWNER_ID))).status, 200);
  assert.ok(!(ledger.get(BIZ_ID) ?? []).some((l) => l.id === manual.id));
});

// ══ เลือกงวด VAT ย้อนหลัง (?month=YYYY-MM) ══
test('businessTaxOverview ?month= — VAT งวดที่เลือก (และเดือนก่อนหน้า) ส่วนปี/กำไรยังยึดวันนี้', () => {
  // payments: ก.ค. 10700 (VAT 700), ส.ค. 5350 (VAT 350), ก.ย. 2140 (VAT 140) — ledger INCOME ตรงกัน + รายจ่าย VAT 35 ในเดือน ส.ค.
  const payments = [
    { amount: 10700, vatRate: 0.07, paidAt: new Date('2026-07-20T04:00:00Z') },
    { amount: 5350, vatRate: 0.07, paidAt: new Date('2026-08-20T04:00:00Z') },
    { amount: 2140, vatRate: 0.07, paidAt: new Date('2026-09-10T04:00:00Z') },
  ];
  const ledger = [
    { type: 'INCOME', category: 'SALES', amount: 10700, vatAmount: 700, whtAmount: 0, createdAt: new Date('2026-07-20T04:00:00Z') },
    { type: 'INCOME', category: 'SALES', amount: 5350, vatAmount: 350, whtAmount: 0, createdAt: new Date('2026-08-20T04:00:00Z') },
    { type: 'INCOME', category: 'SALES', amount: 2140, vatAmount: 140, whtAmount: 0, createdAt: new Date('2026-09-10T04:00:00Z') },
    { type: 'EXPENSE', category: 'SERVICE', amount: 535, vatAmount: 35, whtAmount: 0, createdAt: new Date('2026-08-11T04:00:00Z') },
  ];
  const now = new Date('2026-09-14T04:00:00Z');

  const aug = businessTaxOverview({ vatRate: 0.07, salesPayments: payments, ledger, month: '2026-08', now }) as any;
  assert.equal(aug.vat.thisMonth.outputVat, 350); // งวด ส.ค.
  assert.equal(aug.vat.thisMonth.inputVat, 35);
  assert.equal(aug.vat.lastMonth.outputVat, 700); // งวด ก.ค.
  assert.equal(aug.year.income, 18190); // ปียังยึดวันนี้ (รวมทุกเดือน)

  const sep = businessTaxOverview({ vatRate: 0.07, salesPayments: payments, ledger, now }) as any;
  assert.equal(sep.vat.thisMonth.outputVat, 140); // ไม่ส่ง month = งวดเดือนปัจจุบันตามเดิม
});

test('endOfMonth — ปลายเดือน UTC (ก.ค. 31 ลงท้าย 23:59:59.999)', () => {
  assert.equal(endOfMonth('2026-07').toISOString(), '2026-07-31T23:59:59.999Z');
  assert.equal(endOfMonth('2026-02').toISOString(), '2026-02-28T23:59:59.999Z');
});

// ══ เตือนกำหนดยื่นภาษี (Telegram worker) ══
test('dueFilingsToday — เตือนเฉพาะวันที่ตรงลิสต์ล่วงหน้า · 0 = วันครบกำหนด · ผ่านแล้วไม่เตือน', () => {
  const calendar = [
    { key: 'PP30', label: 'ภ.พ.30', due: '2026-09-15', periodLabel: 'ส.ค.' },
    { key: 'PND3', label: 'ภ.ง.ด.3', due: '2026-09-07', periodLabel: 'ส.ค.' },
  ];
  const today = new Date('2026-09-08T10:00:00Z');
  assert.deepEqual(dueFilingsToday(calendar, today, [7]).map((d) => d.key), ['PP30']); // เหลือ 7 วัน
  assert.deepEqual(dueFilingsToday(calendar, new Date('2026-09-06T10:00:00Z'), [3, 1]).map((d) => d.key), ['PND3']); // เหลือ 1 วัน
  assert.deepEqual(dueFilingsToday(calendar, today, [30]), []); // ไม่ตรงลิสต์ = เงียบ
  assert.deepEqual(dueFilingsToday(calendar, new Date('2026-09-15T10:00:00Z'), [0]).map((d) => d.key), ['PP30']); // วันครบกำหนด
  assert.deepEqual(dueFilingsToday(calendar, new Date('2026-09-16T10:00:00Z'), [0, 1, 7]), []); // ผ่านแล้ว
});

test('notifyTaxDeadlines — ส่งรายธุรกิจเมื่อมีกำหนดถึงวันเตือน · ไม่มีธุรกิจ = 0', async () => {
  const sent: any[] = [];
  const n = await notifyTaxDeadlines(new Date('2026-09-08T10:00:00Z'), async (p) => { sent.push(p); });
  assert.equal(n, 1); // BIZ_ID เดียวใน store
  assert.match(sent[0].text, /ร้านภาษีทดสอบ/);
  assert.match(sent[0].text, /ภ\.พ\.30/);
  assert.equal(sent[0].severity, 'warn');
  assert.ok(sent[0].eventKey.startsWith('business-taxdue-'));

  const none = await notifyTaxDeadlines(new Date('2026-09-16T10:00:00Z'), async (p) => { sent.push(p); });
  assert.equal(none, 0); // 16 ก.ย. ไม่ตรง 7/3/1 ของกำหนดไหน
});
