import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Living Mode (Anti-Goodhart Shield)', () => {
  let testDir: string;
  let stateFile: string;
  let livingMode: any;

  before(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-living-'));
    stateFile = path.join(testDir, 'living-mode.json');
    process.env.LIVING_MODE_FILE = stateFile;

    const mod = await import('../src/services/living-mode.service');
    livingMode = mod.livingMode;
    livingMode.init();
  });

  after(() => {
    try {
      livingMode?.set(false, '');
    } catch {}
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
    delete process.env.LIVING_MODE_FILE;
  });

  test('init: ปิดเสมอ', () => {
    assert.equal(livingMode.isActive(), false);
    assert.equal(livingMode.status().active, false);
  });

  test('set(true): เปิด + persist + จำคนเปิด', () => {
    const st = livingMode.set(true, 'admin');
    assert.equal(st.active, true);
    assert.equal(livingMode.isActive(), true);
    assert.equal(st.by, 'admin');
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.active, true);
  });

  test('set(false): ปิด + persist', () => {
    const st = livingMode.set(false, 'admin');
    assert.equal(st.active, false);
    assert.equal(livingMode.isActive(), false);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.active, false);
  });

  test('automation guard: ON → กฎ lifestyle metric ถูกข้าม, OFF → เตือนปกติ', async () => {
    const { AutomationEngine, LIFESTYLE_METRICS } = await import('../src/services/automation.service');
    const engine = new AutomationEngine();
    (engine as any).rules = [
      { id: 'r1', metric: 'smoke', condition: 'gt', threshold: 200, message: 'เจอควัน', severity: 'warning', enabled: true },
      { id: 'r2', metric: 'power_kw', condition: 'gt', threshold: 10, message: 'ไฟเกิน', severity: 'warning', enabled: true },
      { id: 'r3', metric: 'water_level_cm', condition: 'lt', threshold: 5, message: 'น้ำใกล้หมด', severity: 'warning', enabled: true },
    ];
    assert.ok(LIFESTYLE_METRICS.has('smoke'), 'smoke ต้องอยู่ใน lifestyle metrics');
    assert.ok(LIFESTYLE_METRICS.has('power_kw'));
    assert.ok(!LIFESTYLE_METRICS.has('water_level_cm'), 'น้ำเป็นโครงสร้างพื้นฐาน ไม่ใช่ lifestyle');

    livingMode.set(true, 'admin');
    const alerts = engine.checkMetrics({ smoke: 500, power_kw: 50, water_level_cm: 2 });
    assert.deepEqual(alerts, ['น้ำใกล้หมด'], 'เมื่อ Living Mode เปิด ต้องข้าม smoke+ไฟ แต่ยังเตือนน้ำ');

    livingMode.set(false, 'admin');
    const engine2 = new AutomationEngine(); // engine ใหม่ → cooldown ไม่แทรกแซง
    (engine2 as any).rules = (engine as any).rules;
    const alertsOff = engine2.checkMetrics({ smoke: 500, power_kw: 50, water_level_cm: 2 });
    assert.equal(alertsOff.length, 3, 'Living Mode ปิด → เตือนครบ');
  });
});