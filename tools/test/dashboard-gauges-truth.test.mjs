// dashboard-gauges-truth — PerfGauges บนหน้าแรกห้ามโชว์ตัวเลขที่แต่งจากสูตร (IDEA-012)
//
// เดิม (ก่อนแก้): CPU = 38+(temp%20), MEM = 56+(humidity%16) — สูตรล้วน
//   NET fallback 72 · PWR fallback 64 · HUM fallback 58 · TMP fallback 62 ·
//   WTR fallback 44 · SOL fallback 31 — ตัวเลขดูเหมือน telemetry จริงทั้งที่แต่ง
// แก้แล้ว: แสดงเฉพาะ gauge ที่มีแหล่งข้อมูลจริง (NET=อัตราอุปกรณ์ออนไลน์,
//   PWR/HUM/TMP/WTR/SOL จาก metrics ของ /api/dashboard/stats) ·
//   CPU/MEM ลบทิ้ง (ระบบไม่มีแหล่งข้อมูล CPU/RAM เลย — แสดงได้คือปลอม) ·
//   ช่องที่ไม่มีข้อมูลข้ามไป · ถ้าไม่มีอะไรเลยต้องแสดงสถานะจริง (ห้ามว่างเงียบ ๆ)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'sovereign-frontend', 'src', 'components', 'dashboard', 'HomeCharts.tsx');
const src = readFileSync(FILE, 'utf8');
const start = src.indexOf('export function PerfGauges');
assert.ok(start >= 0, 'ต้องพบ PerfGauges ใน HomeCharts.tsx');
const body = src.slice(start);

test('ห้าม gauge CPU/MEM ที่แต่งจากสูตร (ระบบไม่มีแหล่งข้อมูลจริง)', () => {
  assert.doesNotMatch(body, /label: 'CPU'/, 'PerfGauges: ยังมี gauge CPU ปลอม');
  assert.doesNotMatch(body, /label: 'MEM'/, 'PerfGauges: ยังมี gauge MEM ปลอม');
  assert.doesNotMatch(body, /38\s*\+\s*\(\(metrics\.temperature/, 'ยังมีสูตร CPU ปลอม');
  assert.doesNotMatch(body, /56\s*\+\s*\(\(metrics\.humidity/, 'ยังมีสูตร MEM ปลอม');
});

test('ห้ามค่า fallback แข็งเมื่อไม่มีข้อมูล (ต้องข้าม gauge แทน)', () => {
  for (const n of [72, 64, 58, 62, 44, 31]) {
    assert.doesNotMatch(body, new RegExp(`:\\s*${n}\\s*,\\s*color`), `ยังมี fallback ${n} แข็ง`);
  }
});

test('ทุก gauge ที่เหลือต้องผูกกับแหล่งข้อมูลจริง', () => {
  assert.match(body, /deviceStatus/, 'NET ต้องมาจาก deviceStatus (อุปกรณ์ออนไลน์จริง)');
  assert.match(body, /metrics\.battery_soc/, 'PWR ต้องมาจาก battery_soc');
  assert.match(body, /metrics\.humidity/, 'HUM ต้องมาจาก humidity');
  assert.match(body, /metrics\.temperature/, 'TMP ต้องมาจาก temperature');
  assert.match(body, /metrics\.water_level_cm/, 'WTR ต้องมาจาก water_level_cm');
  assert.match(body, /metrics\.solar_radiation/, 'SOL ต้องมาจาก solar_radiation');
});

test('เมื่อไม่มี gauge เลยต้องแสดงสถานะจริง ไม่ใช่ว่างเงียบ ๆ', () => {
  assert.match(body, /ยังไม่มีข้อมูล/, 'PerfGauges: ต้องมี honest empty state เมื่อไม่มีข้อมูลจริง');
});
