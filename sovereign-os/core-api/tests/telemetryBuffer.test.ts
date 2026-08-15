// tests/telemetryBuffer.test.ts — Telemetry Downsampling (ข้อ 4: buffer → flush 1 นาที)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TelemetryBuffer } from '../src/services/telemetry-buffer.service';

const NOW = new Date('2026-08-15T12:00:00.000Z');

describe('TelemetryBuffer (downsample 60:1)', () => {
  test('add → drain: 1 แถวต่อ (node, metric) ด้วยค่าเฉลี่ย', () => {
    const buf = new TelemetryBuffer(() => NOW);
    buf.add('node-a', 'temp', 20);
    buf.add('node-a', 'temp', 22);
    buf.add('node-a', 'temp', 24);
    const rows = buf.drain();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].nodeId, 'node-a');
    assert.equal(rows[0].metric, 'temp');
    assert.equal(rows[0].deviceId, 'mqtt-auto');
    assert.equal(rows[0].value, 22); // (20+22+24)/3
    assert.equal(rows[0].time, NOW);
  });

  test('หลาย node + หลาย metric แยกกันไม่ปน', () => {
    const buf = new TelemetryBuffer(() => NOW);
    buf.add('node-a', 'temp', 20);
    buf.add('node-b', 'temp', 30);
    buf.add('node-a', 'power_kw', 1.5);
    const rows = buf.drain();
    assert.equal(rows.length, 3);
    const byKey = new Map(rows.map((r) => [`${r.nodeId}|${r.metric}`, r.value]));
    assert.equal(byKey.get('node-a|temp'), 20);
    assert.equal(byKey.get('node-b|temp'), 30);
    assert.equal(byKey.get('node-a|power_kw'), 1.5);
  });

  test('drain ล้าง buffer — ครั้งถัดไปเริ่มใหม่', () => {
    const buf = new TelemetryBuffer(() => NOW);
    buf.add('n', 'm', 10);
    buf.drain();
    assert.equal(buf.size(), 0);
    assert.equal(buf.drain().length, 0);
  });

  test('deviceId กำหนดเองได้ (ค่าเริ่มต้น mqtt-auto)', () => {
    const buf = new TelemetryBuffer(() => NOW);
    buf.add('n', 'm', 5, 'esp32-01');
    const rows = buf.drain();
    assert.equal(rows[0].deviceId, 'esp32-01');
  });

  test('size() นับจำนวน bucket ที่ค้างอยู่', () => {
    const buf = new TelemetryBuffer(() => NOW);
    assert.equal(buf.size(), 0);
    buf.add('n', 'm1', 1);
    buf.add('n', 'm2', 2);
    buf.add('n', 'm1', 3); // bucket เดิม → ไม่เพิ่ม
    assert.equal(buf.size(), 2);
  });

  test('ค่าเฉลี่ยไม่เพี้ยนกับ NaN/Infinity? กันค่าบ้า', () => {
    const buf = new TelemetryBuffer(() => NOW);
    buf.add('n', 'm', Number.NaN);
    const rows = buf.drain();
    assert.ok(Number.isNaN(rows[0].value));
  });

  test('flush หลายรอบต่อเนื่อง (จำลอง 60 ข้อความ → 1 แถว/รอบ)', () => {
    const buf = new TelemetryBuffer(() => NOW);
    for (let i = 0; i < 60; i++) buf.add('node-a', 'temp', 20 + i);
    assert.equal(buf.size(), 1); // 60 ข้อความรวมเป็น 1 bucket
    const rows = buf.drain();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, 49.5); // (20 + ... + 79) / 60
  });
});