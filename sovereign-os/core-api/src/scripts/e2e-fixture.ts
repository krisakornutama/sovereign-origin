// src/scripts/e2e-fixture.ts — ข้อมูลจำลองสำหรับ e2e เท่านั้น (สร้างตอนเริ่มรัน · ลบตอนจบ)
//
// ที่มา: trace-community.spec.ts คาดหน้า /community มีร้านตัวอย่าง + สินค้า แต่สคริปต์ seed เดิม
//   หายไปตอนคัดไฟล์ 1/10 และฐานจริงมีแค่ "ร้านทดสอบระบบ P16" → เทสต์ล้มทุกรอบ
// เจ้าของตัดสินใจ 2/10/69: ให้ e2e สร้างเองแล้วลบทิ้ง — **ห้ามปล่อยให้ค้างในฐานจริง**
//   เพราะหน้า /community เป็นหน้าสาธารณะที่เพิ่งส่งให้ Google (ข้อมูลปลอมจะถูกจัดทำดัชนี)
//
//   ใช้:  node dist/scripts/e2e-fixture.js seed
//         node dist/scripts/e2e-fixture.js clean
//
// หมายเหตุสำคัญ: ไฟล์นี้เป็นแค่ตัวเรียก — การอ่าน/เขียนตาราง businesses/business_products
//   อยู่ใน service ของโมดูล business เท่านั้น (arch-gate: เส้นข้ามโมดูลต้องประกาศ)
import dotenv from 'dotenv';
import path from 'path';
import { prisma } from '../lib/prisma';
import { seedCommunityFixture, clearCommunityFixture } from '../services/business-shop.service';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

async function main() {
  const cmd = process.argv[2];

  if (cmd === 'seed') {
    // ownerId มาจากผู้ใช้จริง (ตาราง users เป็นของโมดูล auth — สคริปต์อ่านได้ตาม baseline เดิม)
    const owner = await prisma.user.findFirst({ where: { role: 'SUPERADMIN' }, orderBy: { id: 'asc' }, select: { id: true } });
    if (!owner) throw new Error('ไม่มีผู้ใช้ SUPERADMIN — seed ไม่ได้ (รัน seed.ts ก่อน)');
    const r = await seedCommunityFixture(owner.id);
    console.log(`seeded shop ${r.shopId} + ${r.products} สินค้า`);
    return;
  }

  if (cmd === 'clean') {
    const r = await clearCommunityFixture();
    console.log(`cleaned: สินค้า ${r.products} · ร้าน ${r.shops}`);
    return;
  }

  console.error('usage: e2e-fixture <seed|clean>');
  process.exit(2);
}

main()
  .catch((e) => {
    console.error('e2e-fixture ล้ม:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());