// src/services/business-shop.service.ts
//
// PUBLIC SHOP — หน้าร้านสาธารณะ (/shop?id=<businessId>) ให้ลูกค้าทั่วไปสั่งซื้อได้
//
// กติกาความปลอดภัย:
// - เปิดเฉพาะธุรกิจที่ shopOpen=true — ปิดร้าน = 404 (ไม่เผยว่าธุรกิจนี้มีอยู่หรือไม่)
// - สาธารณะเห็นเฉพาะ: ชื่อร้าน + สินค้า (ชื่อ/ราคา/สเปค/รับประกัน/สต็อกพอ-ไม่พอ) — ห้ามโผล่ costPrice ทุน
// - สั่งซื้อ = QUOTE แบบไม่หักสต็อก (ยืนยันสต็อกตอนร้านกด confirm เหมือนเดิม)
// - ชำระเงินผ่านลิงก์ลับ publicToken ต่อออเดอร์ (UUID) — จำกัด amount = ส่วนที่ค้างชำระเสมอ
// - ทุก endpoint สาธารณะโดน rate limit ที่ route layer (public ที่สุดของระบบ)
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';

// P16 — ให้ routes เรียกสถิติผ่านตัวกลางเดียวกัน (ธรรมเนียมบ้าน: service เป็นเจ้าของ DB เสมอ)
export { prisma };
import { nextBusinessOrderNo } from '../lib/business';
import { buildPromptPayPayload } from './promptpay';
import QRCode from 'qrcode';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── helpers (ชุดเดียวกับ business.service.ts) ──
function str(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}
function num(v: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** ชื่อร้านที่โชว์สาธารณะ — shopName ตั้งเองมาก่อน ไม่งั้นใช้ชื่อธุรกิจ */
function shopDisplayName(biz: { shopName: string | null; name: string }): string {
  return biz.shopName?.trim() || biz.name;
}

/** ธุรกิจนี้เปิดร้านอยู่หรือไม่ — ปิด/ไม่มีจริง = throw (route แปลงเป็น 404 กลาง ไม่เผยว่ามีอยู่) */
async function openShopOrThrow(businessId: string): Promise<any> {
  const biz = await prisma.business.findUnique({ where: { id: businessId } });
  if (!biz || !biz.isActive || !biz.shopOpen) throw new Error('shop not found');
  return biz;
}

/** รูปร่างสินค้าที่คืนให้สาธารณะ — ตัดทุน/จุดสั่งเติมทิ้ง (I5a: เปิด inventoryItemId เฉพาะ id สำหรับลิงก์ตามรอย —
 *  UUID ภายในไม่ใช่ความลับ และ endpoint ปลายทาง /api/trace/products คืนเฉพาะข้อมูลสาธารณะ ไม่มีทุน/ข้อมูลส่วนบุคคล) */
function publicProduct(p: any): any {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    specs: p.specs ?? null,
    salePrice: p.salePrice,
    warrantyMonths: p.warrantyMonths,
    inStock: p.stockQty > 0,
    inventoryItemId: p.inventoryItemId ?? null,
  };
}

/** หน้าร้าน — ข้อมูลร้าน + สินค้าที่เปิดขาย (ตัดต้นทุนออกหมด) */
export async function getPublicShop(businessId: string): Promise<any> {
  const biz = await openShopOrThrow(businessId);
  const products = await prisma.businessProduct.findMany({
    where: { businessId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  return {
    id: biz.id,
    name: shopDisplayName(biz),
    vatRate: biz.vatRate,
    products: products.map(publicProduct),
  };
}

/** ลูกค้าสั่งซื้อ — สร้าง QUOTE + ลูกค้า walk-in จากชื่อ/เบอร์ที่กรอก (ไม่หักสต็อก) */
export async function createPublicOrder(businessId: string, input: any): Promise<any> {
  const biz = await openShopOrThrow(businessId);

  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length === 0) throw new Error('items are required');
  if (items.length > 50) throw new Error('สั่งได้ครั้งละไม่เกิน 50 รายการ');

  const name = str(input?.customerName, 120);
  const phone = str(input?.customerPhone, 30);
  if (!name || !phone) throw new Error('customerName and customerPhone are required');

  const productIds = items.map((i: any) => str(i?.productId, 40));
  const products = await prisma.businessProduct.findMany({
    where: { id: { in: productIds }, businessId, isActive: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  let subtotal = 0;
  const lines = items.map((i: any) => {
    const p = byId.get(str(i?.productId, 40));
    if (!p) throw new Error('สินค้าบางรายการไม่อยู่ในร้านนี้');
    const qty = Math.floor(num(i?.qty, 1, 1000, 0));
    if (qty < 1) throw new Error(`จำนวนของ "${p.name}" ต้องเป็นจำนวนเต็มอย่างน้อย 1`);
    if (p.stockQty < qty) throw new Error(`สินค้า "${p.name}" มีสต็อกไม่พอ (เหลือ ${p.stockQty})`);
    subtotal += p.salePrice * qty;
    return { productId: p.id, qty, unitPrice: p.salePrice, unitCost: p.costPrice, description: null };
  });
  const vat = Math.round(subtotal * biz.vatRate * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;

  // ลูกค้า walk-in — ผูกด้วยเบอร์โทร (หาซ้ำได้ในธุรกิจเดียวกัน)
  const existing = await prisma.businessCustomer.findFirst({ where: { businessId, phone } });
  const customerId = existing
    ? existing.id
    : (await prisma.businessCustomer.create({ data: { businessId, name, phone, channel: 'ONLINE' } })).id;

  const order = await prisma.businessOrder.create({
    data: {
      businessId,
      orderNo: await nextBusinessOrderNo(businessId, 'S'), // S… = ออเดอร์หน้าร้านสาธารณะ (แยกจาก B… ของหน้าร้านในระบบ)
      customerId,
      channel: 'ONLINE',
      status: 'QUOTE',
      subtotal,
      vat,
      total,
      publicToken: randomUUID(), // ลิงก์ลับสำหรับเช็คสถานะ/แจ้งชำระ — สร้างตั้งแต่ออเดอร์หน้าร้าน
      note: input?.note ? str(input.note, 500) : `สั่งจากหน้าร้านโดย ${name}`,
      lines: { create: lines },
    },
  });

  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    total: order.total,
    publicToken: (order as any).publicToken,
  };
}

/** สถานะออเดอร์ผ่านลิงก์ลับ — token ไม่ตรง/ผิดรูปแบบ = not found ปลอดภัย (กัน prisma uuid cast error รั่ว 500) */
export async function getPublicOrderByToken(token: string): Promise<any> {
  if (!UUID_RE.test(String(token))) throw new Error('order not found');
  const order = await prisma.businessOrder.findUnique({
    where: { publicToken: token },
    include: {
      lines: { include: { product: { select: { name: true } } } },
      payments: true,
      business: { select: { id: true, shopName: true, name: true } },
    },
  });
  if (!order) throw new Error('order not found');
  const paidAmount = order.payments.reduce((s: number, p: any) => s + p.amount, 0);
  return {
    orderNo: order.orderNo,
    status: order.status,
    shop: { id: order.business.id, name: shopDisplayName(order.business) },
    subtotal: order.subtotal,
    vat: order.vat,
    total: order.total,
    paidAmount,
    remaining: Math.max(0, order.total - paidAmount),
    lines: order.lines.map((l: any) => ({ name: l.product?.name ?? l.description ?? 'สินค้า', qty: l.qty, unitPrice: l.unitPrice })),
    payments: order.payments.map((p: any) => ({ amount: p.amount, method: p.method, paidAt: p.paidAt })),
    shipping: publicShipping(order),
  };
}

/**
 * ลูกค้าแจ้งชำระ PromptPay ผ่านลิงก์ลับ
 * - จำกัด amount ≤ ส่วนค้างชำระเสมอ (ห้ามจ่ายเกิน ห้ามตั้งเองว่าครบถ้ายอดไม่ถึง)
 * - บันทึกเป็น method PROMPTPAY + reference = token ต้นทาง (ตรวจย้อนได้) สถานะยังเดิม รอร้านตรวจเงินเข้า
 */
export async function payPublicOrderByToken(token: string, input: any): Promise<any> {
  if (!UUID_RE.test(String(token))) throw new Error('order not found');
  const amount = num(input?.amount, 0.01, 1_000_000, 0);
  if (amount <= 0) throw new Error('amount is required');

  return prisma.$transaction(async (tx) => {
    const order = await tx.$queryRaw<any[]>`SELECT * FROM "business_orders" WHERE "publicToken" = ${token}::uuid FOR UPDATE`;
    const o = order[0];
    if (!o) throw new Error('order not found');
    if (o.status !== 'QUOTE' && o.status !== 'ORDERED' && o.status !== 'PAID') {
      throw new Error(`ออเดอร์นี้ยกเลิกหรือส่งของไปแล้ว (ปัจจุบัน ${o.status})`);
    }
    const payments: any[] = await tx.businessPayment.findMany({ where: { orderId: o.id } });
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const remaining = o.total - paid;
    if (remaining <= 0.001) throw new Error('ออเดอร์นี้ชำระครบแล้ว');
    if (amount > remaining + 0.001) throw new Error(`จ่ายเกินยอดที่ค้าง (คงเหลือ ${remaining.toFixed(2)} บาท)`);
    await tx.businessPayment.create({
      data: { orderId: o.id, amount, method: 'PROMPTPAY', reference: token },
    });
    return { ok: true, orderNo: o.orderNo, reported: amount, remaining: Math.max(0, remaining - amount) };
  });
}

/** ข้อมูลสำหรับหน้าชำระเงิน — QR สำเร็จรูป (data URL) + เบอร์ปลายทางแบบ mask */
export async function publicPromptPayInfo(businessId: string, amountThb: number): Promise<any> {
  const biz = await openShopOrThrow(businessId);
  if (!biz.shopPromptPay) return { configured: false };
  const payload = buildPromptPayPayload({ target: biz.shopPromptPay, amountThb });
  if (!payload) return { configured: false };
  const digits = String(biz.shopPromptPay).replace(/\D/g, '');
  return {
    configured: true,
    qrDataUrl: await QRCode.toDataURL(payload, { margin: 1, width: 240 }),
    maskedTarget: digits.length >= 4 ? `••• ${digits.slice(-4)}` : '••••',
    amountThb,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// เฟส 4 — สถานะจัดส่งแบบเบา (ร้านส่งเอง) + catalog กลางชุมชน
// กติกา: เสริมจาก transition เดิม ไม่แทนที่ · ลูกค้าเห็นผ่านลิงก์ลับเท่านั้น ·
// catalog กลางเฉพาะร้านที่เปิดเอง (shopInCommunity) — โชว์เฉพาะข้อมูลที่เปิดเผยแล้ว
// ────────────────────────────────────────────────────────────────────────────

const SHIPPING_STATUSES = ['PREPARING', 'SHIPPED', 'DELIVERED'] as const;
export type ShippingStatus = (typeof SHIPPING_STATUSES)[number];

/** ร้านอัปเดตสถานะจัดส่ง — จำกัด transition ไปข้างหน้าเท่านั้น (PREPARING → SHIPPED → DELIVERED) */
export async function updateShippingStatus(
  businessId: string,
  orderId: string,
  input: { shippingStatus?: string; shippingCarrier?: string; shippingTracking?: string }
): Promise<any> {
  const status = str(input?.shippingStatus, 20);
  if (!(SHIPPING_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`shippingStatus ต้องเป็นหนึ่งใน: ${SHIPPING_STATUSES.join(', ')}`);
  }
  const order = await prisma.businessOrder.findUnique({ where: { id: orderId } });
  if (!order || order.businessId !== businessId) throw new Error('order not found');
  if (order.status === 'CANCELLED') throw new Error('ออเดอร์นี้ถูกยกเลิกแล้ว — ตั้งสถานะจัดส่งไม่ได้');
  if (order.status === 'QUOTE') throw new Error('ออเดอร์ยังไม่ยืนยัน — ยืนยันออเดอร์ก่อนอัปเดตการจัดส่ง');

  const rank = (s: string | null) => (s ? SHIPPING_STATUSES.indexOf(s as ShippingStatus) : -1);
  if (rank(status) < rank(order.shippingStatus ?? null)) {
    throw new Error(`สถานะจัดส่งเดินหน้าไปแล้ว (${order.shippingStatus}) — ย้อนกลับไม่ได้`);
  }
  const data: any = { shippingStatus: status };
  if (input?.shippingCarrier !== undefined) data.shippingCarrier = str(input.shippingCarrier, 80) || null;
  if (input?.shippingTracking !== undefined) data.shippingTracking = str(input.shippingTracking, 120) || null;
  if (status === 'SHIPPED' && rank(order.shippingStatus ?? null) < 1) data.shippedAt = new Date();
  return prisma.businessOrder.update({ where: { id: orderId }, data });
}

/** ลูกค้าเห็นสถานะจัดส่งผ่านลิงก์ลับ — แนบในคำตอบเดิม */
function publicShipping(order: any): any {
  if (!order.shippingStatus) return null;
  return {
    status: order.shippingStatus,
    carrier: order.shippingCarrier ?? null,
    tracking: order.shippingTracking ?? null,
    shippedAt: order.shippedAt ?? null,
  };
}

/** catalog กลางชุมชน — รวมสินค้าจากทุกร้านที่เปิดทั้ง /shop และเข้าร่วม catalog เอง (opt-in) */
export async function getCommunityCatalog(): Promise<any> {
  const businesses = await prisma.business.findMany({
    where: { isActive: true, shopOpen: true, shopInCommunity: true },
    orderBy: { name: 'asc' },
  });
  const shops = await Promise.all(
    businesses.map(async (biz: any) => {
      const products = await prisma.businessProduct.findMany({
        where: { businessId: biz.id, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      return {
        id: biz.id,
        name: shopDisplayName(biz),
        productCount: products.length,
        products: products.map(publicProduct),
      };
    })
  );
  return {
    shops: shops.filter((s: any) => s.products.length > 0),
    generatedAt: new Date().toISOString(),
  };
}


// ── P17 — บิลค่าบริการ/ติดตั้ง IoT สำหรับคู่ค้า (ย้ายมาไว้ที่เจ้าของ business_orders ตาม boundary gate) ──

/** id ธุรกิจหลักที่ใช้ออกบิลคู่ค้า (หาจากชื่อ — เรียกจาก partners routes ผ่านตรงนี้เท่านั้น) */
export async function foundationBusinessId(): Promise<string | null> {
  const biz = await prisma.business.findFirst({ where: { name: 'Sovereign Origin Foundation' }, select: { id: true } });
  return biz?.id ?? null;
}

/** บิลของคู่ค้า — ตรวจสิทธิ์ด้วย token ที่นี่ (partners routes ส่งมาได้เลย ไม่แตะ business_orders ตรง) */
export async function partnerBillsAuthorized(partnerId: string, token: string): Promise<any[] | null> {
  if (!UUID_RE.test(String(token))) return null; // token ผิดรูปแบบ = not found ปลอดภัย (กัน prisma uuid cast error รั่ว 500)
  const owner = await prisma.businessOrder.findFirst({ where: { publicToken: token, partnerId }, select: { id: true } });
  if (!owner) return null; // token ไม่ตรง → caller ตอบ 403
  return partnerBills(partnerId);
}
// ── P17 — บิลค่าบริการ/ติดตั้ง IoT สำหรับคู่ค้า ──
// เจ้าของสร้างบิลจากแผงคู่ค้า → คู่ค้าชำระผ่านลิงก์ลับ PromptPay เดิม (/shop?order=<token>)
// งานซ่อม/ติดตั้ง = BusinessInstallation ผูกกับออเดอร์ → ตามรอยได้จากลิงก์เดียวกัน
export interface PartnerBillInput {
  partnerId: string;
  title: string;          // เช่น "ค่าติดตั้งเซ็นเซอร์อุณหภูมิ 2 จุด"
  amount: number;         // บาท (ยังไม่รวม VAT)
  installTitle?: string;  // ถ้ามี = สร้างงานติดตั้ง/ซ่อมพร้อมบิล
  note?: string;
}

export async function createPartnerBill(businessId: string, input: PartnerBillInput): Promise<{ orderId: string; orderNo: string; publicToken: string; total: number }> {
  const partner = await prisma.partner.findUnique({ where: { id: input.partnerId } });
  if (!partner) throw new Error('partner not found');
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount ต้องเป็นตัวเลขมากกว่า 0');
  const title = String(input.title ?? '').trim().slice(0, 160);
  if (!title) throw new Error('title จำเป็น');

  // ลูกค้า = ตัวแทนของคู่ค้า (ชื่อร้าน + เบอร์ผู้ติดต่อ — หาซ้ำได้ในธุรกิจเดียวกัน)
  const biz = await prisma.business.findUnique({ where: { id: businessId } });
  if (!biz) throw new Error('business not found');
  const custName = `คู่ค้า: ${partner.name}`.slice(0, 120);
  const existing = await prisma.businessCustomer.findFirst({ where: { businessId, phone: partner.contactPhone } });
  const customerId = existing ? existing.id
    : (await prisma.businessCustomer.create({ data: { businessId, name: custName, phone: partner.contactPhone, channel: 'B2B' } })).id;

  // VAT ตามร้าน · สร้าง QUOTE + publicToken (ชำระผ่านลิงก์ลับเดิมได้ทันที)
  const vat = Math.round(amount * biz.vatRate * 100) / 100;
  const total = Math.round((amount + vat) * 100) / 100;
  const order = await prisma.businessOrder.create({
    data: {
      businessId,
      orderNo: await nextBusinessOrderNo(businessId, 'P'), // P… = บิลคู่ค้า (P16/P17)
      customerId,
      channel: 'B2B',
      status: 'QUOTE',
      subtotal: amount,
      vat,
      total,
      partnerId: partner.id,
      publicToken: randomUUID(),
      note: `บิลค่าบริการ IoT คู่ค้า — ${title}${input.note ? ` · ${String(input.note).slice(0, 200)}` : ''}`,
      lines: { create: [{ productId: (await ensureServiceProduct(businessId, title, amount)).id, qty: 1, unitPrice: amount, unitCost: 0, description: title }] },
    },
  });

  // งานติดตั้ง/ซ่อม (ถ้าระบุ) — ตามรอยผ่าน BusinessInstallation เดิม
  if (input.installTitle) {
    await prisma.businessInstallation.create({
      data: { businessId, orderId: order.id, title: String(input.installTitle).slice(0, 160), status: 'TODO' },
    });
  }
  await notifyPartnerBill(partner, title);
  return { orderId: order.id, orderNo: order.orderNo, publicToken: (order as any).publicToken, total };
}

/** สินค้า "ค่าบริการ" ต่อหัวข้อ — สร้างครั้งเดียวต่อ (businessId+ราคา) ป้องกันขยะ */
async function ensureServiceProduct(businessId: string, title: string, amount: number): Promise<{ id: string }> {
  const sku = `SVC-${Math.round(amount)}`;
  const existing = await prisma.businessProduct.findFirst({ where: { businessId, sku }, select: { id: true } });
  if (existing) return existing;
  return prisma.businessProduct.create({
    data: { businessId, sku, name: `ค่าบริการ Sovereign (${Math.round(amount)}฿)`, category: 'SERVICE', specs: 'ค่าติดตั้ง/ซ่อม/บริการ IoT ตามใบแจ้ง', costPrice: 0, salePrice: Math.round(amount), stockQty: 9999, warrantyMonths: 0 },
    select: { id: true },
  });
}

/** บิลทั้งหมดของคู่ค้า (แผง admin + หน้าคู่ค้า) — ใหม่สุดก่อน */
export async function partnerBills(partnerId: string, take = 50): Promise<Array<{ orderNo: string; title: string; total: number; status: string; publicToken: string | null; createdAt: Date; install?: { title: string; status: string } | null }>> {
  const orders = await prisma.businessOrder.findMany({
    where: { partnerId },
    orderBy: { createdAt: 'desc' },
    take,
    include: { installations: { select: { title: true, status: true }, take: 1 } },
  });
  return orders.map((o: any) => ({
    orderNo: o.orderNo,
    title: (o.note ?? '').replace(/^บิลค่าบริการ IoT คู่ค้า — /, '').slice(0, 120),
    total: o.total,
    status: o.status,
    publicToken: o.publicToken ?? null,
    createdAt: o.createdAt,
    install: o.installations?.[0] ? { title: o.installations[0].title, status: o.installations[0].status } : null,
  }));
}


/** แจ้งคู่ค้าว่ามีบิลใหม่ (ผ่าน service ของ partner — กัน boundary) */
async function notifyPartnerBill(partner: { id: string; name: string; category: string; contactName: string; contactPhone: string }, title: string): Promise<void> {
  try {
    const { notifyPartnerNewBill } = await import('./partner.service');
    await notifyPartnerNewBill(partner, title);
  } catch { /* เงียบ — ไม่กระทบบิล */ }
}

/** P17 — ภาพรวมลิงก์ส่วนตัวของคู่ค้า: บิลทั้งหมด + สถานะชำระ + งานติดตั้ง/ซ่อม — ยืนยันด้วย token ลิงก์ลับ */
export async function partnerPortal(partnerId: string, token: string): Promise<any | null> {
  if (!UUID_RE.test(String(token))) return null; // token ผิดรูปแบบ = not found ปลอดภัย (กัน prisma uuid cast error รั่ว 500)
  const owner = await prisma.businessOrder.findFirst({ where: { publicToken: token, partnerId }, select: { id: true } });
  if (!owner) return null; // token ไม่ตรง
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { name: true, category: true, status: true, created_at: true },
  });
  if (!partner) return null;
  const orders = await prisma.businessOrder.findMany({
    where: { partnerId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      payments: { select: { amount: true, method: true, paidAt: true } },
      installations: { select: { title: true, status: true, scheduledAt: true, note: true } },
      lines: { select: { description: true, qty: true, unitPrice: true } },
    },
  });
  const bills = orders.map((o: any) => {
    const paid = o.payments.reduce((s: number, p: any) => s + p.amount, 0);
    return {
      orderNo: o.orderNo,
      title: (o.note ?? '').replace(/^บิลค่าบริการ IoT คู่ค้า — /, '').split(' · ')[0].slice(0, 120),
      subtotal: o.subtotal,
      vat: o.vat,
      total: o.total,
      paid,
      remaining: Math.max(0, o.total - paid),
      status: o.status,
      publicToken: o.publicToken ?? null, // ลิงก์ชำระต่อบิล (เข้า /shop?order= เดิม)
      createdAt: o.createdAt,
      installs: (o.installations ?? []).map((i: any) => ({ title: i.title, status: i.status, scheduledAt: i.scheduledAt, note: i.note })),
    };
  });
  const installs = bills.flatMap((b) => b.installs.map((i: any) => ({ ...i, orderNo: b.orderNo })));
  return {
    partner: { name: partner.name, category: partner.category, status: partner.status, since: partner.created_at },
    summary: {
      billCount: bills.length,
      totalBilled: bills.reduce((s, b) => s + b.total, 0),
      totalPaid: bills.reduce((s, b) => s + b.paid, 0),
      remaining: bills.reduce((s, b) => s + b.remaining, 0),
      installCount: installs.length,
      installDone: installs.filter((i) => i.status === 'DONE').length,
    },
    bills,
  };
}
