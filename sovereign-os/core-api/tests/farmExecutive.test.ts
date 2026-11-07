// tests/farmExecutive.test.ts
//
// ── ภาพรวมฟาร์มสำหรับผู้บริหาร ──────────────────────────────────────────────
// ล็อกกติกาที่ทำให้ตัวเลข "ใช้ตัดสินใจได้": ความเสี่ยงที่กระทบเงิน/กฎหมาย
// ต้องเป็น critical และต้องมีสิ่งที่ต้องทำ ไม่ใช่แค่ตัวเลขเฉย ๆ
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFarmExecutive, type FarmExecutiveInput } from '../src/services/farm-executive.service';

const NOW = new Date('2026-11-07T09:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

function input(patch: Partial<FarmExecutiveInput> = {}): FarmExecutiveInput {
  return {
    now: NOW,
    plots: [],
    groups: [],
    silos: [],
    climate: null,
    ...patch,
  };
}

describe('farm executive — แปลงพืช', () => {
  test('แปลงเลยกำหนดเก็บเกี่ยว = critical + บอกให้ลงมือ', () => {
    const r = buildFarmExecutive(
      input({
        plots: [
          { id: 'p1', name: 'แปลงทุเรียน', crop: 'ทุเรียน', status: 'growing', expectedHarvestAt: at(-3) },
        ],
      })
    );
    const risk = r.risks.find((x) => x.severity === 'critical');
    assert.ok(risk, 'ต้องมี critical');
    assert.match(risk!.title, /เลยกำหนด/);
    assert.match(risk!.action, /เก็บเกี่ยว|พักแปลง/);
    assert.equal(r.kpis.overdueHarvests, 1);
  });

  test('แปลงที่เก็บเกี่ยวแล้วไม่ถูกนับเป็นงานค้าง', () => {
    const r = buildFarmExecutive(
      input({
        plots: [
          { id: 'p1', name: 'แปลง A', crop: 'ข้าว', status: 'harvested', expectedHarvestAt: at(-10) },
        ],
      })
    );
    assert.equal(r.kpis.overdueHarvests, 0);
    assert.equal(r.risks.length, 0);
  });

  test('ใกล้เก็บเกี่ยวใน 7 วัน = info ไม่ใช่ critical', () => {
    const r = buildFarmExecutive(
      input({
        plots: [{ id: 'p1', name: 'แปลง B', crop: 'ผักสลัด', status: 'growing', expectedHarvestAt: at(3) }],
      })
    );
    assert.equal(r.kpis.upcomingHarvests7d, 1);
    assert.equal(r.risks[0].severity, 'info');
  });
});

describe('farm executive — ปศุสัตว์', () => {
  test('ติดระยะหยุดยา = critical และนับจำนวนสัตว์ที่ขายไม่ได้', () => {
    const r = buildFarmExecutive(
      input({
        groups: [
          {
            id: 'g1',
            code: 'BROILER-01',
            species: 'POULTRY_BROILER',
            quantity: 500,
            status: 'ACTIVE',
            ageDays: 30,
            quarantineEndAt: null,
            medical: [{ drugName: 'Enrofloxacin', safeHarvestAt: at(5) }],
            vaccines: [],
            mortality7d: 0,
          },
        ],
      })
    );
    const risk = r.risks.find((x) => x.id === 'withdrawal-g1');
    assert.ok(risk);
    assert.equal(risk!.severity, 'critical');
    assert.match(risk!.detail, /Enrofloxacin/);
    assert.equal(r.kpis.animalsInWithdrawal, 500);
  });

  test('วัคซีนเกินกำหนด = critical; ใกล้ถึงกำหนด = warning', () => {
    const overdue = buildFarmExecutive(
      input({
        groups: [
          {
            id: 'g1', code: 'SWINE-02', species: 'SWINE', quantity: 40, status: 'ACTIVE', ageDays: 30,
            quarantineEndAt: null, medical: [],
            vaccines: [{ vaccineName: 'FMD', targetAgeDays: 21, completed: false }],
            mortality7d: 0,
          },
        ],
      })
    );
    assert.equal(overdue.kpis.vaccineOverdue, 1);
    assert.equal(overdue.risks[0].severity, 'critical');

    const soon = buildFarmExecutive(
      input({
        groups: [
          {
            id: 'g2', code: 'SWINE-03', species: 'SWINE', quantity: 40, status: 'ACTIVE', ageDays: 20,
            quarantineEndAt: null, medical: [],
            vaccines: [{ vaccineName: 'FMD', targetAgeDays: 22, completed: false }],
            mortality7d: 0,
          },
        ],
      })
    );
    assert.equal(soon.kpis.vaccineOverdue, 0);
    assert.equal(soon.risks[0].severity, 'warning');
  });

  test('อัตราตายเกิน 2% ใน 7 วัน = critical', () => {
    const r = buildFarmExecutive(
      input({
        groups: [
          {
            id: 'g1', code: 'DUCK-01', species: 'DUCK', quantity: 100, status: 'ACTIVE', ageDays: 14,
            quarantineEndAt: null, medical: [], vaccines: [], mortality7d: 5,
          },
        ],
      })
    );
    assert.equal(r.kpis.mortality7d, 5);
    const risk = r.risks.find((x) => x.id === 'mortality-g1');
    assert.equal(risk?.severity, 'critical');
  });

  test('กักกันอยู่ = warning พร้อมวันปลดล็อก', () => {
    const r = buildFarmExecutive(
      input({
        groups: [
          {
            id: 'g1', code: 'CATTLE-01', species: 'CATTLE', quantity: 10, status: 'QUARANTINE', ageDays: 60,
            quarantineEndAt: at(7), medical: [], vaccines: [], mortality7d: 0,
          },
        ],
      })
    );
    const risk = r.risks.find((x) => x.id === 'quarantine-g1');
    assert.equal(risk?.severity, 'warning');
    assert.equal(r.kpis.quarantineGroups, 1);
  });
});

describe('farm executive — อาหารและภูมิอากาศ', () => {
  test('ไซโลต่ำกว่า 15% = critical', () => {
    const r = buildFarmExecutive(
      input({ silos: [{ siloCode: 'SILO-A', capacityKg: 1000, currentKg: 100 }] })
    );
    assert.equal(r.kpis.silosLow, 1);
    assert.equal(r.risks[0].severity, 'critical');
  });

  test('THI 78 ขึ้นไป = critical (ความร้อนรุนแรง)', () => {
    const r = buildFarmExecutive(input({ climate: { thi: 80, status: 'SEVERE' } }));
    assert.equal(r.risks[0].severity, 'critical');
    assert.equal(r.kpis.latestThi, 80);
  });

  test('ฟาร์มว่างเปล่า = ไม่มีข้อมูล ไม่สร้างความเสี่ยงปลอม', () => {
    const r = buildFarmExecutive(input());
    assert.equal(r.risks.length, 0);
    assert.equal(r.kpis.criticalRisks, 0);
    assert.equal(r.kpis.plots, 0);
  });

  test('เรียงความเสี่ยง: critical ก่อน warning ก่อน info', () => {
    const r = buildFarmExecutive(
      input({
        plots: [{ id: 'p1', name: 'แปลง C', crop: 'ข้าว', status: 'growing', expectedHarvestAt: at(2) }],
        silos: [{ siloCode: 'SILO-B', capacityKg: 1000, currentKg: 100 }],
        climate: { thi: 74, status: 'MODERATE' },
      })
    );
    const order = r.risks.map((x) => x.severity);
    assert.deepEqual(order, [...order].sort((a, b) => (a === b ? 0 : a === 'critical' ? -1 : b === 'critical' ? 1 : a === 'warning' ? -1 : 1)));
    assert.equal(r.kpis.criticalRisks, 1);
  });
});
