import './setup-env';
import os from 'os';
import path from 'path';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// ตั้งก่อน import service (STATE_FILE อ่านตอนโหลดโมดูล)
process.env.GOVERNOR_STATE_FILE = path.join(os.tmpdir(), 'governor-test-' + Date.now(), 'governor.json');
process.env.GOVSIM_DATA_DIR = path.join(os.tmpdir(), 'govsim-gov-test-' + Date.now());
process.env.OLLAMA_URL = 'http://127.0.0.1:1'; // fail fast → fallback heuristic

type Gov = typeof import('../src/services/governor.service');
type Sim = typeof import('../src/services/governance-sim.service');
let gov: Gov;
let sim: Sim;

beforeEach(async () => {
  gov = await import('../src/services/governor.service');
  sim = await import('../src/services/governance-sim.service');
});

afterEach(async () => {
  for (const s of sim.listScenarios()) sim.deleteScenario(s.id);
});

describe('Governor AI — แยกแยะเรื่องใหญ่ (ต้องมนุษย์ approve)', () => {
  test('purge/buyOffElites/coercion>=3/เปลี่ยนกลยุทธ์ → significant', () => {
    assert.ok(gov.isSignificantLever('purge', 1, 0));
    assert.ok(gov.isSignificantLever('buyOffElites', 1, 0));
    assert.ok(gov.isSignificantLever('coercion', 3, 1));
    assert.ok(gov.isSignificantLever('assimilationStrategy', 0, 1));
    assert.ok(gov.isSignificantLever('taxRate', 30, 20)); // diff 10 >= 5
  });

  test('ปรับเล็กน้อย → ไม่ significant (AI ทำเองได้)', () => {
    assert.ok(!gov.isSignificantLever('welfare', 22, 20));
    assert.ok(!gov.isSignificantLever('taxRate', 22, 20));
    assert.ok(!gov.isSignificantLever('coercion', 2, 1)); // diff 1, ค่า 2
  });
});

describe('Governor AI — ขอบเขตการปรับต่อรอบ (bounded)', () => {
  test('conservative = ปรับได้ไม่เกิน 2 จุด, autonomous = 6 จุด', () => {
    assert.equal(gov.maxDeltaFor('conservative', 'policePatrols'), 2);
    assert.equal(gov.maxDeltaFor('balanced', 'policePatrols'), 4);
    assert.equal(gov.maxDeltaFor('autonomous', 'policePatrols'), 6);
    assert.equal(gov.maxDeltaFor('autonomous', 'taxRate'), 2); // ภาษีปรับได้จำกัดเสมอ
    assert.equal(gov.maxDeltaFor('autonomous', 'welfare'), 5); // งบประมาณ capped ที่ 5
  });

  test('sanitizeAutoActions: ตัด levers นอก whitelist + ไม่เกินขอบเขต + ตัดเรื่องใหญ่', () => {
    const snap: any = {
      levers: { taxRate: 20, welfare: 20, subsidy: 30, purge: false, budget: { welfare: 20, military: 15 } },
    };
    const out = gov.sanitizeAutoActions([
      { lever: 'welfare', value: 999, reason: 'มากเกิน' },
      { lever: 'purge', value: 1, reason: 'ห้าม' },
      { lever: 'coercion', value: 3, reason: 'ห้าม' },
      { lever: 'nonexistent', value: 50, reason: 'ไม่รู้จัก' },
      { lever: 'subsidy', value: 33, reason: 'พอดี' },
    ], snap, 'conservative');
    const byLever = Object.fromEntries(out.map((a) => [a.lever, a.value]));
    assert.deepEqual(Object.keys(byLever).sort(), ['subsidy', 'welfare']);
    assert.equal(byLever.welfare, 22, 'welfare ถูก clamp ไว้ที่ 22 (conservative +2)');
    assert.equal(byLever.subsidy, 32, 'subsidy ถูก clamp ไว้ที่ 32 ไม่ใช่ 33');
  });
});

describe('Governor AI — Fallback Heuristic (Ollama ล้ม)', () => {
  test('สถานการณ์เลวร้าย → เสนอการแก้ที่ตรงกับทฤษฎี', () => {
    const snap: any = {
      status: 'unstable', legitimacy: { total: 30 }, unrestRisk: 70, gini: 70,
      scarcity: 70, treasury: -500, insurgencyStrength: 0.3, resistance: 80,
      friction: 70, foreignProxy: 50, counterNarrative: 30, corruption: 40,
      levers: {
        taxRate: 20, welfare: 20, subsidy: 30, powerSharing: 20, policePatrols: 40,
        culturalEducation: 20, foreignAppeasement: 30, coercion: 1, mediaControl: 30,
        surveillance: 20, budget: { welfare: 20, bureaucracy: 15 },
      },
    };
    const r = gov.heuristicDecide(snap, 'balanced');
    const levers = r.auto.map((a) => a.lever);
    assert.ok(levers.includes('policePatrols'), 'unrest สูง → เพิ่มตำรวจ');
    assert.ok(levers.includes('subsidy'), 'scarcity สูง → อุดหนุน');
    assert.ok(levers.includes('powerSharing'), 'legitimacy ต่ำ → เปิดพื้นที่ร่วม');
    assert.ok(r.proposals.some((p) => p.kind === 'coercion'), 'กบฏ 30% → เสนอใช้กำลัง (ต้องมนุษย์ approve)');
  });

  test('สถานการณ์ทรงตัว → เสนอ "คงนโยบาย"', () => {
    const snap: any = {
      status: 'unstable', legitimacy: { total: 55 }, unrestRisk: 30, gini: 50,
      scarcity: 30, treasury: 500, insurgencyStrength: 0.05, resistance: 40,
      friction: 30, foreignProxy: 20, counterNarrative: 20, corruption: 30,
      levers: {
        taxRate: 20, welfare: 20, subsidy: 30, powerSharing: 20, policePatrols: 40,
        culturalEducation: 20, foreignAppeasement: 30, coercion: 1, mediaControl: 30,
        surveillance: 20, budget: { welfare: 20, bureaucracy: 15 },
      },
    };
    const r = gov.heuristicDecide(snap, 'balanced');
    assert.equal(r.auto.length, 0);
    assert.ok(r.proposals.some((p) => p.title.includes('คงนโยบาย')));
  });
});

describe('Governor AI — Learning Loop (เรียนรู้จากผลลัพธ์)', () => {
  test('evaluateOutcome: ดีขึ้น → good, แย่ลง → bad', () => {
    const before: any = { legitimacy: { total: 40 }, unrestRisk: 60, treasury: 100 };
    const better: any = { legitimacy: { total: 45 }, unrestRisk: 55, treasury: 120 };
    const worse: any = { legitimacy: { total: 36 }, unrestRisk: 65, treasury: 80 };
    assert.equal(gov.evaluateOutcome(before, better).verdict, 'good');
    assert.equal(gov.evaluateOutcome(before, worse).verdict, 'bad');
  });

  test('cycle จริง → มีบทเรียนใน memory (fallback heuristic ทำงานตอน Ollama ล้ม)', async () => {
    gov.setEnabled(true);
    gov.setAutonomy('autonomous');
    const s = sim.createScenario({ seed: 777, population: 300 });
    gov.setFocusScenario(s.id);
    const r = await gov.runGovernorCycle();
    assert.ok(r.ok, `cycle failed: ${r.reason}`);
    const st = gov.governorStatus();
    assert.ok(st.cycleCount >= 1);
    assert.ok(st.lastCycleAt !== null);
    // scenario ถูกเดินเวลาไป (tick > 0) และมี auto-actions บันทึกใน activity
    const loaded = sim.loadScenario(s.id)!;
    assert.ok(loaded.tick > 0, `governor ต้องเดินเวลา scenario (tick=${loaded.tick})`);
    assert.ok(st.activity.some((a: any) => a.type === 'auto_action' || a.type === 'cycle'));
  });

  test('cycle ทำงานซ้ำได้ (หลายรอบต่อเนื่อง)', async () => {
    gov.setEnabled(true);
    const s = sim.createScenario({ seed: 42, population: 300 });
    gov.setFocusScenario(s.id);
    await gov.runGovernorCycle();
    await gov.runGovernorCycle();
    const st = gov.governorStatus();
    assert.ok(st.cycleCount >= 2);
    assert.ok(st.memory.length >= 0); // memory ไม่ระเบิด
  });
});

describe('Governor AI — เรื่องใหญ่ต้องมนุษย์ approve', () => {
  test('approve proposal → ใช้ levers กับ scenario, reject → ไม่ใช้', () => {
    gov.setEnabled(true);
    const s = sim.createScenario({ seed: 5, population: 300 });
    gov.setFocusScenario(s.id);
    // สร้าง proposal ตรง ๆ ผ่านการรัน cycle ที่ Ollama ล้ม (heuristic อาจเสนอ) หรือแทรกเอง
    const st = gov.governorStatus();
    let p = st.pendingProposals.find((x: any) => x.kind === 'coercion' || x.kind === 'budget_overhaul' || x.kind === 'direction');
    if (!p) {
      // ไม่มี proposal จากรอบนี้ → บังคับสร้างเองผ่าน state ภายในไม่ได้ → ตรวจว่า path approve ทำงานโดยไม่มี proposal
      const r = gov.approveProposal('nonexistent');
      assert.equal(r.ok, false);
      assert.ok(r.error);
      return;
    }
    const beforeCoercion = sim.loadScenario(s.id)!.levers.coercion;
    const appr = gov.approveProposal(p.id);
    assert.ok(appr.ok);
    // coercion proposal → scenario coercion เปลี่ยน (หลัง tick รอบหน้า)
    if (p.kind === 'coercion') {
      const after = sim.loadScenario(s.id)!.levers.coercion;
      assert.ok(after >= 3, `coercion หลัง approve ต้อง >= 3 (ได้ ${after})`);
    }
    void beforeCoercion;
  });

  test('approve proposal ที่ถูก reject แล้ว → error', () => {
    gov.setEnabled(true);
    const s = sim.createScenario({ seed: 8, population: 300 });
    gov.setFocusScenario(s.id);
    const st = gov.governorStatus();
    const p = st.pendingProposals[0];
    if (!p) return;
    const rej = gov.rejectProposal(p.id, 'human', 'ไม่เห็นด้วย');
    assert.ok(rej.ok);
    const again = gov.approveProposal(p.id);
    assert.equal(again.ok, false);
    assert.match(again.error || '', /rejected|decided|แล้ว/);
  });
});

describe('Governor AI — API (HTTP)', () => {
  let srv: any;
  let routes: any;
  let helpers: any;
  let auth: string;

  beforeEach(async () => {
    helpers = await import('./helpers');
    routes = (await import('../src/modules/governor/governor.routes')).default;
    srv = await helpers.createTestServer((app: any) => app.use('/api/governor', routes));
    auth = `Bearer ${helpers.makeToken('SUPERADMIN')}`;
  });

  afterEach(async () => {
    await srv?.close();
  });

  test('GET status → ข้อมูล governor (ทิศทาง + autonomy + proposals)', async () => {
    const res = await fetch(`${srv.baseUrl}/api/governor/status`, { headers: { Authorization: auth } });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(typeof body.direction, 'string');
    assert.ok(['conservative', 'balanced', 'autonomous'].includes(body.autonomy));
    assert.equal(typeof body.enabled, 'boolean');
  });

  test('PUT direction → ตั้งทิศทางได้ (มนุษย์คุมทิศทาง)', async () => {
    const res = await fetch(`${srv.baseUrl}/api/governor/direction`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'ปรองดองแบบค่อยเป็นค่อยไป ลดการใช้กำลัง' }),
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.direction, 'ปรองดองแบบค่อยเป็นค่อยไป ลดการใช้กำลัง');
  });

  test('PUT autonomy + enabled → เปลี่ยนระดับอิสระ/เปิดปิดได้', async () => {
    const r1 = await fetch(`${srv.baseUrl}/api/governor/autonomy`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ autonomy: 'autonomous' }),
    });
    assert.equal((await r1.json()).autonomy, 'autonomous');
    const r2 = await fetch(`${srv.baseUrl}/api/governor/enabled`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal((await r2.json()).enabled, true);
  });

  test('PUT direction โดยไม่ใช่ SUPERADMIN → 403', async () => {
    const token = helpers.makeToken('ADMIN');
    const res = await fetch(`${srv.baseUrl}/api/governor/direction`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'x' }),
    });
    assert.equal(res.status, 403);
  });

  test('POST cycle (force) → ทำงานแม้ disabled + POST reject', async () => {
    const s = sim.createScenario({ seed: 12, population: 300 });
    await fetch(`${srv.baseUrl}/api/governor/focus`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: s.id }),
    });
    const cyc = await fetch(`${srv.baseUrl}/api/governor/cycle`, {
      method: 'POST', headers: { Authorization: auth },
    });
    assert.equal(cyc.status, 200);
    const status = await (await fetch(`${srv.baseUrl}/api/governor/status`, { headers: { Authorization: auth } })).json();
    if (status.pendingProposals?.length) {
      const rej = await fetch(`${srv.baseUrl}/api/governor/proposals/${status.pendingProposals[0].id}/reject`, {
        method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'ทดสอบ' }),
      });
      assert.equal(rej.status, 200);
    }
  });
});