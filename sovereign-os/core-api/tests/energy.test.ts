import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import energyRoutes from '../src/modules/energy/energy.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, TestServer } from './helpers';
import { setTelegramAlertSender } from '../src/services/telegram-alert.service';

// ────────────────────────────────────────────────────────────────────────────
// ENERGY เต็มรูป — mock suite (ไม่แตะ DB จริง)
// ครอบ: ingest ค่าวัด (+ตรวจเพดานทันที) · CRUD เพดาน (global/node/device) ·
// ตรวจเกินเพดาน + เตือน Telegram (pipeline เดิม ผ่าน DI sender) · summary fallback
// ────────────────────────────────────────────────────────────────────────────

const NODE = '11111111-1111-1111-1111-111111111111';
const NODE2 = '22222222-2222-2222-2222-222222222222';
const DEV = 'esp32-kitchen';

const H = { Authorization: `Bearer ${makeToken('SUPERADMIN')}`, 'Content-Type': 'application/json' };
const VIEW = { Authorization: `Bearer ${makeToken('VIEWER')}` };

let ts: TestServer;
const readings: any[] = [];
const thresholds = new Map<string, any>();
let sentAlerts: string[] = [];

before(async () => {
  // ── mock energy_readings (in-memory) ──
  (prisma as any).energyReading = {
    create: async ({ data }: any) => {
      const row = { id: `er-${readings.length + 1}`, read_at: data.read_at ?? new Date(), ...data };
      readings.push(row);
      return row;
    },
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = [...readings];
      if (where?.node_id) rows = rows.filter((r) => r.node_id === where.node_id);
      if (where?.device_id) rows = rows.filter((r) => r.device_id === where.device_id);
      if (where?.metric) rows = rows.filter((r) => r.metric === where.metric);
      if (where?.read_at?.gte) rows = rows.filter((r) => r.read_at >= where.read_at.gte);
      if (orderBy?.read_at === 'desc') rows.sort((a, b) => b.read_at.getTime() - a.read_at.getTime());
      return rows.slice(0, take ?? rows.length);
    },
    findFirst: async ({ where, orderBy }: any) => {
      const rows = await (prisma as any).energyReading.findMany({ where, orderBy });
      return rows[0] ?? null;
    },
    aggregate: async ({ where }: any) => {
      const rows = await (prisma as any).energyReading.findMany({ where });
      if (rows.length === 0) return { _avg: { value: null } };
      return { _avg: { value: rows.reduce((s: number, r: any) => s + r.value, 0) / rows.length } };
    },
  };

  // ── mock energy_thresholds (in-memory + unique scope+scopeName+metric) ──
  const keyOf = (s: string, n: string, m: string) => `${s}|${n}|${m}`;
  (prisma as any).energyThreshold = {
    findMany: async ({ where }: any) =>
      [...thresholds.values()].filter((t) => (!where?.isActive ? true : t.isActive === where.isActive)),
    upsert: async ({ where, update, create }: any) => {
      const k = keyOf(where.scope_scopeName_metric.scope, where.scope_scopeName_metric.scopeName, where.scope_scopeName_metric.metric);
      const existing = thresholds.get(k);
      if (existing) {
        const merged = { ...existing, ...update };
        thresholds.set(k, merged);
        return merged;
      }
      const row = { id: `et-${thresholds.size + 1}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      thresholds.set(k, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = [...thresholds.values()].find((t) => t.id === where.id);
      if (!row) throw new Error('Record to update not found');
      const merged = { ...row, ...data };
      thresholds.set(keyOf(row.scope, row.scopeName, row.metric), merged);
      return merged;
    },
    delete: async ({ where }: any) => {
      const row = [...thresholds.values()].find((t) => t.id === where.id);
      if (!row) throw new Error('Record to delete does not exist.');
      thresholds.delete(keyOf(row.scope, row.scopeName, row.metric));
      return row;
    },
  };

  // sensor_telemetry ว่าง → summary ต้องไม่พัง (แค่ no_data)
  (prisma as any).$queryRawUnsafe = async () => [];

  // DI sender — จับ alert แทนยิง network
  sentAlerts = [];
  setTelegramAlertSender(async (html: string) => {
    sentAlerts.push(html);
    return true;
  });

  ts = await createTestServer((app) => app.use('/api/energy', energyRoutes));
});

after(async () => {
  await ts.close();
  setTelegramAlertSender(null);
});

const post = (path: string, body: unknown, headers = H) =>
  fetch(`${ts.baseUrl}/api/energy${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
const get = (path: string, headers = VIEW) => fetch(`${ts.baseUrl}/api/energy${path}`, { headers });

test('POST /readings — บันทึกค่าวัดพลังงาน + ปฏิเสธ metric/value ที่ผิด', async () => {
  const bad1 = await post('/readings', { node_id: NODE, metric: 'temperature_c', value: 30 });
  assert.equal(bad1.status, 400);
  const bad2 = await post('/readings', { node_id: NODE, metric: 'power_kw', value: 'ห้า' });
  assert.equal(bad2.status, 400);
  const bad3 = await post('/readings', { metric: 'power_kw', value: 1 });
  assert.equal(bad3.status, 400);

  const res = await post('/readings', { node_id: NODE, device_id: DEV, metric: 'power_kw', value: 1.2 });
  assert.equal(res.status, 201);
  const body: any = await res.json();
  assert.equal(body.reading.metric, 'power_kw');
  assert.equal(body.reading.value, 1.2);
  assert.equal(body.reading.device_id, DEV);
  assert.deepEqual(body.breaches, [], 'ยังไม่มีเพดาน = ไม่มี breach');
  assert.equal(readings.length, 1);
});

test('GET /readings — กรอง node/device/metric + limit', async () => {
  await post('/readings', { node_id: NODE2, device_id: 'pump-a', metric: 'power_kw', value: 2.5 });
  await post('/readings', { node_id: NODE, device_id: DEV, metric: 'battery_soc', value: 88 });

  const all = await get('/readings');
  assert.equal(all.status, 200);
  const allBody: any = await all.json();
  assert.equal(allBody.length, 3);

  const byDev: any = await (await get(`/readings?device_id=${DEV}`)).json();
  assert.ok(byDev.every((r: any) => r.device_id === DEV));

  const byMetric: any = await (await get('/readings?metric=battery_soc')).json();
  assert.equal(byMetric.length, 1);
  assert.equal(byMetric[0].value, 88);

  const limited: any = await (await get('/readings?limit=2')).json();
  assert.equal(limited.length, 2);
});

test('POST /thresholds — ตั้งเพดาน global/node/device (upsert) + ปฏิเสธ scope/maxKw ผิด', async () => {
  const badScope = await post('/thresholds', { scope: 'plot', scopeName: 'x', maxKw: 5 });
  assert.equal(badScope.status, 400);
  const badName = await post('/thresholds', { scope: 'device', maxKw: 5 });
  assert.equal(badName.status, 400);
  const badKw = await post('/thresholds', { scope: 'global', maxKw: -1 });
  assert.equal(badKw.status, 400);

  const g = await post('/thresholds', { scope: 'global', maxKw: 50, windowMin: 60 });
  assert.equal(g.status, 201);
  const gBody: any = await g.json();
  assert.equal(gBody.scope, 'global');
  assert.equal(gBody.scopeName, '*');

  const d = await post('/thresholds', { scope: 'device', scopeName: DEV, maxKw: 5, windowMin: 30 });
  assert.equal(d.status, 201);
  const dBody: any = await d.json();
  assert.equal(dBody.windowMin, 30);

  // upsert — ตั้งซ้ำแก้ค่าเดิม ไม่เพิ่มแถว
  const again = await post('/thresholds', { scope: 'device', scopeName: DEV, maxKw: 4.5, windowMin: 30 });
  assert.equal(again.status, 201);
  assert.equal(thresholds.size, 2);
  const devRow: any = [...thresholds.values()].find((t: any) => t.scope === 'device');
  assert.equal(devRow.maxKw, 4.5);
});

test('POST /check — เกินเพดานต่อ device → breach + Telegram (pipeline เดิม)', async () => {
  // ค่าเฉลี่ย DEV ล่าสุด 1.2 kW ใน 30 นาที — เพดาน 4.5 ยังไม่เกิน → ไม่มี breach
  const ok = await post('/check', {});
  const okBody: any = await ok.json();
  assert.equal(okBody.breaches.length, 0);
  assert.equal(sentAlerts.length, 0);

  // เพิ่มค่าหนัก → เฉลี่ย DEV เกิน 4.5
  await post('/readings', { node_id: NODE, device_id: DEV, metric: 'power_kw', value: 9.0 });
  const res = await post('/check', {});
  assert.equal(res.status, 200);
  const body: any = await res.json();
  const devBreach = body.breaches.find((b: any) => b.scope === 'device');
  assert.ok(devBreach, 'เพดาน device ต้องถูก breach');
  assert.equal(devBreach.maxKw, 4.5);
  assert.ok(devBreach.avgKw > 4.5);

  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sentAlerts.some((a) => a.includes('พลังงานเกินเพดาน')), 'Telegram ผ่าน pipeline เดิม (DI sender)');
  assert.ok(sentAlerts.some((a) => a.includes('WARN')));
});

test('POST /readings — ingest ใหม่ตรวจเพดานทันที (checkAndAlert ในสาย ingest)', async () => {
  const res = await post('/readings', { node_id: NODE, device_id: DEV, metric: 'power_kw', value: 9.5 });
  assert.equal(res.status, 201);
  const body: any = await res.json();
  assert.ok(body.breaches.some((b: any) => b.scope === 'device'), 'check ทันทีใน POST /readings');
});

test('dedup — eventKey เดิมภายใน 5 นาที ไม่ยิง Telegram ซ้ำ (กัน sensor flapping)', async () => {
  const { createTelegramAlertDispatcher } = await import('../src/services/telegram-alert.service');
  const { config } = await import('../src/config');
  const got: string[] = [];
  const dispatcher = createTelegramAlertDispatcher(config.telegramAlert, { send: async (h) => { got.push(h); return true; } });
  const first = await dispatcher.send({ text: 'ทดสอบ dedup', severity: 'warn', eventKey: 'energy-threshold:test' });
  const second = await dispatcher.send({ text: 'ทดสอบ dedup', severity: 'warn', eventKey: 'energy-threshold:test' });
  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.equal(second.reason.includes('dedup'), true);
  assert.equal(got.length, 1);
});

test('PATCH/DELETE /thresholds/:id — แก้/ปิด/ลบ + 404 เมื่อไม่พบ', async () => {
  const devRow: any = [...thresholds.values()].find((t: any) => t.scope === 'device');
  const patched = await fetch(`${ts.baseUrl}/api/energy/thresholds/${devRow.id}`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ maxKw: 2, isActive: false }),
  });
  assert.equal(patched.status, 200);
  const pBody: any = await patched.json();
  assert.equal(pBody.maxKw, 2);
  assert.equal(pBody.isActive, false);

  // เพดานปิดแล้วไม่ถูกตรวจ
  const res = await post('/check', {});
  const body: any = await res.json();
  assert.ok(!body.breaches.some((b: any) => b.scope === 'device'), 'เพดาน isActive=false ต้องถูกข้าม');

  const del = await fetch(`${ts.baseUrl}/api/energy/thresholds/${devRow.id}`, { method: 'DELETE', headers: H });
  assert.equal(del.status, 200);
  const missing = await fetch(`${ts.baseUrl}/api/energy/thresholds/${devRow.id}`, { method: 'DELETE', headers: H });
  assert.equal(missing.status, 404);
});

test('GET /summary — no_data เมื่อไม่มีข้อมูล + fallback ไม่พัง', async () => {
  // เคลียร์ค่าวัดให้ summary เข้าทาง fallback (sensor_telemetry mock ว่าง)
  readings.length = 0;
  const res = await get('/summary');
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.status, 'no_data');
  assert.equal(body.source, 'sensor_telemetry');
  assert.equal(body.capacity_kwh > 0, true);
});

test('GET /summary — คำนวณจาก energy_readings ได้ครบ (charging + เวลาที่เหลือ)', async () => {
  const now = new Date();
  readings.push(
    { id: 's1', node_id: NODE, device_id: DEV, metric: 'battery_soc', value: 90, read_at: now },
    { id: 's2', node_id: NODE, device_id: DEV, metric: 'power_kw', value: -1.0, read_at: now },
    { id: 's3', node_id: NODE, device_id: DEV, metric: 'power_kw', value: -1.0, read_at: now },
  );
  const res = await get('/summary');
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.source, 'energy_readings');
  assert.equal(body.battery_soc, 90);
  assert.equal(body.power_kw_avg_24h, -1);
  assert.equal(body.status, 'discharging');
  // (90/100)*5kWh / 1kW = 4.5 ชม.
  assert.equal(body.hours_remaining, 4.5);
});
