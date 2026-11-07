// ─────────────────────────────────────────────────────────────
// Inventory service — ตรรกะหมดอายุ / เตือนของเหลือน้อย (pure functions)
// แยกจาก route เพื่อให้ test ได้ง่ายโดยไม่ต้องต่อฐานข้อมูล
// ─────────────────────────────────────────────────────────────

export const INVENTORY_CATEGORIES = [
  'WATER',
  'FOOD',
  'SEED',
  'FUEL',
  'MEDICINE',
  'TOOL',
  'MATERIAL',
  'PRECIOUS_METAL',
  'COMPOST',
  'FERTILIZER',
  'OTHER',
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export type ExpiryStatus = 'ok' | 'expiring' | 'expired' | 'na';

export interface ExpiryInfo {
  // วันก่อนหมดอายุ (ติดลบ = หมดอายุแล้ว, null = ไม่มีวันหมดอายุ)
  daysLeft: number | null;
  status: ExpiryStatus;
}

/** จำนวนวันก่อนหมดอายุ (ปัดขึ้นเป็นจำนวนเต็มวัน) */
export function daysUntil(date: Date, now: Date = new Date()): number {
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / 86_400_000);
}

/**
 * สถานะวันหมดอายุ:
 * - expired   หมดอายุแล้ว (daysLeft < 0)
 * - expiring  เหลือไม่เกิน EXPIRING_SOON_DAYS วัน
 * - ok        ยังเหลืออีกนาน
 * - na        ไม่ตั้งวันหมดอายุ
 */
export function computeExpiryStatus(
  expiryDate: Date | string | null | undefined,
  now: Date = new Date(),
  expiringSoonDays: number = EXPIRING_SOON_DAYS
): ExpiryInfo {
  if (expiryDate == null) return { daysLeft: null, status: 'na' };
  const date = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(date.getTime())) return { daysLeft: null, status: 'na' };
  const left = daysUntil(date, now);
  if (left < 0) return { daysLeft: left, status: 'expired' };
  if (left <= expiringSoonDays) return { daysLeft: left, status: 'expiring' };
  return { daysLeft: left, status: 'ok' };
}

/** จำนวนวันก่อนหมดอายุเริ่มเตือน (ตั้งได้ผ่าน env, ค่าเริ่ม 30 วัน) */
export const EXPIRING_SOON_DAYS = parseInt(process.env.INVENTORY_EXPIRING_SOON_DAYS || '30', 10);

export interface StockStatus {
  low: boolean;
  // null = ไม่ตั้งระดับขั้นต่ำไว้
  minimumStock: number | null;
}

/** ของเหลือน้อย = มีค่า minimum_stock และ quantity ต่ำกว่านั้น */
export function computeStockStatus(
  quantity: number,
  minimumStock: number | null | undefined
): StockStatus {
  if (minimumStock == null || minimumStock <= 0) return { low: false, minimumStock: null };
  return { low: quantity < minimumStock, minimumStock };
}

/** คำนวณวันหมดอายุอัตโนมัติจาก shelf_life_days (นับจากวันนี้ + อายุการเก็บ) */
export function computeExpiryDate(
  shelfLifeDays: number | null | undefined,
  now: Date = new Date()
): Date | null {
  if (shelfLifeDays == null || !Number.isFinite(Number(shelfLifeDays)) || Number(shelfLifeDays) <= 0) {
    return null;
  }
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + Math.floor(Number(shelfLifeDays)));
  return date;
}

/** ตรวจสอบ category ที่ถูกต้อง (คืน null ถ้าไม่รู้จัก — ให้ route ตัดสินใจ) */
export function isCategoryValid(category: string): boolean {
  return (INVENTORY_CATEGORIES as readonly string[]).includes(category);
}

// ─────────────────────────────────────────────────────────────
// Stock adjustment (Prisma) — หัก/เติมยอดคงเหลืออัตโนมัติ
// ใช้จาก livestock (เบิกอาหาร/ฉีดวัคซีน/บันทึกยา) เพื่อให้คลังตรงกับของจริง
// ─────────────────────────────────────────────────────────────

export interface StockAdjustResult {
  ok: boolean;
  name?: string;
  remaining: number;
  shortfall: number; // จำนวนที่หักไม่ได้ (เกินยอดคงเหลือ)
  reason?: string;
}

/** หักยอดคงเหลือ — หักเกิน = หักได้เท่าที่เหลือ + รายงาน shortfall (ไม่มีติดลบ) */
export async function deductStock(
  prisma: { inventoryItem: { findUnique: (a: any) => Promise<any>; update: (a: any) => Promise<any> } },
  itemId: string,
  qty: number
): Promise<StockAdjustResult> {
  const amount = Math.max(0, Number(qty) || 0);
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) return { ok: false, remaining: 0, shortfall: amount, reason: 'inventory item not found' };
  const remaining = Math.max(0, Number(item.quantity) - amount);
  const shortfall = Math.max(0, amount - Number(item.quantity));
  if (amount === 0) return { ok: true, name: item.name, remaining: Number(item.quantity), shortfall: 0 };
  await prisma.inventoryItem.update({ where: { id: itemId }, data: { quantity: remaining } });
  return { ok: shortfall === 0, name: item.name, remaining, shortfall, reason: shortfall > 0 ? `หักได้ ${remaining}/${Number(item.quantity)} — ขาด ${shortfall}` : undefined };
}

// ─────────────────────────────────────────────────────────────
// Atomic stock delta — ใช้กับ offline replay (conflict resolver)
//
// ต่างจาก deductStock ด้านบน: การหักต้องเป็น atomic guard ที่ DB
// (UPDATE ... WHERE quantity >= amount) ไม่ใช่ read-then-write
// เพื่อกัน 2 เครื่องตัดสต็อกพร้อมกันแล้วยอดติดลบ/หาย
// ─────────────────────────────────────────────────────────────

export interface StockDeltaResult {
  applied: boolean;
  /** ยอดคงเหลือหลังทำรายการ (หรือยอดปัจจุบันถ้าไม่ผ่าน guard) */
  quantity: number;
  reason?: string;
}

export async function applyStockDelta(
  prisma: {
    inventoryItem: {
      findFirst: (args: any) => Promise<any>;
      updateMany: (args: any) => Promise<{ count: number }>;
    };
  },
  input: { userId: string; itemId: string; delta: number }
): Promise<StockDeltaResult> {
  const amount = Number(input.delta);
  if (!Number.isFinite(amount) || amount === 0) {
    return { applied: false, quantity: 0, reason: 'INVALID_DELTA' };
  }

  const ownerWhere = { id: input.itemId, user_id: input.userId };
  const existing = await prisma.inventoryItem.findFirst({
    where: ownerWhere,
    select: { quantity: true },
  });
  if (!existing) return { applied: false, quantity: 0, reason: 'RESOURCE_NOT_FOUND' };

  if (amount < 0) {
    const deduct = Math.abs(amount);
    const guarded = await prisma.inventoryItem.updateMany({
      where: { ...ownerWhere, quantity: { gte: deduct } },
      data: { quantity: { decrement: deduct } },
    });
    const current = await prisma.inventoryItem.findFirst({
      where: ownerWhere,
      select: { quantity: true },
    });
    const quantity = Number(current?.quantity ?? existing.quantity);
    return guarded.count > 0 ? { applied: true, quantity } : { applied: false, quantity };
  }

  await prisma.inventoryItem.updateMany({
    where: ownerWhere,
    data: { quantity: { increment: amount } },
  });
  const current = await prisma.inventoryItem.findFirst({
    where: ownerWhere,
    select: { quantity: true },
  });
  return {
    applied: true,
    quantity: Number(current?.quantity ?? Number(existing.quantity) + amount),
  };
}

/** เติมยอดคงเหลือ (กลับเข้าคลัง — เช่น เติมถังอาหาร) */
export async function addStock(
  prisma: { inventoryItem: { findUnique: (a: any) => Promise<any>; update: (a: any) => Promise<any> } },
  itemId: string,
  qty: number
): Promise<StockAdjustResult> {
  const amount = Math.max(0, Number(qty) || 0);
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) return { ok: false, remaining: 0, shortfall: 0, reason: 'inventory item not found' };
  if (amount === 0) return { ok: true, name: item.name, remaining: Number(item.quantity), shortfall: 0 };
  const remaining = Number(item.quantity) + amount;
  await prisma.inventoryItem.update({ where: { id: itemId }, data: { quantity: remaining } });
  return { ok: true, name: item.name, remaining, shortfall: 0 };
}
