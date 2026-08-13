import './setup-env';
import { test, mock } from 'node:test';
import assert from 'node:assert';
import {
  encodePng,
  drawTrendPng,
  drawMultiTrendPng,
  buildSnapshotForAlert,
  buildTrendPng,
  buildReportPng,
  prisma,
} from '../src/services/chart-snapshot.service';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('encodePng produces a valid PNG with correct IHDR dimensions', () => {
  const W = 320;
  const H = 120;
  const rgb = Buffer.alloc(W * H * 3, 0x10); // สีทึบ
  const png = encodePng(W, H, rgb);

  // signature
  assert.ok(png.subarray(0, 8).equals(PNG_SIG), 'PNG signature ต้องถูกต้อง');
  // IHDR chunk: length 13 + type 'IHDR' + width/height (BE)
  assert.strictEqual(png.readUInt32BE(8), 13);
  assert.strictEqual(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.strictEqual(png.readUInt32BE(16), W);
  assert.strictEqual(png.readUInt32BE(20), H);
  // จบด้วย IEND
  assert.strictEqual(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});

test('drawTrendPng renders a chart for multiple points', () => {
  const points = Array.from({ length: 20 }, (_, i) => ({
    time: Date.now() - (19 - i) * 60000,
    value: 20 + Math.sin(i / 2) * 5,
  }));
  const png = drawTrendPng(points, 320, 160);
  assert.ok(png.subarray(0, 8).equals(PNG_SIG));
  assert.ok(png.length > 1000, 'PNG ต้องมีข้อมูลจริง (IDAT)');
});

test('drawTrendPng handles flat data (min === max) without NaN', () => {
  const points = [
    { time: 1, value: 10 },
    { time: 2, value: 10 },
    { time: 3, value: 10 },
  ];
  const png = drawTrendPng(points);
  assert.ok(png.subarray(0, 8).equals(PNG_SIG));
});

test('buildSnapshotForAlert returns null when there is insufficient data', async () => {
  mock.method(prisma, '$queryRawUnsafe', async () => []);
  const result = await buildSnapshotForAlert({ metric: 'temperature' });
  assert.strictEqual(result, null);
});

test('buildSnapshotForAlert returns a PNG buffer when telemetry exists', async () => {
  mock.method(prisma, '$queryRawUnsafe', async () => {
    const now = Date.now();
    return Array.from({ length: 12 }, (_, i) => ({
      bucket: new Date(now - (11 - i) * 600000).toISOString(),
      avg_value: 30 + i,
    }));
  });
  const result = await buildSnapshotForAlert({ metric: 'temperature' });
  assert.ok(Buffer.isBuffer(result), 'ต้องได้ Buffer');
  assert.ok(result!.subarray(0, 8).equals(PNG_SIG));
});

test('buildSnapshotForAlert survives DB errors (returns null)', async () => {
  mock.method(prisma, '$queryRawUnsafe', async () => {
    throw new Error('timescale down');
  });
  const result = await buildSnapshotForAlert({ metric: 'humidity' });
  assert.strictEqual(result, null);
});

test('buildTrendPng respects requested hours and bucket size in query', async () => {
  let captured: string | null = null;
  mock.method(prisma, '$queryRawUnsafe', async (query: string) => {
    captured = query;
    const now = Date.now();
    return Array.from({ length: 5 }, (_, i) => ({
      bucket: new Date(now - (4 - i) * 3600000).toISOString(),
      avg_value: 40 + i,
    }));
  });
  const png = await buildTrendPng('power_kw', 24 * 7, 60);
  assert.ok(Buffer.isBuffer(png));
  assert.ok(captured!.includes("'60 minutes'"), 'bucket ขนาด 60 นาที');
  assert.ok(captured!.includes("'168 hours'"), 'ช่วง 7 วัน (168 ชม.)');
});

test('buildTrendPng returns null when metric has no data', async () => {
  mock.method(prisma, '$queryRawUnsafe', async () => []);
  const result = await buildTrendPng('nonexistent_metric', 24, 10);
  assert.strictEqual(result, null);
});

test('drawMultiTrendPng draws multiple series into one valid PNG', () => {
  const mkPoints = (base: number) =>
    Array.from({ length: 15 }, (_, i) => ({ time: i * 60000, value: base + Math.sin(i / 2) * 3 }));
  const png = drawMultiTrendPng([
    { label: 'temperature', points: mkPoints(28) },
    { label: 'battery_soc', points: mkPoints(80) },
    { label: 'power_kw', points: mkPoints(0.4) },
  ]);
  assert.ok(png.subarray(0, 8).equals(PNG_SIG));
  assert.ok(png.length > 1500, 'มีข้อมูล + legend text จริง');
});

test('drawMultiTrendPng handles empty series list (blank PNG, no crash)', () => {
  const png = drawMultiTrendPng([]);
  assert.ok(png.subarray(0, 8).equals(PNG_SIG));
});

test('drawMultiTrendPng handles flat series (min === max) without NaN', () => {
  const flat = { label: 'humidity', points: [{ time: 1, value: 50 }, { time: 2, value: 50 }, { time: 3, value: 50 }] };
  const png = drawMultiTrendPng([flat]);
  assert.ok(png.subarray(0, 8).equals(PNG_SIG));
});

test('buildReportPng queries all metrics at once and groups by metric', async () => {
  let captured: string | null = null;
  mock.method(prisma, '$queryRawUnsafe', async (query: string) => {
    captured = query;
    const now = Date.now();
    const rows: any[] = [];
    for (const m of ['temperature', 'battery_soc']) {
      for (let i = 0; i < 6; i++) {
        rows.push({ metric: m, bucket: new Date(now - (5 - i) * 600000).toISOString(), avg_value: 25 + i });
      }
    }
    return rows;
  });

  const png = await buildReportPng(['temperature', 'battery_soc', 'power_kw'], 24, 10);
  assert.ok(Buffer.isBuffer(png), 'มี 2 metric ที่มีข้อมูล → ได้ PNG');
  assert.ok(captured!.includes('ANY($1::text[])'), 'query ใช้ array param เดียว');
  assert.ok(captured!.includes('GROUP BY metric, bucket'), 'group ต่อ metric + bucket');
});

test('buildReportPng returns null when no metric has enough data', async () => {
  mock.method(prisma, '$queryRawUnsafe', async () => []);
  const result = await buildReportPng(['temperature', 'humidity'], 24, 10);
  assert.strictEqual(result, null);
});
