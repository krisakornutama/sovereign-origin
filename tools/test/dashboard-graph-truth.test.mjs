// dashboard-graph-truth — กัน "กราฟประวัติที่ดูจริงแต่สร้างจากฟังก์ชันคณิตศาสตร์" กลับมาอีก
//
// เหตุผล (IDEA-011): dashboard เดิมมี ThreatHistoryGraph วาดคลื่นจาก
//   Math.sin(t*π*6)*8 + Math.cos(t*π*2.7)*6 + spike exp แล้วติดป้าย
//   "HISTORICAL · STRESS INDEX 1930—2040" — ผู้ใช้เห็นเป็นข้อมูลประวัติศาสตร์
//   ทั้งที่ไม่มีที่มา (หลักการเดียวกับ SEC-020/SEC-024/SEC-027: ตัดเงียบ = ห้าม)
// แก้แล้ว: คอมโพเนนต์ดึง series จริงจาก GET /api/risk-monitor/history
//   (ตาราง threat_index) และแสดงสถานะจริงเมื่ออ่านไม่ได้/ยังไม่มีข้อมูล
// ป้าย "NEON {neonPct}%" ที่ค่าเป็น 56 แข็ง ๆ ก็ถือเป็นของปลอมบนหน้าแรก — ห้ามกลับมา
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'sovereign-frontend', 'src');
const FILES = [
  path.join(FE, 'pages', 'dashboard.tsx'),
  ...readdirSync(path.join(FE, 'components', 'dashboard'), { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx$/.test(e.name))
    .map((e) => path.join(FE, 'components', 'dashboard', e.name)),
];

const sources = new Map();
for (const f of FILES) {
  if (!statSync(f).isFile()) continue;
  sources.set(path.relative(ROOT, f), readFileSync(f, 'utf8'));
}
assert.ok(sources.size >= 2, 'ต้องสแกนได้ทั้ง pages/dashboard.tsx และ components/dashboard/*');

const all = [...sources.entries()].map(([rel, src]) => ({ rel, src }));

test('ห้ามกลับไปใช้เครื่องกำหนดคลื่นปลอม (sine/cosine + spike exp) ในกราฟ threat', () => {
  for (const { rel, src } of all) {
    assert.doesNotMatch(src, /Math\.sin\([^)]*Math\.PI\s*\*\s*6/, `${rel}: ยังมี sine wave ปลอม`);
    assert.doesNotMatch(src, /Math\.exp\(-Math\.pow\(\(t\s*-\s*0\.82\)/, `${rel}: ยังมี spike ปลอม`);
  }
});

test('ห้ามติดป้ายช่วงปีปลอม 1930—2040 (ป้ายจริงต้องมาจากข้อมูล)', () => {
  for (const { rel, src } of all) {
    assert.doesNotMatch(src, /1930/, `${rel}: ยังมีป้ายปีปลอม 1930`);
    assert.doesNotMatch(src, /STRESS INDEX 1930/, `${rel}: ยังมีป้าย STRESS INDEX ปลอม`);
  }
});

test('ThreatHistoryGraph ต้องดึงข้อมูลจริงจาก /api/risk-monitor/history', () => {
  // "เจ้าของ" = ไฟล์ที่มีนิยามฟังก์ชันเท่านั้น — ไฟล์ที่แค่ import/call site (dashboard.tsx) ไม่นับ
  const owners = all.filter((f) => /function\s+ThreatHistoryGraph\s*\(/.test(f.src));
  assert.ok(owners.length > 0, 'ต้องพบคอมโพเนนต์ ThreatHistoryGraph');
  for (const { rel, src } of owners) {
    assert.match(src, /\/api\/risk-monitor\/history/, `${rel}: ThreatHistoryGraph ยังไม่ต่อ API จริง`);
  }
});

test('ห้าม badge "NEON {neonPct}%" ค่าแข็งบนหน้าแรก', () => {
  const dash = sources.get(path.relative(ROOT, path.join(FE, 'pages', 'dashboard.tsx')));
  assert.ok(dash, 'dashboard.tsx หาย');
  assert.doesNotMatch(dash, /neonPct/, 'dashboard.tsx: ยังมี neonPct ค่าแข็ง');
  assert.doesNotMatch(dash, /NEON \{/, 'dashboard.tsx: ยังมี badge NEON ปลอม');
});

test('dashboard.tsx ต้องจัดขนาดลง ≤ 800 บรรทัด (เพดาน pages)', () => {
  const dashPath = path.join(FE, 'pages', 'dashboard.tsx');
  const n = readFileSync(dashPath, 'utf8').split('\n').length;
  assert.ok(n <= 800, `dashboard.tsx = ${n} บรรทัด > เพดาน 800 — ต้อง extract component ก่อน`);
});
