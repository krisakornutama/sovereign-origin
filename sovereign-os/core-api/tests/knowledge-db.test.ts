import './setup-env';
/* knowledge upload — lifecycle จริงบน Postgres (ส่วนเสริมของ harden-upload-routes.test.ts)
   ปกติชุด route-level ใช้ mockModel ครอบ prisma — ไฟล์นี้ปล่อย knowledgeItem เป็น DB จริงทั้งวงจร:
     upload → row อยู่ใน Postgres จริง + ไฟล์อยู่บนดิสก์ → GET /uploads/:file เสิร์ฟได้
     → DELETE /items/:id → row หายจาก DB **และ** ไฟล์หายจากดิสก์ (จุดที่ mock พิสูจน์ไม่ได้)
   Gated: รันเมื่อ RUN_DB_TESTS=1 และมี TEST_DATABASE_URL เท่านั้น (CI: ubuntu job มี postgres service
   container แล้วอัปสคีมาด้วย prisma db push — ท้องถิ่น: ชี้ไปที่ DB ทดสอบแล้ว RUN_DB_TESTS=1 npm test)
   ไฟล์นี้ตั้ง TEST_DATABASE_URL ก่อน import แช่น prisma — ต้องอยู่บรรทัดแรกสุดของเทส */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RUN_DB = process.env.RUN_DB_TESTS === '1' && !!process.env.TEST_DATABASE_URL;

describe('knowledge upload — real Postgres lifecycle', { skip: RUN_DB ? false : 'ต้องการ RUN_DB_TESTS=1 + TEST_DATABASE_URL (CI ubuntu job)' }, () => {
  /* ตั้ง env ก่อน dynamic import ทุกชั้น app (prisma client สร้างจาก DATABASE_URL ตอน import แรก) */
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL as string;
  process.env.HASH_QUARANTINE_DIR = path.join(process.env.TEST_TMPDIR ?? '.', 'quarantine');

  let express: typeof import('express');
  let knowledgeRoutes: import('express').Router;
  let prisma: any;
  let makeToken: (role?: string, overrides?: Record<string, unknown>) => string;
  let createTestServer: (mount: (app: import('express').Express) => void) => Promise<any>;
  let hashEngine: any;

  test('setup: เชื่อม DB จริง + อัปสคีมา + mock เฉพาะ threat-intel (สแกน AV ผ่าน)', async () => {
    express = (await import('express')).default;
    ({ prisma } = await import('../src/lib/prisma'));
    ({ makeToken } = await import('./helpers'));
    ({ createTestServer } = await import('./helpers'));
    knowledgeRoutes = (await import('../src/modules/knowledge/knowledge.routes')).default;
    ({ hashEngine } = await import('../src/services/hash-engine.service'));
    /* threat-intel ให้ hit ไม่ได้เสมอ (ไฟล์ทดสอบไม่ใช่ malware) — ชั้นอื่นของ AV เป็นของจริง */
    prisma.threatIntelItem = { findFirst: async () => null };
    await prisma.$connect();
    await prisma.$executeRawUnsafe('SELECT 1');
  });

  test('upload → row จริงใน Postgres + ไฟล์จริงบนดิสก์ → serve ได้ → DELETE ลบทั้ง DB และดิสก์', async () => {
    const token = makeToken();
    const ts = await createTestServer((app: import('express').Express) => app.use('/api/knowledge', knowledgeRoutes));
    try {
      /* 1) POST /upload — multipart จริง */
      const boundary = '----dbtest' + Date.now();
      const bytes = Buffer.from('ข้อความจากเทส real-db', 'utf8');
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hello-db.txt"\r\nContent-Type: text/plain\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const up = await fetch(`${ts.baseUrl}/api/knowledge/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
        body: body,
      });
      /* อ่าน body ครั้งเดียว — (บั๊กแรก: ใส่ await up.text() ใน assert message แล้ว json() พัง body already read) */
      const upText = await up.text();
      assert.equal(up.status, 201, upText.slice(0, 200));
      const item = JSON.parse(upText).item;

      /* 2) row อยู่ใน Postgres จริง (query ตรง ๆ — ไม่ผ่านตัวที่ handler ใช้) */
      const row = await prisma.knowledgeItem.findUnique({ where: { id: item.id } });
      assert.ok(row, 'row ต้องอยู่ใน DB จริง');
      assert.equal(row.type, 'TXT');
      assert.equal(row.title, 'hello db');
      assert.match(row.file_path, /^uploads[\\/]\d+-[0-9a-f-]{36}\.txt$/);

      /* 3) ไฟล์อยู่บนดิสก์จริงตาม file_path ที่เก็บ */
      const KNOWLEDGE_DIR = path.resolve(path.dirname(row.file_path) === 'uploads' ? path.join(process.cwd(), 'knowledge') : path.join(process.cwd(), 'knowledge', 'knowledge'));
      const onDisk = path.join(KNOWLEDGE_DIR, row.file_path);
      assert.ok(fs.existsSync(onDisk), `ไฟล์ต้องอยู่ที่ ${onDisk}`);
      assert.equal(fs.readFileSync(onDisk, 'utf8'), 'ข้อความจากเทส real-db');

      /* 4) GET /uploads/:file เสิร์ฟไฟล์จริงกลับมา */
      const served = await fetch(`${ts.baseUrl}/api/knowledge/${row.file_path.replace(/\\/g, '/')}`, {
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
      assert.equal(await prisma.knowledgeItem.findUnique({ where: { id: item.id } }), null, 'row ต้องหายจาก DB');
      assert.equal(fs.existsSync(onDisk), false, 'ไฟล์ต้องถูกลบจากดิสก์ด้วย');
    } finally {
      await ts.close();
    }
  });

  test('teardown: ปิด connection', async () => {
    await prisma.$disconnect();
  });
});
