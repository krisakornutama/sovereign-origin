import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer, mockModel, makeToken } from './helpers';
import {
  validateReading,
  checkReference,
  analyzeReadings,
} from '../src/services/health-readings.service';
import healthReadingsRoutes, { prisma } from '../src/modules/health/health-readings.routes';

// ────────────────────────────────────────────────
// validateReading
// ────────────────────────────────────────────────
describe('validateReading', () => {
  test('accepts valid values per type', () => {
    assert.equal(validateReading('WEIGHT', 70), null);
    assert.equal(validateReading('SUGAR', 120), null);
    assert.equal(validateReading('TEMP', 36.8), null);
    assert.equal(validateReading('BP', 120, 110, 80), null);
  });

  test('rejects out-of-range values (boundary)', () => {
    assert.match(validateReading('WEIGHT', 1) ?? '', /out of range/);
    assert.match(validateReading('WEIGHT', 500) ?? '', /out of range/);
    assert.equal(validateReading('WEIGHT', 2), null); // min inclusive
    assert.equal(validateReading('WEIGHT', 400), null); // max inclusive
    assert.match(validateReading('SUGAR', 900) ?? '', /out of range/);
    assert.match(validateReading('TEMP', 28) ?? '', /out of range/);
    assert.match(validateReading('TEMP', 46) ?? '', /out of range/);
  });

  test('rejects non-numeric value', () => {
    assert.match(validateReading('WEIGHT', 'abc') ?? '', /out of range/);
  });

  test('rejects unknown type', () => {
    assert.match(validateReading('HEIGHT' as any, 70) ?? '', /type must be one of/);
  });

  test('BP requires both systolic and diastolic', () => {
    assert.match(validateReading('BP', 120) ?? '', /requires systolic and diastolic/);
    assert.match(validateReading('BP', 140, 140, 150) ?? '', /diastolic must be lower than systolic/);
    assert.equal(validateReading('BP', 120, 120, 79), null);
    assert.match(validateReading('BP', 120, 120, 25) ?? '', /diastolic out of range/);
  });
});

// ────────────────────────────────────────────────
// checkReference
// ────────────────────────────────────────────────
describe('checkReference', () => {
  test('BP thresholds', () => {
    assert.equal(checkReference('BP', 150, 150, 95).level, 'warning');
    assert.equal(checkReference('BP', 185, 185, 120).level, 'critical');
    assert.equal(checkReference('BP', 120, 120, 80).level, 'ok');
    assert.equal(checkReference('BP', 85, 85, 55).level, 'low');
  });

  test('sugar thresholds', () => {
    assert.equal(checkReference('SUGAR', 300).level, 'critical');
    assert.equal(checkReference('SUGAR', 200).level, 'warning');
    assert.equal(checkReference('SUGAR', 60).level, 'low');
    assert.equal(checkReference('SUGAR', 50).level, 'critical');
    assert.equal(checkReference('SUGAR', 100).level, 'ok');
  });

  test('temperature thresholds', () => {
    assert.equal(checkReference('TEMP', 39.2).level, 'critical');
    assert.equal(checkReference('TEMP', 38).level, 'warning');
    assert.equal(checkReference('TEMP', 34.5).level, 'low');
    assert.equal(checkReference('TEMP', 36.8).level, 'ok');
  });

  test('weight has no reference warning', () => {
    assert.equal(checkReference('WEIGHT', 70).level, 'ok');
  });
});

// ────────────────────────────────────────────────
// analyzeReadings (reuse z-score จาก P4)
// ────────────────────────────────────────────────
const day = 86400000;
const base = Date.parse('2026-08-01T00:00:00Z');

function rows(days: number[], values: number[]) {
  return days.map((d, i) => ({ value: values[i], systolic: null, diastolic: null, measured_at: new Date(base + d * day) }));
}

describe('analyzeReadings', () => {
  test('flat series -> trend flat, no anomalies', () => {
    const a = analyzeReadings(rows([0, 1, 2, 3, 4, 5, 6, 7], [70, 70, 70, 70, 70, 70, 70, 70]), 'WEIGHT');
    assert.equal(a.trend, 'flat');
    assert.equal(a.count, 8);
    assert.equal(a.latest?.value, 70);
    assert.equal(a.anomalies.length, 0);
    assert.equal(a.reference?.level, 'ok');
  });

  test('upward trend -> up with positive slope', () => {
    const a = analyzeReadings(rows([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20], [60, 62, 63, 64, 66, 67, 69, 70, 72, 74, 80]), 'WEIGHT');
    assert.equal(a.trend, 'up');
    assert.ok(a.slopePerDay! > 0);
    assert.ok(a.changePct! > 25);
  });

  test('detects spike as critical anomaly (z >= 5)', () => {
    const values = [70, 74, 70, 74, 70, 74, 70, 74, 70, 74, 130];
    const a = analyzeReadings(rows([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], values), 'SUGAR');
    assert.equal(a.anomalies.length, 1);
    assert.equal(a.anomalies[0].value, 130);
    assert.equal(a.anomalies[0].severity, 'critical');
  });

  test('BP analysis uses systolic and flags reference warning', () => {
    const bpRows = [0, 1, 2, 3].map((d, i) => ({
      value: 145,
      systolic: 145,
      diastolic: 95,
      measured_at: new Date(base + d * day),
    }));
    const a = analyzeReadings(bpRows, 'BP');
    assert.equal(a.latest?.systolic, 145);
    assert.equal(a.reference?.level, 'warning');
  });

  test('empty -> count 0, latest null', () => {
    const a = analyzeReadings([], 'TEMP');
    assert.equal(a.count, 0);
    assert.equal(a.latest, null);
    assert.equal(a.reference, null);
    assert.equal(a.trend, 'flat');
  });
});

// ────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────
describe('health readings routes', () => {
  const token = makeToken();

  test('POST saves a valid reading', async () => {
    let data: any = null;
    mockModel(prisma, 'healthReading', {
      create: async (args: any) => {
        data = args.data;
        return { id: 'r1', ...args.data };
      },
    });
    const ts = await createTestServer((app) => app.use('/', healthReadingsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'WEIGHT', value: 70, note: 'ตอนเช้า' }),
      });
      assert.equal(res.status, 201);
      assert.equal(data.value, 70);
      assert.equal(data.systolic, null);
      assert.ok(data.measured_at instanceof Date);
    } finally {
      await ts.close();
    }
  });

  test('POST saves BP with systolic/diastolic', async () => {
    let data: any = null;
    mockModel(prisma, 'healthReading', {
      create: async (args: any) => {
        data = args.data;
        return { id: 'r2', ...args.data };
      },
    });
    const ts = await createTestServer((app) => app.use('/', healthReadingsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'BP', value: 120, systolic: 120, diastolic: 80 }),
      });
      assert.equal(res.status, 201);
      assert.equal(data.systolic, 120);
      assert.equal(data.diastolic, 80);
    } finally {
      await ts.close();
    }
  });

  test('POST rejects BP without diastolic', async () => {
    const ts = await createTestServer((app) => app.use('/', healthReadingsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'BP', value: 130 }),
      });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /requires systolic and diastolic/);
    } finally {
      await ts.close();
    }
  });

  test('POST rejects out-of-range value', async () => {
    const ts = await createTestServer((app) => app.use('/', healthReadingsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'TEMP', value: 50 }),
      });
      assert.equal(res.status, 400);
    } finally {
      await ts.close();
    }
  });

  test('GET returns rows + per-type analysis', async () => {
    const recentSince = base + 10 * day;
    mockModel(prisma, 'healthReading', {
      findMany: async (args: any) => {
        if (args.take === 200) {
          return [
            { type: 'WEIGHT', value: 70, systolic: null, diastolic: null, measured_at: new Date(recentSince - 10 * day) },
            { type: 'WEIGHT', value: 72, systolic: null, diastolic: null, measured_at: new Date(recentSince - 2 * day) },
            { type: 'WEIGHT', value: 74, systolic: null, diastolic: null, measured_at: new Date(recentSince) },
            { type: 'TEMP', value: 37.0, systolic: null, diastolic: null, measured_at: new Date(recentSince) },
          ];
        }
        return [
          { id: 'r1', type: 'WEIGHT', value: 74, systolic: null, diastolic: null, measured_at: new Date(recentSince) },
          { id: 'r2', type: 'TEMP', value: 37.0, systolic: null, diastolic: null, measured_at: new Date(recentSince) },
        ];
      },
    });
    const ts = await createTestServer((app) => app.use('/', healthReadingsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.rows.length, 2);
      assert.ok(body.analysis.WEIGHT);
      assert.equal(body.analysis.WEIGHT.latest.value, 74);
      assert.equal(body.analysis.WEIGHT.trend, 'up');
      assert.ok(body.analysis.TEMP);
      assert.equal(body.analysis.TEMP.latest.value, 37.0);
    } finally {
      await ts.close();
    }
  });

  test('GET ?type= filters where clause', async () => {
    const seen: any[] = [];
    mockModel(prisma, 'healthReading', {
      findMany: async (args: any) => {
        seen.push(args);
        return [];
      },
    });
    const ts = await createTestServer((app) => app.use('/', healthReadingsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/?type=WEIGHT`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(res.status, 200);
      assert.ok(seen.some((a) => a.where?.type === 'WEIGHT'));
    } finally {
      await ts.close();
    }
  });

  test('GET rejects bad type', async () => {
    const ts = await createTestServer((app) => app.use('/', healthReadingsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/?type=HEIGHT`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(res.status, 400);
    } finally {
      await ts.close();
    }
  });

  test('DELETE found -> 200, not found -> 404', async () => {
    mockModel(prisma, 'healthReading', {
      deleteMany: async (args: any) => {
        return args.where.id === 'r1' ? { count: 1 } : { count: 0 };
      },
    });
    const ts = await createTestServer((app) => app.use('/', healthReadingsRoutes));
    try {
      const ok = await fetch(`${ts.baseUrl}/r1`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      assert.equal(ok.status, 200);
      const missing = await fetch(`${ts.baseUrl}/rX`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      assert.equal(missing.status, 404);
    } finally {
      await ts.close();
    }
  });

  test('requires auth', async () => {
    const ts = await createTestServer((app) => app.use('/', healthReadingsRoutes));
    try {
      const res = await fetch(`${ts.baseUrl}/`);
      assert.equal(res.status, 401);
    } finally {
      await ts.close();
    }
  });
});