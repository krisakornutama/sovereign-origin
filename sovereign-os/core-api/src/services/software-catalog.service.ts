// src/services/software-catalog.service.ts
//
// SOFTWARE CATALOG (P8) — ขายซอฟต์แวร์แยกเป็นชิ้น
// หลักการ:
//  - "ข้อมูลฟังก์ชันจริง" = สแกนโค้ดจริงใน src/modules (endpoints/LOC/routes files) — ไม่ใช่ตัวเลขมั่ว
//    สแกนสดทุกครั้งที่เรียก (โฟลเดอร์เล็ก 61 โมดูล — เร็วพอ) → ตัวเลขขึ้นกับโค้ดจริงเสมอ
//  - ราคาที่ขายจริงเก็บใน DB (business_products ของ business "Sovereign Devices" — sku ขึ้นต้น SW-)
//  - publish = สร้าง/อัปเดต business_product + ผูก inventory item "ซอฟต์แวร์ Sovereign (license)"
//    → โผล่หน้าร้านสาธารณะทันที (การ์ดสายสดใช้ล็อต release ที่ seed ไว้)
//  - unpublish = isActive=false (หายจากหน้าร้าน — ข้อมูล/ราคาคงอยู่)
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../lib/prisma';

const MODULES_DIR = join(process.cwd(), 'src', 'modules');
const SKU_PREFIX = 'SW-';
const DEVICES_BIZ_NAME = 'Sovereign Devices';
const SOFTWARE_ITEM_NAME = 'ซอฟต์แวร์ Sovereign (license)';

export interface ModuleFacts {
  key: string;
  endpoints: number;
  loc: number;
  routeFiles: number;
  serviceFiles: number;
  testRefs: number;
  suggestedPrice: number;
}

/** สแกนโมดูลเดียว — ข้อมูลฟังก์ชันจริงจากโค้ด */
function scanModule(key: string): ModuleFacts {
  const dir = join(MODULES_DIR, key);
  let endpoints = 0;
  let loc = 0;
  let routeFiles = 0;
  let serviceFiles = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const p = join(dir, f);
    if (!statSync(p).isFile()) continue;
    const content = readFileSync(p, 'utf8');
    loc += content.split('\n').length;
    if (f.includes('.routes.')) {
      routeFiles += 1;
      endpoints += (content.match(/router\.(get|post|patch|put|delete)\(/g) ?? []).length;
    }
    if (f.includes('.service.')) serviceFiles += 1;
  }
  // จำนวนไฟล์เทสต์ที่อ้างโมดูลนี้ (พิสูจน์คุณภาพ — ทดสอบแล้วกี่ชุด)
  let testRefs = 0;
  try {
    const testsDir = join(process.cwd(), 'tests');
    for (const f of readdirSync(testsDir)) {
      if (!f.endsWith('.test.ts')) continue;
      const content = readFileSync(join(testsDir, f), 'utf8');
      if (content.includes(`modules/${key}/`) || content.includes(`services/${key}`)) testRefs += 1;
    }
  } catch { /* tests dir หาย = 0 */ }
  return { key, endpoints, loc, routeFiles, serviceFiles, testRefs, suggestedPrice: suggestPrice(endpoints, loc, testRefs) };
}

/** ราคาแนะนำจากข้อมูลจริง: ฐานตาม endpoints + น้ำหนัก LOC + โบนัสคุณภาพ (มีเทสต์)
 *  สูตรโปร่งใส ปรับได้: base 190 + endpoints×95 + loc×0.28 + testRefs×60 → ปัดเป็น 10฿ ปิดท้าย 9 */
export function suggestPrice(endpoints: number, loc: number, testRefs: number): number {
  const raw = 190 + endpoints * 95 + loc * 0.28 + testRefs * 60;
  const rounded = Math.round(raw / 10) * 10 - 1;
  return Math.max(290, rounded);
}

/** ข้อมูลจริงทุกโมดูล เรียงตามราคาแนะนำมาก→น้อย */
export function scanAllModules(): ModuleFacts[] {
  const keys = readdirSync(MODULES_DIR).filter((k) => {
    try { return statSync(join(MODULES_DIR, k)).isDirectory(); } catch { return false; }
  });
  return keys.map(scanModule).sort((a, b) => b.suggestedPrice - a.suggestedPrice);
}

export interface SoftwareListingRow {
  sku: string;
  moduleKey: string;
  productId: string | null;
  name: string;
  category: string;
  specs: string;
  costPrice: number;
  salePrice: number;
  suggestedPrice: number;
  isActive: boolean;
  published: boolean;
  facts: ModuleFacts;
}

/** รวมข้อมูลจริง + ของที่ publish แล้ว (จาก business_products) ต่อโมดูล */
export async function softwareCatalog(): Promise<{ rows: SoftwareListingRow[]; businessId: string | null; scannedAt: string }> {
  const biz = await prisma.business.findFirst({ where: { name: DEVICES_BIZ_NAME } });
  const items = biz
    ? await prisma.businessProduct.findMany({ where: { businessId: biz.id, sku: { startsWith: SKU_PREFIX } } })
    : [];
  const bySku = new Map(items.map((p) => [p.sku, p]));
  const rows = scanAllModules().map((facts) => {
    const sku = `${SKU_PREFIX}${facts.key.toUpperCase()}`;
    const p: any = bySku.get(sku);
    return {
      sku,
      moduleKey: facts.key,
      productId: p?.id ?? null,
      name: p?.name ?? `โมดูล ${facts.key}`,
      category: p?.category ?? 'ซอฟต์แวร์',
      specs: p?.specs ?? '',
      costPrice: p?.costPrice ?? 0,
      salePrice: p?.salePrice ?? facts.suggestedPrice,
      suggestedPrice: facts.suggestedPrice,
      isActive: p ? Boolean(p.isActive) : false,
      published: Boolean(p?.isActive),
      facts,
    };
  });
  return { rows, businessId: biz?.id ?? null, scannedAt: new Date().toISOString() };
}

/** publish โมดูลเป็นสินค้า — idempotent (มีแล้ว = อัปเดตราคา/สถานะ) */
export async function publishModule(
  moduleKey: string,
  input: { name?: string; specs?: string; salePrice?: number; costPrice?: number; ownerId: string }
): Promise<SoftwareListingRow> {
  const all = scanAllModules();
  const facts = all.find((f) => f.key === moduleKey);
  if (!facts) throw new Error(`module "${moduleKey}" not found`);
  const sku = `${SKU_PREFIX}${facts.key.toUpperCase()}`;

  // inventory item กลางของซอฟต์แวร์ (สร้างครั้งเดียว) — จำนวนไม่จำกัด (เก็บเป็น 9999)
  let item = await prisma.inventoryItem.findFirst({ where: { name: SOFTWARE_ITEM_NAME } });
  if (!item) {
    item = await prisma.inventoryItem.create({
      data: { user_id: input.ownerId, name: SOFTWARE_ITEM_NAME, category: 'OTHER', quantity: 9999, unit: 'license', unit_price_usd: 0, location: 'ดิจิทัล — ส่งมอบทางอีเมล/QR' },
    });
  }

  const biz = await prisma.business.findFirst({ where: { name: DEVICES_BIZ_NAME } });
  if (!biz) throw new Error(`business "${DEVICES_BIZ_NAME}" not found — รัน seed-devices-shop.ts ก่อน`);

  const existing = await prisma.businessProduct.findFirst({ where: { businessId: biz.id, sku } });
  const data = {
    businessId: biz.id,
    inventoryItemId: item.id,
    sku,
    name: String(input.name ?? `โมดูล ${facts.key}`).slice(0, 120),
    category: 'ซอฟต์แวร์',
    specs: String(input.specs ?? `${facts.endpoints} endpoints · ${facts.loc.toLocaleString('th-TH')} บรรทัด · ${facts.testRefs} ชุดทดสอบ`).slice(0, 300),
    costPrice: Number(input.costPrice ?? 0),
    salePrice: Number(input.salePrice ?? facts.suggestedPrice),
    stockQty: 9999,
    reorderPoint: 0,
    warrantyMonths: 12,
    isActive: true,
  };
  const product = existing
    ? await prisma.businessProduct.update({ where: { id: existing.id }, data })
    : await prisma.businessProduct.create({ data });
  // คืนแถวจากข้อมูลที่เขียนจริง (ไม่ re-scan — กัน race และตัวเลขไม่ตรงชั่วขณะ)
  return {
    sku,
    moduleKey: facts.key,
    productId: product.id,
    name: data.name,
    category: data.category,
    specs: data.specs,
    costPrice: data.costPrice,
    salePrice: data.salePrice,
    suggestedPrice: facts.suggestedPrice,
    isActive: true,
    published: true,
    facts,
  };
}

/** ปิดขายโมดูล (isActive=false — หายจากหน้าร้าน ข้อมูลคงอยู่) */
export async function unpublishModule(moduleKey: string): Promise<void> {
  const sku = `${SKU_PREFIX}${moduleKey.toUpperCase()}`;
  const biz = await prisma.business.findFirst({ where: { name: DEVICES_BIZ_NAME } });
  if (!biz) throw new Error(`business "${DEVICES_BIZ_NAME}" not found`);
  await prisma.businessProduct.updateMany({ where: { businessId: biz.id, sku }, data: { isActive: false } });
}
