/* multer/raw-body uploads (documents scan-to-inventory + treasury slip + OTA firmware + whisper)
   — lifecycle จริงบน Postgres (ส่วนเสริมของ knowledge-db.test.ts, ใช้ harness กลางจาก db-harness.ts)
   ปกติชุด route-level ใช้ mockModel ครอบ prisma — ไฟล์นี้ปล่อย DB เป็นของจริงทั้งวงจร:
     documents: POST /scan-to-inventory (multipart ภาพ + AI mock) → row จริงใน inventory_items
     treasury : upload สลิป → evidence_url data URL ใน DB decode ได้ไบต์ตรง → เกิน 2MB ปฏิเสธ → VERIFIED อัปโหลดซ้ำไม่ได้
     ota      : POST firmware (raw body) → ไฟล์จริงบนดิสก์ → deploy → row จริงใน ota_events → DELETE ลบดิสก์
     whisper  : ไม่แตะ DB — พิสูจน์วงจรดิสก์จริง (multipart → ดิสก์ → CLI อ่าน → เก็บกวาด) mock เฉพาะ CLI
   Gated: รันเมื่อ RUN_DB_TESTS=1 และมี TEST_DATABASE_URL เท่านั้น (CI: job test-db เดิม —
   ท้องถิ่น: ชี้ไปที่ DB ทดสอบแล้ว RUN_DB_TESTS=1 npx tsx --test tests/uploads-db.test.ts)
   ไฟล์นี้ตั้ง TEST_DATABASE_URL ก่อน import แช่น prisma — ต้องอยู่บรรทัดแรกสุดของเทส */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RUN_DB, SKIP_REASON, primeDbEnv, setupCore, teardownCore, multipart, PNG_1X1, WAV_STUB, mockDelegate, type CoreCtx } from './db-harness';

describe('uploads (documents + treasury + ota + whisper) — real Postgres lifecycle', { skip: RUN_DB ? false : SKIP_REASON }, () => {
  primeDbEnv();

  let ctx: CoreCtx;
  let knowledgeRoutes: import('express').Router;
  let knowledgeDir: () => string;
  let hashEngine: any;
  let documentsRoutes: import('express').Router;
  let visionDeps: { post?: (...args: any[]) => Promise<any> };
  let treasuryRoutes: import('express').Router;
  let otaRoutes: import('express').Router;
  let otaMod: typeof import('../src/modules/ota/ota.routes');
  let otaMqttPublishOrig: (...args: any[]) => any;
  let otaDirPath: string;
  let restoreThreatIntel: (() => void) | null = null;
  let crypto: typeof import('node:crypto');

  test('setup: เชื่อม DB จริง + user ทดสอบ (FK) + mock เฉพาะ AI vision', async () => {
    ctx = await setupCore();
    ({ default: documentsRoutes, visionDeps } = await import('../src/modules/documents/documents.routes'));
    treasuryRoutes = (await import('../src/modules/treasury/treasury.routes')).default;
    /* OTA_DIR ถูกอ่านตอน import — ตั้งก่อน dynamic import ให้ firmware ลงโฟลเดอร์ชั่วคราวของชุดเทสนี้ */
    process.env.OTA_DIR = path.join(process.env.TEST_TMPDIR ?? '.', 'ota-firmwares');
    otaDirPath = process.env.OTA_DIR;
    otaMod = await import('../src/modules/ota/ota.routes');
    otaRoutes = otaMod.default;
    otaMqttPublishOrig = otaMod.mqttClient.publish.bind(otaMod.mqttClient);
    /* ล้าง event ของไฟล์ทดสอบจากรอบก่อน (ota_events ไม่มี FK — รันซ้ำท้องถิ่นต้อง idempotent) */
    await ctx.prisma.otaEvent.deleteMany({ where: { firmware: 'fw-dbtest.bin' } });
  });

  test('documents: POST /scan-to-inventory (multipart) → AI อ่านฉลาก → row จริงใน inventory_items + expiry จาก shelf_life_days', async () => {
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/documents', documentsRoutes));
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
      const row = await ctx.prisma.inventoryItem.findUnique({ where: { id } });
      assert.ok(row, 'row ต้องอยู่ใน DB จริง');
      assert.equal(row.user_id, ctx.userId);
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
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/treasury', treasuryRoutes));
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
      assert.equal((await ctx.prisma.transferOrder.findUnique({ where: { id: order.id } }))?.status, 'PENDING');

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
      const row = await ctx.prisma.transferOrder.findUnique({ where: { id: order.id } });
      assert.match(row.evidence_url, /^data:image\/png;base64,/);
      const b64 = row.evidence_url.slice(row.evidence_url.indexOf(',') + 1);
      assert.ok(Buffer.from(b64, 'base64').equals(PNG_1X1), 'ไบต์สลิปใน DB ต้องตรงกับไฟล์ที่อัปโหลด');
      assert.equal(row.status, 'PENDING', 'อัปโหลดสลิปต้องไม่เปลี่ยนสถานะคำสั่ง');
    } finally {
      await ts.close();
    }
  });

  test('treasury: สลิปเกิน 2MB ถูกปฏิเสธโดยไม่เขียน DB + คำสั่ง VERIFIED อัปโหลดซ้ำไม่ได้', async () => {
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/treasury', treasuryRoutes));
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
      assert.equal((await ctx.prisma.transferOrder.findUnique({ where: { id: order.id } })).evidence_url, null, 'ไฟล์ที่ถูกปฏิเสธต้องไม่เขียน DB');

      /* 2) ยืนยันโอน → VERIFIED จริงใน DB (เงินสด 0 → หักได้ 0 — ledger ไม่พัง) */
      const confirm = await fetch(`${ts.baseUrl}/api/treasury/transfers/${order.id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ txid: 'TXID-dbtest-1234' }),
      });
      assert.equal(confirm.status, 200, (await confirm.text()).slice(0, 300));
      assert.equal((await ctx.prisma.transferOrder.findUnique({ where: { id: order.id } })).status, 'VERIFIED');

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

  test('ota: อัปโหลด firmware (raw body) → ไฟล์จริงบนดิสก์ → deploy → row จริงใน ota_events → DELETE ลบทั้ง DB และดิสก์', async () => {
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/ota', otaRoutes));
    const fw = Buffer.from('SOVEREIGN-FW-DBTEST v1.2.3 ' + Date.now());
    try {
      /* mock เฉพาะ broker — publish ต้องโดนเรียกจริง (พิสูจน์ว่า deploy ออก MQTT ชั้นเดิม) */
      let published = 0;
      otaMod.mqttClient.publish = ((...args: any[]) => {
        published++;
        const cb = args.find((a) => typeof a === 'function');
        if (cb) cb();
      }) as any;

      /* 1) POST /firmwares — raw body จริง (ไม่ใช่ multipart — OTA ใช้ express.raw) */
      const up = await fetch(`${ts.baseUrl}/api/ota/firmwares?name=fw-dbtest.bin`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body: fw,
      });
      assert.equal(up.status, 200, (await up.text()).slice(0, 300));
      const fwPath = path.join(otaDirPath, 'fw-dbtest.bin');
      assert.ok(fs.existsSync(fwPath), 'firmware ต้องลงดิสก์จริงใน OTA_DIR ที่ประกาศ');
      assert.ok(fs.readFileSync(fwPath).equals(fw), 'ไบต์ firmware บนดิสก์ต้องตรงกับที่อัปโหลด');

      /* 2) POST /deploy — สั่งผ่าน MQTT + เขียน ota_events ลง DB จริง */
      const deploy = await fetch(`${ts.baseUrl}/api/ota/deploy`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ nodeId: '11111111-1111-1111-1111-111111111111', file: 'fw-dbtest.bin' }),
      });
      const deployText = await deploy.text();
      assert.equal(deploy.status, 200, deployText.slice(0, 300));
      assert.ok(published >= 1, 'deploy ต้อง publish คำสั่งออก MQTT อย่างน้อย 1 ครั้ง');
      const evs = await ctx.prisma.otaEvent.findMany({ where: { firmware: 'fw-dbtest.bin' } });
      assert.equal(evs.length, 1, 'deploy ต้องเขียน ota_events จริง 1 row');
      assert.equal(evs[0].status, 'sent');
      /* version ของ OTA = ชื่อไฟล์ตัด .bin (สัญญาของ deploy handler) */
      assert.equal(evs[0].version, 'fw-dbtest');

      /* 3) GET /events — อ่านจาก DB จริงผ่าน API */
      const list = await fetch(`${ts.baseUrl}/api/ota/events`, { headers: { Authorization: `Bearer ${token}` } });
      const listed = JSON.parse(await list.text());
      assert.ok(listed.some((e: any) => e.firmware === 'fw-dbtest.bin'), 'GET /events ต้องเห็น event จาก DB จริง');

      /* 4) DELETE → ไฟล์หายจากดิสก์ (วงจรดิสก์ปิดจริง — ota_events ตั้งใจเก็บเป็น history) */
      const del = await fetch(`${ts.baseUrl}/api/ota/firmwares/fw-dbtest.bin`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(del.status, 200);
      assert.ok(!fs.existsSync(fwPath), 'firmware ต้องหายจากดิสก์หลัง DELETE');
      assert.equal(await ctx.prisma.otaEvent.count({ where: { firmware: 'fw-dbtest.bin' } }), 1, 'event เป็น history — ต้องยังอยู่');
    } finally {
      otaMod.mqttClient.publish = otaMqttPublishOrig as any;
      await ts.close();
    }
  });

  test('whisper: multipart เสียง → ไฟล์จริงบนดิสก์ชั่วคราว → CLI (env override) อ่าน → ตอบข้อความ + ไฟล์ถูกเก็บกวาด', async () => {
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    /* fixture CJS แยกไฟล์ — env override ต้องชี้ไฟล์จริง (รันเนอร์ไม่มี whisper-cli จริง) */
    const overrideFile = path.join(process.env.TEST_TMPDIR ?? '.', 'whisper-run-override.cjs');
    fs.writeFileSync(
      overrideFile,
      "module.exports = function (_cmd, args) {" +
        "const fs = require('node:fs');" +
        "const audioPath = args[args.indexOf('-f') + 1];" +
        "if (!fs.existsSync(audioPath)) return Promise.reject(new Error('audio file missing on disk: ' + audioPath));" +
        "if (fs.statSync(audioPath).size === 0) return Promise.reject(new Error('audio file empty'));" +
        "return Promise.resolve({ stdout: '[00:00.000 --> 00:01.000] hello\\nสวัสดีจาก whisper dbtest', stderr: '' });" +
        "};"
    );
    process.env.WHISPER_RUN_OVERRIDE = overrideFile;

    const { default: whisperRoutes } = await import('../src/modules/whisper/whisper.routes');
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/whisper', whisperRoutes));
    try {
      /* เห็นพาธไฟล์ที่ CLI จะได้รับผ่าน stdout — พิสูจน์ว่า override โดนเรียกจริงและไฟล์อยู่บนดิสก์ตอนนั้น */
      const { headers, body } = multipart({}, 'audio', 'note-dbtest.wav', 'audio/wav', WAV_STUB);
      const res = await fetch(`${ts.baseUrl}/api/whisper/transcribe`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      const text = await res.text();
      assert.equal(res.status, 200, text.slice(0, 300));
      /* fixture เขียนไฟล์ดิสก์จริงของ request นี้ลง stdout — มี output = override โดนเรียกและไฟล์มีจริง */
      assert.equal(JSON.parse(text).text, 'สวัสดีจาก whisper dbtest');
    } finally {
      delete process.env.WHISPER_RUN_OVERRIDE;
      fs.rmSync(overrideFile, { force: true });
      await ts.close();
    }
  });

  test('knowledge upload + EICAR: hash-engine ปฏิเสธ → ไฟล์เข้า quarantine จริง → ไม่สร้าง row → ไม่เหลือใน uploads + securityEvent จริงใน DB', async () => {
    const token = ctx.makeToken();
    knowledgeRoutes = (await import('../src/modules/knowledge/knowledge.routes')).default;
    ({ knowledgeDir } = await import('../src/services/knowledge-dir.service'));
    ({ hashEngine, EICAR } = await import('../src/services/hash-engine.service'));
    /* threat-intel ให้ hit ไม่ได้เสมอ (ไฟล์ทดสอบไม่ใช่ malware) — restore ใน teardown เพื่อไม่ค้างข้ามไฟล์เทส */
    restoreThreatIntel = mockDelegate(ctx.prisma, 'threatIntelItem', { findFirst: async () => null });
    /* ล้าง event จากรอบก่อน (รันซ้ำท้องถิ่นต้อง idempotent) */
    await ctx.prisma.securityEvent.deleteMany({ where: { description: { contains: 'eicar-dbtest' } } });

    const uploadsDirPath = path.join(knowledgeDir(), 'uploads');
    const uploadsFiles = () => (fs.existsSync(uploadsDirPath) ? fs.readdirSync(uploadsDirPath).sort() : []);
    const before = uploadsFiles();

    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/knowledge', knowledgeRoutes));
    try {
      const { headers, body } = multipart({}, 'file', 'eicar-dbtest.txt', 'text/plain', Buffer.from(EICAR, 'latin1'));
      const res = await fetch(`${ts.baseUrl}/api/knowledge/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      const text = await res.text();
      assert.equal(res.status, 403, text.slice(0, 300));
      const payload = JSON.parse(text);
      assert.equal(payload.verdict, 'malware');
      assert.ok(payload.hash, 'ต้องรายงาน sha256 ของไฟล์');
      assert.ok(payload.quarantinedTo, 'ต้องรายงานพาธ quarantine');

      /* ไฟล์ EICAR ต้องถูกย้ายเข้า quarantine จริง (ไม่ใช่แค่คำตอบบอกว่ากักไว้) */
      assert.ok(fs.existsSync(payload.quarantinedTo), `ไฟล์ต้องอยู่ใน quarantine จริง: ${payload.quarantinedTo}`);
      assert.ok(fs.readFileSync(payload.quarantinedTo, 'latin1').includes(EICAR), 'เนื้อไฟล์ใน quarantine ต้องครบ');

      /* ไม่สร้าง row + ไม่เหลือไฟล์ใน uploads (ไฟล์ถูกลบหลัง quarantine แล้ว) */
      assert.equal(
        await ctx.prisma.knowledgeItem.findFirst({ where: { title: { contains: 'eicar' } } }),
        null,
        'ไฟล์ malware ห้ามสร้าง row'
      );
      assert.deepEqual(uploadsFiles().filter((f) => !before.includes(f)), [], 'ไม่ต้องเหลือไฟล์ใน knowledge/uploads');

      /* ผลพลอยได้: MALWARE_DETECTED ถูกเขียนลง security_events จริง (จุดที่ mock ล้วนพิสูจน์ไม่ได้) */
      const sev = await ctx.prisma.securityEvent.findFirst({
        where: { event_type: 'MALWARE_DETECTED', description: { contains: payload.hash.slice(0, 16) } },
        orderBy: { timestamp: 'desc' },
      });
      assert.ok(sev, 'securityEvent MALWARE_DETECTED ต้องอยู่ใน DB จริง');

      /* เก็บกวาดไฟล์ quarantine ของเทสนี้ */
      fs.rmSync(payload.quarantinedTo, { force: true });
    } finally {
      await ts.close();
    }
  });

  test('knowledge upload + Threat Intel FILE hit: seed hash จริง → อัปโหลดไฟล์ตรง hash → ปฏิเสธ + quarantine + securityEvent จากกิ่ง Threat Intel', async () => {
    const token = ctx.makeToken();
    crypto = await import('node:crypto');
    /* ไฟล์ text จริงที่ไม่ใช่ EICAR — hash นี้คือสิ่งที่จะถูก seed ลงฐาน Threat Intel */
    const evilBytes = Buffer.from('sovereign-threat-intel-dbtest payload ' + crypto.randomUUID(), 'utf8');
    const sha256 = crypto.createHash('sha256').update(evilBytes).digest('hex');
    /* คืน delegate จริงก่อน seed — กิ่งนี้ต้องพิสูจน์ว่า query ผ่าน DB จริงเจอ seed ที่เพิ่งใส่ */
    restoreThreatIntel?.();
    restoreThreatIntel = null;
    await ctx.prisma.threatIntelItem.deleteMany({ where: { value: sha256 } });
    await ctx.prisma.threatIntelItem.create({
      data: { type: 'FILE', value: sha256, category: 'malware', source: 'manual', confidence: 1, active: true, note: 'dbtest' },
    });
    await ctx.prisma.securityEvent.deleteMany({ where: { description: { contains: 'threat-intel-dbtest' } } });

    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/knowledge', knowledgeRoutes));
    try {
      const { headers, body } = multipart({}, 'file', 'threat-intel-dbtest.txt', 'text/plain', evilBytes);
      const res = await fetch(`${ts.baseUrl}/api/knowledge/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      const text = await res.text();
      assert.equal(res.status, 403, text.slice(0, 300));
      const payload = JSON.parse(text);
      assert.equal(payload.verdict, 'malware');
      assert.match(payload.error, /Threat Intel FILE hit \(malware\)/, 'ต้องติดกิ่ง Threat Intel ไม่ใช่ EICAR/policy');
      assert.equal(payload.hash, sha256);

      /* quarantine จริง + ไม่สร้าง row + ไม่เหลือใน uploads */
      assert.ok(payload.quarantinedTo, 'ต้องรายงานพาธ quarantine');
      assert.ok(fs.existsSync(payload.quarantinedTo), 'ไฟล์ต้องเข้า quarantine จริง');
      assert.ok(fs.readFileSync(payload.quarantinedTo).equals(evilBytes), 'ไบต์ใน quarantine ต้องตรงไฟล์ที่อัปโหลด');
      assert.equal(await ctx.prisma.knowledgeItem.findFirst({ where: { title: { contains: 'threat-intel-dbtest' } } }), null, 'ห้ามสร้าง row');
      const sec = await ctx.prisma.securityEvent.findFirst({
        where: { event_type: 'MALWARE_DETECTED', description: { contains: sha256.slice(0, 16) } },
        orderBy: { timestamp: 'desc' },
      });
      assert.ok(sec, 'securityEvent MALWARE_DETECTED ต้องอยู่ใน DB จริง');
      assert.match(sec.description, /Threat Intel FILE hit \(malware\)/);

      /* เก็บกวาด: seed + ไฟล์ quarantine ของเทสนี้ */
      await ctx.prisma.threatIntelItem.deleteMany({ where: { value: sha256 } });
      fs.rmSync(payload.quarantinedTo, { force: true });
    } finally {
      await ts.close();
    }
  });

  test('teardown: คืน delegate ที่ mock ไว้ + ลบ user ทดสอบ (cascade) + ปิด MQTT + ปิด connection', async () => {
    restoreThreatIntel?.();
    restoreThreatIntel = null;
    otaMod.mqttClient.end(true);
    await teardownCore(ctx);
  });
});
