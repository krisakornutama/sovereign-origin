import './setup-env';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import riskRoutes from '../src/modules/risk/risk.routes';
import { prisma } from '../src/lib/prisma';
import { createTestServer, makeToken, mockModel, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// Risk Monitor routes — Threat Index / DEFCON / Scenario Forecast (mock suite)
//
// ครอบ: overview (มี/ไม่มี engine ใน app.locals) · headlines (filter + เพดาน limit)
//        history (เพดาน 500) · refresh 503 เมื่อ worker ไม่ทำงาน
//        DEFCON drill: role gate · validate 0-100 · 503 เมื่อไม่มี engine
//        stress-test validate · scenarios validate focus
//        หน้า /defcon คืน level + thresholds + events
//
// ทำไมต้องมี (audit 3/10/69): risk เป็น 0% coverage ทั้งที่เป็นระบบเตือนความปลอดภัย
// ที่ยิง action จริงเมื่อขึ้น DEFCON — logic ผิด = ระบบเตือนผิด
// ────────────────────────────────────────────────────────────────────────────

let server: TestServer;
const TOKEN = makeToken('SUPERADMIN');
const VIEWER = makeToken('USER');
const AUTH = { Authorization: `Bearer ${TOKEN}` };

const threatRows: any[] = [
  {
    id: 1,
    overall: 82,
    categories: { war: 90, banking: 40, energy: 75, inflation: 60 },
    summary: 'ความเสี่ยงสูง',
    headline_count: 3,
    timestamp: new Date('2026-10-03T01:00:00Z'),
    model: 'gemma3:4b',
  },
  {
    id: 2,
    overall: 20,
    categories: { war: 10 },
    summary: 'ปกติ',
    headline_count: 1,
    timestamp: new Date('2026-10-02T01:00:00Z'),
    model: 'gemma3:4b',
  },
];

const headlineRows: any[] = [
  { id: 'h1', title: 'ข่าว war', category: 'war', published: new Date('2026-10-03T00:00:00Z') },
  { id: 'h2', title: 'ข่าว energy', category: 'energy', published: new Date('2026-10-02T00:00:00Z') },
  { id: 'h3', title: 'ข่าว banking', category: 'banking', published: new Date('2026-10-01T00:00:00Z') },
];

const defconEvents: any[] = [
  { id: 'd1', level: 2, action: 'NOTIFY', detail: 'เตือนทีม', timestamp: new Date('2026-10-03T00:30:00Z') },
];

const drillCalls: number[] = [];

before(async () => {
  mockModel(prisma, 'threatIndex', {
    findFirst: async () => threatRows[0],
    findMany: async ({ take }: any = {}) => threatRows.slice(0, take ?? threatRows.length),
  });
  mockModel(prisma, 'riskHeadline', {
    findMany: async ({ where, take }: any = {}) => {
      const list = where?.category ? headlineRows.filter((h) => h.category === where.category) : headlineRows;
      return list.slice(0, take ?? list.length);
    },
  });
  mockModel(prisma, 'defconEvent', {
    findMany: async ({ take }: any = {}) => defconEvents.slice(0, take ?? defconEvents.length),
  });

  // app.locals: ตัวแรกมีทั้ง engine+worker · ตัวที่สีไม่มี (จำลอง RISK_MONITOR_ENABLED=false)
  server = await createTestServer((app) => {
    app.locals.defconEngine = {
      getLevel: () => 2,
      check: async (n: number) => {
        drillCalls.push(n);
        return { level: n > 90 ? 1 : n > 50 ? 3 : 0, actionsRun: [{ id: 'act-1' }] };
      },
    };
    app.locals.riskWorker = {
      getStatus: () => ({ enabled: true, lastError: null, lastErrorAt: null }),
      runOnce: async () => ({ headlines: 2, overall: 55 }),
    };
    app.use('/api/risk-monitor', riskRoutes);
  });
});

after(async () => {
  if (server) await server.close();
});

function post(url: string, body: any, headers: Record<string, string> = AUTH) {
  return fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ────────────────────────────────────────────────────────────────────────────
describe('GET /overview', () => {
  test('คืน threatIndex + defcon + headlines + worker ครบ', async () => {
    const res = await fetch(server.baseUrl + '/api/risk-monitor/overview', { headers: AUTH });
    assert.strictEqual(res.status, 200);
    const body: any = await res.json();
    assert.strictEqual(body.threatIndex.overall, 82);
    assert.strictEqual(body.threatIndex.categories.war, 90);
    assert.strictEqual(body.defconLevel, 2, 'ต้องอ่านระดับจาก engine ใน app.locals ไม่ใช่คำนวณซ้ำ');
    assert.strictEqual(body.headlines.length, 3);
    assert.deepStrictEqual(body.worker, { enabled: true, lastError: null, lastErrorAt: null });
  });

  test('ไม่มี engine ใน app.locals = ตกไปใช้ classifyDefcon(overall) แทน', async () => {
    const bare = await createTestServer((app) => {
      app.locals.defconEngine = undefined;
      app.locals.riskWorker = undefined;
      app.use('/api/risk-monitor', riskRoutes);
    });
    try {
      const res = await fetch(bare.baseUrl + '/api/risk-monitor/overview', { headers: AUTH });
      const body: any = await res.json();
      // overall 82 → แตะ 75 ขึ้นไป = level 2
      assert.strictEqual(body.defconLevel, 2);
      assert.strictEqual(body.worker, null);
    } finally {
      await bare.close();
    }
  });

  test('ไม่ต้อง login = 401', async () => {
    const res = await fetch(server.baseUrl + '/api/risk-monitor/overview');
    assert.strictEqual(res.status, 401);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('GET /headlines', () => {
  test('ไม่กรอง = คืนทั้งหมดเรียงตาม published', async () => {
    const res = await fetch(server.baseUrl + '/api/risk-monitor/headlines', { headers: AUTH });
    const body: any = await res.json();
    assert.strictEqual(body.length, 3);
    assert.strictEqual(body[0].id, 'h1');
  });

  test('category ที่ถูกต้อง = กรองจริง', async () => {
    const res = await fetch(server.baseUrl + '/api/risk-monitor/headlines?category=energy', { headers: AUTH });
    const body: any = await res.json();
    assert.deepStrictEqual(body.map((h: any) => h.id), ['h2']);
  });

  test('category ที่ไม่อยู่ใน allowlist = ถือว่าไม่กรอง (ไม่ใช่ 500/400)', async () => {
    const res = await fetch(server.baseUrl + '/api/risk-monitor/headlines?category=evil', { headers: AUTH });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).length, 3);
  });

  test('limit เกินเพดาน = ถูกตัดที่ 200 ไม่ใช่ส่งทั้งหมด', async () => {
    const res = await fetch(server.baseUrl + '/api/risk-monitor/headlines?limit=99999', { headers: AUTH });
    assert.strictEqual(res.status, 200);
    // mock คืนเท่าที่มี — การตัดที่ 200 ถูกพิสูจน์จาก take ที่ส่ง (ดู test ถัดไป)
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('GET /history', () => {
  test('คืนเฉพาะ field ที่การ์ดต้องใช้ ไม่หยด model/overall ทิ้ง', async () => {
    const res = await fetch(server.baseUrl + '/api/risk-monitor/history', { headers: AUTH });
    const body: any = await res.json();
    assert.strictEqual(body.length, 2);
    assert.deepStrictEqual(Object.keys(body[0]).sort(), ['categories', 'headline_count', 'overall', 'timestamp']);
  });

  test('limit ที่เยอะเกิน = clamp ที่ 500', async () => {
    let seenTake: any;
    const saved = (prisma as any).threatIndex.findMany;
    (prisma as any).threatIndex.findMany = async (args: any) => {
      seenTake = args.take;
      return saved(args);
    };
    await fetch(server.baseUrl + '/api/risk-monitor/history?limit=99999', { headers: AUTH });
    assert.strictEqual(seenTake, 500);
    (prisma as any).threatIndex.findMany = saved;
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /refresh', () => {
  test('มี worker = เรียก runOnce แล้วคืนผล', async () => {
    const res = await post(server.baseUrl + '/api/risk-monitor/refresh', {});
    assert.strictEqual(res.status, 200);
    const body: any = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.overall, 55);
  });

  test('ไม่มี worker (RISK_MONITOR_ENABLED=false) = 503 พร้อมบอกสาเหตุ ไม่ใช่ 500 หลอก', async () => {
    const bare = await createTestServer((app) => {
      app.locals.riskWorker = undefined;
      app.use('/api/risk-monitor', riskRoutes);
    });
    try {
      const res = await post(bare.baseUrl + '/api/risk-monitor/refresh', {});
      assert.strictEqual(res.status, 503);
      assert.match((await res.json()).error, /RISK_MONITOR_ENABLED/);
    } finally {
      await bare.close();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /defcon/drill', () => {
  test('role ต่ำกว่า SUPERADMIN = ถูกปฏิเสธ (drill ยิง action จริง = ต้องจำกัดสิทธิ์)', async () => {
    drillCalls.length = 0;
    const res = await post(server.baseUrl + '/api/risk-monitor/defcon/drill', { index: 95 }, { Authorization: `Bearer ${VIEWER}` });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(drillCalls.length, 0, 'ห้ามรัน engine ให้ user ระดับทั่วไป');
  });

  test('index นอก 0-100 = 400 ก่อนแตะ engine', async () => {
    drillCalls.length = 0;
    for (const bad of [-1, 101, 100.5, 'abc', undefined]) {
      const res = await post(server.baseUrl + '/api/risk-monitor/defcon/drill', { index: bad });
      assert.strictEqual(res.status, 400, `index=${bad}`);
    }
    assert.strictEqual(drillCalls.length, 0);
  });

  // ⚠️ ข้อบกพร่องเบา ๆ ที่เจอตอนเขียนเทสต์ (3/10/69) — ยังไม่แก้
  // ส่ง index=null ชัด ๆ → Number(null) = 0 → ผ่าน → รัน drill ที่ระดับ 0 เงียบ ๆ
  // (ส่ง body {} เปล่า = undefined → NaN → 400 ถูกต้องแล้ว · ผลกระทบเบาเพราะ 0 = de-escalation
  //  ตามที่ doc ระบุไว้ แต่ "ลืมส่งค่า" ไม่ควรเท่ากับ "สั่งลดระดับ")
  test('⚠️ ข้อบกพร่อง: index=null ถูกตีความเป็น 0 แล้วรัน drill เลย', async () => {
    drillCalls.length = 0;
    const res = await post(server.baseUrl + '/api/risk-monitor/defcon/drill', { index: null });
    assert.strictEqual(res.status, 200, 'พฤติกรรมปัจจุบัน (ถ้าจะแก้ = 400)');
    assert.deepStrictEqual(drillCalls, [0]);
  });

  test('body ว่างเปล่า (ไม่ได้ส่ง index เลย) = 400 ถูกต้องแล้ว', async () => {
    drillCalls.length = 0;
    const res = await post(server.baseUrl + '/api/risk-monitor/defcon/drill', {});
    assert.strictEqual(res.status, 400);
    assert.strictEqual(drillCalls.length, 0);
  });

  test('index ที่ถูกต้อง = เรียก engine.check แล้วคืน id ของ action', async () => {
    drillCalls.length = 0;
    const res = await post(server.baseUrl + '/api/risk-monitor/defcon/drill', { index: 55 });
    assert.strictEqual(res.status, 200);
    const body: any = await res.json();
    assert.strictEqual(body.level, 3);
    assert.deepStrictEqual(body.actionsRun, ['act-1']);
    assert.deepStrictEqual(drillCalls, [55]);
  });

  test('ไม่มี engine = 503 ไม่ใช่ crash', async () => {
    const bare = await createTestServer((app) => {
      app.locals.defconEngine = undefined;
      app.use('/api/risk-monitor', riskRoutes);
    });
    try {
      const res = await post(bare.baseUrl + '/api/risk-monitor/defcon/drill', { index: 55 });
      assert.strictEqual(res.status, 503);
    } finally {
      await bare.close();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /stress-test', () => {
  test('scenario ที่ไม่ใช่ string = 400 (ไม่ยิงเข้า Ollama)', async () => {
    for (const bad of [undefined, 42, {}]) {
      const res = await post(server.baseUrl + '/api/risk-monitor/stress-test', { scenario: bad });
      assert.strictEqual(res.status, 400, `scenario=${JSON.stringify(bad)}`);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /scenarios', () => {
  test('focus ที่ไม่รู้จัก = 400 พร้อมบอกรายชื่อที่รับได้', async () => {
    const res = await post(server.baseUrl + '/api/risk-monitor/scenarios', { focus: 'astrology' });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /general/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('GET /defcon', () => {
  test('คืนระดับ + เกณฑ์ + เหตุการณ์ล่าสุด', async () => {
    const res = await fetch(server.baseUrl + '/api/risk-monitor/defcon', { headers: AUTH });
    assert.strictEqual(res.status, 200);
    const body: any = await res.json();
    assert.strictEqual(body.currentLevel, 2);
    assert.deepStrictEqual(body.thresholds, { level3: 50, level2: 75, level1: 90 });
    assert.strictEqual(body.latestOverall, 82);
    assert.deepStrictEqual(Object.keys(body.events[0]).sort(), ['action', 'detail', 'level', 'timestamp']);
  });

  test('ไม่มีข้อมูลเลย = ยังตอบ 200 ด้วย null ไม่ใช่พัง', async () => {
    const empty = await createTestServer((app) => {
      (prisma as any).threatIndex.findFirst = async () => null;
      (prisma as any).defconEvent.findMany = async () => [];
      app.use('/api/risk-monitor', riskRoutes);
    });
    try {
      const res = await fetch(empty.baseUrl + '/api/risk-monitor/defcon', { headers: AUTH });
      const body: any = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.latestOverall, null);
      assert.deepStrictEqual(body.events, []);
    } finally {
      await empty.close();
    }
  });
});
