import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import predictiveRoutes from '../src/modules/predictive/predictive.routes';
import {
  prisma,
  linearFit,
  batteryForecastSoc,
  rollingZScore,
  detectAnomalies,
  PredictiveWorker,
  KEY_METRICS,
} from '../src/services/predictive.service';
import { automationEmitter } from '../src/services/automation.service';
import { mockModel, createTestServer, makeToken, TestServer } from './helpers';

let server: TestServer;
let token: string;

// ข้อมูล SOC ชุดควบคุม: ลดวันละ 5% จาก 86% → slope ≈ -0.2083 %/ชม.
const SOC_HISTORY = Array.from({ length: 7 * 24 }, (_, i) => ({
  time: new Date(Date.now() - (7 * 24 - i) * 3600000),
  value: 86 - (i / 24) * 5,
}));

function spikeSeries(base = 50): Array<{ time: Date; value: number }> {
  const out: Array<{ time: Date; value: number }> = [];
  for (let i = 0; i < 120; i++) {
    const v = i === 100 ? base + 6 * 2 : base + (i % 2 === 0 ? -0.5 : 0.5);
    out.push({ time: new Date(Date.now() - (120 - i) * 60000), value: v });
  }
  return out;
}

before(async () => {
  try {
    (prisma as any).$queryRawUnsafe = async (_sql: string, ...params: any[]) => {
      const sql = String(_sql);
      const metric = typeof params[0] === 'string' ? params[0] : sql.includes("'battery_soc'") ? 'battery_soc' : '';
      if (metric === 'battery_soc') return SOC_HISTORY;
      if (metric === 'water_level_cm') return spikeSeries();
      return [];
    };
  } catch (e) {
    console.log('queryRaw mock FAIL:', e);
  }
  server = await createTestServer((app) => app.use('/api/predictive', predictiveRoutes));
  token = makeToken('SUPERADMIN');
});

after(async () => {
  if (server) await server.close();
});

function auth(t: string) {
  return { Authorization: `Bearer ${t}` };
}

// ── Pure: linearFit ─────────────────────────────────────────────────────────

test('linearFit finds exact line (y=2t+10, r2=1)', () => {
  const pts = Array.from({ length: 20 }, (_, i) => ({ t: i, y: 2 * i + 10 }));
  const fit = linearFit(pts)!;
  assert.ok(Math.abs(fit.slope - 2) < 1e-9);
  assert.ok(Math.abs(fit.intercept - 10) < 1e-9);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-9);
});

test('linearFit handles noise and NaN', () => {
  const noise = Array.from({ length: 50 }, (_, i) => ({ t: i, y: 3 * i + Math.sin(i) * 50 }));
  const fit = linearFit(noise)!;
  assert.ok(Math.abs(fit.slope - 3) < 1.2, `slope=${fit.slope}`);
  const withNaN = [...noise, { t: 100, y: NaN }, { t: 101, y: 3 }];
  assert.ok(linearFit(withNaN) != null);
});

test('linearFit returns null when data insufficient', () => {
  assert.strictEqual(linearFit([]), null);
  assert.strictEqual(linearFit([{ t: 0, y: 1 }, { t: 1, y: 2 }]), null);
  // t คงที่ (ไม่มี variance)
  assert.strictEqual(linearFit([{ t: 5, y: 1 }, { t: 5, y: 2 }, { t: 5, y: 3 }]), null);
});

// ── Pure: batteryForecastSoc ────────────────────────────────────────────────

test('batteryForecastSoc predicts empty time from 7-day controlled series', () => {
  const f = batteryForecastSoc(SOC_HISTORY.map((s) => ({ t: new Date(s.time).getTime() / 3600000, y: s.value })));
  assert.strictEqual(f.direction, 'discharging');
  assert.ok(Math.abs((f.slopePerHour * 24) - (-5)) < 0.05, `slope=${f.slopePerHour}/ชม.`);
  // ข้อมูลมี 7 วัน (168 ชม.) → เหลือ ~245.8 ชม. (จาก (86/5)*24 − 167)
  assert.ok(Math.abs(f.hoursToEmpty! - ((86 / 5) * 24 - 167)) < 24, `hoursToEmpty=${f.hoursToEmpty}`);
  assert.ok(f.r2 > 0.9, `r2=${f.r2}`);
  assert.strictEqual(f.samples, 7 * 24);
});

test('batteryForecastSoc returns null when rising or flat', () => {
  const rising = Array.from({ length: 48 }, (_, i) => ({ t: i, y: i }));
  assert.strictEqual(batteryForecastSoc(rising).hoursToEmpty, null);
  assert.strictEqual(batteryForecastSoc(rising).direction, 'charging');
  const flat = Array.from({ length: 48 }, (_, i) => ({ t: i, y: 70 }));
  assert.strictEqual(batteryForecastSoc(flat).hoursToEmpty, null);
  assert.strictEqual(batteryForecastSoc(flat).direction, 'flat');
});

test('batteryForecastSoc survives NaN data', () => {
  const dirty = [...SOC_HISTORY.map((s) => ({ t: new Date(s.time).getTime() / 3600000, y: s.value })), { t: 9999, y: NaN }];
  const f = batteryForecastSoc(dirty);
  assert.strictEqual(f.direction, 'discharging');
  assert.ok(f.hoursToEmpty != null);
});

// ── Pure: rollingZScore / detectAnomalies ───────────────────────────────────

test('rollingZScore flags a spike ~6σ above rolling mean', () => {
  const rolled = rollingZScore(spikeSeries().map((s) => ({ t: s.time.getTime(), y: s.value })), 30, 3);
  const flagged = rolled.filter((p) => p.anomaly);
  assert.strictEqual(flagged.length, 1, `${flagged.length} จุดผิดปกติ`);
  const spike = flagged[0];
  assert.ok(spike.z > 3, `z=${spike.z}`);
});

test('rollingZScore produces no anomalies on constant series (std=0 guard)', () => {
  const flat = Array.from({ length: 100 }, (_, i) => ({ t: i, y: 42 }));
  const rolled = rollingZScore(flat, 10, 3);
  assert.strictEqual(rolled.filter((p) => p.anomaly).length, 0);
});

test('detectAnomalies respects threshold, sorts newest-first, severity at |z|≥5', () => {
  const series = spikeSeries().map((s) => ({ t: s.time.getTime(), y: s.value }));
  const z3 = detectAnomalies(series, { window: 30, zThreshold: 3 });
  assert.ok(z3.length >= 1);
  assert.ok(z3[0].severity === 'warning' || z3[0].severity === 'critical');
  assert.ok(z3[0].time >= z3[z3.length - 1]?.time);

  const bigSpike = Array.from({ length: 100 }, (_, i) => ({
    t: i, y: i === 90 ? 10 * 10 : 1,
  }));
  const crit = detectAnomalies(bigSpike, { window: 20, zThreshold: 3 });
  assert.ok(crit.some((a) => a.severity === 'critical'));

  const z50 = detectAnomalies(series, { window: 30, zThreshold: 50 });
  assert.strictEqual(z50.length, 0);
});

// ── Worker ──────────────────────────────────────────────────────────────────

function makeWorkerDeps(spike = true) {
  return {
    loadBatteryHistory: async () => SOC_HISTORY,
    loadMetricHistory: async (metric: string) => (spike ? spikeSeries() : [...spikeSeries()].map((s, i) => ({ ...s, value: 50 + (i % 3) * 0.1 }))),
    emitAlert: () => {},
  };
}

test('PredictiveWorker.runOnce emits one anomaly alert for water_level_cm spike', async () => {
  const alerts: any[] = [];
  const worker = new PredictiveWorker({
    ...makeWorkerDeps(),
    emitAlert: (a) => alerts.push(a),
  });
  const counts = await worker.runOnce();
  assert.strictEqual(counts.water_level_cm, 1);
  const alert = alerts.find((a) => a.metric === 'water_level_cm');
  assert.ok(alert, 'ต้อง emit alert ที่ metric ที่เจอ spike');
  assert.ok(alert.ruleId.startsWith('predictive_anomaly_'));
  assert.ok(typeof alert.message === 'string' && alert.message.includes('water_level_cm'));
  assert.strictEqual(worker.lastRunAt != null, true);
});

test('PredictiveWorker.runOnce respects cooldown (no repeat alert in 6h)', async () => {
  const alerts: any[] = [];
  const worker = new PredictiveWorker({
    ...makeWorkerDeps(),
    emitAlert: (a) => alerts.push(a),
  });
  await worker.runOnce();
  const firstCount = alerts.length;
  await worker.runOnce();
  assert.strictEqual(alerts.length, firstCount, 'run ซ้ำใน cooldown ต้องไม่ emit ซ้ำ');
});

test('PredictiveWorker emits into automationEmitter (server handles persist/socket/telegram)', async () => {
  const captured: any[] = [];
  const listener = (a: any) => captured.push(a);
  automationEmitter.on('alert', listener);
  try {
    const worker = new PredictiveWorker({
      ...makeWorkerDeps(),
      emitAlert: (a) => automationEmitter.emit('alert', a),
    });
    await worker.runOnce();
    assert.ok(captured.length >= 1);
  } finally {
    automationEmitter.removeListener('alert', listener);
  }
});

test('PredictiveWorker skips metrics with too little data', async () => {
  const alerts: any[] = [];
  const worker = new PredictiveWorker({
    loadBatteryHistory: async () => SOC_HISTORY,
    loadMetricHistory: async () => [],
    emitAlert: (a) => alerts.push(a),
  });
  const counts = await worker.runOnce();
  assert.strictEqual(alerts.length, 0);
  assert.strictEqual(Object.values(counts).every((c) => c === 0), true);
});

// ── Routes ──────────────────────────────────────────────────────────────────

test('predictive routes require authentication', async () => {
  for (const url of ['/api/predictive/battery', '/api/predictive/anomalies?metric=temperature', '/api/predictive/summary']) {
    const res = await fetch(server.baseUrl + url);
    assert.strictEqual(res.status, 401, url);
  }
});

test('GET /battery returns forecast + series', async () => {
  const res = await fetch(server.baseUrl + '/api/predictive/battery', { headers: auth(token) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.forecast.direction, 'discharging');
  assert.ok(body.forecast.hoursToEmpty != null);
  assert.ok(Array.isArray(body.series) && body.series.length > 0);
  assert.ok(body.source.samples >= 100);
});

test('GET /anomalies validates metric', async () => {
  const bad = await fetch(server.baseUrl + '/api/predictive/anomalies?metric=ufo_zap', { headers: auth(token) });
  assert.strictEqual(bad.status, 400);
  const ok = await fetch(server.baseUrl + '/api/predictive/anomalies?metric=water_level_cm&hours=24', { headers: auth(token) });
  assert.strictEqual(ok.status, 200);
  const body = await ok.json();
  assert.strictEqual(body.metric, 'water_level_cm');
  assert.ok(Array.isArray(body.anomalies));
  assert.ok(body.anomalies.length >= 1);
  assert.ok(body.anomalies[0].z > 3);
});

test('GET /summary returns battery + anomaly counts per key metric', async () => {
  const res = await fetch(server.baseUrl + '/api/predictive/summary', { headers: auth(token) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.battery && typeof body.battery.direction === 'string');
  assert.ok(body.anomaliesByMetric);
  for (const m of KEY_METRICS) {
    assert.ok(m in body.anomaliesByMetric, `ต้องมี ${m}`);
  }
});