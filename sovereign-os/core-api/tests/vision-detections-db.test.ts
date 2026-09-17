import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RUN_DB, SKIP_REASON, primeDbEnv, setupCore, teardownCore, PNG_1X1, type CoreCtx } from './db-harness';

/* POST /api/infrastructure/detections — real-Postgres lifecycle (ของจริงทุกชั้น ไม่มี mock prisma):
   สร้าง Camera จริง → POST /detections (image_path แบบ backslash) → row จริงใน detection_events
   ที่ normalize เป็น POSIX → camera.last_event_at อัปเดตจริง → vision-rule (worker ตัวจริง)
   อ่าน image_path ล่าสุดจาก DB แล้ว "เปิดไฟล์จริงจากดิสก์" มาเป็น data URI
   (หัวใจของไฟล์นี้: mock เฉพาะ Ollama + Telegram ผ่าน DI ที่ service มีให้ — พิสูจน์ว่า
    พาธที่เก็บลง DB ใช้งานได้จริงตั้งแต่เขียนจนถึงผู้อ่านปลายทาง)
   Gated: RUN_DB_TESTS=1 + TEST_DATABASE_URL (CI: job test-db) */
describe('detections + vision-rule — real Postgres lifecycle', { skip: RUN_DB ? false : SKIP_REASON }, () => {
  primeDbEnv();

  let ctx: CoreCtx;
  let infrastructureRoutes: import('express').Router;
  const snapshotsDir = path.join(process.env.TEST_TMPDIR ?? '.', 'detection-snapshots');
  const posixDir = snapshotsDir.split(path.sep).join('/'); /* รูปร่างที่ handler ต้องเก็บลง DB (POSIX เสมอ) */
  const snapshotPath = path.join(snapshotsDir, 'person-2026-09-17.jpg');
  let ollamaCalls = 0;
  let telegramCalled = false;
  let restoreNotify: (() => void) | null = null;

  test('setup: เชื่อม DB จริง + ล้างข้อมูลเศษจากรอบก่อน', async () => {
    ctx = await setupCore();
    infrastructureRoutes = (await import('../src/modules/infrastructure/infrastructure.routes')).default;
    /* ล้างเฉพาะของชุดเทสนี้ (camera/detection ผูกกันด้วยชื่อ dbtest-) — รันซ้ำท้องถิ่น idempotent และไม่แตะข้อมูลอื่น */
    await ctx.prisma.detectionEvent.deleteMany({ where: { camera: { name: { startsWith: 'dbtest-' } } } });
    await ctx.prisma.camera.deleteMany({ where: { name: { startsWith: 'dbtest-' } } });
    await ctx.prisma.visionAlert.deleteMany({});
    await ctx.prisma.visionRule.deleteMany({ where: { id: 1 } });
    fs.rmSync(snapshotsDir, { recursive: true, force: true });
    fs.mkdirSync(snapshotsDir, { recursive: true });
    /* ภาพ snapshot จริงบนดิสก์ — ตัวที่จะถูก "เปิด" ผ่านพาธที่เก็บใน DB */
    fs.writeFileSync(snapshotPath, PNG_1X1);
  });

  test('สร้าง Camera จริง → POST /detections → row จริง + image_path POSIX + last_event_at อัปเดต', async () => {
    const token = ctx.makeToken();
    const cam = await ctx.prisma.camera.create({ data: { name: 'dbtest-front-door', location: 'หน้าบ้าน' } });
    const ts = await ctx.createTestServer((app: import('express').Express) => app.use('/api/infrastructure', infrastructureRoutes));
    try {
      /* sender จริง (Frigate/YOLO บน Windows) ส่ง backslash มาได้ — handler ต้อง normalize */
      const res = await fetch(`${ts.baseUrl}/api/infrastructure/detections`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          camera_id: cam.id,
          object_type: 'person',
          confidence: 0.87,
          image_path: snapshotsDir + '\\person-2026-09-17.jpg',
        }),
      });
      const text = await res.text();
      assert.equal(res.status, 201, text.slice(0, 300));

      /* row จริงใน DB — image_path เป็น POSIX เสมอ (ผู้อ่านคือ vision-rule path.resolve) */
      const row = await ctx.prisma.detectionEvent.findFirst({ where: { camera_id: cam.id } });
      assert.ok(row, 'detection_event ต้องอยู่ใน DB จริง');
      assert.equal(row.object_type, 'person');
      assert.equal(row.image_path, posixDir + '/person-2026-09-17.jpg');
      assert.ok(!String(row.image_path).includes('\\'), 'ห้ามเหลือ backslash ใน DB');

      /* camera.last_event_at อัปเดตจริงตาม handler */
      const camAfter = await ctx.prisma.camera.findUnique({ where: { id: cam.id } });
      assert.ok(camAfter?.last_event_at, 'last_event_at ต้องถูกเขียน');

      /* object_type นอก whitelist → 400 กันขยะเข้าฐาน */
      const bad = await fetch(`${ts.baseUrl}/api/infrastructure/detections`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ camera_id: cam.id, object_type: 'ufo' }),
      });
      assert.equal(bad.status, 400);
    } finally {
      await ts.close();
    }
  });

  test('vision-rule (worker จริง) อ่าน image_path จาก DB → เปิดไฟล์จริงจากดิสก์ → VisionAlert จริงใน DB', async () => {
    /* DI ทางการของ vision-rule.service — Ollama จำลอง (ตอบ JSON คนแปลกหน้า 1 คน), Telegram จับว่าโดนเรียก */
    const vrs = await import('../src/services/vision-rule.service');
    vrs.setVisionOllama({
      post: async () => {
        ollamaCalls++;
        return { data: { response: '{"persons": 1, "familiar": [], "strangers": 1}' } };
      },
    });
    const origNotify = (vrs as any).visionNotify;
    vrs.setVisionNotify(async () => {
      telegramCalled = true;
    });
    restoreNotify = () => vrs.setVisionNotify(origNotify);

    /* กฎจริงใน DB — ตรวจทันทีทุกครั้ง + แจ้งเตือน */
    await ctx.prisma.visionRule.upsert({
      where: { id: 1 },
      update: { enabled: true, interval_min: 0, notify_telegram: true, only_strangers: true, last_check_at: null },
      create: { id: 1, enabled: true, interval_min: 0, notify_telegram: true, only_strangers: true, last_check_at: null },
    });
    /* ไม่มีใบหน้าลงทะเบียน → สายเข้า analyzeStranger (Ollama mock) — embed ไม่เกี่ยว */
    await ctx.prisma.knownFace.deleteMany({});

    const result = await vrs.runVisionCheck();
    assert.equal(result.alerted, true, `expected alert, got ${JSON.stringify(result)}`);
    assert.equal(result.persons, 1);
    assert.equal(ollamaCalls, 1, 'Ollama (mock) ต้องโดนเรียกเพื่อวิเคราะห์ภาพ');
    assert.equal(telegramCalled, true, 'notify_telegram=true → notify ต้องถูกเรียก (mock DI — ไม่ยิง network จริงเพราะ harness ลบ token แล้ว)');

    /* VisionAlert จริงใน DB — image_url เก็บ "พาธต้นทาง" (ค่า image_path จาก DB) ไม่ใช่ data URI:
       ไบต์ภาพเทียบกับไฟล์จริงบนดิสก์ตามพาธนั้น = พิสูจน์ว่าเส้นทาง DB → ดิสก์ใช้งานได้จริง */
    const alert = await ctx.prisma.visionAlert.findFirst({ orderBy: { created_at: 'desc' } });
    assert.ok(alert, 'vision_alert ต้องถูกเขียน');
    assert.equal(alert.kind, 'stranger');
    const expectedPosix = posixDir + '/person-2026-09-17.jpg';
    assert.equal(alert.image_url, expectedPosix, 'image_url ต้องเป็นพาธ POSIX ตามที่เก็บใน detection_events');
    assert.ok(fs.existsSync(path.resolve(expectedPosix)), 'พาธใน alert ต้องชี้ไฟล์จริงบนดิสก์');
    assert.ok(fs.readFileSync(path.resolve(expectedPosix)).equals(PNG_1X1), 'ไฟล์ตามพาธต้องเป็นภาพที่ POST ไว้จริง');

    /* กฎถูกอัปเดต last_check_at จริง (pacing ทำงาน) */
    const rule = await ctx.prisma.visionRule.findUnique({ where: { id: 1 } });
    assert.ok(rule?.last_check_at, 'last_check_at ต้องถูกอัปเดตหลังตรวจ');
  });

  test('teardown: คืน DI + ลบ user ทดสอบ + เก็บกวาด snapshot + ปิด connection', async () => {
    restoreNotify?.();
    restoreNotify = null;
    fs.rmSync(snapshotsDir, { recursive: true, force: true });
    await teardownCore(ctx);
  });
});
