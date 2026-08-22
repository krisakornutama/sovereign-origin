import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateBaguaMasterplan } from '../src/services/property-strategy.service';

const W = 80, L = 60; // 3 ไร่ (4800 ตร.ม.) — รูปผืนผ้าเหมือนที่ดินจริง

function zoneArea(z: { width_m: number; length_m: number }): number {
  return z.width_m * z.length_m;
}

describe('bagua masterplan (adaptive geometry)', () => {
  test('80×60 m: rings are 40/50/10 of total', () => {
    const plan = generateBaguaMasterplan(W, L);
    assert.equal(plan.totalAreaSqM, 4800);
    assert.deepEqual(plan.land, { width: 80, length: 60 });
    const outer = plan.rings.find((r) => r.id === 'outer')!;
    const middle = plan.rings.find((r) => r.id === 'middle')!;
    const core = plan.rings.find((r) => r.id === 'core')!;
    assert.equal(outer.pct, 40);
    assert.equal(middle.pct, 50);
    assert.equal(core.pct, 10);
    assert.ok(Math.abs(outer.area_m2 - 1920) < 2);
    assert.ok(Math.abs(middle.area_m2 - 2400) < 2);
    assert.ok(Math.abs(core.area_m2 - 480) < 2);
  });

  test('zones cover the whole land exactly (no gaps, no overlap)', () => {
    const plan = generateBaguaMasterplan(W, L);
    const sumZones = plan.zones.reduce((s, z) => s + zoneArea(z), 0);
    assert.equal(plan.zones.length, 9);
    // ปัดพิกัด 2 ตำแหน่งต่อด้าน → ผลรวมคลาดเคลื่อนได้เล็กน้อย (< 1% ของพื้นที่)
    assert.ok(Math.abs(sumZones - plan.totalAreaSqM) < plan.totalAreaSqM * 0.01, `sum=${sumZones} total=${plan.totalAreaSqM}`);

    // ตรวจไม่มีทับซ้อน (คู่อันดับ)
    for (let i = 0; i < plan.zones.length; i++) {
      for (let j = i + 1; j < plan.zones.length; j++) {
        const a = plan.zones[i], b = plan.zones[j];
        const overlap =
          Math.min(a.x + a.width_m, b.x + b.width_m) - Math.max(a.x, b.x) > 0.01 &&
          Math.min(a.y + a.length_m, b.y + b.length_m) - Math.max(a.y, b.y) > 0.01;
        assert.ok(!overlap, `${a.name} overlaps ${b.name}`);
      }
    }
  });

  test('middle ring splits into 3 functional zones ≈ 20% each (within ±30%); inside land bounds', () => {
    const plan = generateBaguaMasterplan(W, L);
    const { width: LW, length: LL } = plan.land;
    for (const z of plan.zones) {
      assert.ok(z.x >= 0 && z.y >= 0, `${z.name} negative origin`);
      assert.ok(z.x + z.width_m <= LW + 0.01, `${z.name} exceeds width`);
      assert.ok(z.y + z.length_m <= LL + 0.01, `${z.name} exceeds length`);
    }
    const middleZones = plan.zones.filter(
      (z) => z.type === 'WATER_BODY' || z.type === 'AGRICULTURE' || z.type === 'LIVESTOCK_GARDEN'
    );
    assert.equal(middleZones.length, 4); // สระ + นา 2 แถบ + สวน
    const target = 0.2 * plan.totalAreaSqM;
    const paddy = middleZones.filter((z) => z.type === 'AGRICULTURE').reduce((s, z) => s + zoneArea(z), 0);
    const pond = middleZones.find((z) => z.type === 'WATER_BODY')!;
    const garden = middleZones.find((z) => z.type === 'LIVESTOCK_GARDEN')!;
    for (const [label, area] of [['pond', zoneArea(pond)], ['paddy', paddy], ['garden', zoneArea(garden)]] as const) {
      assert.ok(area > target * 0.5 && area < target * 1.5, `${label}=${area} target=${target}`);
    }
  });

  test('any rectangle size: coverage exact + rings proportional', () => {
    for (const [w, l] of [[100, 50], [40, 120], [25, 25], [150, 30]] as const) {
      const plan = generateBaguaMasterplan(w, l);
      const sumZones = plan.zones.reduce((s, z) => s + zoneArea(z), 0);
      assert.ok(Math.abs(sumZones - w * l) < w * l * 0.01, `size ${w}×${l}: sum=${sumZones} != ${w * l}`);
      const pcts = plan.rings.map((r) => r.pct);
      assert.deepEqual(pcts, [40, 50, 10]);
      const core = plan.rings.find((r) => r.id === 'core')!;
      assert.ok(Math.abs(core.area_m2 - w * l * 0.1) < 1);
    }
  });

  test('points reference existing zone names and stay inside land', () => {
    const plan = generateBaguaMasterplan(100, 60);
    const names = new Set(plan.zones.map((z) => z.name));
    for (const p of plan.points) {
      assert.ok(names.has(p.zoneName), `point "${p.name}" zone "${p.zoneName}" missing`);
      assert.ok(p.x >= 0 && p.y >= 0 && p.x <= plan.land.width && p.y <= plan.land.length);
    }
    assert.equal(plan.points.length, 4);
  });
});