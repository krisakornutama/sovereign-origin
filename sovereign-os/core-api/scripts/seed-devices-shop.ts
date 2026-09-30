// ────────────────────────────────────────────────────────────────────────────
// seed-devices-shop.ts — เปิดร้าน "Sovereign Devices" (อุปกรณ์ IoT/DMS) บนหน้าร้านสาธารณะ
//
// สร้าง (idempotent — รันซ้ำได้ ไม่กลืนของเดิม):
//   1) business "Sovereign Devices" (shopOpen + shopInCommunity) — เจ้าของ = seed-trace (บัญชี seed เดิม)
//   2) สินค้า 3 SKU ตาม BOM จริงของ SERIES_RED_DMS_BLUEPRINT.md:
//        DMS-KIT-ESP32   ชุดประกอบ ESP32-S3 + SIM7600G (1,290฿)
//        DMS-READY-PI    ชุด Pi Zero 2 W พร้อมใช้ (2,490฿)
//        DMS-SETUP-PRO   ชุด + ตั้งค่าเชื่อม Sovereign OS ให้ (2,990฿)
//   3) วัตถุดิบในคลัง "ชุดอุปกรณ์ DMS (ประกอบแล้ว)" + ProductLot ล็อตการผลิต
//      เหตุการณ์: ASSEMBLED → FLASHED firmware v0.4.0 → TESTED (drill ผ่าน) → PACKAGED
//      → การ์ด "สายสดจากแปลง" บนหน้าร้านกลายเป็นบัตรประวัติการผลิตของเครื่องที่ลูกค้าได้
//   4) ปิดร้านผักเดิมจากสาธารณะ (shopOpen=false, shopInCommunity=false) — ข้อมูล/ล็อตครบเหมือนเดิม
//      เปิดคืนได้ทีเดียว: UPDATE business SET "shopOpen"=true, "shopInCommunity"=true WHERE name='ร้านเกษตรผักสดชุมชน';
//
// ใช้:  export DATABASE_URL=postgresql://...  (DB จริงของ prod — คอนเทนเนอร์ใช้ db "sovereign")
//      npx tsx scripts/seed-devices-shop.ts
// ────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BIZ_NAME = 'Sovereign Devices';
const SHOP_NAME = 'ร้านอุปกรณ์ Sovereign (DMS)';
const OWNER_USER = 'seed-trace'; // บัญชีเจ้าของจาก seed ชุดแรก (ไม่สร้างใหม่)
const ITEM_NAME = 'ชุดอุปกรณ์ DMS (ประกอบ+ทดสอบแล้ว)';
const VEG_BIZ_NAME = 'ร้านเกษตรผักสดชุมชน';

const SKUS: Array<{
  sku: string; name: string; category: string; specs: string;
  costPrice: number; salePrice: number; stockQty: number; warrantyMonths: number;
}> = [
  {
    sku: 'DMS-KIT-ESP32',
    name: 'ชุดประกอบ DMS — ESP32-S3 + SIM7600G 4G HAT',
    category: 'ชุดประกอบ',
    specs: 'บอร์ด+โมด็อม 4G+เสา+สาย — แฟลชเฟิร์มแวร์โอเพนซอร์สเองได้ · คู่มือไทยใน GitHub',
    costPrice: 780, salePrice: 1290, stockQty: 10, warrantyMonths: 6,
  },
  {
    sku: 'DMS-READY-PI',
    name: 'ชุด DMS พร้อมใช้ — Raspberry Pi Zero 2 W + โมเด็ม 4G',
    category: 'พร้อมใช้',
    specs: 'ตั้งค่ามาแล้ว ทำงานทันทีที่ใส่ซิม · เฟิร์มแวร์ v0.4.0 · กล่อง+อะแดปเตอร์ครบ',
    costPrice: 1650, salePrice: 2490, stockQty: 5, warrantyMonths: 6,
  },
  {
    sku: 'DMS-SETUP-PRO',
    name: 'ชุด DMS + ตั้งค่าเชื่อม Sovereign OS ให้ (Remote Setup)',
    category: 'พร้อมใช้ + บริการ',
    specs: 'ทุกอย่างในชุดพร้อมใช้ + ทีมงานจับคู่กับระบบของคุณ ซ้อม drill ผ่านหน้างานระยะไกล',
    costPrice: 1950, salePrice: 2990, stockQty: 3, warrantyMonths: 12,
  },
];

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

async function ensureItem(ownerId: string) {
  const found = await prisma.inventoryItem.findFirst({ where: { name: ITEM_NAME } });
  if (found) return found;
  const created = await prisma.inventoryItem.create({
    data: {
      user_id: ownerId,
      name: ITEM_NAME,
      category: 'OTHER',
      quantity: SKUS.reduce((s, k) => s + k.stockQty, 0),
      unit: 'ชุด',
      unit_price_usd: 0,
      location: 'โต๊ะประกอบ — ทดสอบแล้วทั้งชุด',
    },
  });
  console.log(`  + inventory item "${ITEM_NAME}" (${created.quantity} ชุด)`);
  return created;
}

async function ensureDeviceBusiness(ownerId: string, itemId: string) {
  let biz = await prisma.business.findFirst({ where: { name: BIZ_NAME } });
  if (!biz) {
    biz = await prisma.business.create({
      data: {
        name: BIZ_NAME,
        shopName: SHOP_NAME,
        shopOpen: true,
        shopInCommunity: true,
        vatRate: 0, // ราคาสินค้าอิเล็กทรอนิกส์รวม VAT แล้ว — หน้าร้านจะไม่บวกซ้ำ
        isActive: true,
        ownerId,
      },
    });
    console.log(`  + business "${BIZ_NAME}" (shopOpen + community)`);
  }
  for (const k of SKUS) {
    const found = await prisma.businessProduct.findFirst({ where: { businessId: biz.id, sku: k.sku } });
    if (found) {
      console.log(`  = ${k.sku} มีอยู่แล้ว — ข้าม`);
      continue;
    }
    await prisma.businessProduct.create({
      data: { businessId: biz.id, inventoryItemId: itemId, isActive: true, ...k },
    });
    console.log(`  + product ${k.sku} "${k.name}" (${k.salePrice} ฿)`);
  }
  return biz;
}

async function ensureProductionLot(itemId: string) {
  const lotCode = 'LOT-DMS01A';
  const found = await prisma.productLot.findUnique({ where: { lotCode } });
  if (found) {
    console.log(`  = lot ${lotCode} มีอยู่แล้ว — ข้าม`);
    return found;
  }
  const lot = await prisma.productLot.create({
    data: {
      lotCode,
      inventoryItemId: itemId,
      plotId: null, // ไม่ใช่ผลผลิตเกษตร — ไม่ผูกแปลง
      crop: 'ชุดอุปกรณ์ DMS รุ่นแรก',
      quantityKg: SKUS.reduce((s, k) => s + k.stockQty, 0), // หน่วยจริง = ชุด (schema ใช้ kg — เก็บเป็นจำนวนชุด)
      harvestedAt: hoursAgo(30),
    },
  });
  const events = [
    { type: 'PROCESSED', detail: 'ประกอบบอร์ด + โมด็อม 4G ครบชุด (5 ชุด)', hoursAgo: 30 },
    { type: 'TESTED', detail: 'แฟลชเฟิร์มแวร์ v0.4.0 (sovereign-dms GitHub) — บูตผ่าน ส่ง heartbeat ปกติ', hoursAgo: 28 },
    { type: 'TESTED', detail: 'Drill ตัดฮาร์ตบีตจำลอง: แจ้งระดับ 1 ที่ T+90s ระดับ 2 ที่ T+180s — ผ่านทั้ง 5 ชุด', hoursAgo: 26 },
    { type: 'NOTE', detail: 'แพ็กกล่อง + ใส่ QR ตามรอย (ลิงก์หน้านี้) พร้อมส่งมอบ', hoursAgo: 24 },
  ];
  for (const ev of events) {
    await prisma.traceEvent.create({
      data: { lotId: lot.id, type: ev.type, detail: ev.detail, createdAt: hoursAgo(ev.hoursAgo) },
    });
  }
  console.log(`  + lot ${lotCode} (${events.length} เหตุการณ์ — ประกอบ→แฟลช→ทดสอบ→แพ็ก)`);
  return lot;
}

async function main() {
  console.log('── [1/4] บัญชีเจ้าของร้าน (บัญชี seed เดิม — ต้องรัน seed-trace-community.ts ก่อนหน้านี้) ──');
  const owner = await prisma.user.findUnique({ where: { username: OWNER_USER } });
  if (!owner) throw new Error(`ไม่พบ user "${OWNER_USER}" — รัน scripts/seed-trace-community.ts ก่อน`);

  console.log('── [2/4] วัตถุดิบชุดอุปกรณ์ในคลัง ──');
  const item = await ensureItem(owner.id);

  console.log('── [3/4] ร้าน Sovereign Devices + สินค้า 3 SKU ──');
  await ensureDeviceBusiness(owner.id, item.id);

  console.log('── [4/4] ล็อตการผลิต (เหตุการณ์ประกอบ/แฟลช/ทดสอบ/แพ็ก) ──');
  await ensureProductionLot(item.id);

  console.log('── ปิดร้านผักเดิมจากสาธารณะ (ข้อมูลครบเหมือนเดิม — เปิดคืนได้ทีเดียว) ──');
  const veg = await prisma.business.findFirst({ where: { name: VEG_BIZ_NAME } });
  if (veg && (veg.shopOpen || veg.shopInCommunity)) {
    await prisma.business.update({
      where: { id: veg.id },
      data: { shopOpen: false, shopInCommunity: false },
    });
    console.log(`  ✓ "${VEG_BIZ_NAME}": shopOpen=false, shopInCommunity=false (ปิดสาธารณะ — demo ภายในยังใช้ได้)`);
  } else {
    console.log('  = ร้านผักปิดอยู่แล้ว — ข้าม');
  }

  const biz = await prisma.business.findFirst({ where: { name: BIZ_NAME } });
  console.log(`\n✅ seed เสร็จ — devices business=${biz?.id}`);
  console.log('   /shop ไม่ใส่ ?id จะ redirect มาร้านนี้ · /community เห็น "ร้านอุปกรณ์ Sovereign (DMS)"');
  console.log('   /trace ค้น LOT-DMS01A = บัตรประวัติการผลิตของชุดอุปกรณ์');
}

main()
  .catch((e) => {
    console.error('❌ seed ล้ม:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
