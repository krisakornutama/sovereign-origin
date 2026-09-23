import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import farmRoutes, { prisma } from '../src/modules/farm/farm.routes';
import { createTestServer, makeToken, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// เฟส 3 — Farm Advisor: แนะนำการปลูก + คาดการณ์ผลผลิต (mock suite)
// กฎเหล็กที่เทสต้องจับ: heuristic ตอบได้เสมอ ไม่ว่า Ollama ล้ม/ช้า/ไม่มี
// แหล่งที่มาชัดเจน (source) และตัวเลขต้องตรงสูตรที่ประกาศ
// ────────────────────────────────────────────────────────────────────────────

const PLOT = '22222222-2222-2222-2222-222222222222';
const PLOT2 = '33333333-3333-3333-3333-333333333333';
const PLOT3 = '44444444-4444-4444-4444-444444444444';

// กันเทสไปชน Ollama จริงบนเครื่อง — ชี้พอร์ตปิด (ECONNREFUSED ทันที) + timeout สั้น
// (ค่าถูกอ่านตอน dynamic import ครั้งแรกที่มี request — หลังบรรทัดนี้เสมอ)
process.env.OLLAMA_URL = 'http://127.0.0.1:59999';
process.env.FARM_ADVISOR_TIMEOUT_MS = '1000';

let server: TestServer;
const plots: any[] = [
  { id: PLOT, name: 'แปลงมะเขือเทศ', location: 'โซน A', crop: 'มะเขือเทศ', area_sqm: 20, status: 'growing', created_at: new Date(), updated_at: new Date() },
  { id: PLOT2, name: 'แปลงพริก', location: 'โซน B', crop: null, area_sqm: 50, status: 'fallow', created_at: new Date(), updated_at: new Date() },
  { id: PLOT3, name: 'แปลงเพื่อนบ้าน', location: 'โซน C', crop: null, area_sqm: 50, status: 'harvested', created_at: new Date(), updated_at: new Date() },
];
const soilReadings: any[] = [
  // ดินดีตามมะเขือเทศ — คะแนนควรสูง
  { id: 'sr-1', plot_id: PLOT, n: 50, p: 40, k: 65, ph: 6.4, moisture_pct: 68, ec: 1.5, note: null, recorded_at: new Date('2026-09-20T00:00:00Z') },
];
const lots: any[] = [
  // ประวัติแปลงนี้: มะเขือเทศเก็บไป 2 ครั้ง รวม 55 กก. → 2.75 กก./ตร.ม.
  { id: 'lot-1', lotCode: 'LOT-A', plotId: PLOT, crop: 'มะเขือเทศ', quantityKg: 30, harvestedAt: new Date('2026-08-01') },
  { id: 'lot-2', lotCode: 'LOT-B', plotId: PLOT, crop: 'มะเขือเทศ', quantityKg: 25, harvestedAt: new Date('2026-09-01') },
  // ประวัติแปลงอื่น (PLOT3): พริก 60 กก. / 50 ตร.ม. = 1.2 กก./ตร.ม. (global-history สำหรับแปลงพริก)
  { id: 'lot-3', lotCode: 'LOT-C', plotId: PLOT3, crop: 'พริก', quantityKg: 60, harvestedAt: new Date('2026-09-05') },
];

before(async () => {
  (prisma as any).farmPlot = {
    findUnique: async ({ where }: any) => plots.find((p) => p.id === where.id) ?? null,
    findMany: async () => plots,
  };
  (prisma as any).farmSoilReading = {
    findFirst: async ({ where }: any) =>
      soilReadings.filter((r) => r.plot_id === where.plot_id).sort((a, b) => b.recorded_at.getTime() - a.recorded_at.getTime())[0] ?? null,
  };
  (prisma as any).productLot = {
    findUnique: async () => null,
    findMany: async (args?: any) => {
      const where = args?.where;
      return where?.plotId ? lots.filter((l) => l.plotId === where.plotId) : lots;
    },
    create: async ({ data }: any) => ({ id: 'lot-new', ...data }),
  };
  (prisma as any).traceEvent = { create: async ({ data }: any) => ({ id: 'ev-new', ...data }) };
  (prisma as any).inventoryItem = { create: async ({ data }: any) => ({ id: 'inv-new', ...data }) };

  server = await createTestServer((app) => app.use('/api/farm/plots', farmRoutes));
});

after(async () => {
  if (server) await server.close();
});

const get = (path: string) =>
  fetch(`${server.baseUrl}/api/farm/plots${path}`, { headers: { Authorization: `Bearer ${makeToken('SUPERADMIN')}` } });

test('GET /:id/advisor — heuristic ตอบได้เสมอ (ไม่มี AI) + ที่มาตัวเลขชัดเจน', async () => {
  const res = await get(`/${PLOT}/advisor`);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.source, 'heuristic');
  assert.equal(body.plotId, PLOT);
  assert.equal(body.currentCrop, 'มะเขือเทศ');
  assert.equal(body.hasSoilData, true);

  // ประวัติแปลง: 55 กก. / 20 ตร.ม. = 2.75 กก./ตร.ม. → expected 55 กก.
  const tomato = body.recommendations.find((r: any) => r.crop === 'มะเขือเทศ');
  assert.ok(tomato, 'มีคำแนะนำมะเขือเทศ');
  assert.equal(tomato.basis, 'history');
  assert.equal(tomato.perSqmKg, 2.75);
  assert.equal(tomato.expectedKg, 55);
  assert.equal(tomato.boosted, true);
  assert.ok(tomato.score > 85, `ดินดี + เคยปลูก = คะแนนสูง (ได้ ${tomato.score})`);
  assert.ok(body.recommendations.length >= 1 && body.recommendations.length <= 3);

  // forecast พืชที่ปลูกอยู่
  assert.equal(body.forecast.crop, 'มะเขือเทศ');
  assert.equal(body.forecast.expectedKg, 55);
  assert.equal(body.harvestHistory.lots, 2);
  assert.equal(body.harvestHistory.totalKg, 55);
});

test('GET /:id/advisor — global-history: แปลงไม่มีประวัติเอง แต่แปลงอื่นปลูกพริกมา', async () => {
  const res = await get(`/${PLOT2}/advisor`);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  const chili = body.recommendations.find((r: any) => r.crop === 'พริก');
  assert.ok(chili, 'มีคำแนะนำพริก');
  assert.equal(chili.basis, 'global-history');
  assert.equal(chili.perSqmKg, 1.2); // 60/50 จากแปลงอื่น
  assert.equal(chili.expectedKg, 60); // 1.2 × 50 ตร.ม.
  assert.equal(chili.boosted, false);
  // แปลงนี้ไม่มีค่าดิน — คะแนนเริ่มกลาง 50
  assert.equal(body.hasSoilData, false);
  assert.ok(chili.reasons.some((x: string) => x.includes('ยังไม่มีค่าดินล่าสุด')));
});

test('GET /:id/advisor — estimate เมื่อไม่มีประวัติทั้งระบบ + จัดอันดับพืชมีหลักฐานก่อนพืชคาดเดา', async () => {
  // พืชที่ไม่มีใครปลูกเลย (เช่น ข้าว) ต้อง basis=estimate และ perSqmKg ตรง baseline — ขอครบทุกพืช (18 ชนิด)
  const res = await get(`/${PLOT2}/advisor?top=18`);
  const body: any = await res.json();
  const rice = body.recommendations.find((r: any) => r.crop === 'ข้าว');
  assert.ok(rice, 'ข้าวต้องอยู่ในรายการครบทุกพืช');
  assert.equal(rice.basis, 'estimate');
  assert.equal(rice.perSqmKg, 0.65);
  assert.equal(rice.expectedKg, 32.5); // 0.65 × 50
  // จัดเรียง: พืชมีหลักฐานจริง (พริก global-history) ต้องอยู่ก่อนพืช estimate ทั้งหมด
  const idxChili = body.recommendations.findIndex((r: any) => r.crop === 'พริก');
  const idxRice = body.recommendations.findIndex((r: any) => r.crop === 'ข้าว');
  assert.ok(idxChili < idxRice, 'พืชมีหลักฐานจริงต้องจัดก่อนพืชคาดเดา');
  // ในกลุ่ม estimate เรียงตามผลผลิตคาดการณ์: อ้อย (7.0) ก่อนข้าว (0.65)
  const idxSugarcane = body.recommendations.findIndex((r: any) => r.crop === 'อ้อย');
  assert.ok(idxSugarcane < idxRice, 'อ้อยคาดผลผลิตสูงกว่า ต้องจัดก่อนข้าว');
});

test('GET /:id/advisor?ai=1 — Ollama ตอบจริง → source=ollama + aiText; ล้ม/หมดเวลา → fallback heuristic ครบ', async () => {
  // ai=1 โดยไม่มี Ollama จริงในเทส (axios ยิง 127.0.0.1:11434 ที่ไม่มีเซิร์ฟเวอร์) → fallback
  const res = await get(`/${PLOT}/advisor?ai=1`);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.source, 'heuristic');
  assert.equal(body.aiText, null);
  // กฎเหล็ก: ยังได้คำแนะนำ + คาดการณ์ครบถ้วนแม้ AI ล้ม
  assert.ok(body.recommendations.length >= 1);
  assert.ok(body.forecast);
  assert.equal(body.forecast.expectedKg, 55);
}, { timeout: 15000 });

test('GET /:id/advisor — 404 เมื่อแปลงไม่พบ', async () => {
  const res = await get('/99999999-9999-9999-9999-999999999999/advisor');
  assert.equal(res.status, 404);
});

test('askFarmAdvisor — inject llm ตอบ → source=ollama (เส้นทาง DI เดียวกับ advisor เดิม)', async () => {
  const { askFarmAdvisor } = await import('../src/services/farm-advisor.service');
  const result = await askFarmAdvisor(PLOT, { llm: async () => 'คำตอบจาก AI จำลอง' });
  assert.equal(result.source, 'ollama');
  assert.equal(result.aiText, 'คำตอบจาก AI จำลอง');
  assert.ok(result.heuristic.recommendations.length >= 1);
  assert.ok(result.heuristicText.includes('แปลงมะเขือเทศ'));
});

test('askFarmAdvisor — llm throw → fallback heuristic (source=heuristic) ไม่พัง', async () => {
  const { askFarmAdvisor } = await import('../src/services/farm-advisor.service');
  const result = await askFarmAdvisor(PLOT, { llm: async () => { throw new Error('ollama down'); } });
  assert.equal(result.source, 'heuristic');
  assert.equal(result.aiText, null);
  assert.ok(result.heuristicText.includes('คาดการณ์ผลผลิต'));
});
