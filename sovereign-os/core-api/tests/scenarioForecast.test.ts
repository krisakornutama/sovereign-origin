// tests/scenarioForecast.test.ts — ครอบ scenario-forecast.service.ts (เดิม 0%)
// 1) parseForecastResponse — pure parser ต้องกลั่นผล AI ให้สะอาดเสมอ (กัน output เพี้ยน)
// 2) generateScenarios — เมื่อ Ollama ออฟไลน์ ต้อง fallback จาก Threat Index แบบ deterministic และ persist ลง DB
import 'dotenv/config';
import './setup-env';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer, mockModel, type TestServer } from './helpers';

let mod: typeof import('../src/services/scenario-forecast.service');

before(async () => {
  // mock prisma ก่อน import service (loaders + persist ใช้ prisma ตรง ๆ)
  const { prisma } = await import('../src/lib/prisma');
  mockModel(prisma, 'systemSetting', { findUnique: async () => null });
  mockModel(prisma, 'riskHeadline', { findMany: async () => [], count: async () => 0 });
  mockModel(prisma, 'threatIndex', { findFirst: async () => null });
  mockModel(prisma, 'scenarioForecast', {
    findMany: async () => [],
    findFirst: async () => null,
    create: async (a: any) => ({ id: 'f1', ...a.data }),
  });
  mod = await import('../src/services/scenario-forecast.service');
});

describe('parseForecastResponse — กลั่นคำตอบ AI เป็นโครงที่อ่านได้', () => {
  test('JSON ล้อม markdown fence ก็อ่านได้ + เรียงตาม probability มาก→น้อย', () => {
    const raw = '```json\n{"summary":"สรุปรวม","scenarios":[' +
      '{"title":"เรื่องเบา","probability":30,"impact":"low","horizonDays":10},' +
      '{"title":"เรื่องหนัก","probability":90,"impact":"critical","horizonDays":5}' +
      ']}\n```';
    const out = mod.parseForecastResponse(raw, 'general', 90);
    assert.ok(out, 'ต้อง parse ได้');
    assert.equal(out!.summary, 'สรุปรวม');
    assert.equal(out!.scenarios.length, 2);
    assert.equal(out!.scenarios[0].title, 'เรื่องหนัก'); // 90 มาก่อน 30
    assert.equal(out!.scenarios[0].impact, 'critical');
    assert.equal(out!.scenarios[1].horizonDays, 10);
  });

  test('ค่าเพี้ยนถูก clamp/correct: probability ติดลบ→0, เกิน 100→100, horizon>param ถูกหด, category/impact แปลก→default', () => {
    const raw = JSON.stringify({
      scenarios: [
        { title: 'A', probability: -5, horizonDays: 999, category: 'WEIRD', impact: 'EXPLOSION' },
        { title: 'B', probability: 150, horizonDays: 0 },
        { title: '   ', probability: 50 },            // ไม่มี title จริง → ตัดทิ้ง
        'ขยะ',                                        // ไม่ใช่ object → ข้าม
        { probability: 10 },                          // ไม่มี title → ตัดทิ้ง
      ],
    });
    const out = mod.parseForecastResponse(raw, 'security', 60);
    assert.ok(out);
    assert.equal(out!.scenarios.length, 2);
    const [b, a] = out!.scenarios; // เรียงมาก→น้อย: B (100) มาก่อน A (0)
    assert.equal(a.probability, 0);
    assert.equal(a.horizonDays, 60);
    assert.equal(a.category, 'security');
    assert.equal(a.impact, 'medium');
    assert.equal(b.probability, 100);
    assert.equal(b.horizonDays, 60);
    assert.ok(!out!.scenarios.some((s) => !s.title.trim())); // ไม่เหลือ title เปล่า
  });

  test('ไม่มี JSON / JSON พัง → คืน null (ไม่ throw)', () => {
    assert.equal(mod.parseForecastResponse('', 'general', 90), null);
    assert.equal(mod.parseForecastResponse('ไม่มี JSON เลยสักติ้ว', 'general', 90), null);
    assert.equal(mod.parseForecastResponse('{ broken', 'general', 90), null);
    assert.equal(mod.parseForecastResponse('{"scenarios":[]}', 'general', 90), null); // ว่าง → null
  });
});

describe('generateScenarios — เส้นทาง Ollama offline (fallback deterministic)', () => {
  let s: TestServer;
  let created: any[] = [];

  before(async () => {
    // prisma ตัวจริงไม่มี DB (setup-env) — mock model ให้ loaders คืนค่าว่างและจับ create เก็บไว้ดู
    const { prisma } = await import('../src/lib/prisma');
    mockModel(prisma, 'riskHeadline', { findMany: async () => [], count: async () => 0 });
    mockModel(prisma, 'threatIndex', { findFirst: async () => null });
    s = await createTestServer(() => { /* ไม่ต้องมี route — เรียก service ตรง */ });
  });

  after(async () => s.close());

  test('Ollama ออฟไลน์ → source=fallback, มี scenarios ≥3, persist ลง DB, โครง result ครบ', async () => {
    const { prisma } = await import('../src/lib/prisma');
    // threatIndex ไม่มีข้อมูล → fallback ใช้พื้นฐาน 50/40
    mockModel(prisma, 'threatIndex', { findFirst: async () => null });
    mockModel(prisma, 'scenarioForecast', {
      findMany: async () => [],
      findFirst: async () => null,
      create: async (a: any) => { created.push(a.data); return { id: 'f2', ...a.data }; },
    });
    (globalThis as any).__forecastCreated = created;

    const res = await mod.generateScenarios({ focus: 'security', horizonDays: 30 });
    assert.equal(res.source, 'fallback');
    assert.equal(res.offline, true);
    assert.equal(res.focus, 'security');
    assert.equal(res.horizonDays, 30);
    assert.ok(res.scenarios.length >= 3, `fallback ต้องมี ≥3 ข้อ (ได้ ${res.scenarios.length})`);
    for (const sc of res.scenarios) {
      assert.ok(sc.title.length > 0);
      assert.ok(sc.probability >= 0 && sc.probability <= 100);
      assert.ok(sc.horizonDays >= 1 && sc.horizonDays <= 30);
      assert.ok(['critical', 'high', 'medium', 'low'].includes(sc.impact));
    }
    assert.ok(res.scenarios.some((sc) => sc.category === 'security'), 'โฟกัส security ต้องมีข้อ security');
    // deterministic — เรียกซ้ำได้ผลเดิม
    const res2 = await mod.generateScenarios({ focus: 'security', horizonDays: 30 });
    assert.deepEqual(res2.scenarios, res.scenarios);
    // persist เกิดขึ้นจริง (ประวัติ = อดีตของรอบถัดไป)
    assert.equal(created.length, 2);
    assert.equal(created[0].focus, 'security');
  });

  test('FOCUS แปลก → ตกไป general อย่างปลอดภัย', async () => {
    const res = await mod.generateScenarios({ focus: 'สมรภูมิบ้านแตก' as never, horizonDays: 7 });
    assert.equal(res.focus, 'general');
    assert.equal(res.source, 'fallback');
    assert.ok(res.scenarios.length >= 3);
  });
});
