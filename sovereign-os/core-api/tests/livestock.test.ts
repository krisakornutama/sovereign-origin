// tests/livestock.test.ts — Sovereign Livestock Engine (API-level, mock prisma)
import './setup-env';
import { test, before, after, mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import livestockRoutes, { prisma as livestockPrisma } from '../src/modules/livestock/livestock.routes';
import { actuationService } from '../src/services/actuation.service';
import { getTelegramAlertDispatcher } from '../src/services/telegram-alert.service';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

let server: TestServer;
let token: string;
let sentAlerts: any[] = [];
let actuCalls: any[] = [];
let climateRows: any[] = [];

// ── in-memory stores ────────────────────────────────────────────
const groups = new Map<string, any>();
const medical = new Map<string, any[]>();
const schedules = new Map<string, any[]>();
const logs = new Map<string, any[]>();
const silos = new Map<string, any>();
const bio = new Map<string, any[]>();
const breedings = new Map<string, any[]>();
const batches = new Map<string, any[]>();
const utilities: any[] = [];
let seq = 0;

const GROUP = {
  id: 'g-1',
  code: 'LAYER-01',
  name: null,
  species: 'POULTRY_LAYER',
  quantity: 100,
  birthDate: new Date('2026-01-01T00:00:00.000Z'),
  houseCode: 'H1',
  status: 'ACTIVE',
  notes: null,
  created_at: new Date(),
};

function resetStores() {
  groups.clear(); medical.clear(); schedules.clear(); logs.clear();
  silos.clear(); bio.clear(); breedings.clear(); batches.clear();
  utilities.length = 0; seq = 0;
}

function newId(p: string) { return `${p}-${++seq}`; }
function attachChildren(g: any, inc: any = {}) {
  const out: any = { ...g };
  if (inc.records) out.records = medical.get(g.id) || [];
  if (inc.schedules) {
    out.schedules = (schedules.get(g.id) || [])
      .filter((s) => !inc.schedules.where?.isCompleted || !s.isCompleted)
      .sort((a, b) => a.targetAgeDays - b.targetAgeDays);
  }
  if (inc.dailyLogs) {
    out.dailyLogs = (logs.get(g.id) || [])
      .sort((a, b) => new Date(a.logDate).getTime() - new Date(b.logDate).getTime())
      .slice(-(inc.dailyLogs.take || 999));
  }
  if (inc.breedings) out.breedings = breedings.get(g.id) || [];
  if (inc.batches) out.batches = batches.get(g.id) || [];
  if (inc._count) out._count = { records: (medical.get(g.id) || []).length, dailyLogs: (logs.get(g.id) || []).length };
  return out;
}

function mockDelegates() {
  mockModel(livestockPrisma, 'livestockGroup', {
    findMany: async ({ where = {}, include }: any = {}) => {
      let list = [...groups.values()];
      if (where.species) list = list.filter((g) => g.species === where.species);
      if (where.status) list = list.filter((g) => g.status === where.status);
      return list.sort((a, b) => +b.created_at - +a.created_at).map((g) => attachChildren(g, include));
    },
    findUnique: async ({ where, include }: any = {}) => {
      const g = groups.get(where.id);
      return g ? attachChildren(g, include) : null;
    },
    create: async ({ data }: any) => {
      const g = { id: newId('g'), created_at: new Date(), ...data };
      groups.set(g.id, g);
      return { ...g };
    },
    update: async ({ where, data }: any) => {
      const g = groups.get(where.id);
      if (!g) throw new Error('not found');
      Object.assign(g, data);
      return { ...g };
    },
    delete: async ({ where }: any) => {
      if (!groups.has(where.id)) throw new Error('not found');
      groups.delete(where.id);
      return { id: where.id };
    },
  });

  mockModel(livestockPrisma, 'medicalRecord', {
    create: async ({ data }: any) => {
      const arr = medical.get(data.livestockGroupId) || [];
      const r = { id: newId('med'), created_at: new Date(), ...data };
      arr.push(r);
      medical.set(data.livestockGroupId, arr);
      return { ...r };
    },
  });

  mockModel(livestockPrisma, 'vaccineSchedule', {
    create: async ({ data }: any) => {
      const arr = schedules.get(data.livestockGroupId) || [];
      const s = { id: newId('vac'), isCompleted: false, completedAt: null, created_at: new Date(), ...data };
      arr.push(s);
      schedules.set(data.livestockGroupId, arr);
      return { ...s };
    },
    update: async ({ where, data }: any) => {
      for (const arr of schedules.values()) {
        const s = arr.find((x) => x.id === where.id);
        if (s) { Object.assign(s, data); return { ...s }; }
      }
      throw new Error('not found');
    },
  });

  mockModel(livestockPrisma, 'dailyProductionLog', {
    upsert: async ({ where, create, update }: any) => {
      const { livestockGroupId, logDate } = where.livestockGroupId_logDate;
      const arr = logs.get(livestockGroupId) || [];
      let row = arr.find((l) => l.logDate === logDate);
      if (row) Object.assign(row, update);
      else {
        row = { id: newId('log'), created_at: new Date(), ...create, livestockGroupId, logDate };
        arr.push(row);
        logs.set(livestockGroupId, arr);
      }
      return { ...row };
    },
  });

  mockModel(livestockPrisma, 'feedSilo', {
    findMany: async () => [...silos.values()].sort((a, b) => a.siloCode.localeCompare(b.siloCode)),
    findUnique: async ({ where }: any) => silos.get(where.id) || null,
    create: async ({ data }: any) => {
      const s = { id: newId('sil'), created_at: new Date(), ...data };
      silos.set(s.id, s);
      return { ...s };
    },
    update: async ({ where, data }: any) => {
      const s = silos.get(where.id);
      if (!s) throw new Error('not found');
      Object.assign(s, data);
      return { ...s };
    },
  });

  mockModel(livestockPrisma, 'biosecurityLog', {
    create: async ({ data }: any) => {
      const e = { id: newId('bio'), entryTime: new Date(), created_at: new Date(), ...data };
      bio.get('all')!.push(e);
      return { ...e };
    },
    findMany: async () => [...bio.get('all')!].reverse().slice(0, 100),
  });

  mockModel(livestockPrisma, 'breedingRecord', {
    create: async ({ data }: any) => {
      const arr = breedings.get(data.livestockGroupId) || [];
      const r = { id: newId('br'), status: 'PREGNANT', created_at: new Date(), ...data };
      arr.push(r);
      breedings.set(data.livestockGroupId, arr);
      return { ...r };
    },
    update: async ({ where, data }: any) => {
      for (const arr of breedings.values()) {
        const r = arr.find((x) => x.id === where.id);
        if (r) { Object.assign(r, data); return { ...r }; }
      }
      throw new Error('not found');
    },
  });

  mockModel(livestockPrisma, 'batchFinancialLog', {
    findMany: async ({ where = {} }: any = {}) => {
      let list = [...batches.get('all')!];
      if (where.livestockGroupId) list = list.filter((b) => b.livestockGroupId === where.livestockGroupId);
      return list.sort((a, b) => +b.created_at - +a.created_at);
    },
    findUnique: async ({ where }: any) => batches.get('all')!.find((b) => b.id === where.id) || null,
    create: async ({ data }: any) => {
      const b = { id: newId('bat'), created_at: new Date(), ...data };
      batches.get('all')!.push(b);
      return { ...b };
    },
    update: async ({ where, data }: any) => {
      const b = batches.get('all')!.find((x) => x.id === where.id);
      if (!b) throw new Error('not found');
      Object.assign(b, data);
      return { ...b };
    },
  });

  mockModel(livestockPrisma, 'utilityAlertLog', {
    create: async ({ data }: any) => {
      const u = { id: newId('ut'), created_at: new Date(), ...data };
      utilities.push(u);
      return { ...u };
    },
  });
}

async function api(path: string, method = 'GET', body?: any, useToken = true) {
  const res = await fetch(`${server.baseUrl}/api/livestock${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(useToken ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

before(async () => {
  resetStores();
  bio.set('all', []);
  batches.set('all', []);
  mockDelegates();

  // Telegram + actuation — patch singleton ผ่าน mock.method (routes ใช้ตัวเดียวกัน)
  // mock send เลียนแบบ dedup จริง (eventKey ซ้ำใน window → ไม่ส่ง) เพื่อให้ assert ตรงพฤติกรรมจริง
  sentAlerts = [];
  const sentKeys = new Map<string, number>();
  mock.method(getTelegramAlertDispatcher(), 'send', async (payload: any) => {
    if (payload.eventKey) {
      const last = sentKeys.get(payload.eventKey);
      if (last != null && Date.now() - last < 300_000) return { sent: false, reason: 'dedup' };
      sentKeys.set(payload.eventKey, Date.now());
    }
    sentAlerts.push(payload);
    return { sent: true, reason: 'mock' };
  });
  actuCalls = [];
  mock.method(actuationService, 'executeCommand', async (cmd: any) => {
    actuCalls.push(cmd);
    return { ok: true, actuatorId: cmd.actuatorId, action: 'verified', rule: 'mock' };
  });

  // hypertable climate — เลียนแบบผ่าน $queryRawUnsafe (INSERT/read)
  climateRows = [];
  (livestockPrisma as any).$queryRawUnsafe = async (q: string, ...args: any[]) => {
    if (/INSERT INTO livestock_climate_logs/i.test(q)) {
      climateRows.push({ id: 'c', houseCode: args[0], tempC: args[1], rhPct: args[2], thi: args[3], status: args[4], at: new Date(args[5]) });
      return [];
    }
    const limit = q.includes('LIMIT 48');
    const copy = [...climateRows].sort((a, b) => +b.at - +a.at);
    return (limit ? copy.slice(0, 48) : copy.slice(0, 1)).map((r) => ({
      ...r, tempC: r.tempC, rhPct: r.rhPct,
    }));
  };

  server = await createTestServer((app) => app.use('/api/livestock', livestockRoutes));
  token = makeToken('SUPERADMIN');
});

after(async () => {
  mock.restoreAll();
  if (server) await server.close();
});

// ═══════════════ Auth & Validation ═══════════════
describe('auth + validation', () => {
  test('401 without token', async () => {
    const r = await api('/groups', 'POST', { code: 'X', species: 'DUCK', quantity: 10 }, false);
    assert.equal(r.status, 401);
  });

  test('403 for non-write role', async () => {
    const viewer = makeToken('VIEWER');
    const res = await fetch(`${server.baseUrl}/api/livestock/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${viewer}` },
      body: JSON.stringify({ code: 'X', species: 'DUCK', quantity: 10 }),
    });
    assert.equal(res.status, 403);
  });

  test('group create validations', async () => {
    assert.equal((await api('/groups', 'POST', { species: 'DUCK', quantity: 10 })).status, 400);
    assert.equal((await api('/groups', 'POST', { code: 'X', species: 'DRAGON', quantity: 10 })).status, 400);
    assert.equal((await api('/groups', 'POST', { code: 'X', species: 'DUCK', quantity: 0 })).status, 400);
    assert.equal((await api('/groups', 'POST', { code: 'X', species: 'DUCK', quantity: 10, birthDate: 'not-a-date' })).status, 400);
    assert.equal((await api('/groups', 'POST', { code: 'X', species: 'DUCK', quantity: 10, status: 'FROZEN' })).status, 400);
  });

  test('climate validation', async () => {
    assert.equal((await api('/climate', 'POST', { tempC: 99, rhPct: 50 })).status, 400);
    assert.equal((await api('/climate', 'POST', { tempC: 30 })).status, 400);
  });

  test('biosecurity validation', async () => {
    assert.equal((await api('/biosecurity', 'POST', { sanitizedSec: 60 })).status, 400);
    assert.equal((await api('/biosecurity', 'POST', { visitorName: 'A', sanitizedSec: -1 })).status, 400);
  });

  test('utility validation', async () => {
    assert.equal((await api('/utility', 'POST', { gridPowerState: 'NORMAL', generatorState: 'OFF' })).status, 400);
    assert.equal((await api('/utility', 'POST', { houseCode: 'H1', gridPowerState: 'WEIRD' })).status, 400);
  });
});

// ═══════════════ Groups CRUD ═══════════════
describe('groups CRUD', () => {
  test('create → list → detail → update → delete', async () => {
    const c = await api('/groups', 'POST', { ...GROUP, id: undefined });
    assert.equal(c.status, 200);
    const gid = c.json.group.id;
    assert.equal(gid.startsWith('g-'), true);

    const list = await api('/groups?species=POULTRY_LAYER');
    assert.equal(list.json.groups.length, 1);
    assert.equal(list.json.groups[0]._count.records, 0);

    const det = await api(`/groups/${gid}`);
    assert.equal(det.status, 200);
    assert.equal(det.json.withdrawalLock.locked, false);
    assert.deepEqual(det.json.group.schedules, []);

    const up = await api(`/groups/${gid}`, 'PATCH', { quantity: 90, status: 'QUARANTINE' });
    assert.equal(up.status, 200);
    assert.equal(up.json.group.quantity, 90);
    assert.equal(up.json.group.status, 'QUARANTINE');

    const del = await api(`/groups/${gid}`, 'DELETE');
    assert.equal(del.status, 200);
    assert.equal(del.json.ok, true);
    assert.equal((await api(`/groups/${gid}`)).status, 404);
  });

  test('detail 404 for unknown id', async () => {
    assert.equal((await api('/groups/nope')).status, 404);
  });
});

// ═══════════════ Medical + Withdrawal Lock + วัคซีน ═══════════════
describe('medical + vaccine', () => {
  test('ยา → LOCKED_WITHDRAWAL + alert + drugTotalL (เมื่อให้ avgWeightKg)', async () => {
    groups.set(GROUP.id, { ...GROUP });
    const body = { drugName: 'Amoxicillin', dosageMgKg: 5, withdrawalDays: 7, avgWeightKg: 2.5, drugConcentrationMgPerL: 50 };
    const r = await api(`/groups/${GROUP.id}/medical`, 'POST', body);
    assert.equal(r.status, 200);
    assert.equal(r.json.groupLocked, true);
    assert.equal(r.json.drugTotalL, 25); // 2.5kg × 100 × 5 / 50
    assert.equal(groups.get(GROUP.id).status, 'LOCKED_WITHDRAWAL');
    assert.equal(sentAlerts.filter((a) => a.eventKey?.startsWith('withdrawal-')).length, 1);
  });

  test('withdrawalDays=0 → ไม่ล็อก', async () => {
    groups.set('g-free', { ...GROUP, id: 'g-free', code: 'FREE-01' });
    const r = await api('/groups/g-free/medical', 'POST', { drugName: 'Vit C', dosageMgKg: 1, withdrawalDays: 0 });
    assert.equal(r.json.groupLocked, false);
    assert.equal(groups.get('g-free').status, 'ACTIVE');
  });

  test('medical validation', async () => {
    assert.equal((await api(`/groups/${GROUP.id}/medical`, 'POST', { dosageMgKg: 1, withdrawalDays: 1 })).status, 400);
    assert.equal((await api(`/groups/${GROUP.id}/medical`, 'POST', { drugName: 'A', dosageMgKg: -2, withdrawalDays: 1 })).status, 400);
  });

  test('วัคซีน: สร้างแผน → mark ฉีดแล้ว', async () => {
    const v = await api(`/groups/${GROUP.id}/vaccines`, 'POST', { vaccineName: 'ND', targetAgeDays: 21 });
    assert.equal(v.status, 200);
    const vid = v.json.schedule.id;
    const done = await api(`/vaccines/${vid}`, 'PATCH', { isCompleted: true });
    assert.equal(done.json.schedule.isCompleted, true);
    assert.ok(done.json.schedule.completedAt);
  });
});

// ═══════════════ Climate + Fail-Safe ═══════════════
describe('climate + fail-safe', () => {
  test('COMFORT → ไม่สั่งพัดลม', async () => {
    const r = await api('/climate', 'POST', { tempC: 20, rhPct: 60, houseCode: 'H1' });
    assert.equal(r.status, 200);
    assert.equal(r.json.level, 'info');
    assert.equal(r.json.label, 'COMFORT');
    assert.equal(r.json.failSafe, null);
  });

  test('HEAT_WARNING (THI>74) → สั่ง load-1 ON จริง', async () => {
    const r = await api('/climate', 'POST', { tempC: 30, rhPct: 85, houseCode: 'H1' });
    assert.equal(r.json.level, 'warn');
    assert.equal(r.json.label, 'HEAT_WARNING');
    assert.equal(+r.json.thi.toFixed(2), 83.69);
    assert.deepEqual(r.json.actions, ['EVAP_FAN_ON']);
    assert.equal(r.json.failSafe.ok, true);
    assert.equal(actuCalls.length, 1);
    assert.equal(actuCalls[0].actuatorId, 'load-1');
    assert.equal(actuCalls[0].desiredState, 'on');
    assert.equal(actuCalls[0].actor, 'system');
  });

  test('CRITICAL (THI>84) → failSafe + alert critical', async () => {
    const r = await api('/climate', 'POST', { tempC: 36, rhPct: 95, houseCode: 'H1' });
    assert.equal(r.json.level, 'critical');
    assert.equal(+r.json.thi.toFixed(2), 95.73);
    assert.equal(r.json.failSafe.ok, true);
    assert.equal(sentAlerts.filter((a) => a.severity === 'critical' && a.eventKey?.startsWith('thi-')).length, 1);
  });

  test('GET history → กลับหน้าล่าสุด (จาก hypertable)', async () => {
    const r = await api('/climate');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.history));
    assert.equal(r.json.history.length, 3); // 3 samples จาก POST ข้างบน
    assert.ok(r.json.latest.thi > 0);
  });
});

// ═══════════════ Utility Fail-Safe ═══════════════
describe('utility fail-safe', () => {
  test('BLACKOUT + RUNNING → WARN', async () => {
    const r = await api('/utility', 'POST', { houseCode: 'H1', gridPowerState: 'BLACKOUT', generatorState: 'RUNNING' });
    assert.equal(r.json.anomaly, 'WARN');
    assert.equal(sentAlerts.filter((a) => a.eventKey?.startsWith('ats-')).length, 1);
  });

  test('BLACKOUT + FAIL → CRITICAL alert', async () => {
    const r = await api('/utility', 'POST', { houseCode: 'H1', gridPowerState: 'BLACKOUT', generatorState: 'FAIL' });
    assert.equal(r.json.anomaly, 'CRITICAL');
    const crit = sentAlerts.filter((a) => a.severity === 'critical' && a.eventKey?.startsWith('ats-'));
    assert.equal(crit.length, 1);
  });

  test('NORMAL + OFF → NONE', async () => {
    const r = await api('/utility', 'POST', { houseCode: 'H1', gridPowerState: 'NORMAL', generatorState: 'OFF' });
    assert.equal(r.json.anomaly, 'NONE');
  });
});

// ═══════════════ Daily Logs + Vet AI ═══════════════
describe('daily logs + Vet AI', () => {
  test('log ปกติ → ไม่มี action', async () => {
    const gid = 'g-log';
    groups.set(gid, { ...GROUP, id: gid, code: 'LOG-01' });
    const r = await api(`/groups/${gid}/daily-logs`, 'POST', {
      logDate: '2026-08-15T00:00:00.000Z', eggCount: 80, feedConsumedKg: 30,
      avgWeightGram: 1800, waterConsumedL: 200,
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.actions, []);
    assert.equal(r.json.statusChanged, null);
  });

  test('อัตราตาย 6% → QUARANTINE อัตโนมัติ + alert critical', async () => {
    const gid = 'g-log';
    const r = await api(`/groups/${gid}/daily-logs`, 'POST', {
      logDate: '2026-08-16T00:00:00.000Z', mortalityCount: 6, feedConsumedKg: 20,
    });
    assert.equal(r.json.statusChanged, 'QUARANTINE');
    assert.ok(r.json.actions.some((a: any) => a.action === 'QUARANTINE'));
    assert.equal(groups.get(gid).status, 'QUARANTINE');
    assert.equal(sentAlerts.filter((a) => a.eventKey === `quarantine-${gid}`).length, 1);
  });

  test('FCR เบี่ยง + HD ร่วง + น้ำลด + วัคซีนครบกำหนด → ครบ 4 actions', async () => {
    const gid = 'g-ai';
    groups.set(gid, { ...GROUP, id: gid, code: 'AI-01' });
    schedules.set(gid, [{ id: 'vac-due', livestockGroupId: gid, vaccineName: 'ND', targetAgeDays: 1, isCompleted: false, completedAt: null }]);
    await api(`/groups/${gid}/daily-logs`, 'POST', {
      logDate: '2026-08-15T00:00:00.000Z', eggCount: 80, feedConsumedKg: 30, avgWeightGram: 1800, waterConsumedL: 200,
    });
    const r = await api(`/groups/${gid}/daily-logs`, 'POST', {
      logDate: '2026-08-16T00:00:00.000Z', eggCount: 60, feedConsumedKg: 60, avgWeightGram: 1850, waterConsumedL: 150,
    });
    const actions = r.json.actions.map((a: any) => a.action);
    assert.ok(actions.includes('FCR_DEVIATION'), JSON.stringify(actions));
    assert.ok(actions.includes('HD_DROP'), JSON.stringify(actions));
    assert.ok(actions.includes('VACCINE_DUE'), JSON.stringify(actions));
    assert.ok(actions.includes('WATER_DROP'), JSON.stringify(actions));
    assert.equal(r.json.analysis.hdDropPct, -20.0);
    assert.equal(sentAlerts.filter((a) => a.eventKey === `fcr-${gid}`).length, 1);
    assert.equal(sentAlerts.filter((a) => a.eventKey === `vaccine-vac-due`).length, 1);
  });

  test('upsert วันเดียวกัน → 1 log (ไม่ซ้ำ)', async () => {
    const gid = 'g-upsert';
    groups.set(gid, { ...GROUP, id: gid, code: 'UPS-01' });
    await api(`/groups/${gid}/daily-logs`, 'POST', { logDate: '2026-08-14T00:00:00.000Z', eggCount: 70, feedConsumedKg: 25 });
    await api(`/groups/${gid}/daily-logs`, 'POST', { logDate: '2026-08-14T00:00:00.000Z', eggCount: 75, feedConsumedKg: 25 });
    const rows = logs.get(gid)!.filter((l) => l.logDate === '2026-08-14T00:00:00.000Z');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].eggCount, 75);
  });

  test('GET metrics → fcr/hdPct/withdrawalLock/pendingVaccines', async () => {
    const gid = 'g-metrics';
    groups.set(gid, { ...GROUP, id: gid, code: 'MET-01' });
    schedules.set(gid, [{ id: 'vac-met', livestockGroupId: gid, vaccineName: 'IB', targetAgeDays: 7, isCompleted: false, completedAt: null }]);
    await api(`/groups/${gid}/daily-logs`, 'POST', {
      logDate: '2026-08-15T00:00:00.000Z', feedConsumedKg: 30, avgWeightGram: 1800, eggCount: 80,
    });
    await api(`/groups/${gid}/daily-logs`, 'POST', {
      logDate: '2026-08-16T00:00:00.000Z', feedConsumedKg: 60, avgWeightGram: 1850, eggCount: 60,
    });
    const r = await api(`/groups/${gid}/metrics`);
    assert.equal(r.status, 200);
    assert.ok(r.json.metrics.fcr > 0);
    assert.equal(r.json.metrics.standardFcr, 2.0);
    assert.equal(r.json.metrics.pendingVaccines, 1);
    assert.equal(r.json.metrics.withdrawalLock.locked, false);
  });

  test('logDate invalid → 400', async () => {
    assert.equal((await api('/groups/g-ai/daily-logs', 'POST', { logDate: 'garbage' })).status, 400);
  });
});

// ═══════════════ Silos ═══════════════
describe('feed silos', () => {
  test('create → list (fillPct) → refill +→ แจ้งเตือนเมื่อต่ำ 15%', async () => {
    const c = await api('/silos', 'POST', { siloCode: 'SILO-1', capacityKg: 1000, currentKg: 1000 });
    assert.equal(c.status, 200);
    const sid = c.json.silo.id;

    const list = await api('/silos');
    assert.equal(list.json.silos[0].fillPct, 100);

    const ref = await api(`/silos/${sid}/refill`, 'PATCH', { deltaKg: -900 });
    assert.equal(ref.status, 200);
    assert.equal(ref.json.silo.currentKg, 100);
    assert.equal(sentAlerts.filter((a) => a.eventKey === `silo-${sid}-low`).length, 1);

    assert.equal((await api(`/silos/${sid}/refill`, 'PATCH', { deltaKg: 0 })).status, 400);
    assert.equal((await api('/silos/nope/refill', 'PATCH', { deltaKg: 10 })).status, 404);
  });
});

// ═══════════════ Biosecurity Gate ═══════════════
describe('biosecurity gate', () => {
  test('ฉีดพ่น 60s → DENIED + alert', async () => {
    const r = await api('/biosecurity', 'POST', { visitorName: 'John', vehiclePlate: 'กข1234', sanitizedSec: 60 });
    assert.equal(r.status, 200);
    assert.equal(r.json.gate.passed, false);
    assert.equal(sentAlerts.filter((a) => a.text?.includes('GATE DENIED')).length, 1);
  });

  test('ฉีดพ่น 200s → ผ่าน', async () => {
    const r = await api('/biosecurity', 'POST', { visitorName: 'Suda', sanitizedSec: 200 });
    assert.equal(r.json.gate.passed, true);
  });

  test('GET history + summary', async () => {
    const r = await api('/biosecurity');
    assert.equal(r.status, 200);
    assert.equal(r.json.summary.total, 2);
    assert.equal(r.json.summary.denied, 1);
  });
});

// ═══════════════ Breeding + Hatchability ═══════════════
describe('breeding cycle', () => {
  test('create (default expectedBirthAt = +21d) + ปิดผล → hatchability', async () => {
    const c = await api(`/groups/${GROUP.id}/breeding`, 'POST', { inseminatedAt: '2026-08-01T00:00:00.000Z', eggSetCount: 100 });
    assert.equal(c.status, 200);
    const bid = c.json.record.id;
    assert.equal(c.json.record.status, 'PREGNANT');

    const p = await api(`/breeding/${bid}`, 'PATCH', { status: 'LITTERED', hatchedCount: 90, actualBirthAt: '2026-08-22T00:00:00.000Z' });
    assert.equal(p.status, 200);
    assert.equal(p.json.hatchabilityPct, 90);

    assert.equal((await api(`/breeding/${bid}`, 'PATCH', { status: 'ALIEN' })).status, 400);
  });
});

// ═══════════════ Batch Financial ═══════════════
describe('batch financial engine', () => {
  test('create → netProfit auto + list filter', async () => {
    const c = await api('/batches', 'POST', {
      batchCode: 'B-001', livestockGroupId: GROUP.id,
      initialAnimalCost: 10000, totalFeedCost: 5000, totalMedCost: 1000, totalUtilityCost: 2000, totalRevenue: 30000,
    });
    assert.equal(c.status, 200);
    assert.equal(c.json.batch.netProfit, 12000);

    const list = await api(`/batches?livestockGroupId=${GROUP.id}`);
    assert.equal(list.json.batches.length, 1);

    assert.equal((await api('/batches', 'POST', { initialAnimalCost: 1 })).status, 400);
  });

  test('patch recalc + 404', async () => {
    const list = await api('/batches');
    const bid = list.json.batches[0].id;
    const p = await api(`/batches/${bid}`, 'PATCH', { totalRevenue: 40000, closedAt: '2026-08-20T00:00:00.000Z' });
    assert.equal(p.status, 200);
    assert.equal(p.json.batch.netProfit, 22000);
    assert.equal((await api('/batches/nope', 'PATCH', { totalRevenue: 1 })).status, 404);
  });
});

// ═══════════════ Dashboard ═══════════════
describe('dashboard', () => {
  test('summary ครบ: groups/quarantine/lowSilos/netProfit/latestThi', async () => {
    const r = await api('/dashboard');
    assert.equal(r.status, 200);
    assert.equal(r.json.summary.groups >= 3, true);
    assert.equal(r.json.summary.quarantine >= 1, true);
    assert.equal(r.json.summary.lowSilos, 1);
    assert.equal(r.json.summary.netProfit, 22000);
    assert.ok(r.json.summary.latestThi > 80);
    assert.equal(r.json.regimes.length, 5);
  });
});
