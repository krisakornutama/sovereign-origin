// dashboard-fallback-truth — ชุดกราฟที่เหลือของ dashboard ห้ามวาดจากค่า fallback แต่ง (IDEA-013)
//
// เดิม (ก่อนแก้):
//   RadarPentagon: temp ?? 28 · humidity ?? 60 · battery ?? 70 · water ?? 45 ·
//     power ?? 1.2 — เซ็นเซอร์ยังไม่ส่งข้อมูลก็วาดรูปห้าเหลี่ยมสวย ๆ จากค่าแต่ง
//   SankeyAlluvial: portfolio ?? 42000 · inventory ?? 8000 · cash ?? 5000 ·
//     runway ?? 6.2 · burn ?? 850 · growing ?? 3 — จุดที่เรียกด้วย wealth={null}
//     (กรณี PORTFOLIO_ENABLED ปิด) แสดงตัวเลขปลอมตลอดเวลา
//   SensorCard: trend fetch .catch(() => {}) กลืน error → จุดโหลด "…" ค้างตลอด
// แก้แล้ว: วาดเฉพาะเมื่อมีข้อมูลจริง · ไม่ครบ = สถานะจริง (บอกแกนที่ขาด) ·
//   wealth ไม่มี = กล่องข้อความจริง · catch → แสดง "—" ไม่ใช่ค้างโหลด
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'sovereign-frontend', 'src', 'components', 'dashboard');
const home = readFileSync(path.join(FE, 'HomeCharts.tsx'), 'utf8');
const sensors = readFileSync(path.join(FE, 'SensorWidgets.tsx'), 'utf8');

function slice(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `ต้องพบ ${from}`);
  const b = to ? src.indexOf(to, a + 1) : -1;
  return b > a ? src.slice(a, b) : src.slice(a);
}

const pentagon = slice(home, 'export function RadarPentagon', 'export function SankeyAlluvial');
const sankey = slice(home, 'export function SankeyAlluvial', 'export function PerfGauges');

test('RadarPentagon: ห้ามวาดจากค่า fallback แต่ง ต้องวาดเมื่อมีข้อมูลจริงครบ 5 แกนเท่านั้น', () => {
  assert.doesNotMatch(pentagon, /metrics\.temperature\s*\?\?\s*28/, 'ยังมี temp fallback 28');
  assert.doesNotMatch(pentagon, /metrics\.humidity\s*\?\?\s*60/, 'ยังมี humidity fallback 60');
  assert.doesNotMatch(pentagon, /battery_soc\s*\?\?\s*70/, 'ยังมี battery fallback 70');
  assert.doesNotMatch(pentagon, /water_level_cm\s*\?\?\s*45/, 'ยังมี water fallback 45');
  assert.doesNotMatch(pentagon, /power_kw\s*\?\?\s*1\.2/, 'ยังมี power fallback 1.2');
  assert.match(pentagon, /ยังไม่มีข้อมูล/, 'ต้องมีสถานะจริงเมื่อข้อมูลไม่ครบ (บอกแกนที่ขาด)');
});

test('SankeyAlluvial: ห้ามตัวเลขแต่ง (42000/8000/5000/6.2/850/3) ต้องสร้างจาก wealth จริงเท่านั้น', () => {
  for (const n of ['42000', '8000', '5000', '6\\.2', '850', '\\?\\?\\s*3\\b']) {
    assert.doesNotMatch(sankey, new RegExp(n), `ยังมีค่าแต่ง ${n}`);
  }
  assert.match(sankey, /ยังไม่มีข้อมูล/, 'ต้องมีสถานะจริงเมื่อไม่มีข้อมูล wealth');
});

test('SensorCard: ห้ามกลืน error เงียบ ๆ (.catch(() => {})) — อ่านไม่ได้ต้องแสดงสถานะจริง', () => {
  assert.doesNotMatch(sensors, /catch\(\(\)\s*=>\s*\{\s*\}\)/, 'ยังมี empty catch (ตัดเงียบ)');
});
