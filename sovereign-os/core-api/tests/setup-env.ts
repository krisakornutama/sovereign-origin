import os from 'os';
import path from 'path';

// ⚠️ ต้อง import ไฟล์นี้เป็นอันดับแรกในทุก test file
// เพราะ config/index.ts จะ throw ถ้าไม่มี JWT_SECRET / DATABASE_URL
process.env.JWT_SECRET = 'test-secret-0123456789abcdef';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
process.env.MQTT_HOST = '127.0.0.1';
process.env.MQTT_PORT = '1883';
process.env.PORT = '3999';
process.env.OTA_BASE_URL = 'http://127.0.0.1:3999';
// Telegram — test จะ mock axios ไม่ได้ส่งจริง
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.TELEGRAM_CHAT_ID = '12345';
// โฟลเดอร์ชั่วคราวสำหรับ OTA upload test (ไม่แตะของจริง)
process.env.OTA_DIR = path.join(os.tmpdir(), 'sovereign-ota-test');

// ── กัน flake ที่ราก (2026-09-18) ──────────────────────────────────────────
// อาการ: ชุด mock ล้มสุ่มทั้งไฟล์ (telegram/firstResponder/ota/mesh-lite/businessPlatform)
// ด้วย "Unable to deserialize cloned data" ระดับ IPC ของ test runner
// ต้นเหตุ: โค้ดที่เรียก Prisma โดยไม่มีใคร stub (เช่น sendTelegramAlert แบบ fire-and-forget
// ของ mesh → getTelegramCredentials → systemSetting.findMany) ปลุก Prisma engine จริง
// ให้วิ่งหา 127.0.0.1:5432 ปลอม แล้ว engine (native worker) รบกวน pipe ของ runner จน report เสีย
// ทางแก้: ในชุด mock (RUN_DB_TESTS !== '1') ผูก delegate no-op "ตารางว่าง" ให้ทุกโมเดล
// — เติมเฉพาะเมธอดที่ยังไม่มีใคร stub เท่านั้น (ไม่ทับ stub เฉพาะของแต่ละเทส)
// — ชุด real-DB (RUN_DB_TESTS=1) ไม่ถูกแตะแม้แต่บรรทัดเดียว
if (process.env.RUN_DB_TESTS !== '1') {
  void (async () => {
    const [{ prisma }, { Prisma }] = await Promise.all([
      import('../src/lib/prisma'),
      import('@prisma/client'),
    ]);
    const p = prisma as any;
    const noopDefaults: Record<string, (args?: any) => unknown> = {
      findUnique: async () => null,
      findUniqueOrThrow: async () => {
        throw new Error('mock suite: record not found (no-op delegate)');
      },
      findFirst: async () => null,
      findFirstOrThrow: async () => {
        throw new Error('mock suite: record not found (no-op delegate)');
      },
      findMany: async () => [],
      count: async () => 0,
      aggregate: async () => ({}),
      groupBy: async () => [],
      create: async (args?: any) => ({ id: 1, ...(args?.data ?? {}) }),
      createMany: async (args?: any) => ({ count: Array.isArray(args?.data) ? args.data.length : 1 }),
      update: async (args?: any) => ({ id: 1, ...(args?.data ?? {}) }),
      updateMany: async () => ({ count: 0 }),
      upsert: async (args?: any) => ({ id: 1, ...(args?.create ?? {}), ...(args?.update ?? {}) }),
      delete: async () => null,
      deleteMany: async () => ({ count: 0 }),
    };
    for (const model of Prisma.dmmf.datamodel.models) {
      const delegate = (p[model.name] ??= {});
      for (const [m, fn] of Object.entries(noopDefaults)) {
        if (typeof delegate[m] !== 'function') delegate[m] = fn;
      }
    }
  })();
}
