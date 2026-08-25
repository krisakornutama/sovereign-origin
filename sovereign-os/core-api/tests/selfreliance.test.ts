// tests/selfreliance.test.ts — pure compute (ไม่แตะ DB)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeWaterDays, computeFoodDays, computeEnergyHours,
  findWeakestLink, type AutonomyItem,
} from '../src/services/selfreliance.service.ts';

describe('Self-Reliance — Days of Autonomy', () => {
  it('water: 1000L ÷ (4 คน × 20L) = 12.5 วัน', () => {
    assert.equal(computeWaterDays(1000, 4, 20), 12.5);
  });
  it('water: คนเดียว 30L/วัน ถัง 900L = 30 วัน', () => {
    assert.equal(computeWaterDays(900, 1, 30), 30);
  });
  it('food: 60kg ÷ (4 × 1.5kg) = 10 วัน', () => {
    assert.equal(computeFoodDays(60, 4, 1.5), 10);
  });
  it('energy: แบต 50% × 5kWh ÷ 0.5kW = 5 ชม.', () => {
    assert.equal(computeEnergyHours(50, 5, 0.5), 5);
  });
  it('energy: ไม่มีข้อมูลโหลด → null (ประเมินไม่ได้)', () => {
    assert.equal(computeEnergyHours(50, 5, null), null);
  });
  it('weakest link: เลือกตัว days ต่ำสุด ข้าม null', () => {
    const items: AutonomyItem[] = [
      { key: 'water', label: 'น้ำ', days: 30, detail: '', ok: true },
      { key: 'food', label: 'อาหาร', days: 5, detail: '', ok: false },
      { key: 'energy', label: 'ไฟ', days: null, detail: '', ok: null },
    ];
    const weakest = findWeakestLink(items);
    assert.equal(weakest?.key, 'food');
  });
  it('weakest link: ทุกตัว null → null (ประเมินไม่ได้)', () => {
    const items: AutonomyItem[] = [{ key: 'energy', label: 'ไฟ', days: null, detail: '', ok: null }];
    assert.equal(findWeakestLink(items), null);
  });
});
