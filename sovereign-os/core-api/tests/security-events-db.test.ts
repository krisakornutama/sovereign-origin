import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { RUN_DB, SKIP_REASON, primeDbEnv, setupCore, teardownCore, type CoreCtx } from './db-harness';

/* security_events — สัญญารวมบน Postgres จริง (จุดเขียนกระจาย 16 จุดจาก 15 ไฟล์ — ไฟล์นี้พินสัญญากลาง):
     รูปร่างทุกแถว: event_type = UPPER_SNAKE, severity ∈ info|warning|critical,
                    description เป็นข้อความ, raw_data = object หรือ null
   สองเส้นทางจริงที่พินผ่าน route/service ตัวเต็ม:
     - INTRUSION        ← POST /api/property/points/:id/trigger (จุดเดียวของระบบที่เขียน INTRUSION)
     - MALWARE_DETECTED ← hash-engine (quarantine จริง) ผ่าน knowledge upload
   Gated: RUN_DB_TESTS=1 + TEST_DATABASE_URL (CI: job test-db) */
describe('security_events contract — real Postgres lifecycle', { skip: RUN_DB ? false : SKIP_REASON }, () => {
  primeDbEnv();

  let ctx: CoreCtx;
  const shaOf = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

  test('setup: เชื่อม DB จริง (ไม่ mock prisma — EICAR ถูกตรวจก่อนกิ่ง Threat Intel จึงใช้ DB จริงได้ทั้งสาย)', async () => {
    ctx = await setupCore();
    await ctx.prisma.securityEvent.deleteMany({});
    await ctx.prisma.strategicPoint.deleteMany({});
  });

  test('INTRUSION: property trigger → row จริง (event_type/severity/raw_data ตามสัญญา) + last_triggered_at อัปเดต', async () => {
    const propertyRoutes = (await import('../src/modules/property/property.routes')).default;
    const token = ctx.makeToken('SUPERADMIN', { userId: ctx.userId });
    const point = await ctx.prisma.strategicPoint.create({
      data: { name: 'dbtest-gate', type: 'เซ็นเซอร์ตรวจจับ', x: 10, y: 20, radius_m: 5, enabled: true },
    });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/property', propertyRoutes));
    try {
      /* trigger จะพยายามแจ้ง Telegram — ใน real-DB harness token ถูกลบ → ตอบ false แบบเงียบ (ไม่ยิง network) */
      const res = await fetch(`${ts.baseUrl}/api/property/points/${point.id}/trigger`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ subject: 'คนแปลกหน้า dbtest' }),
      });
      const text = await res.text();
      assert.equal(res.status, 200, text.slice(0, 300));

      const ev = await ctx.prisma.securityEvent.findFirst({ where: { event_type: 'INTRUSION' }, orderBy: { timestamp: 'desc' } });
      assert.ok(ev, 'INTRUSION ต้องอยู่ใน security_events จริง');
      assert.equal(ev.severity, 'warning');
      assert.match(ev.description, /dbtest-gate/);
      assert.match(ev.description, /คนแปลกหน้า dbtest/);
      assert.ok(ev.raw_data && typeof ev.raw_data === 'object', 'raw_data ต้องเป็น object');
      assert.equal(ev.raw_data.point_id, point.id);

      const after = await ctx.prisma.strategicPoint.findUnique({ where: { id: point.id } });
      assert.ok(after?.last_triggered_at, 'last_triggered_at ต้องถูกอัปเดต');
    } finally {
      await ts.close();
    }
  });

  test('MALWARE_DETECTED: hash-engine (quarantine จริง) → row จริง severity=critical + raw_data ครบ hash/mime/quarantinedTo', async () => {
    const knowledgeRoutes = (await import('../src/modules/knowledge/knowledge.routes')).default;
    const hashEngineMod = await import('../src/services/hash-engine.service');
    const token = ctx.makeToken();
    const bytes = Buffer.concat([Buffer.from('x'.repeat(10), 'utf8'), Buffer.from(hashEngineMod.EICAR, 'latin1')]);
    const sha = shaOf(bytes);
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/knowledge', knowledgeRoutes));
    try {
      const boundary = '----secdb' + Date.now();
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sec-dbtest.txt"\r\nContent-Type: text/plain\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const res = await fetch(`${ts.baseUrl}/api/knowledge/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
      assert.equal(res.status, 403, (await res.text()).slice(0, 200));

      const ev = await ctx.prisma.securityEvent.findFirst({ where: { event_type: 'MALWARE_DETECTED' }, orderBy: { timestamp: 'desc' } });
      assert.ok(ev, 'MALWARE_DETECTED ต้องอยู่ใน security_events จริง');
      assert.equal(ev.severity, 'critical');
      assert.match(ev.description, new RegExp(sha.slice(0, 16)));
      assert.equal(ev.raw_data?.hash, sha);
      assert.ok(ev.raw_data?.quarantinedTo, 'raw_data ต้องมี quarantinedTo');
      assert.ok(fs.existsSync(ev.raw_data.quarantinedTo), 'ไฟล์ต้องเข้า quarantine จริง');
      fs.rmSync(ev.raw_data.quarantinedTo, { force: true });
    } finally {
      await ts.close();
    }
  });

  test('vocabulary ทั้งฐาน: event_type เป็น UPPER_SNAKE + severity อยู่ใน info|warning|critical (ทุกแถวที่ชุดเทสสร้าง)', async () => {
    const rows = await ctx.prisma.securityEvent.findMany({ orderBy: { timestamp: 'asc' } });
    assert.ok(rows.length >= 2, `ต้องมีอย่างน้อย 2 rows จากสองเส้นทาง (ได้ ${rows.length})`);
    for (const r of rows) {
      assert.match(r.event_type, /^[A-Z][A-Z0-9_]*$/, `event_type ต้องเป็น UPPER_SNAKE: ${r.event_type}`);
      assert.ok(['info', 'warning', 'critical'].includes(r.severity), `severity ต้องอยู่ใน info|warning|critical: ${r.severity}`);
      assert.ok(typeof r.description === 'string' && r.description.length > 0, 'description ต้องเป็นข้อความ');
      assert.ok(r.raw_data === null || (typeof r.raw_data === 'object' && !Array.isArray(r.raw_data)), 'raw_data = object|null');
    }
    const types = new Set(rows.map((r) => r.event_type));
    assert.ok(types.has('INTRUSION'), 'ต้องมี INTRUSION จากเส้นทาง property');
    assert.ok(types.has('MALWARE_DETECTED'), 'ต้องมี MALWARE_DETECTED จากเส้นทาง hash-engine');
  });

  test('teardown: ลบ user ทดสอบ + ปิด connection', async () => {
    await teardownCore(ctx);
  });
});
