// ─────────────────────────────────────────────────────────────
// Inventory service — ตรรกะหมดอายุ / เตือนของเหลือน้อย (pure functions)
// แยกจาก route เพื่อให้ test ได้ง่ายโดยไม่ต้องต่อฐานข้อมูล
// ─────────────────────────────────────────────────────────────

export const INVENTORY_CATEGORIES = [
  'WATER',
  'FOOD',
  'FUEL',
  'MATERIAL',
  'PRECIOUS_METAL',
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
