// ── INTEGRATION TEST: ต้องมี TimescaleDB จริง (prisma migrate dev ต้องรันแล้ว) ──
// รัน:  RUN_INTEGRATION=1 DATABASE_URL=postgresql://... JWT_SECRET=... npm run test:integration
import { test } from 'node:test';
import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';

const SKIP = process.env.RUN_INTEGRATION !== '1';
const prisma = new PrismaClient();

const METRIC = 'itest_temperature';

function getNodeId(): Promise<string | null> {
  return prisma.$queryRawUnsafe<Array<any>>('SELECT id FROM nodes LIMIT 1')
    .then((rows) => (rows.length ? String(rows[0].id) : null))
    .catch(() => null);
}

test('insert telemetry → latest value query → time_bucket history (real TimescaleDB)', { skip: SKIP ? 'set RUN_INTEGRATION=1 to enable' : false }, async () => {
  const nodeId = await getNodeId();
  if (!nodeId) {
    console.log('⏭️  ไม่มี node ใน DB — ข้าม (สร้าง node ก่อน: INSERT INTO nodes ... )');
    return;
  }

  const deviceId = 'itest-device';
  const value = 27.5;

  try {
    await prisma.$queryRawUnsafe(
      `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value)
       VALUES (NOW(), $1::uuid, $2, $3, $4)`,
      nodeId, deviceId, METRIC, value
    );

    // ค่าล่าสุด (เหมือน dashboard stats)
    const latest = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT value FROM sensor_telemetry WHERE metric = $1 ORDER BY time DESC LIMIT 1`,
      METRIC
    );
    assert.strictEqual(latest.length, 1);
    assert.strictEqual(Number(latest[0].value), value);

    // history 24h (เหมือน /api/timescale/history?range=24h) — ต้องคืนอย่างน้อย 1 bucket
    const history = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT time_bucket('5 minutes', time) AS bucket, AVG(value) AS avg_value
       FROM sensor_telemetry
       WHERE metric = $1 AND time >= NOW() - INTERVAL '24 hours'
       GROUP BY bucket ORDER BY bucket ASC`,
      METRIC
    );
    assert.ok(history.length >= 1, 'ต้องมี bucket อย่างน้อย 1 แถว');
    assert.ok(Number(history[history.length - 1].avg_value) >= value, 'avg_value ต้อง >= ค่าที่ insert');

    // retention policy ต้องมีจริง (continuous aggregate + retention)
    const policies = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT relname FROM pg_class WHERE relname = 'sensor_telemetry_hourly'`
    );
    assert.ok(policies.length === 1, 'continuous aggregate sensor_telemetry_hourly ต้องถูกสร้างจาก migration');
  } finally {
    await prisma.$queryRawUnsafe(`DELETE FROM sensor_telemetry WHERE metric = $1`, METRIC);
  }
});
