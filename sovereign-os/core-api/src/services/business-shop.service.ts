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

/** รูปร่างสินค้าที่คืนให้สาธารณะ — ตัดทุน/จุดสั่งเติม/inventoryItemId ทิ้งหมด */
function publicProduct(p: any): any {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    specs: p.specs ?? null,
    salePrice: p.salePrice,
    warrantyMonths: p.warrantyMonths,
    inStock: p.stockQty > 0,
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
