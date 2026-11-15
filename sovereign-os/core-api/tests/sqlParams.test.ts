// SQL ที่ประกอบสตริงเอง — วันนี้ค่าเป็นค่าคงที่ แต่ไม่มีอะไรกันค่าแปลกปลอมไหลเข้ามา
//
// `$queryRawUnsafe` สองจุดเคยต่อค่าเข้าสตริง SQL ตรง ๆ:
//   learning-engine: INTERVAL '${days} days'
//   wan-monitor:     '${deviceId}', '${metric}'
// ค่าเหล่านี้เคยมาจากค่าคงที่เท่านั้น แต่โค้ดไม่ได้บังคับ — ถ้าวันหนึ่งมีคนส่งค่าจาก
// request หรือข้อมูลที่ router รายงานเข้ามา (ชื่ออุปกรณ์/ชื่อ metric) จะกลายเป็น SQL
// injection ทันที · ทางแก้ที่ถูกคือให้ตัวขับ SQL ส่งค่าเป็น parameter (Prisma tagged
// template) แล้วเทสต์นี้ยึด "ค่าเดินทางไปกับ parameters ไม่ใช่ไปอยู่ในข้อความ SQL"
//
// เทสต์ตรวจที่ Prisma.Sql ที่สร้างจริง (ไม่ mock client, ไม่ต้องมี DB) เพื่อให้ผลคงที่
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { metricSeriesQuery } from '../src/services/learning-engine.service';
import { metricInsertQuery } from '../src/services/wan-monitor.service';

const SRC = path.resolve(__dirname, '../src/services');

function read(file: string): string {
  return readFileSync(path.join(SRC, file), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('metricSeriesQuery ส่ง metric กับจำนวนวันไปเป็น parameter', () => {
  const q = metricSeriesQuery('battery_soc', 30);
  assert.ok(!q.sql.includes('battery_soc'), `metric ต้องไม่อยู่ในข้อความ SQL: ${q.sql}`);
  assert.ok(!/\b30\b/.test(q.sql), `จำนวนวันต้องไม่อยู่ในข้อความ SQL: ${q.sql}`);
  assert.deepEqual(q.values, ['battery_soc', 30]);
  assert.ok(q.sql.includes('INTERVAL'), 'ยังต้องคูณ interval ตามจำนวนวัน');
});

test('metricSeriesQuery ทนค่า days ที่ไม่ใช่ค่าปกติ (ไม่เปลี่ยนรูป SQL)', () => {
  const q = metricSeriesQuery("x'; DROP TABLE sensor_telemetry; --", 7);
  assert.ok(!q.sql.includes('DROP TABLE'), `ค่าแปลกปลอมหลุดเข้า SQL: ${q.sql}`);
  assert.ok(q.values.includes("x'; DROP TABLE sensor_telemetry; --"));
});

test('metricInsertQuery ไม่ยอมให้ deviceId/metric เป็นส่วนหนึ่งของคำสั่ง SQL', () => {
  const evilDevice = "x'); DROP TABLE sensor_telemetry; --";
  const evilMetric = "metric', 1); DELETE FROM audit_logs; --";
  const q = metricInsertQuery(evilMetric, 42, evilDevice);
  assert.ok(!q.sql.includes('DROP TABLE'), `deviceId หลุดเข้า SQL: ${q.sql}`);
  assert.ok(!q.sql.includes('DELETE FROM audit_logs'), `metric หลุดเข้า SQL: ${q.sql}`);
  assert.ok(q.values.includes(evilDevice), 'deviceId ต้องไปกับ parameter');
  assert.ok(q.values.includes(evilMetric), 'metric ต้องไปกับ parameter');
  assert.ok(q.values.includes(42), 'ค่าตัวเลขต้องไปกับ parameter');
  assert.equal(q.values.length, 4, 'node_id + deviceId + metric + value เท่านั้น');
});

test('ไม่มีไฟล์ service ที่ยังใช้ $queryRawUnsafe กับค่าที่ต่อเข้าสตริง', () => {
  for (const file of ['learning-engine.service.ts', 'wan-monitor.service.ts']) {
    const src = read(file);
    assert.ok(!src.includes('$queryRawUnsafe'), `${file} ยังใช้ $queryRawUnsafe`);
    assert.ok(src.includes('$queryRaw('), `${file} ต้องใช้ $queryRaw แบบ parameter`);
  }
});
