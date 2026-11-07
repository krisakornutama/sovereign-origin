// tests/farmExecutiveRoutes.test.ts
//
// ── GET /api/farm/executive (route-level) ──────────────────────────────────
// service test ล็อกกฎไปแล้ว ไฟล์นี้ล็อก "เส้นทางจริง": ดึงข้อมูลจาก Prisma,
// แปลงวันที่, ทน climate ล่ม และส่ง KPI/ความเสี่ยงออกไปถูกสำนักงาน
import './setup-env';
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockModel, createTestServer, makeToken } from './helpers';
import { prisma } from '../src/lib/prisma';

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY);

interface State {
  plots: any[];
  groups: any[];
  silos: any[];
  climateRows: any[] | Error;
}

let state: State;

function group(patch: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    code: 'BROILER-01',
    species: 'POULTRY_BROILER',
    quantity: 100,
    birthDate: at(-20),
    status: 'ACTIVE',
    quarantineEndAt: null,
    records: [],
    schedules: [],
    dailyLogs: [],
    ...patch,
  };
}

beforeEach(() => {
  state = { plots: [], groups: [], silos: [], climateRows: [] };
  mockModel(prisma as any, 'farmPlot', { findMany: async () => state.plots });
  mockModel(prisma as any, 'livestockGroup', { findMany: async () => state.groups });
  mockModel(prisma as any, 'feedSilo', { findMany: async () => state.silos });
  // hypertable อ่านผ่าน raw SQL (เหมือน livestock dashboard)
  (prisma as any).$queryRawUnsafe = async () => {
    if (state.climateRows instanceof Error) throw state.climateRows;
    return state.climateRows;
  };
});

async function withServer(fn: (base: string) => Promise<void>) {
  const router = require('../src/modules/farm/farm.routes').default;
  const srv = await createTestServer((app) => app.use('/api/farm', router));
  try {
    await fn(srv.baseUrl);
  } finally {
    await srv.close();
  }
}

const auth = () => ({
  authorization: `Bearer ${makeToken('SUPERADMIN')}`,
});

describe('GET /api/farm/executive', () => {
  test('ไม่ล็อกอิน = 401', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/farm/executive`);
      assert.equal(res.status, 401);
    });
  });

  test('สภาวะปกติ = criticalCount 0 และ KPI ตรงกับข้อมูล', async () => {
    state.plots = [
      { id: 'p1', name: 'แปลง A', crop: 'ข้าว', status: 'harvested', expected_harvest_at: at(-5) },
    ];
    state.groups = [group()];
    state.silos = [{ siloCode: 'SILO-A', capacityKg: 1000, currentKg: 800 }];
    state.climateRows = [{ thi: 70, status: 'NORMAL' }];

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/farm/executive`, { headers: auth() });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      const body = (await res.json()) as any;
      assert.equal(body.kpis.criticalRisks, 0);
      assert.equal(body.kpis.animals, 100);
      assert.equal(body.kpis.plots, 1);
      assert.equal(body.kpis.growing, 0);
      assert.equal(body.kpis.latestThi, 70);
      assert.equal(body.risks.length, 0);
      assert.ok(body.generatedAt);
    });
  });

  test('ข้อมูลวิกฤต = คาย risk ครบและเรียง critical ก่อน', async () => {
    state.plots = [
      { id: 'p1', name: 'แปลงทุเรียน', crop: 'ทุเรียน', status: 'growing', expected_harvest_at: at(-2) },
    ];
    state.groups = [
      group({
        records: [
          { drugName: 'Enrofloxacin', safeHarvestDate: at(4) },
          { drugName: 'Amoxicillin', safeHarvestDate: at(-1) },
        ],
        schedules: [{ vaccineName: 'FMD', targetAgeDays: 7, isCompleted: false }],
        dailyLogs: [{ logDate: at(-1), mortalityCount: 5 }],
      }),
    ];
    state.silos = [{ siloCode: 'SILO-A', capacityKg: 1000, currentKg: 100 }];
    state.climateRows = [{ thi: 80, status: 'SEVERE' }];

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/farm/executive`, { headers: auth() });
      const body = (await res.json()) as any;
      assert.equal(res.status, 200);
      const ids = body.risks.map((r: any) => r.id);
      for (const id of [
        'plot-overdue-p1',
        'withdrawal-g1',
        'vaccine-g1',
        'mortality-g1',
        'silo-SILO-A',
        'climate-thi-critical',
      ]) {
        assert.ok(ids.includes(id), `ต้องมี ${id}`);
      }
      assert.ok(body.kpis.criticalRisks >= 5);
      assert.equal(body.kpis.overdueHarvests, 1);
      assert.equal(body.kpis.vaccineOverdue, 1);
      assert.equal(body.kpis.animalsInWithdrawal, 100);
      assert.equal(body.kpis.silosLow, 1);
      // เรียงแล้ว: critical ต้องมาก่อน warning/info ทั้งหมด
      const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      const ranks = body.risks.map((r: any) => rank[r.severity]);
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
      // ทุกความเสี่ยงต้องมี action + link ให้กดต่อได้
      for (const risk of body.risks) {
        assert.ok(risk.action && risk.link, `risk ${risk.id} ต้องมี action/link`);
      }
    });
  });

  test('ตาราง climate ล่ม = ยังตอบ 200 (THI เป็น null) ไม่ทำให้ทั้งหน้าล่ม', async () => {
    state.groups = [group()];
    state.climateRows = new Error('relation does not exist');

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/farm/executive`, { headers: auth() });
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;
      assert.equal(body.kpis.latestThi, null);
      assert.equal(body.kpis.animals, 100);
    });
  });
});
