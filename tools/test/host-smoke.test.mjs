#!/usr/bin/env node
/* ── HOST-002: "เปิดมาแล้วต้องใช้งานได้ปกติ" — เทสต์ตรรกะของ tools/host-smoke.mjs ──
   กฎ: ข้อใดข้อหนึ่งในนี้ล้ม (API ตาย, DB unavailable, เว็บไม่ใช่ HTML, container ตาย)
   ต้องทำให้ผลรวมเป็น FAIL เพื่อไม่ให้ปิดงานทั้งที่ระบบใช้งานไม่ได้
   ─────────────────────────────────────────────────────────────────────────── */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeLiveness,
  judgeAppHealth,
  judgeWeb,
  judgeContainers,
  judgeTasks,
  summarize,
} from '../host-smoke.mjs';

const ok = (name) => ({ name, ok: true, detail: '', critical: true });

describe('API liveness', () => {
  test('200 + ok:true = ผ่าน', () => {
    assert.equal(judgeLiveness({ status: 200, body: { ok: true, uptime: 12 } }).ok, true);
  });
  test('ต่อไม่ติด (status 0) = ไม่ผ่าน', () => {
    const r = judgeLiveness({ status: 0, body: null });
    assert.equal(r.ok, false);
    assert.equal(r.critical, true);
  });
  test('200 แต่ ok ไม่ใช่ true = ไม่ผ่าน', () => {
    assert.equal(judgeLiveness({ status: 200, body: { ok: false } }).ok, false);
  });
});

describe('App health + DB', () => {
  test('db.state=ok = ผ่าน', () => {
    const r = judgeAppHealth({
      status: 200,
      body: { status: 'ok', build: { fingerprint: 'abc' }, db: { state: 'ok', migrationHead: 'm1' } },
    });
    assert.equal(r.ok, true);
    assert.match(r.detail, /db ok/);
  });

  test('db.state=unavailable = ไม่ผ่าน (ต่อ DB ไม่ได้)', () => {
    const r = judgeAppHealth({
      status: 200,
      body: { status: 'ok', db: { state: 'unavailable', reason: 'ECONNREFUSED' } },
    });
    assert.equal(r.ok, false);
    assert.equal(r.critical, true);
    assert.match(r.detail, /ECONNREFUSED/);
  });

  test('ไม่มีข้อมูล DB ในคำตอบ = ผ่านแบบเตือน (สัญญาเดิม status:ok)', () => {
    const r = judgeAppHealth({ status: 200, body: { status: 'ok' } });
    assert.equal(r.ok, true);
    assert.equal(r.critical, false);
  });

  test('status ไม่ใช่ ok = ไม่ผ่าน', () => {
    assert.equal(judgeAppHealth({ status: 200, body: { status: 'degraded' } }).ok, false);
  });
});

describe('หน้าเว็บ', () => {
  test('200 + HTML = ผ่าน', () => {
    assert.equal(judgeWeb({ status: 200, text: '<!DOCTYPE html><html><body>x</body></html>' }).ok, true);
  });
  test('200 แต่ไม่ใช่ HTML = ไม่ผ่าน', () => {
    assert.equal(judgeWeb({ status: 200, text: 'upstream connect error' }).ok, false);
  });
  test('หน้า error ของ Next = ไม่ผ่าน', () => {
    assert.equal(judgeWeb({ status: 200, text: '<html>Internal Server Error</html>' }).ok, false);
  });
  test('502 = ไม่ผ่าน', () => {
    assert.equal(judgeWeb({ status: 502, text: '' }).ok, false);
  });
});

describe('Docker', () => {
  test('ขึ้นครบ ไม่มี unhealthy = ผ่าน', () => {
    const r = judgeContainers([
      { name: 'sovereign-api-1', status: 'Up 2 hours (healthy)' },
      { name: 'sovereign-db-1', status: 'Up 2 hours (healthy)' },
    ]);
    assert.equal(r.ok, true);
  });
  test('มีตัว unhealthy = ไม่ผ่าน พร้อมบอกชื่อ', () => {
    const r = judgeContainers([
      { name: 'sovereign-api-1', status: 'Up 1 min (unhealthy)' },
      { name: 'sovereign-db-1', status: 'Up 2 hours (healthy)' },
    ]);
    assert.equal(r.ok, false);
    assert.match(r.detail, /sovereign-api-1/);
  });
  test('ไม่มี container เลย = ไม่ผ่าน', () => {
    assert.equal(judgeContainers([]).ok, false);
  });
  test('อ่านสถานะไม่ได้ = เตือน ไม่บล็อก', () => {
    const r = judgeContainers(null);
    assert.equal(r.ok, false);
    assert.equal(r.critical, false);
  });
});

describe('Scheduled tasks', () => {
  test('Sovereign tasks ทั้งหมด Ready = ผ่าน', () => {
    const r = judgeTasks([
      { name: 'Sovereign Nightly Verify', state: 'Ready' },
      { name: 'Microsoft Edge', state: 'Disabled' }, // ไม่ใช่ของโปรเจ็ก — ไม่นับ
    ]);
    assert.equal(r.ok, true);
  });
  test('มีตัว Disabled = เตือน (ไม่บล็อกการทำงานของแอป)', () => {
    const r = judgeTasks([{ name: 'Sovereign Offsite Backup', state: 'Disabled' }]);
    assert.equal(r.ok, false);
    assert.equal(r.critical, false);
  });
});

describe('สรุปผล', () => {
  test('มีข้อ critical แดงข้อเดียว = ทั้งชุด FAIL (exit 1)', () => {
    const s = summarize([ok('a'), judgeLiveness({ status: 0 })]);
    assert.equal(s.ok, false);
    assert.equal(s.failedCritical.length, 1);
  });
  test('แดงเฉพาะข้อเตือน = ยังผ่าน', () => {
    const s = summarize([ok('a'), judgeTasks(null)]);
    assert.equal(s.ok, true);
    assert.equal(s.failedSoft.length, 1);
  });
  test('เขียวทั้งหมด = ผ่าน', () => {
    const s = summarize([ok('a'), ok('b')]);
    assert.equal(s.ok, true);
    assert.equal(s.failedCritical.length, 0);
  });
});
