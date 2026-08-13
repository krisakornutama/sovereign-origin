// TDD: ระบบภูมิศาสตร์ที่ดิน — แผนที่จำลอง + จุดยุทธศาสตร์สำหรับกับดัก/ตรวจจับ
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreStrategicPoints,
  suggestStrategicPoints,
  buildPropertyMapSvg,
  type PropertyZone,
  type StrategicPoint,
} from '../src/services/property-strategy.service';

const ZONES: PropertyZone[] = [
  { id: 'z1', name: 'บ้าน', type: 'บ้าน', x: 10, y: 10, z: 0, width_m: 8, length_m: 6, height_m: 3, color: '#f59e0b' },
  { id: 'z2', name: 'ประตูหน้า', type: 'ประตู', x: 2, y: 5, z: 0, width_m: 2, length_m: 1, height_m: 2, color: '#3b82f6' },
  { id: 'z3', name: 'สวนทุเรียน', type: 'สวน', x: 15, y: 15, z: 0, width_m: 6, length_m: 6, height_m: 2, color: '#10b981' },
];

test('scoreStrategicPoints ranks boundary/entrance points above interior ones', () => {
  const points: StrategicPoint[] = [
    { id: 'p1', name: 'จุดริมรั้ว', type: 'กล้อง', x: 0, y: 8, z: 1, reason: 'ริมรั้วด้านหน้า', enabled: true },
    { id: 'p2', name: 'กลางสวน', type: 'เซ็นเซอร์', x: 16, y: 16, z: 0, reason: 'ในแปลง', enabled: true },
  ];
  const scored = scoreStrategicPoints(ZONES, points, 30, 20);
  const p1 = scored.find((s) => s.point.id === 'p1');
  const p2 = scored.find((s) => s.point.id === 'p2');
  assert.ok(p1 && p2);
  assert.ok(p1.score > p2.score, 'จุดริมรั้วควรได้คะแนนสูงกว่า');
  assert.ok(p1.score >= 0 && p1.score <= 100);
  assert.ok(p1.reasons.length > 0);
});

test('suggestStrategicPoints generates candidates at entrances and boundary gaps', () => {
  const suggestions = suggestStrategicPoints(ZONES, 30, 20);
  assert.ok(suggestions.length >= 2);
  const nearEntrance = suggestions.find((s) => s.reason.includes('ประตู'));
  const onBoundary = suggestions.find((s) => s.reason.includes('รั้ว') || s.reason.includes('ขอบ'));
  assert.ok(nearEntrance, 'ควรแนะนำจุดใกล้ประตู');
  assert.ok(onBoundary, 'ควรแนะนำจุดตามแนวรั้ว/ขอบที่ดิน');
});

test('buildPropertyMapSvg renders zones with isometric 3D projection and scale', () => {
  const svg = buildPropertyMapSvg(ZONES, [], 30, 20);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('บ้าน'));
  assert.ok(svg.includes('ประตูหน้า'));
  // ไอโซเมตริก: มี depth transform (translate/scale แกน Y)
  assert.ok(/transform=|polygon/i.test(svg));
});

test('buildPropertyMapSvg escapes user-controlled names (กัน SVG injection)', () => {
  const evil: PropertyZone = {
    id: 'e1', name: '<script>alert(1)</script>', type: 'บ้าน',
    x: 5, y: 5, z: 0, width_m: 2, length_m: 2, height_m: 2, color: '#fff',
  };
  const svg = buildPropertyMapSvg([evil], [], 10, 10);
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
});
