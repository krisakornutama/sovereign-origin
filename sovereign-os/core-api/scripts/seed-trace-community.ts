// ────────────────────────────────────────────────────────────────────────────
// seed-trace-community.ts — Seed ข้อมูลจริงให้หน้า /trace และ /community มีของโชว์ตั้งแต่เปิดครั้งแรก
//
// สร้าง (idempotent — เช็คก่อนสร้างทุกชิ้น รันซ้ำได้ ไม่กลืนข้อมูลเดิม):
//   1) บัญชี e2e-bot (SUPERADMIN — รหัสผ่านตาม runbook §๖ ที่จดไว้ใน infra/.credentials)
//      → เกต verify:full (Playwright auth.setup) ต้องล็อกอินด้วยบัญชีนี้
//   2) บัญชี seed-trace (เจ้าของคลัง/ธุรกิจใน seed ชุดนี้)
//   3) แปลงเกษตร + วัตถุดิบในคลัง (ปลายทางของการเก็บเกี่ยว)
//   4) ธุรกิจ opt-in เข้า catalog กลางชุมชน (shopOpen + shopInCommunity) + สินค้า 2 รายการ
//   5) ล็อตผลผลิต 2 ล็อต พร้อมเหตุการณ์ตามรอย (HARVESTED → PROCESSED → TESTED / HARVESTED → SOLD)
//
// ใช้:  export DATABASE_URL=postgresql://...  (DB จริงของ prod — คอนเทนเนอร์ใช้ db "sovereign")
//      npx tsx scripts/seed-trace-community.ts
// ────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PLOT_NAME = 'แปลงมะเขือเทศโซน A';
const ITEM_NAME = 'มะเขือเทศสด (แปลงโซน A)';
const BIZ_NAME = 'ร้านเกษตรผักสดชุมชน';
const SHOP_NAME = 'ร้านผักสดตามรอย';
const SEED_USER = 'seed-trace';
const SEED_PASS = 'Seed-Local-2026!';
// e2e-bot — รหัสผ่านเดียวกับที่จดไว้ใน sovereign-os/infra/.credentials (runbook: "รหัสผ่านอยู่ใน repo")
const E2E_USER = 'e2e-bot';
const E2E_PASS = 'E2E-Sovereign-Run-2026!';

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

async function ensureUser(username: string, password: string, role: 'SUPERADMIN' | 'OPERATOR') {
  const found = await prisma.user.findUnique({ where: { username } });
  if (found) return found;
  const created = await prisma.user.create({
    data: { username, password_hash: await bcrypt.hash(password, 10), role },
  });
  console.log(`  + user ${username} (${role})`);
  return created;
}

async function ensurePlot() {
  const found = await prisma.farmPlot.findFirst({ where: { name: PLOT_NAME } });
  if (found) return found;
  const created = await prisma.farmPlot.create({
    data: {
      name: PLOT_NAME,
      location: 'โซน A — ฟาร์มหลังบ้าน',
      crop: 'มะเขือเทศ',
      area_sqm: 120,
      status: 'active',
      soil_notes: 'ดินร่วน pH 6.5 — วัดครั้งล่าสุด 18 ก.ย. 2569',
    },
  });
  console.log(`  + farm plot "${PLOT_NAME}"`);
  return created;
}

async function ensureInventoryItem(userId: string) {
  const found = await prisma.inventoryItem.findFirst({ where: { user_id: userId, name: ITEM_NAME } });
  if (found) return found;
  const created = await prisma.inventoryItem.create({
    data: {
      user_id: userId,
      name: ITEM_NAME,
      category: 'PRODUCE',
      quantity: 50.5,
      unit: 'kg',
      unit_price_usd: 0,
      location: 'คลังแปรรูป — ชั้นแช่เย็น',
    },
  });
  console.log(`  + inventory item "${ITEM_NAME}"`);
  return created;
}

async function ensureBusiness(ownerId: string) {
  const found = await prisma.business.findFirst({ where: { name: BIZ_NAME } });
  if (found) return found;
  const created = await prisma.business.create({
    data: {
      name: BIZ_NAME,
      shopName: SHOP_NAME,
      shopOpen: true, // เปิดหน้าร้านสาธารณะ /shop?id=<id>
      shopInCommunity: true, // opt-in เข้า catalog กลางชุมชน /community
      vatRate: 0.07,
      isActive: true,
      ownerId,
    },
  });
  console.log(`  + business "${BIZ_NAME}" (opt-in community)`);
  return created;
}

async function ensureProduct(businessId: string, inventoryItemId: string, p: {
  sku: string; name: string; category: string; specs: string;
  costPrice: number; salePrice: number; stockQty: number; reorderPoint: number;
}) {
  const found = await prisma.businessProduct.findFirst({ where: { businessId, name: p.name } });
  if (found) return found;
  const created = await prisma.businessProduct.create({
    data: { businessId, inventoryItemId, isActive: true, warrantyMonths: 0, ...p },
  });
  console.log(`  + product "${p.name}" (${p.salePrice} ฿)`);
  return created;
}

async function ensureLot(input: {
  lotCode: string;
  inventoryItemId: string;
  plotId: string;
  crop: string;
  quantityKg: number;
  harvestedHoursAgo: number;
  soldHoursAgo?: number; // ถ้าระบุ = ผูกลูกค้า + ตั้งเวลาขาย (ทำให้หน้า trace โชว์ป้าย "ขายแล้ว")
  soldCustomerId?: string | null;
  events: Array<{ type: string; detail: string; hoursAgo: number }>;
}) {
  const found = await prisma.productLot.findUnique({ where: { lotCode: input.lotCode } });
  if (found) {
    console.log(`  = lot ${input.lotCode} มีอยู่แล้ว — ข้าม`);
    return found;
  }
  const lot = await prisma.productLot.create({
    data: {
      lotCode: input.lotCode,
      inventoryItemId: input.inventoryItemId,
      plotId: input.plotId,
      crop: input.crop,
      quantityKg: input.quantityKg,
      harvestedAt: hoursAgo(input.harvestedHoursAgo),
      ...(input.soldHoursAgo != null && input.soldCustomerId
        ? { soldCustomerId: input.soldCustomerId, soldAt: hoursAgo(input.soldHoursAgo) }
        : {}),
    },
  });
  for (const ev of input.events) {
    await prisma.traceEvent.create({
      data: { lotId: lot.id, type: ev.type, detail: ev.detail, createdAt: hoursAgo(ev.hoursAgo) },
    });
  }
  console.log(`  + lot ${input.lotCode} (${input.events.length} เหตุการณ์)`);
  return lot;
}

async function ensureCustomer(businessId: string) {
  const found = await prisma.businessCustomer.findFirst({ where: { businessId, phone: '0800000001' } });
  if (found) return found;
  const created = await prisma.businessCustomer.create({
    data: { businessId, name: 'ลูกค้าชุมชน (เดโม่)', phone: '0800000001' },
  });
  console.log('  + customer "ลูกค้าชุมชน (เดโม่)"');
  return created;
}

async function main() {
  console.log('── [1/5] บัญชีผู้ใช้ (e2e-bot สำหรับเกต E2E + seed-trace เจ้าของข้อมูล) ──');
  await ensureUser(E2E_USER, E2E_PASS, 'SUPERADMIN');
  const seedUser = await ensureUser(SEED_USER, SEED_PASS, 'OPERATOR');

  console.log('── [2/5] แปลงเกษตรต้นทาง ──');
  const plot = await ensurePlot();

  console.log('── [3/5] วัตถุดิบในคลัง (ผลผลิตเข้าคลังแล้ว) ──');
  const item = await ensureInventoryItem(seedUser.id);

  console.log('── [4/5] ร้าน opt-in เข้า catalog กลางชุมชน + สินค้า ──');
  const biz = await ensureBusiness(seedUser.id);
  const tomato = await ensureProduct(biz.id, item.id, {
    sku: 'SOV-TOM-001',
    name: 'มะเขือเทศออร์แกนิก 1 กก.',
    category: 'ผักผลไม้',
    specs: 'เก็บเกี่ยวจากแปลงโซน A — ไม่ใช้สารเคมี',
    costPrice: 25,
    salePrice: 45,
    stockQty: 50,
    reorderPoint: 10,
  });
  await ensureProduct(biz.id, item.id, {
    sku: 'SOV-SAL-002',
    name: 'ผักสลัดฟาร์มรวม 300 กรัม',
    category: 'ผักสลัด',
    specs: 'รวม 5 ชนิด — เก็บเช้าส่งบ่าย',
    costPrice: 15,
    salePrice: 35,
    stockQty: 30,
    reorderPoint: 8,
  });

  console.log('── [5/5] ล็อตผลผลิต + เหตุการณ์ตามรอย ──');
  await ensureLot({
    lotCode: 'LOT-T4ST2H', // ตัดตัวอักษรกันอ่านผิดตาม CODE_ALPHABET (ไม่มี 0/O/1/I)
    inventoryItemId: item.id,
    plotId: plot.id,
    crop: 'มะเขือเทศ',
    quantityKg: 32.5,
    harvestedHoursAgo: 72,
    events: [
      { type: 'HARVESTED', detail: 'เก็บเกี่ยว 32.5 กก. จากแปลงมะเขือเทศโซน A', hoursAgo: 72 },
      { type: 'PROCESSED', detail: 'คัดขนาด + แพ็กกล่อง 1 กก. เข้าคลังแปรรูป', hoursAgo: 40 },
      { type: 'TESTED', detail: 'ตรวจคุณภาพ: ไม่พบสารฆ่าแมลงตกค้าง — ผ่านเกณฑ์', hoursAgo: 24 },
    ],
  });
  const customer = await ensureCustomer(biz.id);
  await ensureLot({
    lotCode: 'LOT-D3M9C4',
    inventoryItemId: item.id,
    plotId: plot.id,
    crop: 'ผักสลัดรวม',
    quantityKg: 18,
    harvestedHoursAgo: 26,
    soldCustomerId: customer.id,
    soldHoursAgo: 2,
    events: [
      { type: 'HARVESTED', detail: 'เก็บเกี่ยว 18 กก. รุ่นผักสลัด (แปลงโซน A)', hoursAgo: 26 },
      { type: 'SOLD', detail: 'ขายผ่านออเดอร์ ORD-DEMO-0001', hoursAgo: 2 },
    ],
  });

  console.log(`\n✅ seed เสร็จ — business=${biz.id} product=${tomato.id}`);
  console.log('   /community ควรเห็น "ร้านผักสดตามรอย" · /trace ค้น LOT-T4ST2H และ LOT-D3M9C4 ได้');
}

main()
  .catch((e) => {
    console.error('❌ seed ล้ม:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
