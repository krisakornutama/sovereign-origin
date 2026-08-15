import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Maintenance Radar (Sovereignty Tax)', () => {
  let testDir: string;
  let dataFile: string;
  let maintenanceRadar: any;

  before(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-maint-'));
    dataFile = path.join(testDir, 'maintenance-radar.json');
    process.env.MAINTENANCE_RADAR_FILE = dataFile;

    const mod = await import('../src/services/maintenance-radar.service');
    maintenanceRadar = mod.maintenanceRadar;
    maintenanceRadar.init();
  });

  after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
    delete process.env.MAINTENANCE_RADAR_FILE;
  });

  test('status: มีงานครบ + งานที่ยังไม่เคยทำถือว่าครบกำหนด (overdue)', () => {
    const st = maintenanceRadar.status();
    assert.ok(st.tasks.length >= 5, `ต้องมีอย่างน้อย 5 งาน (ได้ ${st.tasks.length})`);
    for (const t of st.tasks) {
      assert.ok(t.id && t.label && t.intervalDays > 0 && t.effortH >= 0);
      assert.equal(typeof t.dueInDays, 'number');
      assert.equal(typeof t.overdue, 'boolean');
    }
    assert.ok(st.tasks.some((t: any) => t.overdue), 'งานที่ไม่เคยทำต้อง overdue (นับจาก "เพิ่งตั้งระบบ")');
    assert.equal(typeof st.taxHoursEstimate, 'number');
    assert.ok(Array.isArray(st.driftFlags));
  });

  test('markDone: ครบกำหนดเลื่อนออก + persist', () => {
    const before = maintenanceRadar.status().tasks.find((t: any) => t.id === 'sensor-battery');
    assert.ok(before.overdue, 'ก่อนทำ ต้อง overdue');
    const st = maintenanceRadar.markDone('sensor-battery', 'admin');
    const after = st.tasks.find((t: any) => t.id === 'sensor-battery');
    assert.equal(after.overdue, false, 'หลังทำ ต้องไม่ overdue');
    assert.equal(after.lastDoneBy, 'admin');
    assert.ok(after.dueInDays > 100, `รอบ 180 วัน → เหลืออีก ~180 วัน (ได้ ${after.dueInDays})`);
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.ok(saved.lastDone['sensor-battery']);
  });

  test('driftCheck: ทน DB ไม่พร้อม (คืน [] ไม่ throw)', async () => {
    const flags = await maintenanceRadar.driftCheck();
    assert.ok(Array.isArray(flags));
  });

  test('taxHours: ประมาณการ = ผลรวม effort ของงานที่ครบกำหนดใน 30 วัน (ปัด 1 ตำแหน่ง)', () => {
    const st = maintenanceRadar.status();
    const manual = st.tasks.filter((t: any) => t.dueInDays <= 30 && !t.auto).reduce((a: number, t: any) => a + t.effortH, 0);
    const auto = st.tasks.filter((t: any) => t.dueInDays <= 30 && t.auto).reduce((a: number, t: any) => a + t.effortH * 0.1, 0);
    assert.equal(st.taxHoursEstimate, Math.round((manual + auto) * 10) / 10);
  });
});