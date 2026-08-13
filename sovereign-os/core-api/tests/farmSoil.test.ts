// TDD: วิเคราะห์ดินแปลงฟาร์ม — NPK/ค่า pH/ความชื้น เทียบกับความต้องการของพืช
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSoil,
  soilAmendmentPlan,
  CROP_IDEALS,
  soilStatus,
} from '../src/services/farm-soil.service';

test('analyzeSoil flags low moisture with a watering alert', () => {
  const r = analyzeSoil(
    { n: 30, p: 40, k: 50, ph: 6.2, moisture_pct: 35 },
    'ทุเรียน'
  );
  assert.ok(r.findings.some((f) => f.kind === 'moisture' && f.severity === 'high'));
  assert.ok(r.findings.some((f) => f.kind === 'moisture' && f.action.includes('รดน้ำ')));
});

test('analyzeSoil flags phosphorus deficiency for durian and suggests fertilizer', () => {
  const r = analyzeSoil(
    { n: 20, p: 5, k: 30, ph: 5.2, moisture_pct: 65 },
    'ทุเรียน'
  );
  const phos = r.findings.find((f) => f.kind === 'p');
  assert.ok(phos, 'ควรพบฟอสฟอรัสต่ำ');
  assert.ok(phos?.severity === 'high' || phos?.severity === 'medium');
  assert.ok(phos?.action.length > 0);
});

test('analyzeSoil flags acidic pH and recommends lime', () => {
  const r = analyzeSoil({ n: 40, p: 40, k: 40, ph: 4.6, moisture_pct: 60 }, 'ทุเรียน');
  const ph = r.findings.find((f) => f.kind === 'ph');
  assert.ok(ph);
  assert.ok(ph?.action.includes('ปูน') || ph?.action.includes('โดโลไมต์'));
});

test('analyzeSoil reports healthy soil with no high alerts', () => {
  const r = analyzeSoil({ n: 50, p: 50, k: 60, ph: 6.0, moisture_pct: 70 }, 'ทุเรียน');
  assert.equal(r.findings.filter((f) => f.severity === 'high').length, 0);
  assert.ok(r.score >= 70);
});

test('soilAmendmentPlan builds step-by-step soil preparation for a demanding crop', () => {
  const plan = soilAmendmentPlan(
    { n: 10, p: 5, k: 8, ph: 4.8, moisture_pct: 30 },
    'ทุเรียน'
  );
  assert.ok(plan.length >= 3);
  assert.ok(plan.some((s) => s.includes('pH') || s.includes('ปูน')));
  assert.ok(plan.some((s) => s.includes('น้ำ') || s.includes('ชลประทาน')));
});

test('CROP_IDEALS knows common Thai crops', () => {
  for (const crop of ['ทุเรียน', 'มะเขือเทศ', 'ข้าว']) {
    assert.ok(CROP_IDEALS[crop], `ควรมีข้อมูล ${crop}`);
    assert.ok(CROP_IDEALS[crop].ph.length === 2);
    assert.ok(CROP_IDEALS[crop].moisture.length === 2);
  }
});

test('soilStatus grades ranges correctly', () => {
  assert.equal(soilStatus(35, [60, 80]), 'low');
  assert.equal(soilStatus(70, [60, 80]), 'ok');
  assert.equal(soilStatus(95, [60, 80]), 'high');
});
