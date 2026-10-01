import './setup-env';
import { test, before } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/lib/prisma';
import { buildMorningDigest } from '../src/services/business.service';

// ────────────────────────────────────────────────────────────────────────────
// P19 ต่อ — สรุปเช้าสำหรับเจ้าของ (ส่ง TG ทุกวัน 08:00 ไทย โดย workers/start.ts)
// ตรวจ: ตัวเลขจากข้อมูลจริง · ตัดรายการปฏิเสธ/ออเดอร์ครบยอดออก · ขอบเขต "เมื่อวาน" ตามวันไทย
// ────────────────────────────────────────────────────────────────────────────

const BIZ_ID = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-10-02T02:00:00Z'); // 09:00 ไทย 2 ต.ค. — "เมื่อวาน" = 1 ต.ค. (เขต +7)

const ledger: any[] = [];
const orders: any[] = [];
const payments: any[] = [];

before(async () => {
  (prisma as any).businessLedgerEntry = {
    findMany: async ({ where }: any) =>
      ledger.filter(
        (l) =>
          (where?.type === undefined || l.type === where.type) &&
          (where?.category === undefined || l.category === where.category) &&
          (where?.createdAt?.gte === undefined || (l.createdAt >= where.createdAt.gte && l.createdAt <= where.createdAt.lte))
      ),
  };
  (prisma as any).businessOrder = {
    findMany: async ({ where }: any) => orders.filter((o) => where?.status?.in === undefined || where.status.in.includes(o.status)),
  };
  (prisma as any).businessPayment = {
    findMany: async ({ where }: any) =>
      payments.filter((p) => (where?.method === undefined || p.method === where.method) && (where?.rejectedAt !== null || p.rejectedAt == null)),
  };

  // "เมื่อวาน" ตามวันไทย (1 ต.ค. 06:00 ไทย = 30 ก.ย. 23:00 UTC) — l2 อยู่นอกหน้าต่าง · l3 เป็นรายจ่าย
  ledger.push({ id: 'l1', type: 'INCOME', category: 'SALES', amount: 3210, createdAt: new Date('2026-10-01T06:00:00+07:00') });
  ledger.push({ id: 'l2', type: 'INCOME', category: 'SALES', amount: 107, createdAt: new Date('2026-09-30T23:00:00+07:00') });
  ledger.push({ id: 'l3', type: 'EXPENSE', category: 'SERVICE', amount: 535, createdAt: new Date('2026-10-01T07:00:00+07:00') });

  orders.push({ id: 'o1', businessId: BIZ_ID, status: 'ORDERED', total: 228.98, paidAmount: 100 });
  orders.push({ id: 'o2', businessId: BIZ_ID, status: 'QUOTE', total: 1500, paidAmount: 0, partnerId: 'p1' });
  orders.push({ id: 'o3', businessId: BIZ_ID, status: 'PAID', total: 100, paidAmount: 100 }); // ครบยอด — ไม่นับ

  payments.push({ id: 'p1', orderId: 'o1', amount: 100, method: 'PROMPTPAY' }); // รอยืนยัน
  payments.push({ id: 'p2', orderId: 'o2', amount: 1500, method: 'PROMPTPAY', rejectedAt: new Date() }); // ถูกปฏิเสธ
  payments.push({ id: 'p3', orderId: 'o3', amount: 100, method: 'PROMPTPAY' }); // ออเดอร์ครบแล้ว
});

test('buildMorningDigest — ตัวเลขจากข้อมูลจริง ตัดปฏิเสธ/ครบยอดออก · ขอบเขตเมื่อวานตามวันไทย', async () => {
  const text = await buildMorningDigest(NOW);
  assert.match(text, /สรุปเช้า/);
  assert.match(text, /3,210 ฿/, 'ยอดขายเมื่อวานเฉพาะ 1 ต.ค. ไทย (l2 อยู่ 30 ก.ย.)');
  assert.match(text, /1 บิล/, 'นับเฉพาะรายรับขายที่อยู่ในหน้าต่าง');
  assert.match(text, /100 ฿/, 'แจ้งชำระรอยืนยัน (ตัด rejected และออเดอร์ครบยอด)');
  assert.match(text, /1,628.98 ฿/, 'ค้างชำระรวม 2 ออเดอร์ (128.98 + 1500)');
  assert.match(text, /1 ใบ \(รวม 1,500 ฿\)/, 'บิลคู่ค้าค้างชำระ');
  assert.ok(!text.includes('1,500 ฿</b>'), 'rejected ต้องไม่เข้ายอดแจ้งชำระรอยืนยัน');
  assert.ok(!text.includes('535'), 'รายจ่ายไม่ปนยอดขาย');
  assert.ok(!text.includes('107'), 'รายรับนอกวันไทยเมื่อวานไม่ปน');
});

test('buildMorningDigest — ไม่มีข้อมูล = ยังส่ง (heartbeat) ตัวเลขเป็น 0', async () => {
  ledger.length = 0;
  orders.length = 0;
  payments.length = 0;
  const text = await buildMorningDigest(NOW);
  assert.match(text, /สรุปเช้า/);
  assert.match(text, /0 ฿/);
  assert.match(text, /0 ออเดอร์/);
  assert.match(text, /0 ใบ/);
});
