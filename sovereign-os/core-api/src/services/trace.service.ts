// src/services/trace.service.ts
//
// TRACEABILITY — รหัสล็อตผลผลิต + เหตุการณ์ตามรอย (เฟส 1)
//
// หลักการ:
// - เก็บเกี่ยว (farm) → สร้าง ProductLot ผูก InventoryItem + FarmPlot อัตโนมัติ + เหตุการณ์ HARVESTED
// - ยืนยันออเดอร์ (business) → ล็อตของสินค้าที่หักสต็อกกลายเป็น SOLD (ผูกลูกค้า)
// - ส่งของ → DELIVERED · ยกเลิกออเดอร์ที่ยืนยันแล้ว → RESTOCKED (กลับสู่คลัง/ปลดลูกค้า)
// - trace สาธารณะผ่านรหัสล็อต — ไม่เปิดเผยข้อมูลราคาทุนหรือข้อมูลส่วนบุคคล
// - trace.service เป็น best-effort ต่อเหตุการณ์ธุรกิจ: พัง = log แล้วข้าม ไม่ดันออเดอร์ให้ล้ม
import { prisma } from '../lib/prisma';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัด 0/O/1/I กันอ่านผิดตอนสแกน
const CODE_LEN = 6;

/** สุ่มรหัสล็อต LOT-XXXXXX พร้อมเช็คซ้ำใน DB (ความยาว 6 = 33^6 ~ 1.29 พันล้าน ชนยาก) */
export async function generateLotCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    let suffix = '';
    for (let i = 0; i < CODE_LEN; i++) {
      suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    const code = `LOT-${suffix}`;
    const exists = await prisma.productLot.findUnique({ where: { lotCode: code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error('สร้างรหัสล็อตไม่สำเร็จ (ลองหลายครั้งแล้วชนซ้ำ) — ลองอีกครั้ง');
}

/** เหตุการณ์ล็อตที่สาธารณะเห็นได้ — ตัดรายละเอียดที่เปิดเผยไม่ได้ออก */
function publicEvent(e: any): any {
  return { type: e.type, detail: e.detail ?? null, at: e.createdAt };
}

/** รูปร่างล็อตสาธารณะ — QR/ลิงก์ตามรอยใช้ชุดนี้ (ไม่มีทุน/ไม่มีข้อมูลส่วนบุคคล) */
function publicLot(lot: any): any {
  return {
    lotCode: lot.lotCode,
    crop: lot.crop ?? null,
    quantityKg: lot.quantityKg,
    harvestedAt: lot.harvestedAt,
    plotName: lot.plot?.name ?? null,
    plotLocation: lot.plot?.location ?? null,
    sold: Boolean(lot.soldCustomerId),
    events: (lot.events ?? []).map(publicEvent),
  };
}

/** เก็บเกี่ยว → สร้างล็อตใหม่ (เรียกจาก farm harvest) — best-effort: พัง = throw ให้ caller เลือก */
export async function createLotFromHarvest(input: {
  inventoryItemId: string;
  plotId?: string | null;
  crop?: string | null;
  quantityKg: number;
}): Promise<any> {
  const lotCode = await generateLotCode();
  const lot = await prisma.productLot.create({
    data: {
      lotCode,
      inventoryItemId: input.inventoryItemId,
      plotId: input.plotId ?? null,
      crop: input.crop ?? null,
      quantityKg: Math.max(0, Number(input.quantityKg) || 0),
      harvestedAt: new Date(),
    },
  });
  await prisma.traceEvent.create({
    data: { lotId: lot.id, type: 'HARVESTED', detail: `เก็บเกี่ยว ${input.quantityKg} กก.` },
  });
  return lot;
}

/** ออเดอร์ถูกยืนยัน → ล็อตที่ผูกกับสินค้าที่ขายกลายเป็น SOLD (ผูกลูกค้า) — best-effort ไม่ throw */
export async function markLotsSold(
  tx: any,
  businessId: string,
  productIds: string[],
  customerId: string | null,
  orderNo: string
): Promise<void> {
  if (productIds.length === 0) return;
  try {
    const lots = await tx.productLot.findMany({
      where: { inventoryItemId: { in: productIds }, soldCustomerId: null },
      orderBy: { harvestedAt: 'asc' }, // FIFO — ของเก่าออกก่อน
    });
    if (lots.length === 0) return;
    const now = new Date();
    for (const lot of lots) {
      await tx.productLot.update({
        where: { id: lot.id },
        data: { soldCustomerId: customerId, soldAt: now },
      });
      await tx.traceEvent.create({
        data: { lotId: lot.id, type: 'SOLD', detail: `ขายผ่านออเดอร์ ${orderNo}` },
      });
    }
  } catch (err) {
    console.error('📦 trace markLotsSold failed (order continues):', err);
  }
}

/** ออเดอร์ถูกส่งของ → เหตุการณ์ DELIVERED บนล็อตที่ถูกขายด้วยออเดอร์นี้ — best-effort */
export async function markLotsDelivered(tx: any, orderNo: string, customerName?: string | null): Promise<void> {
  try {
    const lots = await tx.productLot.findMany({
      where: { events: { some: { type: 'SOLD', detail: { contains: orderNo } } } },
    });
    for (const lot of lots) {
      const events: any[] = await tx.traceEvent.findMany({ where: { lotId: lot.id } });
      if (events.some((e) => e.type === 'DELIVERED')) continue; // กันซ้ำ
      await tx.traceEvent.create({
        data: {
          lotId: lot.id,
          type: 'DELIVERED',
          detail: `ส่งมอบแล้ว${customerName ? ` ถึง ${customerName}` : ''} (ออเดอร์ ${orderNo})`,
        },
      });
    }
  } catch (err) {
    console.error('📦 trace markLotsDelivered failed (order continues):', err);
  }
}

/** ออเดอร์ที่ยืนยันแล้วถูกยกเลิก → ปลดลูกค้า + เหตุการณ์ RESTOCKED — best-effort */
export async function markLotsRestocked(tx: any, orderNo: string): Promise<void> {
  try {
    const lots = await tx.productLot.findMany({
      where: { events: { some: { type: 'SOLD', detail: { contains: orderNo } } } },
    });
    for (const lot of lots) {
      const events: any[] = await tx.traceEvent.findMany({ where: { lotId: lot.id } });
      if (events.some((e) => e.type === 'RESTOCKED' && (e.detail ?? '').includes(orderNo))) continue; // กันซ้ำ
      await tx.productLot.update({ where: { id: lot.id }, data: { soldCustomerId: null, soldAt: null } });
      await tx.traceEvent.create({
        data: { lotId: lot.id, type: 'RESTOCKED', detail: `ออเดอร์ ${orderNo} ถูกยกเลิก — กลับเข้าคลัง` },
      });
    }
  } catch (err) {
    console.error('📦 trace markLotsRestocked failed (order continues):', err);
  }
}

/** ตามรอยจากรหัสล็อต (สาธารณะ) — ไม่มีรหัส/ไม่มีล็อต = throw (route แปลง 404) */
export async function getPublicTrace(lotCode: string): Promise<any> {
  const code = String(lotCode || '').trim().toUpperCase();
  if (!/^LOT-[A-Z2-9]{6}$/.test(code)) throw new Error('lot not found');
  const lot = await prisma.productLot.findUnique({
    where: { lotCode: code },
    include: {
      plot: { select: { name: true, location: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!lot) throw new Error('lot not found');
  return publicLot(lot);
}

/** รายการล็อตล่าสุด (login) — หน้าแรกของ traceability */
export async function listLots(take = 50): Promise<any[]> {
  return prisma.productLot.findMany({
    orderBy: { harvestedAt: 'desc' },
    take: Math.min(Math.max(1, take), 200),
    include: {
      plot: { select: { name: true } },
      events: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}
