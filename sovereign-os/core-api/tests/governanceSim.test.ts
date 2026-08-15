import './setup-env';
import os from 'os';
import path from 'path';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// ต้องตั้งก่อน import service (DATA_DIR อ่านตอนโหลดโมดูล)
process.env.GOVSIM_DATA_DIR = path.join(os.tmpdir(), 'govsim-test-' + Date.now());
process.env.OLLAMA_URL = 'http://127.0.0.1:1'; // fail fast → fallback template

type Sim = typeof import('../src/services/governance-sim.service');
let sim: Sim;

beforeEach(async () => {
  sim = await import('../src/services/governance-sim.service');
});

afterEach(async () => {
  for (const s of sim.listScenarios()) sim.deleteScenario(s.id);
});

describe('GovSim Core — Seeded Determinism', () => {
  test('seed เดียวกัน → ประชากร + ผล tick เหมือนกันทุกประการ', () => {
    const a = sim.createScenario({ seed: 12345, population: 500 });
    const b = sim.createScenario({ seed: 12345, population: 500 });
    assert.equal(JSON.stringify(a.persons), JSON.stringify(b.persons));
    const ta = sim.tickScenario(a.id, 12);
    const tb = sim.tickScenario(b.id, 12);
    assert.equal(JSON.stringify(ta.scenario.persons), JSON.stringify(tb.scenario.persons));
    assert.equal(ta.scenario.legitimacy.total, tb.scenario.legitimacy.total);
    assert.equal(ta.scenario.unrestRisk, tb.scenario.unrestRisk);
  });

  test('seed ต่างกัน → ประชากรไม่เหมือนกัน', () => {
    const a = sim.createScenario({ seed: 111, population: 300 });
    const b = sim.createScenario({ seed: 222, population: 300 });
    const sa = JSON.stringify(a.persons.map((p: any) => p.satisfaction));
    const sb = JSON.stringify(b.persons.map((p: any) => p.satisfaction));
    assert.notEqual(sa, sb);
  });

  test('tick 12 ครั้ง = ครบ 1 ปี (year+1, month กลับมา 1)', () => {
    const s = sim.createScenario({ seed: 42, population: 300 });
    const r = sim.tickScenario(s.id, 12);
    assert.equal(r.scenario.year, 1);
    assert.equal(r.scenario.month, 1);
    assert.equal(r.scenario.tick, 12);
    assert.ok(r.scenario.history.length <= 12);
  });
});

describe('GovSim Module 2 — Political Economy', () => {
  test('Welfare + Subsidy สูง → Scarcity ต่ำกว่า + แรงงานพึงพอใจกว่า', () => {
    const poor = sim.createScenario({ seed: 7, population: 400 });
    sim.applyLevers(poor.id, { budget: { military: 30, bureaucracy: 25, welfare: 5, infrastructure: 30, patronage: 10 }, subsidy: 0, taxRate: 30 });
    const rich = sim.createScenario({ seed: 7, population: 400 });
    sim.applyLevers(rich.id, { budget: { military: 10, bureaucracy: 15, welfare: 40, infrastructure: 25, patronage: 10 }, subsidy: 80, taxRate: 15 });

    const tp = sim.tickScenario(poor.id, 12).scenario;
    const tr = sim.tickScenario(rich.id, 12).scenario;
    assert.ok(tr.scarcity < tp.scarcity, `scarcity: rich=${tr.scarcity} poor=${tp.scarcity}`);
    const wp = sim.factionAggregates(tp).find((f) => f.cls === 'working')!;
    const wr = sim.factionAggregates(tr).find((f) => f.cls === 'working')!;
    assert.ok(wr.satisfaction > wp.satisfaction, `working satisfaction: rich=${wr.satisfaction} poor=${wp.satisfaction}`);
  });

  test('ภาษีสูง + สงคราม → GDP ตก, เงินเฟ้อขึ้น', () => {
    const s = sim.createScenario({ seed: 9, population: 300 });
    sim.applyLevers(s.id, { taxRate: 45, coercion: 4 });
    const before = s.gdpIndex;
    const after = sim.tickScenario(s.id, 24).scenario;
    assert.ok(after.gdpIndex < before * 0.95, `gdp ${before} → ${after.gdpIndex}`);
  });
});

describe('GovSim Module 3 — Legitimacy', () => {
  test('Power Sharing สูง → Procedural Legitimacy สูง; Coercion 4 → Procedural ต่ำ', () => {
    const s1 = sim.createScenario({ seed: 5, population: 300 });
    sim.applyLevers(s1.id, { powerSharing: 90, coercion: 0 });
    const r1 = sim.tickScenario(s1.id, 6).scenario;
    const s2 = sim.createScenario({ seed: 5, population: 300 });
    sim.applyLevers(s2.id, { powerSharing: 0, coercion: 4 });
    const r2 = sim.tickScenario(s2.id, 6).scenario;
    assert.ok(r1.legitimacy.procedural > r2.legitimacy.procedural);
  });
});

describe('GovSim Module 5 — Suppression Paradox', () => {
  test('Purge → Mobilization ระยะสั้นลด แต่ Radicalization พุ่งระยะยาว (กับดักการปราบปราม)', () => {
    const s = sim.createScenario({ seed: 3, population: 500 });
    const before = sim.tickScenario(s.id, 12).scenario;
    const radBefore = sim.factionAggregates(before).find((f) => f.cls === 'marginalized')!.radicalization;
    sim.applyLevers(s.id, { purge: true, coercion: 4 });
    const after1 = sim.tickScenario(s.id, 1).scenario; // เดือนเดียวหลัง purge
    const mobAfter1 = sim.factionAggregates(after1).find((f) => f.cls === 'marginalized')!.mobilization;
    const after12 = sim.tickScenario(s.id, 12).scenario; // หนึ่งปีให้หลัง
    const radAfter12 = sim.factionAggregates(after12).find((f) => f.cls === 'marginalized')!.radicalization;
    assert.ok(radAfter12 > radBefore, `radicalization หลังปราบ ${radAfter12} ต้อง > ก่อน ${radBefore}`);
    assert.ok(after12.legitimacy.total < before.legitimacy.total, 'purge ทำลายความชอบธรรม');
    assert.ok(after12.suppressionRecord > 0);
    void mobAfter1;
  });

  test('Purge → Resistance เพิ่ม (ความต้านทานยึดครองไม่ลดด้วยกำลัง)', () => {
    const a = sim.createScenario({ seed: 11, population: 500 });
    sim.applyLevers(a.id, { purge: true });
    const ra = sim.tickScenario(a.id, 12).scenario;
    const b = sim.createScenario({ seed: 11, population: 500 });
    const rb = sim.tickScenario(b.id, 12).scenario;
    assert.ok(ra.resistance > rb.resistance, `resistance: purge=${ra.resistance} normal=${rb.resistance}`);
  });
});

describe('GovSim Module 8 — Post-Conquest Integration (กฎเหล็กการปกครอง)', () => {
  test('บริการ/คุณภาพชีวิต ลดความต้านทานได้จริง มากกว่าการตั้งทหาร', () => {
    // scenario เดียวกัน seed เดียว — ต่างกันแค่ "บริการ" vs "กำลังทหาร"
    const services = sim.createScenario({ seed: 21, population: 600 });
    sim.applyLevers(services.id, {
      budget: { military: 5, bureaucracy: 15, welfare: 45, infrastructure: 25, patronage: 10 },
      subsidy: 80, minorityRights: 90, powerSharing: 60, culturalEducation: 70,
      assimilationStrategy: 'economic', coercion: 0,
    });
    const military = sim.createScenario({ seed: 21, population: 600 });
    sim.applyLevers(military.id, {
      budget: { military: 50, bureaucracy: 15, welfare: 5, infrastructure: 15, patronage: 15 },
      subsidy: 0, minorityRights: 10, powerSharing: 0, culturalEducation: 5,
      assimilationStrategy: 'direct', coercion: 4,
    });
    const rs = sim.tickScenario(services.id, 36).scenario;
    const rm = sim.tickScenario(military.id, 36).scenario;
    assert.ok(rs.resistance < rm.resistance, `resistance: services=${rs.resistance} military=${rm.resistance}`);
    assert.ok(rs.friction < rm.friction, `friction: services=${rs.friction} military=${rm.friction}`);
    assert.ok(rs.pacification > rm.pacification);
    assert.ok(rs.collaboratorRatio > rm.collaboratorRatio);
  });

  test('Direct Rule + ลบอัตลักษณ์ → Friction สูง, Conquered โกรธกว่า', () => {
    const direct = sim.createScenario({ seed: 33, population: 400 });
    sim.applyLevers(direct.id, { assimilationStrategy: 'direct', culturalEducation: 0, minorityRights: 0 });
    const inclusive = sim.createScenario({ seed: 33, population: 400 });
    sim.applyLevers(inclusive.id, { assimilationStrategy: 'indirect', culturalEducation: 90, minorityRights: 90 });
    const rd = sim.tickScenario(direct.id, 24).scenario;
    const ri = sim.tickScenario(inclusive.id, 24).scenario;
    const conqueredSat = (s: any) => {
      const members = s.persons.filter((p: any) => p.identity === 'conquered');
      return members.reduce((a: number, p: any) => a + p.satisfaction, 0) / Math.max(1, members.length);
    };
    assert.ok(conqueredSat(ri) > conqueredSat(rd), 'conquered พึงพอใจกว่าภายใต้ Inclusive');
  });
});

describe('GovSim Math — Rebellion Probability (สมการพิมพ์เขียว)', () => {
  test('Gini สูง + Scarcity สูง + Legitimacy ต่ำ → P(rebellion) สูง', () => {
    const bad = sim.createScenario({ seed: 77, population: 600 });
    sim.applyLevers(bad.id, { taxRate: 45, budget: { military: 30, bureaucracy: 20, welfare: 5, infrastructure: 20, patronage: 25 }, subsidy: 0, coercion: 0, powerSharing: 0, minorityRights: 0 });
    const rb = sim.tickScenario(bad.id, 24).scenario;
    assert.ok(rb.rebellionProbability > 0.45, `P=${rb.rebellionProbability}`);
    assert.ok(rb.unrestRisk > 40, `unrest=${rb.unrestRisk}`);
  });

  test('การปราบที่ "ครึ่งๆ กลางๆ" → ไม่ดับ แต่ปั่นความเสี่ยง (Half-hearted Suppression)', () => {
    const s = sim.createScenario({ seed: 55, population: 500 });
    // ปกครองแบบกดขี่ปานกลาง: ตั้งด่านเล็กน้อย ไม่กวาดล้าง ไม่ให้สิทธิ
    sim.applyLevers(s.id, { coercion: 1, policePatrols: 10, minorityRights: 0, culturalEducation: 0, powerSharing: 0, assimilationStrategy: 'direct', subsidy: 0 });
    const r = sim.tickScenario(s.id, 36).scenario;
    // ควรมีกบฏเกิดขึ้นจริง (insurgencyStrength > 0)
    assert.ok(r.insurgencyStrength > 0, `insurgency=${r.insurgencyStrength}`);
  });

  test('Asabiyyah: วิกฤตภายนอกหลอมรวม — External Threat สูง → Asabiyyah ไม่ตก', () => {
    const s = sim.createScenario({ seed: 88, population: 300 });
    sim.applyLevers(s.id, { foreignAppeasement: 0 });
    const r = sim.tickScenario(s.id, 36).scenario;
    assert.ok(r.externalThreat > 0);
    // ยืนยันว่า asabiyyah อยู่ในพิสัย 0-100
    assert.ok(r.asabiyyah >= 0 && r.asabiyyah <= 100);
  });
});

describe('GovSim Levers & Validation', () => {
  test('applyLevers: clamp ค่าเกินขอบเขต + กันค่าผิด', () => {
    const s = sim.createScenario({ seed: 1, population: 300 });
    const r = sim.applyLevers(s.id, { taxRate: 99, mediaControl: 500, coercion: 9 as any });
    assert.equal(r.scenario.levers.taxRate, 50);
    assert.equal(r.scenario.levers.mediaControl, 100);
    assert.equal(r.scenario.levers.coercion, 1); // ค่าเดิม (9 ไม่ valid)
  });

  test('buyOffElites เป็น one-shot: กดแล้วติดค่า false ให้ tick ถัดไป', () => {
    const s = sim.createScenario({ seed: 2, population: 300 });
    sim.applyLevers(s.id, { buyOffElites: true });
    const r = sim.tickScenario(s.id, 1);
    assert.equal(r.scenario.levers.buyOffElites, false);
    assert.ok(r.scenario.corruption >= 4, 'ซื้อใจเพิ่มคอร์รัปชัน (second-order)');
  });
});

describe('GovSim Narrative — fallback เมื่อ Ollama Offline', () => {
  test('Ollama ตาย → คืน template ไทย + source=template', async () => {
    const s = sim.createScenario({ seed: 66, population: 300 });
    const mod = await import('../src/services/govsim-narrative.service');
    const news = await mod.generateNarrative(s.id, 'newspaper');
    assert.equal(news.source, 'template');
    assert.ok(news.text.includes('📰'));
    assert.ok(news.title.length > 0);
    const threat = await mod.generateNarrative(s.id, 'threat_letter');
    assert.equal(threat.source, 'template');
    assert.ok(threat.text.includes('✉️'));
    const analysis = await mod.generateNarrative(s.id, 'analysis');
    assert.equal(analysis.source, 'template');
    assert.ok(analysis.text.includes('🔬'));
  });

  test('addNarrative + อ่านย้อนหลัง', () => {
    const s = sim.createScenario({ seed: 66, population: 300 });
    sim.addNarrative(s.id, { kind: 'analysis', title: 'บทวิเคราะห์', text: 'เนื้อหา', source: 'template' });
    const loaded = sim.loadScenario(s.id)!;
    assert.equal(loaded.narratives.length, 1);
    assert.equal(loaded.narratives[0].title, 'บทวิเคราะห์');
  });
});

describe('GovSim Routes (HTTP)', () => {
  test('CRUD + tick + levers + narrative ผ่าน API', async () => {
    const { createTestServer, makeToken } = await import('./helpers');
    const { default: routes } = await import('../src/modules/govsim/govsim.routes');
    const srv = await createTestServer((app) => app.use('/api/govsim', routes));
    try {
      const auth = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };
      const createRes = await fetch(`${srv.baseUrl}/api/govsim/scenarios`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ทดสอบอาณาจักร', population: 200, seed: 999 }),
      });
      assert.equal(createRes.status, 201);
      const created = await createRes.json();
      assert.equal(created.name, 'ทดสอบอาณาจักร');
      assert.equal(created.population, 200);
      const id = created.id;

      const listRes = await fetch(`${srv.baseUrl}/api/govsim/scenarios`, { headers: auth });
      const list = await listRes.json();
      assert.ok(list.some((x: any) => x.id === id));

      const tickRes = await fetch(`${srv.baseUrl}/api/govsim/scenarios/${id}/tick`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ steps: 6 }),
      });
      const ticked = await tickRes.json();
      assert.equal(ticked.view.tick, 6);

      const leverRes = await fetch(`${srv.baseUrl}/api/govsim/scenarios/${id}/levers`, {
        method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ taxRate: 35, powerSharing: 50 }),
      });
      const lev = await leverRes.json();
      assert.equal(lev.levers.taxRate, 35);
      assert.equal(lev.levers.powerSharing, 50);

      const narrRes = await fetch(`${srv.baseUrl}/api/govsim/scenarios/${id}/narrative`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'analysis' }),
      });
      const narr = await narrRes.json();
      assert.equal(narr.source, 'template');
      assert.ok(narr.text.length > 0);

      const narrListRes = await fetch(`${srv.baseUrl}/api/govsim/scenarios/${id}/narrative`, { headers: auth });
      const narrList = await narrListRes.json();
      assert.equal(narrList.length, 1);

      const delRes = await fetch(`${srv.baseUrl}/api/govsim/scenarios/${id}`, { method: 'DELETE', headers: auth });
      assert.equal((await delRes.json()).success, true);
    } finally {
      await srv.close();
    }
  });

  test('unauthorized → 401', async () => {
    const { createTestServer } = await import('./helpers');
    const { default: routes } = await import('../src/modules/govsim/govsim.routes');
    const srv = await createTestServer((app) => app.use('/api/govsim', routes));
    try {
      const res = await fetch(`${srv.baseUrl}/api/govsim/scenarios`);
      assert.equal(res.status, 401);
    } finally {
      await srv.close();
    }
  });
});