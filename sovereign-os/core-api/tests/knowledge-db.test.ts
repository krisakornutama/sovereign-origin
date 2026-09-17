import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RUN_DB, SKIP_REASON, primeDbEnv, setupCore, teardownCore, multipart, type CoreCtx } from './db-harness';

/* knowledge upload — lifecycle จริงบน Postgres (ส่วนเสริมของ harden-upload-routes.test.ts, ใช้ harness กลาง)
   ปกติชุด route-level ใช้ mockModel ครอบ prisma — ไฟล์นี้ปล่อย knowledgeItem เป็น DB จริงทั้งวงจร:
     upload → row อยู่ใน Postgres จริง + ไฟล์อยู่บนดิสก์ → GET /uploads/:file เสิร์ฟได้
     → DELETE /items/:id → row หายจาก DB **และ** ไฟล์หายจากดิสก์ (จุดที่ mock พิสูจน์ไม่ได้)
   Gated: รันเมื่อ RUN_DB_TESTS=1 และมี TEST_DATABASE_URL เท่านั้น (CI: job test-db ใน core-api-tests.yml)
   ไฟล์นี้ตั้ง TEST_DATABASE_URL ก่อน import แช่น prisma — ต้องอยู่บรรทัดแรกสุดของเทส */

describe('knowledge upload — real Postgres lifecycle', { skip: RUN_DB ? false : SKIP_REASON }, () => {
  primeDbEnv();

  let ctx: CoreCtx;
  let knowledgeRoutes: import('express').Router;
  let knowledgeDir: () => string;
  let hashEngine: any;

  test('setup: เชื่อม DB จริง + อัปสคีมา + mock เฉพาะ threat-intel (สแกน AV ผ่าน)', async () => {
    ctx = await setupCore();
    knowledgeRoutes = (await import('../src/modules/knowledge/knowledge.routes')).default;
    ({ knowledgeDir } = await import('../src/services/knowledge-dir.service'));
    ({ hashEngine } = await import('../src/services/hash-engine.service'));
    /* threat-intel ให้ hit ไม่ได้เสมอ (ไฟล์ทดสอบไม่ใช่ malware) — ชั้นอื่นของ AV เป็นของจริง */
    ctx.prisma.threatIntelItem = { findFirst: async () => null };
  });

  test('upload → row จริงใน Postgres + ไฟล์จริงบนดิสก์ → serve ได้ → DELETE ลบทั้ง DB และดิสก์', async () => {
    const token = ctx.makeToken();
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/knowledge', knowledgeRoutes));
    try {
      /* 1) POST /upload — multipart จริง */
      const { headers, body } = multipart({}, 'file', 'hello-db.txt', 'text/plain', Buffer.from('ข้อความจากเทส real-db', 'utf8'));
      const up = await fetch(`${ts.baseUrl}/api/knowledge/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
      /* อ่าน body ครั้งเดียว — (บั๊กแรก: ใส่ await up.text() ใน assert message แล้ว json() พัง body already read) */
      const upText = await up.text();
      assert.equal(up.status, 201, upText.slice(0, 200));
      const item = JSON.parse(upText).item;

      /* 2) row อยู่ใน Postgres จริง (query ตรง ๆ — ไม่ผ่านตัวที่ handler ใช้) */
      const row = await ctx.prisma.knowledgeItem.findUnique({ where: { id: item.id } });
      assert.ok(row, 'row ต้องอยู่ใน DB จริง');
      assert.equal(row.type, 'TXT');
      assert.equal(row.title, 'hello db');
      /* สัญญา POSIX — บั๊กเดิม: path.join บน Windows ให้ backslash แล้ว DELETE ลบไฟล์ไม่ได้ */
      assert.match(row.file_path, /^uploads\/\d+-[0-9a-f-]{36}\.txt$/);

      /* 3) ไฟล์อยู่บนดิสก์จริงตาม file_path ที่เก็บ — ใช้ resolver ตัวเดียวกับแอป (ห้ามเดา flat/nested เอง) */
      const onDisk = path.join(knowledgeDir(), row.file_path);
      assert.ok(fs.existsSync(onDisk), `ไฟล์ต้องอยู่ที่ ${onDisk}`);
      assert.equal(fs.readFileSync(onDisk, 'utf8'), 'ข้อความจากเทส real-db');

      /* 4) GET /uploads/:file เสิร์ฟไฟล์จริงกลับมา */
      const served = await fetch(`${ts.baseUrl}/api/knowledge/${row.file_path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(served.status, 200);
      assert.equal(await served.text(), 'ข้อความจากเทส real-db');

      /* 5) DELETE → row หายจาก DB และไฟล์หายจากดิสก์ (วงจรปิดจริง) */
      const del = await fetch(`${ts.baseUrl}/api/knowledge/items/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(del.status, 200);
      assert.equal(await ctx.prisma.knowledgeItem.findUnique({ where: { id: item.id } }), null, 'row ต้องหายจาก DB');
      assert.equal(fs.existsSync(onDisk), false, 'ไฟล์ต้องถูกลบจากดิสก์ด้วย');
    } finally {
      await ts.close();
    }
  });

  test('teardown: ลบ user ทดสอบ + ปิด connection', async () => {
    await teardownCore(ctx);
  });
});
