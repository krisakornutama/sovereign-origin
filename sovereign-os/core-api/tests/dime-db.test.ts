import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { RUN_DB, SKIP_REASON, primeDbEnv, setupCore, teardownCore, multipart, type CoreCtx } from './db-harness';

/* Dime import — lifecycle จริงบน Postgres (ส่วนเสริมของ dimePipeline.test.ts ที่ mock DB ทั้งชุด)
   ปกติชุด route-level ใช้ mockModel ครอบ prisma — ไฟล์นี้ปล่อย DB เป็นของจริงทั้งวงจร:
     POST /api/dime/import (multipart PDF จริงผ่าน multer memory) → parse → row จริงใน dime_statements
       → upsert จริงใน asset_positions (STOCK) + ราคาจริงใน asset_prices (source='dime')
       → อัปโหลดไฟล์เดิมซ้ำ = duplicate (raw_text_hash UNIQUE จริงกันไฟล์ซ้ำ)
     จุดที่ mock พิสูจน์ไม่ได้: UNIQUE constraint ของ raw_text_hash/message_id + FK user_id
       + เงื่อนไข upsert ที่อ่านจากตารางจริง + การอ่านงบสรุปกลับจาก Postgres
   Gated: RUN_DB_TESTS=1 + TEST_DATABASE_URL (CI: job test-db ใน core-api-tests.yml)
   ไฟล์นี้ตั้ง TEST_DATABASE_URL ก่อน import แช่น prisma — ต้องอยู่บรรทัดแรกสุดของเทส */

/* fixture PDF ที่ผ่าน whitelist ของ dime (.pdf + MIME application/pdf) — ตัว parse จริงถูก mock
   (pdf-parse เป็นชั้นภายนอกเหมือน AI vision/threat-intel ของชุดเทสอื่น — ไม่ใช่สิ่งที่ชุดนี้พิสูจน์) */
const PDF_STUB = Buffer.from('%PDF-1.4\n% sovereign-dime-dbtest\n');

/* ข้อความสเตตเมนต์จำลอง — รูปแบบเดียวกับ fixture ใน dimePipeline.test.ts (parse จริงด้วย parser ตัวเดิม) */
const STATEMENT_TEXT = `Dime! Statement
รายงานยอดคงเหลือประจำเดือนสิงหาคม 2569
US Stocks (หุ้นสหรัฐฯ)
AAPL APPLE INC. 120 45.30 44.50 5,340.00
MSFT MICROSOFT CORP 60 150.00 160.25 9,615.00
Thai Stocks
SCB บมจ.ไทยพาณิชย์ 100 120.00 130.00 13,000.00`;

const AAPL_SECTION_LINE = 'AAPL APPLE INC. 120 45.30 44.50 5,340.00\nMSFT MICROSOFT CORP 60 150.00 160.25 9,615.00';

describe('dime import — real Postgres lifecycle', { skip: RUN_DB ? false : SKIP_REASON }, () => {
  primeDbEnv();

  let ctx: CoreCtx;
  let dimeRoutes: import('express').Router;
  let dimeService: typeof import('../src/services/dime.service');
  let ownerWhere: { username: string };

  test('setup: เชื่อม DB จริง + user ทดสอบ (FK) + mock เฉพาะ parsePdf (pdf-parse เป็นชั้นภายนอก)', async () => {
    ctx = await setupCore();
    dimeRoutes = (await import('../src/modules/dime/dime.routes')).default;
    dimeService = await import('../src/services/dime.service');

    /* ปลดท้าย bot Telegram จาก setup-env (ห้ามยิง network จากเทส) — ทำแบบเดียวกับ harness */
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    /* mock เฉพาะ parsePdf ของ singleton จริง (dimeProcessor) — processor เปิด deps ออกมาให้
       แก้ที่ตัวเดียวกับที่ closure อ่าน (deps.parsePdf) — ครอบทั้งเส้นทาง EMAIL/UPLOAD */
    const realParse = dimeService.dimeProcessor.deps.parsePdf;
    dimeService.dimeProcessor.deps.parsePdf = async () => ({ text: STATEMENT_TEXT });

    ownerWhere = { username: 'db-upload-test' };
    await ctx.prisma.dimeStatement.deleteMany({});
    /* asset_prices ไม่มี FK → user — ฐานท้องถิ่นเก็บข้ามรอบ ต้องล้างเฉพาะสัญลักษณ์ที่ชุดนี้ใช้
       (CI DB สดทุกรอบไม่เจอ แต่รันซ้ำท้องถิ่นต้อง idempotent เหมือนข้อตกลงของชุด real-DB) */
    await ctx.prisma.assetPrice.deleteMany({ where: { symbol: { in: ['AAPL', 'MSFT'] }, source: 'dime' } });
    await ctx.prisma.assetPosition.deleteMany({ where: { user_id: ctx.userId, symbol: { in: ['AAPL', 'MSFT'] } } });
  });

  test('import: multipart PDF → row จริงใน dime_statements (งบสรุป + source UPLOAD) + upsert ตำแหน่ง 2 ตัว + ราคา 2 แถว', async () => {
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/dime', dimeRoutes));
    try {
      /* ตั้งเจ้าของพอร์ตให้ชี้ user ทดสอบจริง (FK ต้องผ่าน) */
      process.env.DIME_OWNER_USERNAME = ownerWhere.username;

      const { headers, body } = multipart({}, 'file', 'statement-db.pdf', 'application/pdf', PDF_STUB);
      const res = await fetch(`${ts.baseUrl}/api/dime/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      const text = await res.text();
      assert.equal(res.status, 200, text.slice(0, 300));
      const payload = JSON.parse(text);
      assert.equal(payload.success, true);
      assert.equal(payload.data.status, 'ok');
      assert.equal(payload.data.period, '2026-08');
      assert.equal(payload.data.upserted, 2);

      /* 1) row อยู่ใน Postgres จริง — อ่านตรง ๆ ไม่ผ่าน handler */
      const row = await ctx.prisma.dimeStatement.findUnique({ where: { id: payload.data.statementId } });
      assert.ok(row, 'dime_statements ต้องมี row จริง');
      assert.equal(row.statement_period, '2026-08');
      assert.equal(row.source, 'UPLOAD');
      assert.equal(row.subject, 'statement-db.pdf');
      assert.equal(row.user_id, ctx.userId, 'เจ้าของต้องเป็น user ทดสอบจริง (FK)');
      assert.ok(row.raw_text_hash, 'hash สำหรับ dedupe ต้องถูกบันทึก');
      /* สัญญา hash = sha1 ของ section US stocks (ฟังก์ชันเดียวกับ pipeline) */
      assert.equal(row.raw_text_hash, dimeService.sha1Section(AAPL_SECTION_LINE));
      assert.equal((row.assets as unknown[]).length, 2);
      /* งบสรุปหน้าแรก — parser ตัวเดิมแตกจากข้อความ fixture */
      assert.ok(row.assets && typeof row.assets === 'object');

      /* 2) asset_positions จริง: AAPL สร้างใหม่, MSFT สร้างใหม่ (ฐานสะอาด) */
      const aapl = await ctx.prisma.assetPosition.findFirst({
        where: { user_id: ctx.userId, symbol: 'AAPL', type: 'STOCK' },
      });
      const msft = await ctx.prisma.assetPosition.findFirst({
        where: { user_id: ctx.userId, symbol: 'MSFT', type: 'STOCK' },
      });
      assert.ok(aapl && msft, 'ตำแหน่งหุ้นต้องถูก upsert ลง asset_positions จริง');
      assert.equal(aapl.quantity, 120);
      assert.equal(aapl.avg_cost_usd, 45.3);
      assert.equal(aapl.company_name, 'APPLE INC.');
      assert.equal(msft.quantity, 60);

      /* 3) asset_prices จริง: source='dime' 2 แถว (AAPL/MSFT) — setup ล้างก่อนจึงนับตรง */
      const prices = await ctx.prisma.assetPrice.findMany({
        where: { symbol: { in: ['AAPL', 'MSFT'] }, source: 'dime' },
      });
      assert.equal(prices.length, 2, `ต้องมีราคา dime 2 แถว (ได้ ${prices.length})`);
      assert.ok(prices.some((p) => p.symbol === 'AAPL' && p.price_usd === 44.5));
      assert.ok(prices.some((p) => p.symbol === 'MSFT' && p.price_usd === 160.25));
    } finally {
      delete process.env.DIME_OWNER_USERNAME;
      await ts.close();
    }
  });

  test('dedupe: อัปโหลดไฟล์เดิมซ้ำ → status duplicate โดย UNIQUE(raw_text_hash) จริงใน DB — ไม่สร้าง row ใหม่/ไม่แตะพอร์ต', async () => {
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/dime', dimeRoutes));
    try {
      process.env.DIME_OWNER_USERNAME = ownerWhere.username;

      const countBefore = await ctx.prisma.dimeStatement.count();
      const posBefore = await ctx.prisma.assetPosition.count({ where: { user_id: ctx.userId } });

      const { headers, body } = multipart({}, 'file', 'statement-db.pdf', 'application/pdf', PDF_STUB);
      const res = await fetch(`${ts.baseUrl}/api/dime/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      const text = await res.text();
      assert.equal(res.status, 200, text.slice(0, 300));
      const payload = JSON.parse(text);
      assert.equal(payload.data.status, 'duplicate', 'ไฟล์เดิมต้องโดน dedupe จาก hash ที่อ่านจาก DB จริง');
      assert.ok(payload.data.statementId, 'duplicate ต้องรายงาน id ของ row เดิม');

      /* DB จริงไม่เปลี่ยน — จุดที่ mock ล้วนพิสูจน์ไม่ได้ (findStatement mock ตอบ null เสมอ) */
      assert.equal(await ctx.prisma.dimeStatement.count(), countBefore, 'ห้ามสร้าง statement ซ้ำ');
      assert.equal(
        await ctx.prisma.assetPosition.count({ where: { user_id: ctx.userId } }),
        posBefore,
        'duplicate ห้ามแตะพอร์ต'
      );
      /* นับแบบ delta — ราคาจากรอบ import แรกมีอยู่แล้ว 1 แถว (setup ล้างก่อน) duplicate ห้ามเพิ่ม */
      assert.equal(
        await ctx.prisma.assetPrice.count({ where: { symbol: 'AAPL', source: 'dime' } }),
        1,
        'duplicate ห้ามแทรกราคาซ้ำ (UNIQUE symbol+time+source จริง)'
      );
    } finally {
      delete process.env.DIME_OWNER_USERNAME;
      await ts.close();
    }
  });

  test('upsert: แก้ parsePdf ให้ยอดใหม่ → ตำแหน่งเดิมถูก update (ไม่สร้างซ้ำ) + ราคาแถวใหม่ตามเวลา', async () => {
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/dime', dimeRoutes));
    try {
      process.env.DIME_OWNER_USERNAME = ownerWhere.username;

      const NEW_TEXT = STATEMENT_TEXT.replace(
        'AAPL APPLE INC. 120 45.30 44.50 5,340.00',
        'AAPL APPLE INC. 150 44.00 46.00 6,900.00'
      );
      const restoreParse = dimeService.dimeProcessor.deps.parsePdf;
      dimeService.dimeProcessor.deps.parsePdf = async () => ({ text: NEW_TEXT });

      const { headers, body } = multipart({}, 'file', 'statement-db2.pdf', 'application/pdf', PDF_STUB);
      const res = await fetch(`${ts.baseUrl}/api/dime/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      const text = await res.text();
      try {
        assert.equal(res.status, 200, text.slice(0, 300));
        const payload = JSON.parse(text);
        assert.equal(payload.data.status, 'ok', 'สเตตเมนต์คนละเนื้อหา = hash ต่างกัน ต้อง import ได้');

        /* ตำแหน่ง AAPL ต้องเป็น row เดิมที่ update — ไม่ใช่สร้างซ้ำ (จำนวนต่อ symbol = 1) */
        const aapls = await ctx.prisma.assetPosition.findMany({
          where: { user_id: ctx.userId, symbol: 'AAPL', type: 'STOCK' },
        });
        assert.equal(aapls.length, 1, 'ห้ามสร้างตำแหน่งซ้ำ — ต้อง update ของเดิม');
        assert.equal(aapls[0].quantity, 150);
        assert.equal(aapls[0].avg_cost_usd, 44);

        /* ราคาแถวใหม่ (เวลาต่างกัน) — UNIQUE(symbol,time,source) จริงต้องรับได้ */
        const priceCount = await ctx.prisma.assetPrice.count({ where: { symbol: 'AAPL', source: 'dime' } });
        assert.equal(priceCount, 2, 'ราคา AAPL ต้องมี 2 แถว (import สองรอบต่างเวลา)');
      } finally {
        dimeService.dimeProcessor.deps.parsePdf = restoreParse;
      }
    } finally {
      delete process.env.DIME_OWNER_USERNAME;
      await ts.close();
    }
  });

  test('validation: ไฟล์ที่ไม่ใช่ PDF ถูก multer ปฏิเสธ 400 โดยไม่เขียน DB (ชั้น hardenUpload บน DB จริง)', async () => {
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/dime', dimeRoutes));
    try {
      const countBefore = await ctx.prisma.dimeStatement.count();
      const { headers, body } = multipart({}, 'file', 'fake-db.txt', 'text/plain', Buffer.from('not a pdf'));
      const res = await fetch(`${ts.baseUrl}/api/dime/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      assert.equal(res.status, 400, (await res.text()).slice(0, 200));
      assert.equal(await ctx.prisma.dimeStatement.count(), countBefore, 'ไฟล์ถูกปฏิเสธต้องไม่เขียน DB');
    } finally {
      await ts.close();
    }
  });

  test('telegram: PDF อ่านไม่ได้ → alert ⚠️ WARN พร้อมเหตุผลจาก parsePdf (DI sender — ไม่ยิง network)', async () => {
    const telegramAlert = await import('../src/services/telegram-alert.service');
    const sent: string[] = [];
    telegramAlert.setTelegramAlertSender(async (html) => {
      sent.push(html);
      return true;
    });

    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/dime', dimeRoutes));
    try {
      process.env.DIME_OWNER_USERNAME = ownerWhere.username;
      const restoreParse = dimeService.dimeProcessor.deps.parsePdf;
      dimeService.dimeProcessor.deps.parsePdf = async () => {
        throw new Error('Encrypted PDF — dbtest reason');
      };
      try {
        const { headers, body } = multipart({}, 'file', 'broken-db.pdf', 'application/pdf', PDF_STUB);
        const res = await fetch(`${ts.baseUrl}/api/dime/import`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, ...headers },
          body,
        });
        const text = await res.text();
        assert.equal(res.status, 200, text.slice(0, 300));
        const payload = JSON.parse(text);
        assert.equal(payload.data.status, 'error');
        assert.match(payload.data.reason, /Encrypted PDF — dbtest reason/);

        /* alert ต้องออก 1 ฉบับ: ป้าย WARN + เหตุผล + eventKey ติด dedup */
        await new Promise((r) => setTimeout(r, 20)); /* ผู้ส่งเป็น fire-and-forget */
        assert.equal(sent.length, 1, `ต้องส่ง alert 1 ฉบับ (ได้ ${sent.length})`);
        assert.match(sent[0], /⚠️/);
        assert.match(sent[0], /WARN/);
        assert.match(sent[0], /Dime! Statement/);
        assert.match(sent[0], /Encrypted PDF — dbtest reason/);
      } finally {
        dimeService.dimeProcessor.deps.parsePdf = restoreParse;
      }
    } finally {
      telegramAlert.setTelegramAlertSender(null);
      delete process.env.DIME_OWNER_USERNAME;
      await ts.close();
    }
  });

  test('teardown: ล้างข้อมูลของ user ทดสอบ (cascade) + ปิด connection', async () => {
    await teardownCore(ctx);
  });
});
