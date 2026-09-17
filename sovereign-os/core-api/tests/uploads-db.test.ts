import './setup-env';
/* multer uploads (documents scan-to-inventory + treasury slip) — lifecycle จริงบน Postgres
   (ส่วนเสริมของ harden-upload-routes.test.ts — real-DB ชุดแรกคือ knowledge-db.test.ts)
   ปกติชุด route-level ใช้ mockModel ครอบ prisma — ไฟล์นี้ปล่อย InventoryItem/TransferOrder เป็น DB จริงทั้งวงจร:
     documents: POST /scan-to-inventory (multipart ภาพ + AI mock) → row จริงใน inventory_items พร้อม expiry
                ที่คำนวณจาก shelf_life_days — โหมด memory: ไม่มีอะไรลงดิสก์เลย
     treasury : สร้างคำสั่งโอน → POST /transfers/:id/evidence (สลิปภาพ) → evidence_url เป็น data URL
                ใน DB ที่ base64-decode กลับได้ไบต์ตรง → เกิน 2MB ถูกปฏิเสธโดยไม่เขียน DB
                → คำสั่งที่ VERIFIED แล้วอัปโหลดสลิปซ้ำไม่ได้ (เงื่อนไขอ่านจาก DB จริง)
   Gated: รันเมื่อ RUN_DB_TESTS=1 และมี TEST_DATABASE_URL เท่านั้น (CI: job test-db เดิมใน core-api-tests.yml —
   ท้องถิ่น: ชี้ไปที่ DB ทดสอบแล้ว RUN_DB_TESTS=1 npx tsx --test tests/uploads-db.test.ts)
   ต่างจาก knowledge: ตารางทั้งสองมี FK → User จริง จึงสร้าง user ทดสอบใน setup (teardown cascade ลบ)
   ไฟล์นี้ตั้ง TEST_DATABASE_URL ก่อน import แช่น prisma — ต้องอยู่บรรทัดแรกสุดของเทส */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const RUN_DB = process.env.RUN_DB_TESTS === '1' && !!process.env.TEST_DATABASE_URL;

describe('multer uploads (documents + treasury) — real Postgres lifecycle', { skip: RUN_DB ? false : 'ต้องการ RUN_DB_TESTS=1 + TEST_DATABASE_URL (CI ubuntu job)' }, () => {
  /* ตั้ง env ก่อน dynamic import ทุกชั้น app (prisma client สร้างจาก DATABASE_URL ตอน import แรก) */
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL as string;
  process.env.HASH_QUARANTINE_DIR = path.join(process.env.TEST_TMPDIR ?? '.', 'quarantine');

  let prisma: any;
  let makeToken: (role?: string, overrides?: Record<string, unknown>) => string;
  let createTestServer: (mount: (app: import('express').Express) => void) => Promise<any>;
  let documentsRoutes: import('express').Router;
  let visionDeps: { post?: (...args: any[]) => Promise<any> };
  let treasuryRoutes: import('express').Router;
  let userId = ''; // user จริงใน DB (FK ของ inventory_items / transfer_orders)

  /* PNG 1×1 จริง — magic bytes ผ่าน whitelist MIME/นามสกุลของทั้งสองโมดูล */
  const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );

  /** ประกอบ multipart body จริง (form fields + ไฟล์ 1 ช่อง) — แบบเดียวกับที่เบราว์เซอร์ส่ง */
  function multipart(fields: Record<string, string>, fileField: string, filename: string, mime: string, bytes: Buffer) {
    const boundary = '----updb' + Date.now() + Math.random().toString(36).slice(2);
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    );
    return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) };
  }

  test('setup: เชื่อม DB จริง + สร้าง user ทดสอบ (FK) + mock เฉพาะ AI vision', async () => {
    ({ prisma } = await import('../src/lib/prisma'));
    ({ makeToken, createTestServer } = await import('./helpers'));
    ({ default: documentsRoutes, visionDeps } = await import('../src/modules/documents/documents.routes'));
    treasuryRoutes = (await import('../src/modules/treasury/treasury.routes')).default;
    await prisma.$connect();
    await prisma.$executeRawUnsafe('SELECT 1');

    /* ตาราง inventory_items/transfer_orders อ้าง User จริง — mock ทดแทนไม่ได้ ต้องมี row จริง */
    const username = 'db-upload-test';
    const user = await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username, password_hash: 'not-a-real-login' },
    });
    userId = user.id;

    /* ล้างเศษจากรอบก่อน (CI รอบแรกไม่มีอยู่แล้ว) */
    await prisma.inventoryItem.deleteMany({ where: { user_id: userId } });
    await prisma.transferOrder.deleteMany({ where: { user_id: userId } });
    await prisma.treasuryEvent.deleteMany({ where: { user_id: userId } });
  });

  test('documents: POST /scan-to-inventory (multipart) → AI อ่านฉลาก → row จริงใน inventory_items + expiry จาก shelf_life_days', async () => {
    const token = makeToken('SUPERADMIN', { userId });
    const ts = await createTestServer((app: import('express').Express) => app.use('/api/documents', documentsRoutes));
    try {
      /* AI vision เป็นของ mock — ชั้น multer → Prisma → Postgres เป็นของจริงทั้งสาย */
      visionDeps.post = async () => ({
        data: { response: '{"name":"น้ำดื่ม db จริง","category":"WATER","quantity":6,"unit":"bottle","shelf_life_days":300}' },
      });

      const { headers, body } = multipart({}, 'image', 'bottle-db.png', 'image/png', PNG_1X1);
      const res = await fetch(`${ts.baseUrl}/api/documents/scan-to-inventory`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      const text = await res.text();
      assert.equal(res.status, 201, text.slice(0, 300));
      const { id } = JSON.parse(text);
      assert.ok(id, 'ต้องได้ id ของ inventory item กลับมา');

      /* row อยู่ใน Postgres จริง — เจ้าของเป็น user จริงตาม FK */
      const row = await prisma.inventoryItem.findUnique({ where: { id } });
      assert.ok(row, 'row ต้องอยู่ใน DB จริง');
      assert.equal(row.user_id, userId);
      assert.equal(row.name, 'น้ำดื่ม db จริง');
      assert.equal(row.category, 'WATER');
      assert.equal(row.quantity, 6);
      assert.equal(row.unit, 'bottle');
      assert.equal(row.shelf_life_days, 300);

      /* expiry คำนวณฝั่ง server (computeExpiryDate) แล้วเขียนลง DB เป็น timestamptz จริง — อนาคต ~300 วัน */
      assert.ok(row.expiry_date, 'expiry_date ต้องถูกคำนวณจาก shelf_life_days');
      assert.ok(row.expiry_date.getTime() > Date.now(), 'expiry ต้องเป็นอนาคต');
      assert.ok(row.expiry_date.getTime() < Date.now() + 400 * 24 * 3600 * 1000, 'expiry ต้องราว ๆ 300 วันข้างหน้า');

      /* memory mode: ภาพถูกอ่านเป็น base64 ส่ง AI แล้วทิ้ง — ไม่มีไฟล์ลงดิสก์ */
      assert.equal(row.file_path ?? null, null);
    } finally {
      visionDeps.post = undefined;
      await ts.close();
    }
  });

  test('treasury: สร้างคำสั่งโอน → อัปโหลดสลิป → evidence_url เป็น data URL ใน DB ที่ decode กลับได้ไบต์ตรง', async () => {
    const token = makeToken('SUPERADMIN', { userId });
    const ts = await createTestServer((app: import('express').Express) => app.use('/api/treasury', treasuryRoutes));
    try {
      /* 1) POST /transfers — คำสั่ง PENDING จริงใน DB (ยังไม่แตะ ledger) */
      const created = await fetch(`${ts.baseUrl}/api/treasury/transfers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ direction: 'OUT', category: 'BILL', amountUsd: 12.5, payee: 'ค่าไฟ db จริง' }),
      });
      const createdText = await created.text();
      assert.equal(created.status, 201, createdText.slice(0, 300));
      const order = JSON.parse(createdText).order;
      assert.equal((await prisma.transferOrder.findUnique({ where: { id: order.id } }))?.status, 'PENDING');

      /* 2) POST /transfers/:id/evidence — multipart สลิปภาพจริง */
      const { headers, body } = multipart({}, 'file', 'slip-db.png', 'image/png', PNG_1X1);
      const up = await fetch(`${ts.baseUrl}/api/treasury/transfers/${order.id}/evidence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      const upText = await up.text();
      assert.equal(up.status, 200, upText.slice(0, 300));

      /* 3) evidence_url อยู่ใน Postgres จริงเป็น data URL — decode กลับได้ไบต์เดิมทุกไบต์
            (จุดที่ mock พิสูจน์ไม่ได้: ไฟล์ multipart ถึง DB ครบโดยไม่เสียหาย) */
      const row = await prisma.transferOrder.findUnique({ where: { id: order.id } });
      assert.match(row.evidence_url, /^data:image\/png;base64,/);
      const b64 = row.evidence_url.slice(row.evidence_url.indexOf(',') + 1);
      assert.ok(Buffer.from(b64, 'base64').equals(PNG_1X1), 'ไบต์สลิปใน DB ต้องตรงกับไฟล์ที่อัปโหลด');
      assert.equal(row.status, 'PENDING', 'อัปโหลดสลิปต้องไม่เปลี่ยนสถานะคำสั่ง');
    } finally {
      await ts.close();
    }
  });

  test('treasury: สลิปเกิน 2MB ถูกปฏิเสธโดยไม่เขียน DB + คำสั่ง VERIFIED อัปโหลดซ้ำไม่ได้', async () => {
    const token = makeToken('SUPERADMIN', { userId });
    const ts = await createTestServer((app: import('express').Express) => app.use('/api/treasury', treasuryRoutes));
    try {
      const created = await fetch(`${ts.baseUrl}/api/treasury/transfers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ direction: 'OUT', category: 'OTHER', amountUsd: 3, payee: 'ทดสอบขอบเขต' }),
      });
      const order = JSON.parse(await created.text()).order;

      /* 1) เกินลิมิต 2MB ของ slipUpload → 400 (multer LIMIT_FILE_SIZE) และ evidence_url ยังเป็น null */
      const big = Buffer.alloc(2 * 1024 * 1024 + 1024, 0x50);
      const { headers, body } = multipart({}, 'file', 'big-slip.png', 'image/png', big);
      const up = await fetch(`${ts.baseUrl}/api/treasury/transfers/${order.id}/evidence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      assert.equal(up.status, 400);
      assert.match(await up.text(), /2MB/);
      assert.equal((await prisma.transferOrder.findUnique({ where: { id: order.id } })).evidence_url, null, 'ไฟล์ที่ถูกปฏิเสธต้องไม่เขียน DB');

      /* 2) ยืนยันโอน → VERIFIED จริงใน DB (เงินสด 0 → หักได้ 0 — ledger ไม่พัง) */
      const confirm = await fetch(`${ts.baseUrl}/api/treasury/transfers/${order.id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ txid: 'TXID-dbtest-1234' }),
      });
      assert.equal(confirm.status, 200, (await confirm.text()).slice(0, 300));
      assert.equal((await prisma.transferOrder.findUnique({ where: { id: order.id } })).status, 'VERIFIED');

      /* 3) อัปโหลดสลิปซ้ำบนคำสั่งที่ VERIFIED → 400 จากเงื่อนไขที่อ่านจาก DB จริง */
      const ok = multipart({}, 'file', 'late-slip.png', 'image/png', PNG_1X1);
      const late = await fetch(`${ts.baseUrl}/api/treasury/transfers/${order.id}/evidence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...ok.headers },
        body: ok.body,
      });
      assert.equal(late.status, 400);
      assert.match(await late.text(), /PENDING/);
    } finally {
      await ts.close();
    }
  });

  test('teardown: ลบ user ทดสอบ (cascade ลบ inventory/transfer ที่เหลือ) + ปิด connection', async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });
});
