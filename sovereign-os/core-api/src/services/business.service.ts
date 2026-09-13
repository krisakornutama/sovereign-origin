// src/services/business.service.ts
//
// BUSINESS PLATFORM — ตรรกะธุรกิจทั้งหมด (สินค้า/ลูกค้า/ออเดอร์/ชำระเงิน/ติดตั้ง/การเงิน/ซัพพลายเออร์/agent)
//
// กติกาสถานะออเดอร์: QUOTE → ORDERED → PAID → DELIVERED (ยกเลิกได้เฉพาะ QUOTE/ORDERED)
// - ยืนยันออเดอร์ (QUOTE→ORDERED) = หักสต็อกใน transaction (กันสต็อกติดลบ)
// - ยกเลิกจาก ORDERED = คืนสต็อก
// - ชำระครบ (→PAID) = บันทึกรายรับในสมุดบัญชีธุรกิจอัตโนมัติ + เครดิตเงินสดเข้า Treasury ของเจ้าของ (SHOP_INCOME)
// - สินค้าผูกคลังกลาง (inventoryItemId): สต็อกธุรกิจ = ความจริงช่องทางธุรกิจ — InventoryItem ของเจ้าของ mirror ทุก delta
//   (ยืนยัน −/ยกเลิก +/รับขอเข้า +/แก้มือ ±; ยอดเริ่มต้นตอนผูกไม่ย้อนเติม — mirror เฉพาะ delta หลังจากนั้น)
import { prisma } from '../lib/prisma';
import { nextBusinessOrderNo } from '../lib/business';
import { sendTelegramAlert } from './telegram-alert.service';
import { creditLiquidCash } from './treasury.service';
import { businessTaxOverview, splitVatFromGross } from './thai-tax.service';

// ── helpers ──
function str(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}
/** คลังกลาง mirror — สินค้าผูก InventoryItem ไว้ → ขยับ quantity ตาม delta (best-effort: ลิงก์พัง/ไม่มี = ข้าม)
 *  ใส่ `need` เพื่อบังคับคลังต้องมีของพอก่อนหัก (ไม่พอ = throw → transaction ทั้งก้อนยกเลิก กันคลังติดลบ) */
async function mirrorWarehouseDelta(client: any, productId: string, delta: number, need?: number): Promise<void> {
  if (!delta) return;
  const p = await client.businessProduct.findUnique({ where: { id: productId } });
  if (!p?.inventoryItemId) return;
  const item = await client.inventoryItem.findUnique({ where: { id: p.inventoryItemId } });
  if (!item) return; // ลิงก์แขวน (ของถูกลบ) — ไม่บล็อกธุรกิจ
  if (need !== undefined && item.quantity < need) throw new Error(`สต็อกคลังกลางไม่พอสำหรับบางรายการ (ต้องการ ${need})`);
  try {
    await client.inventoryItem.update({ where: { id: item.id }, data: { quantity: Math.max(0, item.quantity + delta) } });
  } catch (err) {
    console.error('📦 warehouse mirror failed (business stock unchanged):', err);
  }
}
function num(v: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ── Business CRUD ──
export async function listBusinesses(userId: string, systemRole?: string): Promise<any[]> {
  if (systemRole === 'SUPERADMIN') {
    return prisma.business.findMany({ orderBy: { createdAt: 'desc' }, include: { members: true } });
  }
  return prisma.business.findMany({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: 'desc' },
    include: { members: true },
  });
}

/** เลขออเดอร์ถัดไป B20260912-0001 (นับของวันเดียวกัน +1) */
const nextOrderNo = (businessId: string) => nextBusinessOrderNo(businessId, 'B');


export async function createBusiness(userId: string, input: any): Promise<any> {
  const name = str(input?.name, 120);
  if (!name) throw new Error('name is required');
  const biz = await prisma.business.create({
    data: {
      name,
      bizType: str(input?.bizType, 30) || 'IOT_RETAIL',
      vatRate: num(input?.vatRate, 0, 0.3, 0.07),
      ownerId: userId,
      members: { create: { userId, position: 'OWNER' } },
    },
    include: { members: true },
  });
  return biz;
}

// ── Members ──
export async function listMembers(businessId: string): Promise<any[]> {
  return prisma.businessMember.findMany({
    where: { businessId },
    include: { user: { select: { id: true, username: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function addMember(businessId: string, input: any): Promise<any> {
  const userId = str(input?.userId, 40);
  const position = str(input?.position, 20) || 'VIEWER';
  if (!userId) throw new Error('userId is required');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('user not found');
  return prisma.businessMember.upsert({
    where: { businessId_userId: { businessId, userId } },
    update: { position },
    create: { businessId, userId, position },
  });
}

export async function removeMember(businessId: string, memberId: string): Promise<void> {
  const member = await prisma.businessMember.findUnique({ where: { id: memberId } });
  if (!member || member.businessId !== businessId) throw new Error('member not found');
  if (member.position === 'OWNER') throw new Error('เจ้าของธุรกิจถอดออกไม่ได้');
  await prisma.businessMember.delete({ where: { id: memberId } });
}

// ── Products ──
export async function listProducts(businessId: string, includeInactive = false): Promise<any[]> {
  return prisma.businessProduct.findMany({
    where: includeInactive ? { businessId } : { businessId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createProduct(businessId: string, input: any): Promise<any> {
  const sku = str(input?.sku, 40);
  const name = str(input?.name, 120);
  if (!sku || !name) throw new Error('sku and name are required');
  // ราคาติดลบ/ไม่ใช่ตัวเลข ต้อง reject ไม่ใช่เก็บเป็น 0
  const costPrice = Number(input?.costPrice ?? 0);
  const salePrice = Number(input?.salePrice ?? 0);
  if (!Number.isFinite(costPrice) || costPrice < 0 || !Number.isFinite(salePrice) || salePrice < 0) {
    throw new Error('costPrice and salePrice must be non-negative numbers');
  }
  return prisma.businessProduct.create({
    data: {
      businessId,
      sku,
      name,
      category: str(input?.category, 40) || 'GENERAL',
      specs: input?.specs ? str(input.specs, 500) : null,
      costPrice: num(costPrice, 0, 10_000_000),
      salePrice: num(salePrice, 0, 10_000_000),
      stockQty: Math.floor(num(input?.stockQty, 0, 1_000_000)),
      reorderPoint: Math.floor(num(input?.reorderPoint, 0, 1_000_000)),
      warrantyMonths: Math.floor(num(input?.warrantyMonths, 0, 120)),
      inventoryItemId: input?.inventoryItemId ? str(input.inventoryItemId, 36) : null,
      isActive: input?.isActive !== false,
    },
  });
}

export async function updateProduct(businessId: string, id: string, input: any): Promise<any> {
  const existing = await prisma.businessProduct.findUnique({ where: { id } });
  if (!existing || existing.businessId !== businessId) throw new Error('product not found');
  const data: any = {};
  if (input.name !== undefined) data.name = str(input.name, 120);
  if (input.category !== undefined) data.category = str(input.category, 40);
  if (input.specs !== undefined) data.specs = input.specs ? str(input.specs, 500) : null;
  if (input.costPrice !== undefined) data.costPrice = num(input.costPrice, 0, 10_000_000);
  if (input.salePrice !== undefined) data.salePrice = num(input.salePrice, 0, 10_000_000);
  if (input.stockQty !== undefined) data.stockQty = Math.floor(num(input.stockQty, 0, 1_000_000));
  if (input.reorderPoint !== undefined) data.reorderPoint = Math.floor(num(input.reorderPoint, 0, 1_000_000));
  if (input.warrantyMonths !== undefined) data.warrantyMonths = Math.floor(num(input.warrantyMonths, 0, 120));
  if (input.inventoryItemId !== undefined) data.inventoryItemId = input.inventoryItemId ? str(input.inventoryItemId, 36) : null;
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  const updated = await prisma.businessProduct.update({ where: { id }, data });
  // แก้ stockQty มือบนสินค้าที่ผูกคลังอยู่ → คลังขยับตาม delta (เพิ่งผูกใหม่ = ไม่ย้อนเติมยอดเก่า)
  if (existing.inventoryItemId && data.stockQty !== undefined) {
    await mirrorWarehouseDelta(prisma, id, data.stockQty - existing.stockQty);
  }
  return updated;
}

// ── Customers ──
export async function listCustomers(businessId: string): Promise<any[]> {
  return prisma.businessCustomer.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' } });
}

export async function createCustomer(businessId: string, input: any): Promise<any> {
  const name = str(input?.name, 120);
  if (!name) throw new Error('name is required');
  return prisma.businessCustomer.create({
    data: {
      businessId,
      name,
      phone: input?.phone ? str(input.phone, 30) : null,
      lineId: input?.lineId ? str(input.lineId, 60) : null,
      address: input?.address ? str(input.address, 300) : null,
      taxId: input?.taxId ? str(input.taxId, 20) : null,
      channel: str(input?.channel, 20) || 'ONLINE',
      notes: input?.notes ? str(input.notes, 500) : null,
    },
  });
}

// ── Orders ──
export async function listOrders(businessId: string, status?: string): Promise<any[]> {
  return prisma.businessOrder.findMany({
    where: { businessId, ...(status ? { status } : {}) },
    include: { lines: { include: { product: true } }, customer: true, payments: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function getOrder(businessId: string, id: string): Promise<any> {
  const order = await prisma.businessOrder.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, customer: true, payments: true, installations: true },
  });
  if (!order || order.businessId !== businessId) throw new Error('order not found');
  return order;
}

/** เปิดออเดอร์/ใบเสนอราคา — คำนวณ subtotal/VAT/total + snapshot ราคา/ทุนต่อบรรทัด */
export async function createOrder(businessId: string, input: any): Promise<any> {
  const biz = await prisma.business.findUnique({ where: { id: businessId } });
  if (!biz) throw new Error('business not found');
  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length === 0) throw new Error('items are required');
  const productIds = items.map((i: any) => str(i?.productId, 40));
  const products = await prisma.businessProduct.findMany({
    where: { id: { in: productIds }, businessId },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  let subtotal = 0;
  const lines = items.map((i: any) => {
    const p = byId.get(str(i?.productId, 40));
    if (!p) throw new Error('สินค้าบางรายการไม่อยู่ในธุรกิจนี้');
    const qty = Math.floor(num(i?.qty, 1, 100_000, 1));
    subtotal += p.salePrice * qty;
    return { productId: p.id, qty, unitPrice: p.salePrice, unitCost: p.costPrice, description: i?.description ? str(i.description, 200) : null };
  });
  const vat = Math.round(subtotal * biz.vatRate * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;

  return prisma.businessOrder.create({
    data: {
      businessId,
      orderNo: await nextOrderNo(businessId),
      customerId: input?.customerId ? str(input.customerId, 40) : null,
      channel: str(input?.channel, 20) || 'ONLINE',
      status: 'QUOTE',
      subtotal,
      vat,
      total,
      assignedToId: input?.assignedToId ? str(input.assignedToId, 40) : null,
      note: input?.note ? str(input.note, 500) : null,
      lines: { create: lines },
    },
    include: { lines: true },
  });
}

/**
 * เปลี่ยนสถานะออเดอร์ — state machine เดียวของระบบ
 * QUOTE→ORDERED หักสต็อก (transaction, กันติดลบ) · ORDERED→CANCELLED คืนสต็อก
 * PAID ต้องชำระครบเท่านั้น · DELIVERED ได้หลัง PAID
 */
export async function transitionOrder(
  businessId: string,
  id: string,
  action: 'confirm' | 'mark-paid' | 'deliver' | 'cancel'
): Promise<any> {
  const biz = await prisma.business.findUnique({ where: { id: businessId } });
  if (!biz) throw new Error('business not found');

  return prisma.$transaction(async (tx) => {
    // ล็อกแถวออเดอร์กัน race (SELECT ... FOR UPDATE) — cast ::uuid กัน uuid=text ของ pg
    const order = await tx.$queryRaw<any[]>`SELECT * FROM "business_orders" WHERE "id" = ${id}::uuid AND "businessId" = ${businessId}::uuid FOR UPDATE`;
    const o = order[0];
    if (!o) throw new Error('order not found');

    if (action === 'confirm') {
      if (o.status !== 'QUOTE') throw new Error(`ยืนยันได้เฉพาะจาก QUOTE (ปัจจุบัน ${o.status})`);
      const lines = await tx.businessOrderLine.findMany({ where: { orderId: id } });
      for (const line of lines) {
        // หักสต็อกแบบมีเงื่อนไข — stockQty >= qty ถึงจะสำเร็จ (กันสต็อกติดลบจาก concurrency)
        const res = await tx.$executeRaw`UPDATE "business_products" SET "stockQty" = "stockQty" - ${line.qty}::int, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${line.productId}::uuid AND "stockQty" >= ${line.qty}::int`;
        if (res !== 1) throw new Error(`สต็อกไม่พอสำหรับบางรายการ (ต้องการ ${line.qty})`);
        // ผูกคลังกลางไว้ → คลังต้องมีของพอด้วย (ไม่พอ = ยกเลิกทั้ง transaction กันคลังติดลบ)
        await mirrorWarehouseDelta(tx, line.productId, -line.qty, line.qty);
      }
      return tx.businessOrder.update({ where: { id }, data: { status: 'ORDERED' } });
    }

    if (action === 'cancel') {
      if (o.status !== 'QUOTE' && o.status !== 'ORDERED') throw new Error(`ยกเลิกได้เฉพาะก่อนส่งของ (ปัจจุบัน ${o.status})`);
      if (o.status === 'ORDERED') {
        const lines = await tx.businessOrderLine.findMany({ where: { orderId: id } });
        for (const line of lines) {
          await tx.$executeRaw`UPDATE "business_products" SET "stockQty" = "stockQty" + ${line.qty}::int, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${line.productId}::uuid`;
          await mirrorWarehouseDelta(tx, line.productId, line.qty);
        }
      }
      return tx.businessOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    }

    if (action === 'mark-paid') {
      if (o.status !== 'ORDERED') throw new Error(`ชำระเงินได้เฉพาะจาก ORDERED (ปัจจุบัน ${o.status})`);
      await recordSaleIncome(tx, businessId, o);
      return tx.businessOrder.update({ where: { id }, data: { status: 'PAID' } });
    }

    // deliver
    if (o.status !== 'PAID') throw new Error(`ส่งของได้เฉพาะหลังชำระเงินครบ (ปัจจุบัน ${o.status})`);
    return tx.businessOrder.update({ where: { id }, data: { status: 'DELIVERED' } });
  });
}

/** รายรับออเดอร์ → ledger INCOME + รายได้ร้านเข้า Treasury เจ้าของ (บาท → ดอลลาร์ด้วย USD_THB_RATE)
 *  กันซ้ำด้วย refOrderId (addPayment เป็นทางหลัก, mark-paid เป็นทางลัด — ใช้ตัวกันตัวเดียวกัน)
 *  ภาษี: VAT แยกจากยอด "รวม VAT" ด้วยอัตราของร้าน (ภาษีขาย ภ.พ.30) + WHT ที่ลูกค้าธุรกิจหัก (เครดิต ภ.ง.ด.50)
 *  ส่วน Treasury เป็น best-effort: พังไม่ดัน PAID ให้ล้ม (เงินจริงถึงร้านแล้ว) */
async function recordSaleIncome(tx: any, businessId: string, order: { id: string; orderNo: string; total: number }, whtAmount = 0): Promise<void> {
  const existing = await tx.businessLedgerEntry.findFirst({ where: { refOrderId: order.id, type: 'INCOME', category: 'SALES' } });
  if (existing) return;
  const { vat } = splitVatFromGross(order.total, (await tx.business.findUnique({ where: { id: businessId } }))?.vatRate ?? 0);
  await tx.businessLedgerEntry.create({
    data: { businessId, type: 'INCOME', category: 'SALES', amount: order.total, vatAmount: vat, whtAmount, note: `ขาย ${order.orderNo}`, refOrderId: order.id },
  });
  try {
    const biz = await tx.business.findUnique({ where: { id: businessId } });
    if (!biz) return;
    const rate = Number(process.env.USD_THB_RATE || 35) || 35;
    await creditLiquidCash(tx, biz.ownerId, (order.total - whtAmount) / rate, {
      type: 'SHOP_INCOME',
      note: `รายได้ร้าน ${biz.name} จาก ${order.orderNo} (฿${order.total.toFixed(2)})`,
    });
  } catch (err) {
    console.error('💸 shop income → treasury failed (order stays PAID):', err);
  }
}

/** บันทึกการชำระเงิน — ครบเท่า total แล้ว auto ไป PAID + บันทึกรายรับใน ledger
 *  whtAmount = ภาษีหัก ณ ที่จ่ายที่ลูกค้าธุรกิจหักจากงวดนี้ (ท.ป.4) — ยอดโอนเข้าจริง = amount − whtAmount
 *  วางบิลยอดเต็ม: paidAmount นับ amount เต็ม (ลูกค้าจ่ายหน้าร้านทั้งยอด ส่วน WHT รัฐโอนเข้าเราทีหลัง) */
export async function addPayment(businessId: string, id: string, input: any): Promise<any> {
  const amount = num(input?.amount, 0.01, 10_000_000);
  const method = str(input?.method, 20) || 'CASH';
  const whtAmount = Math.max(0, num(input?.whtAmount, 0, 10_000_000));
  if (whtAmount > amount) throw new Error('ภาษีหัก ณ ที่จ่ายห้ามเกินยอดชำระของงวดนี้');
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.$queryRaw<any[]>`SELECT * FROM "business_orders" WHERE "id" = ${id}::uuid AND "businessId" = ${businessId}::uuid FOR UPDATE`;
    const o = order[0];
    if (!o) throw new Error('order not found');
    if (o.status !== 'ORDERED' && o.status !== 'PAID') throw new Error(`รับชำระได้เฉพาะ ORDERED/PAID (ปัจจุบัน ${o.status})`);
    const paidAmount = o.paidAmount + amount;
    if (paidAmount > o.total + 0.001) throw new Error(`เกินยอดที่ต้องชำระ (คงเหลือ ${Math.max(0, o.total - o.paidAmount)})`);
    await tx.businessPayment.create({
      data: { orderId: id, amount, method, whtAmount, reference: input?.reference ? str(input.reference, 100) : null },
    });
    const updated = await tx.businessOrder.update({
      where: { id },
      data: { paidAmount, ...(paidAmount >= o.total - 0.001 ? { status: 'PAID' } : {}) },
    });
    if (updated.status === 'PAID') await recordSaleIncome(tx, businessId, updated, whtAmount);
    return updated;
  });
  return result;
}

// ── Installations ──
export async function listInstallations(businessId: string, status?: string): Promise<any[]> {
  return prisma.businessInstallation.findMany({
    where: { businessId, ...(status ? { status } : {}) },
    include: { order: { select: { id: true, orderNo: true } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function createInstallation(businessId: string, input: any): Promise<any> {
  const title = str(input?.title, 200);
  if (!title) throw new Error('title is required');
  return prisma.businessInstallation.create({
    data: {
      businessId,
      title,
      orderId: input?.orderId ? str(input.orderId, 40) : null,
      scheduledAt: input?.scheduledAt ? new Date(input.scheduledAt) : null,
      technicianId: input?.technicianId ? str(input.technicianId, 40) : null,
      checklist: Array.isArray(input?.checklist) ? input.checklist.slice(0, 30).map((c: any) => str(c, 200)) : undefined,
      note: input?.note ? str(input.note, 500) : null,
    },
  });
}

export async function transitionInstallation(businessId: string, id: string, action: 'start' | 'complete'): Promise<any> {
  const inst = await prisma.businessInstallation.findUnique({ where: { id } });
  if (!inst || inst.businessId !== businessId) throw new Error('installation not found');
  if (action === 'start') {
    if (inst.status !== 'TODO') throw new Error(`เริ่มได้เฉพาะจาก TODO (ปัจจุบัน ${inst.status})`);
    return prisma.businessInstallation.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
  }
  if (inst.status !== 'IN_PROGRESS') throw new Error(`ปิดงานได้เฉพาะจาก IN_PROGRESS (ปัจจุบัน ${inst.status})`);
  return prisma.businessInstallation.update({ where: { id }, data: { status: 'DONE', completedAt: new Date() } });
}

// ── Ledger ──
export async function listLedger(businessId: string, take = 200): Promise<any[]> {
  return prisma.businessLedgerEntry.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function addLedgerEntry(businessId: string, input: any): Promise<any> {
  const type = str(input?.type, 10) === 'INCOME' ? 'INCOME' : 'EXPENSE';
  const amount = num(input?.amount, 0.01, 10_000_000);
  // ภาษี: รายรับไม่ระบุ vatAmount → แยกอัตโนมัติจากยอดรวมด้วยอัตราของร้าน (กันลืม = ยอด VAT ตรงกับที่ยื่น ภ.พ.30)
  // รายจ่าย: vatAmount จากใบกำกับซัพพลายเออร์ (ภาษีซื้อ) + whtAmount ที่เราหักตอนจ่าย (ท.ป.4) — ไม่เกินยอดรายการ
  let vatAmount = Math.max(0, num(input?.vatAmount, 0, 10_000_000));
  const whtAmount = Math.max(0, Math.min(num(input?.whtAmount, 0, 10_000_000), amount));
  if (type === 'INCOME') {
    if (input?.vatAmount === undefined || input?.vatAmount === null) {
      const biz = await prisma.business.findUnique({ where: { id: businessId } });
      vatAmount = splitVatFromGross(amount, biz?.vatRate ?? 0).vat;
    }
    vatAmount = Math.min(vatAmount, amount);
  }
  return prisma.businessLedgerEntry.create({
    data: {
      businessId,
      type,
      category: str(input?.category, 30) || (type === 'INCOME' ? 'SALES' : 'OTHER'),
      amount,
      vatAmount,
      whtAmount,
      note: input?.note ? str(input.note, 300) : null,
    },
  });
}

/** สรุปการเงินธุรกิจ: รายรับ/รายจ่าย/กำไร + top products ตามกำไรจริง (unitPrice-unitCost) */
export async function businessSummary(businessId: string): Promise<any> {
  const since = new Date();
  since.setMonth(since.getMonth() - 1);
  const [ledger, orders] = await Promise.all([
    prisma.businessLedgerEntry.findMany({ where: { businessId } }),
    prisma.businessOrder.findMany({
      where: { businessId, status: { in: ['ORDERED', 'PAID', 'DELIVERED'] } },
      include: { lines: { include: { product: true } } },
    }),
  ]);
  const income = ledger.filter((l) => l.type === 'INCOME').reduce((s, l) => s + l.amount, 0);
  const expense = ledger.filter((l) => l.type === 'EXPENSE').reduce((s, l) => s + l.amount, 0);
  // ยอดขายนับเฉพาะที่เก็บเงินแล้ว (PAID/DELIVERED) — ตรงกับ INCOME ใน ledger
  const revenue = orders.filter((o) => o.status !== 'ORDERED').reduce((s, o) => s + o.total, 0);
  const cost = orders.filter((o) => o.status !== 'ORDERED').reduce((s, o) => s + o.lines.reduce((ls, l) => ls + l.unitCost * l.qty, 0), 0);

  const productProfit = new Map<string, { name: string; qty: number; profit: number }>();
  for (const o of orders) {
    for (const l of o.lines) {
      const key = l.productId;
      const entry = productProfit.get(key) ?? { name: l.product?.name ?? '?', qty: 0, profit: 0 };
      entry.qty += l.qty;
      entry.profit += (l.unitPrice - l.unitCost) * l.qty;
      productProfit.set(key, entry);
    }
  }
  const topProducts = [...productProfit.values()].sort((a, b) => b.profit - a.profit).slice(0, 5);

  const [lowStock, openOrders, todayInstallations] = await Promise.all([
    prisma.businessProduct.findMany({ where: { businessId, isActive: true, stockQty: { lte: prisma.businessProduct.fields.reorderPoint } } }),
    prisma.businessOrder.count({ where: { businessId, status: { in: ['QUOTE', 'ORDERED'] } } }),
    prisma.businessInstallation.count({ where: { businessId, status: { in: ['TODO', 'IN_PROGRESS'] } } }),
  ]);

  return {
    income,
    expense,
    profit: income - expense,
    revenue,
    cost,
    grossProfit: revenue - cost,
    topProducts,
    lowStock,
    openOrders,
    todayInstallations,
  };
}

// ── ภาษีไทย — สรุป VAT/CIT/PIT/WHT + ปฏิทินยื่น (คำนวณจากข้อมูลจริงในระบบ) ──
export async function businessTax(businessId: string, opts?: { capitalRegistered?: number; fiscalYearEnd?: string }): Promise<Record<string, unknown>> {
  const biz = await prisma.business.findUnique({ where: { id: businessId } });
  if (!biz) throw new Error('business not found');
  const [orders, ledger] = await Promise.all([
    prisma.businessOrder.findMany({
      where: { businessId, status: { in: ['PAID', 'DELIVERED'] } },
      select: { payments: { select: { amount: true, paidAt: true } } },
    }),
    prisma.businessLedgerEntry.findMany({ where: { businessId } }),
  ]);
  // ยอดขายนับเมื่อ "เก็บเงินได้" (เกิดหนี้ VAT ตอนรับเงิน/แจ้งชำระ — ไม่ใช่ตอนส่งของ)
  return businessTaxOverview({
    vatRate: biz.vatRate,
    salesPayments: orders.flatMap((o: any) => o.payments.map((p: any) => ({ amount: p.amount, vatRate: biz.vatRate, paidAt: p.paidAt }))),
    ledger,
    capitalRegistered: opts?.capitalRegistered,
    fiscalYearEnd: opts?.fiscalYearEnd,
  });
}

// ── Suppliers & Purchase Orders ──
export async function listSuppliers(businessId: string): Promise<any[]> {
  return prisma.businessSupplier.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' } });
}

export async function createSupplier(businessId: string, input: any): Promise<any> {
  const name = str(input?.name, 120);
  if (!name) throw new Error('name is required');
  return prisma.businessSupplier.create({
    data: { businessId, name, phone: input?.phone ? str(input.phone, 30) : null, note: input?.note ? str(input.note, 300) : null },
  });
}

export async function listPurchaseOrders(businessId: string): Promise<any[]> {
  return prisma.businessPurchaseOrder.findMany({
    where: { businessId },
    include: { supplier: true, product: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function createPurchaseOrder(businessId: string, input: any): Promise<any> {
  const supplierId = str(input?.supplierId, 40);
  const productId = str(input?.productId, 40);
  const qty = Math.floor(num(input?.qty, 1, 1_000_000, 0));
  const unitCost = num(input?.unitCost, 0, 10_000_000);
  if (!supplierId || !productId || qty < 1) throw new Error('supplierId, productId, qty are required');
  return prisma.businessPurchaseOrder.create({
    data: { businessId, supplierId, productId, qty, unitCost, note: input?.note ? str(input.note, 300) : null },
  });
}

/** รับของเข้า — สต็อกบวก + ต้นทุนเฉลี่ยเคลื่อนที่ + รายจ่ายอัตโนมัติ */
export async function receivePurchaseOrder(businessId: string, id: string): Promise<any> {
  return prisma.$transaction(async (tx) => {
    const po = await tx.businessPurchaseOrder.findUnique({ where: { id } });
    if (!po || po.businessId !== businessId) throw new Error('purchase order not found');
    if (po.status === 'RECEIVED') throw new Error('รับของไปแล้ว');
    const product = await tx.businessProduct.findUnique({ where: { id: po.productId } });
    if (!product) throw new Error('product not found');
    const newQty = product.stockQty + po.qty;
    const newCost = newQty > 0 ? (product.stockQty * product.costPrice + po.qty * po.unitCost) / newQty : po.unitCost;
    await tx.businessProduct.update({
      where: { id: product.id },
      data: { stockQty: newQty, costPrice: Math.round(newCost * 100) / 100 },
    });
    await mirrorWarehouseDelta(tx, product.id, po.qty);
    await tx.businessLedgerEntry.create({
      data: { businessId, type: 'EXPENSE', category: 'RESTOCK', amount: po.qty * po.unitCost, note: `ซื้อเข้า ${product.name} ×${po.qty}` },
    });
    return tx.businessPurchaseOrder.update({ where: { id }, data: { status: 'RECEIVED', receivedAt: new Date() } });
  });
}

// ── Public Shop settings (เจ้าของ/ผู้จัดการตั้งค่าหน้าร้านสาธารณะ) ──
export async function getShopSettings(businessId: string): Promise<any> {
  const biz = await prisma.business.findUnique({ where: { id: businessId } });
  if (!biz) throw new Error('business not found');
  // ไม่ส่ง PromptPay แบบเต็มกลับ UI — โชว์ mask 4 ตัวท้ายพอ (ตั้งใหม่ได้เสมอ)
  const target = String(biz.shopPromptPay ?? '').replace(/\D/g, '');
  return {
    shopOpen: Boolean(biz.shopOpen),
    shopName: biz.shopName ?? '',
    promptPayMasked: target ? `••• ${target.slice(-4)}` : '',
    promptPaySet: Boolean(biz.shopPromptPay),
  };
}

export async function updateShopSettings(businessId: string, input: any): Promise<any> {
  const biz = await prisma.business.findUnique({ where: { id: businessId } });
  if (!biz) throw new Error('business not found');
  const data: any = {};
  if (input?.shopName !== undefined) data.shopName = input.shopName ? str(input.shopName, 120) : null;
  if (input?.shopOpen !== undefined) data.shopOpen = Boolean(input.shopOpen);
  if (input?.shopPromptPay !== undefined) {
    const target = str(input.shopPromptPay, 20);
    if (target) {
      const digits = target.replace(/\D/g, '');
      // รับเบอร์ 10 หลักขึ้นต้น 0 หรือเลขบัตร 13 หลัก เท่านั้น — กัน QR พังเงียบ ๆ
      if (!(digits.length === 10 && digits.startsWith('0')) && digits.length !== 13) {
        throw new Error('PromptPay ต้องเป็นเบอร์มือถือ 10 หลักหรือเลขบัตรประชาชน 13 หลัก');
      }
      data.shopPromptPay = digits;
    } else {
      data.shopPromptPay = null;
    }
  }
  const updated = await prisma.business.update({ where: { id: businessId }, data });
  return getShopSettings(updated.id);
}

// ── Business Agents (ผู้ช่วย AI ประจำธุรกิจ) ──
export const BUSINESS_AGENT_PRESETS = [
  {
    key: 'sales_analyst',
    name: 'นักวิเคราะห์ยอดขาย',
    emoji: '📊',
    system_prompt: 'คุณคือนักวิเคราะห์ยอดขายของธุรกิจขายสินค้า IoT อ่านข้อมูลออเดอร์/กำไรที่ให้มาแล้วสรุปสินค้าขายดี กำไรต่อชิ้น และข้อเสนอแนะปฏิบัติได้จริง ตอบภาษาไทยสั้นกระชับ',
  },
  {
    key: 'stock_manager',
    name: 'ผู้จัดการสต็อก',
    emoji: '📦',
    system_prompt: 'คุณคือผู้จัดการสต็อกของธุรกิจ IoT ตรวจรายการสินค้า/จุดสั่งเติม แล้วแนะนำสินค้าที่ต้องสั่งเพิ่มพร้อมจำนวนที่แนะนำ ตอบภาษาไทยสั้นกระชับ',
  },
  {
    key: 'customer_service',
    name: 'ฝ่ายบริการลูกค้า',
    emoji: '💬',
    system_prompt: 'คุณคือผู้ช่วยฝ่ายบริการลูกค้าของธุรกิจ IoT ช่วยร่างข้อความตอบลูกค้า (LINE/โทรศัพท์) ให้สุภาพ ตรงประเด็น อ้างข้อมูลสินค้า/ราคา/รับประกันที่ให้มา ตอบภาษาไทย',
  },
  {
    key: 'marketer',
    name: 'นักการตลาด',
    emoji: '📣',
    system_prompt: 'คุณคือนักการตลาดของธุรกิจ IoT ร่างโพสต์ขายสินค้าสำหรับ Facebook/LINE จากข้อมูลสินค้าที่ให้มา มี hook เปิด ประโยชน์ที่ได้ ราคา และวิธีติดต่อ ตอบภาษาไทย',
  },
  {
    key: 'accountant',
    name: 'ผู้ช่วยบัญชี',
    emoji: '🧾',
    system_prompt: 'คุณคือผู้ช่วยบัญชีของธุรกิจ IoT สรุปรายรับ/รายจ่าย/กำไรจากข้อมูลสมุดบัญชีที่ให้มา แยกหมวด ชี้จุดที่รายจ่ายสูงผิดปกติ ตอบภาษาไทยสั้นกระชับ',
  },
] as const;

/** seed agent presets ของธุรกิจ → สร้าง AgentRole จริงบน Ollama runner เดิม + ผูก BusinessAgent */
export async function seedBusinessAgents(businessId: string, businessName: string): Promise<number> {
  const existing = await prisma.businessAgent.count({ where: { businessId } });
  if (existing > 0) return 0;
  let created = 0;
  for (const preset of BUSINESS_AGENT_PRESETS) {
    const role = await prisma.agentRole.create({
      data: {
        name: `[ธุรกิจ] ${businessName} · ${preset.name}`,
        emoji: preset.emoji,
        description: `ผู้ช่วย AI ประจำธุรกิจ "${businessName}" — ${preset.name}`,
        system_prompt: preset.system_prompt,
        capability: `business:${businessId}`,
        count: 1,
        enabled: true,
        daily_report: false,
      },
    });
    await prisma.businessAgent.create({
      data: { businessId, roleId: role.id, key: preset.key, name: preset.name, emoji: preset.emoji, enabled: true },
    });
    created += 1;
  }
  return created;
}

export async function listBusinessAgents(businessId: string): Promise<any[]> {
  return prisma.businessAgent.findMany({
    where: { businessId },
    include: { },
    orderBy: { createdAt: 'asc' },
  });
}

export async function setBusinessAgentEnabled(businessId: string, agentId: string, enabled: boolean): Promise<void> {
  const agent = await prisma.businessAgent.findUnique({ where: { id: agentId } });
  if (!agent || agent.businessId !== businessId) throw new Error('agent not found');
  await prisma.$transaction([
    prisma.businessAgent.update({ where: { id: agentId }, data: { enabled } }),
    prisma.agentRole.update({ where: { id: agent.roleId }, data: { enabled } }),
  ]);
}

/** บริบทข้อมูลจริงของธุรกิจสำหรับฉีดเข้า prompt ของ agent (อ่านอย่างเดียว) */
export async function businessContextFor(businessId: string, agentKey: string): Promise<string> {
  try {
    const biz = await prisma.business.findUnique({ where: { id: businessId } });
    if (!biz) return '(ไม่พบธุรกิจ)';
    if (agentKey === 'sales_analyst' || agentKey === 'accountant') {
      const s = await businessSummary(businessId);
      return [
        `ธุรกิจ: ${biz.name}`,
        `รายรับรวม ${s.income.toFixed(0)} บาท | รายจ่ายรวม ${s.expense.toFixed(0)} บาท | กำไร ${s.profit.toFixed(0)} บาท`,
        `ยอดขาย (ออเดอร์ยืนยันแล้ว) ${s.revenue.toFixed(0)} บาท | ต้นทุนสินค้า ${s.cost.toFixed(0)} บาท | กำไรขั้นต้น ${s.grossProfit.toFixed(0)} บาท`,
        `สินค้าขายดี: ${s.topProducts.map((p: any) => `${p.name} (${p.qty} ชิ้น กำไร ${p.profit.toFixed(0)})`).join(', ') || 'ยังไม่มี'}`,
      ].join('\n');
    }
    if (agentKey === 'stock_manager') {
      const products = await prisma.businessProduct.findMany({ where: { businessId, isActive: true }, orderBy: { stockQty: 'asc' }, take: 25 });
      if (products.length === 0) return '(ยังไม่มีสินค้าในระบบ)';
      return products.map((p) => `${p.sku} ${p.name} | สต็อก ${p.stockQty} | จุดสั่งเติม ${p.reorderPoint}${p.stockQty <= p.reorderPoint ? ' ⚠️ ต้องสั่งเติม' : ''}`).join('\n');
    }
    if (agentKey === 'customer_service' || agentKey === 'marketer') {
      const products = await prisma.businessProduct.findMany({ where: { businessId, isActive: true }, take: 15 });
      if (products.length === 0) return '(ยังไม่มีสินค้าในระบบ)';
      return products.map((p) => `${p.name} | ราคา ${p.salePrice} บาท | รับประกัน ${p.warrantyMonths} เดือน${p.specs ? ` | ${p.specs}` : ''}`).join('\n');
    }
    return `ธุรกิจ: ${biz.name}`;
  } catch (err) {
    console.error('business context error:', err instanceof Error ? err.message : err);
    return '(ดึงข้อมูลธุรกิจไม่ได้)';
  }
}

/** เตือนสต็อกต่ำผ่าน Telegram (เรียกจาก worker ทุกเช้า) */
export async function notifyLowStock(): Promise<number> {
  const low = await prisma.businessProduct.findMany({
    where: { isActive: true, stockQty: { lte: prisma.businessProduct.fields.reorderPoint } },
    include: { business: true },
    take: 20,
  });
  if (low.length === 0) return 0;
  const byBusiness = new Map<string, { name: string; items: string[] }>();
  for (const p of low) {
    const entry = byBusiness.get(p.businessId) ?? { name: p.business.name, items: [] };
    entry.items.push(`${p.name} เหลือ ${p.stockQty} (จุดสั่ง ${p.reorderPoint})`);
    byBusiness.set(p.businessId, entry);
  }
  for (const [, entry] of byBusiness) {
    void sendTelegramAlert({
      text: `📦 สต็อกต่ำ — ธุรกิจ "${entry.name}"\n${entry.items.join('\n')}`,
      severity: 'warn',
      eventKey: `business-lowstock-${entry.name}`,
    }).catch(() => {});
  }
  return low.length;
}
