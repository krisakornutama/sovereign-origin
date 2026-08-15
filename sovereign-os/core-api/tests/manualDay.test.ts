import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Manual Day (Cognitive Grounding)', () => {
  let testDir: string;
  let stateFile: string;
  let manualDay: any;

  before(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-manual-'));
    stateFile = path.join(testDir, 'manual-day.json');
    process.env.MANUAL_DAY_FILE = stateFile;

    const mod = await import('../src/services/manual-day.service');
    manualDay = mod.manualDay;
    manualDay.init();
  });

  after(() => {
    try {
      manualDay?.set(false, '', '');
    } catch {}
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
    delete process.env.MANUAL_DAY_FILE;
  });

  test('init: ไม่ active + automation ไม่พัก', () => {
    assert.equal(manualDay.isActive(), false);
    const { automationEngine } = require('../src/services/automation.service');
    assert.equal(automationEngine.paused, false);
  });

  test('set(true): เปิด + automation พัก + หมดอายุในอนาคต + persist', async () => {
    const st = await manualDay.set(true, 'admin', 'วันไร้ระบบ', 2);
    assert.equal(st.active, true);
    assert.equal(st.note, 'วันไร้ระบบ');
    assert.ok(st.endsAt && st.endsAt > Date.now());
    assert.ok(st.remainingMs && st.remainingMs > 0);
    const { automationEngine } = require('../src/services/automation.service');
    assert.equal(automationEngine.paused, true, 'engine ต้องถูกพัก');
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.active, true);
  });

  test('set(false): คืนระบบ + engine กลับมาทำงาน', async () => {
    const st = await manualDay.set(false, 'admin', '');
    assert.equal(st.active, false);
    const { automationEngine } = require('../src/services/automation.service');
    assert.equal(automationEngine.paused, false);
  });

  test('หมดอายุอัตโนมัติ (lazy expiry): เลยเวลา → ปิดเอง + engine คืนระบบ', async () => {
    await manualDay.set(true, 'admin', 'ลืม', 1);
    const state = { ...manualDay.state, endsAt: Date.now() - 1000 };
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
    manualDay.state = state;

    assert.equal(manualDay.isActive(), false, 'เลยเวลาต้องปลดเอง');
    const { automationEngine } = require('../src/services/automation.service');
    assert.equal(automationEngine.paused, false, 'engine ต้องกลับมาทำงาน');
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.active, false);
  });
});