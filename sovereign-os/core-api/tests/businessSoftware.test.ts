// tests/businessSoftware.test.ts — ประเภทธุรกิจ "ขายซอฟต์แวร์เป็นโปรเจ็ก" (30/10/69)
//
// เป้าหมาย: ล็อกแคตตาล็อก/สิทธิ์/ผู้ช่วย AI ที่เจ้าของกำหนดไว้
// และพิสูจน์ว่า seed ทำงานครั้งเดียว (idempotent) ไม่สร้างซ้ำทุกครั้งที่เรียก
import './setup-env';
import { test, before } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/lib/prisma';
import {
  SOFTWARE_BIZ_TYPE,
  SOFTWARE_AGENT_PRESETS,
  SOFTWARE_PRODUCT_PRESETS,
  isSoftwareBusiness,
  seedSoftwareProducts,
  seedSoftwareBusiness,
} from '../src/services/business-software.service';

const BIZ_ID = '44444444-4444-4444-4444-444444444444';

// in-memory store เฉพาะไฟล์นี้ (แต่ละ test file รันคนละ process)
const agentRows: any[] = [];
const productRows: any[] = [];

before(() => {
  (prisma as any).agentRole = {
    create: async ({ data }: any) => ({ id: `role-${agentRows.length + 1}`, ...data }),
  };
  (prisma as any).businessAgent = {
    count: async ({ where }: any) => agentRows.filter((a) => a.businessId === where?.businessId).length,
    create: async ({ data }: any) => {
      const row = { id: `ba-${agentRows.length + 1}`, ...data };
      agentRows.push(row);
      return row;
    },
  };
  (prisma as any).businessProduct = {
    count: async ({ where }: any) =>
      productRows.filter(
        (p) =>
          (!where?.businessId || p.businessId === where.businessId) &&
          (!where?.category || p.category === where.category),
      ).length,
    createMany: async ({ data }: any) => {
      let count = 0;
      for (const row of data) {
        if (productRows.some((p) => p.businessId === row.businessId && p.sku === row.sku)) continue;
        productRows.push(row);
        count += 1;
      }
      return { count };
    },
  };
});

test('isSoftwareBusiness — รู้จักเฉพาะ SOFTWARE_PROJECT (ค่าเก่าต้องไม่ถูกตีความเป็นซอฟต์แวร์)', () => {
  assert.equal(isSoftwareBusiness(SOFTWARE_BIZ_TYPE), true);
  assert.equal(isSoftwareBusiness('IOT_RETAIL'), false);
  assert.equal(isSoftwareBusiness('GENERAL_TRADE'), false);
  assert.equal(isSoftwareBusiness(null), false);
  assert.equal(isSoftwareBusiness(undefined), false);
});

test('แคตตาล็อกซอฟต์แวร์ 4 ชุด — SKU ไม่ซ้ำ ราคาอยู่ในช่วงที่เจ้าของกำหนด', () => {
  assert.equal(SOFTWARE_PRODUCT_PRESETS.length, 4);
  assert.equal(new Set(SOFTWARE_PRODUCT_PRESETS.map((p) => p.sku)).size, 4, 'SKU ต้องไม่ซ้ำ (unique businessId+sku)');
  const bySku = Object.fromEntries(SOFTWARE_PRODUCT_PRESETS.map((p) => [p.sku, p]));
  assert.ok(bySku['SW-TAX-CORE'].salePrice >= 1290 && bySku['SW-TAX-CORE'].salePrice <= 2500);
  assert.ok(bySku['SW-BIZ-OS'].salePrice >= 7900 && bySku['SW-BIZ-OS'].salePrice <= 15900);
  assert.ok(bySku['SW-IOT-FW'].salePrice >= 1500 && bySku['SW-IOT-FW'].salePrice <= 3500);
  assert.ok(bySku['SW-ARCH-BOOK'].salePrice > 0);
  // สินค้าดิจิทัล: ต้องไม่ติดเงื่อนไข stockQty >= qty ตอนออกออเดอร์
  assert.ok(SOFTWARE_PRODUCT_PRESETS.every((p) => p.stockQty > 0));
  assert.ok(SOFTWARE_PRODUCT_PRESETS.every((p) => p.category === 'SOFTWARE'));
});

test('ผู้ช่วย AI สายซอฟต์แวร์ 5 คน — key ไม่ซ้ำ และไม่ใช่ prompt ชุด IoT', () => {
  assert.equal(SOFTWARE_AGENT_PRESETS.length, 5);
  assert.equal(new Set(SOFTWARE_AGENT_PRESETS.map((a) => a.key)).size, 5);
  const keys = SOFTWARE_AGENT_PRESETS.map((a) => a.key);
  for (const k of ['presales', 'license_advisor', 'docs_writer', 'delivery_qa', 'accountant']) {
    assert.ok(keys.includes(k as any), `ขาดผู้ช่วย key=${k}`);
  }
  assert.ok(SOFTWARE_AGENT_PRESETS.every((a) => !a.system_prompt.includes('IoT')), 'prompt ต้องไม่ใช่ชุดขายสินค้า IoT');
});

test('seedSoftwareBusiness — สร้าง 5 ผู้ช่วย + 4 สินค้า และไม่สร้างซ้ำเมื่อเรียกอีกครั้ง', async () => {
  const first = await seedSoftwareBusiness(BIZ_ID, 'Sovereign Dev Shop');
  assert.deepEqual(first, { agents: 5, products: 4 });
  assert.equal(agentRows.length, 5);
  assert.equal(productRows.length, 4);
  assert.ok(agentRows.every((a) => a.businessId === BIZ_ID && a.enabled === true));

  const second = await seedSoftwareBusiness(BIZ_ID, 'Sovereign Dev Shop');
  assert.deepEqual(second, { agents: 0, products: 0 }, 'เรียกซ้ำต้องไม่สร้างเพิ่ม');
  assert.equal(agentRows.length, 5);
  assert.equal(productRows.length, 4);
});

test('seedSoftwareProducts — ธุรกิจที่มีสินค้าอื่นอยู่แล้วยังได้แคตตาล็อกซอฟต์แวร์ครบ', async () => {
  const OTHER = '55555555-5555-5555-5555-555555555555';
  productRows.push({ businessId: OTHER, sku: 'ESP32-01', category: 'SENSOR' });
  const created = await seedSoftwareProducts(OTHER);
  assert.equal(created, 4);
  assert.equal(productRows.filter((p) => p.businessId === OTHER && p.category === 'SOFTWARE').length, 4);
});
