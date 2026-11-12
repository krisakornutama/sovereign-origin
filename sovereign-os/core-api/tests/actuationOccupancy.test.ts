// actuation: "ไม่รู้ว่ามีคนอยู่บ้าน" ต้องไม่ถูกอ่านว่า "ไม่มีคน"
//
// `PhysicalSnapshot.occupied` เดิมเป็น boolean ⇒ presence ที่อ่านไม่ได้/ไม่มี sensor
// ถูกยุบเป็น false = "ไม่มีคน" ⇒ AI/system ปิด wan-link/water-valve ได้ทั้งที่อาจมีคนอยู่
// (fail-open) — และ `loadSnapshot` ใน worker ก็คืน false ทั้งตอน query ล้ม
//
// กติกาใหม่: true = มีคน · false = ยืนยันว่าไม่มีคน · null = ไม่รู้
// กลุ่ม shutdown (wan-link/water-valve) ของ non-human ต้อง fail-closed เมื่อ null
import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Actuator, EnvelopeConfig, PhysicalSnapshot } from '../src/services/actuation.service';

// ต้องตั้ง ACT_STATE_FILE ก่อนโหลด service (module-level const ผูกค่าตอน import ครั้งแรก)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-occ-'));
process.env.ACT_STATE_FILE = path.join(TMP, 'actuation-state.json');
process.env.ACT_VERIFY_TIMEOUT_MS = '150';
process.env.ACT_VERIFY_POLL_MS = '20';
process.env.ACT_RELAY_COOLDOWN_MS = '0';

// require (ไม่ใช่ import) เพื่อให้ env ข้างบนมีผลก่อน module โหลด — tsx รันเป็น CJS จึงไม่มี top-level await
const { evaluateEnvelope, snapshotFromTelemetry, ActuationService } = require('../src/services/actuation.service') as typeof import('../src/services/actuation.service');

const cfg: EnvelopeConfig = {
  batteryFloorPct: 20,
  batteryHoldPct: 30,
  heavyDrawKw: 0.5,
  tempCeilingC: 45,
  relayCooldownMs: 60000,
  criticalRelays: ['wan-link', 'water-valve'],
  occupancyGraceMs: 1800000,
  verifyTimeoutMs: 100,
  verifyPollMs: 10,
};

const valve: Actuator = {
  id: 'water-valve',
  kind: 'relay',
  label: 'วาล์วน้ำ',
  state: 'on',
  class: 'critical',
  energyImpactKw: 0.1,
};
const lamp: Actuator = {
  id: 'load-1',
  kind: 'relay',
  label: 'โหลดกลาง',
  state: 'on',
  class: 'standard',
  energyImpactKw: 0.4,
};

const snap = (over: Partial<PhysicalSnapshot> = {}): PhysicalSnapshot => ({
  batterySoc: 50,
  powerKw: -0.5,
  tempC: 30,
  occupied: false,
  ...over,
});

test('occupied = null (presence อ่านไม่ได้) → system ปิด water-valve ไม่ได้ และบอกว่ายังไม่รู้', () => {
  const v = evaluateEnvelope(valve, 'off', 'system', snap({ occupied: null }), cfg, 0);
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'OCCUPANCY');
  assert.match(String(v.reason), /ไม่รู้/);
});

test('occupied = null + governor ก็ไม่ผ่าน (critical circuit หรือ occupancy ก็ต้องกัน)', () => {
  const v = evaluateEnvelope(valve, 'off', 'governor', snap({ occupied: null }), cfg, 0);
  assert.equal(v.allowed, false);
});

test('occupied = false (ยืนยันว่าไม่มีคน) → system ปิดได้ตามเดิม (ไม่เข้มเกิน)', () => {
  assert.equal(evaluateEnvelope(valve, 'off', 'system', snap({ occupied: false }), cfg, 0).allowed, true);
});

test('occupied = true → system ปิดไม่ได้ พร้อมบอกว่ามีคนอยู่', () => {
  const v = evaluateEnvelope(valve, 'off', 'system', snap({ occupied: true }), cfg, 0);
  assert.equal(v.allowed, false);
  assert.equal(v.rule, 'OCCUPANCY');
  assert.match(String(v.reason), /มีคนอยู่บ้าน/);
});

test('human สั่งได้เสมอ แม้สถานะคนอยู่บ้านไม่ทราบ', () => {
  assert.equal(evaluateEnvelope(valve, 'off', 'human', snap({ occupied: null }), cfg, 0).allowed, true);
});

test('ไม่รู้สถานะคนอยู่บ้าน ไม่บล็อกงานที่ไม่ใช่กลุ่ม shutdown (เช่น ปิดโหลดกลาง)', () => {
  assert.equal(evaluateEnvelope(lamp, 'off', 'system', snap({ occupied: null }), cfg, 0).allowed, true);
});

test('snapshotFromTelemetry: presence ไม่มีแถว = null ไม่ใช่ false', () => {
  const s = snapshotFromTelemetry({
    latest: [
      { metric: 'battery_soc', value: '64' },
      { metric: 'power_kw', value: '-0.3' },
    ],
    temp: [{ max_temp: '31.5' }],
    occupancy: [],
  });
  assert.equal(s.batterySoc, 64);
  assert.equal(s.powerKw, -0.3);
  assert.equal(s.tempC, 31.5);
  assert.ok(s.occupied === null, 'ไม่มี presence = ไม่รู้ ไม่ใช่ "ไม่มีคน"');
});

test('snapshotFromTelemetry: presence = 0 คือไม่มีคน (false), >0 คือมีคน (true)', () => {
  const base = { latest: [], temp: [], occupancy: [] as Array<{ value: any }> };
  assert.equal(snapshotFromTelemetry({ ...base, occupancy: [{ value: '0' }] }).occupied, false);
  assert.equal(snapshotFromTelemetry({ ...base, occupancy: [{ value: '1' }] }).occupied, true);
  assert.equal(snapshotFromTelemetry({ ...base, occupancy: [{ value: 0 }] }).occupied, false);
});

test('snapshotFromTelemetry: ค่าที่อ่านไม่ได้ (null/ไม่ใช่ตัวเลข) = null ไม่ใช่ 0', () => {
  const s = snapshotFromTelemetry({
    latest: [{ metric: 'battery_soc', value: null }, { metric: 'power_kw', value: 'n/a' }],
    temp: [{ max_temp: null }],
    occupancy: [{ value: 'NaN' }],
  });
  assert.equal(s.batterySoc, null);
  assert.equal(s.powerKw, null);
  assert.equal(s.tempC, null);
  assert.ok(s.occupied === null, 'presence ที่แปลงไม่ได้ = ไม่รู้');
});

test('setOccupancy (PUT /occupancy) มีผลจริง: override true กัน system ปิดน้ำ แม้ snapshot บอกว่าไม่มีคน', async () => {
  const svc = new ActuationService({ loadSnapshot: async () => snap({ occupied: false }) });
  svc.setOccupancy(true);
  const denied = await svc.executeCommand({
    actuatorId: 'water-valve',
    desiredState: 'off',
    actor: 'system',
    reason: 'override test',
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.rule, 'OCCUPANCY');

  // เคลียร์ override = กลับไปใช้ค่าจริง (false → ปิดได้)
  svc.setOccupancy(null);
  const allowed = await svc.executeCommand({
    actuatorId: 'water-valve',
    desiredState: 'off',
    actor: 'system',
    reason: 'override cleared',
  });
  assert.equal(allowed.ok, true);
});
