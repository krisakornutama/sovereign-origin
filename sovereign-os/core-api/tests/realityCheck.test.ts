import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Reality-Check & Paranoia Index (Anti Synthetic-Insanity)', () => {
  let testDir: string;
  let dataFile: string;
  let realityCheck: any;

  before(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-reality-'));
    dataFile = path.join(testDir, 'reality-corrections.json');
    process.env.REALITY_CORRECTIONS_FILE = dataFile;

    const mod = await import('../src/services/reality-check.service');
    realityCheck = mod.realityCheck;
    realityCheck.init();
  });

  after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
    delete process.env.REALITY_CORRECTIONS_FILE;
  });

  test('init: เริ่มว่าง', async () => {
    const st = await realityCheck.stats();
    assert.equal(st.corrections30d, 0);
    assert.equal(st.latest.length, 0);
  });

  test('addCorrection: บันทึก false_positive + stats อัปเดต + persist ไฟล์', async () => {
    const st = await realityCheck.addCorrection('false_positive', 'ช่างที่เราจ้าง ไม่ใช่ผู้บุกรุก', 'family-member', { type: 'IDS_ALERT', eventId: 'evt-1' });
    assert.equal(st.corrections30d, 1);
    assert.equal(st.falsePositives30d, 1);
    assert.equal(st.latest.length, 1);
    assert.equal(st.latest[0].note, 'ช่างที่เราจ้าง ไม่ใช่ผู้บุกรุก');
    assert.equal(st.latest[0].source_type, 'IDS_ALERT');
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].kind, 'false_positive');
  });

  test('addCorrection: kind ต่างกันนับแยก (false_negative ไม่นับเป็น paranoia)', async () => {
    await realityCheck.addCorrection('false_negative', 'พลาดประตูเปิด', 'family-member');
    const st = await realityCheck.stats();
    assert.equal(st.corrections30d, 2);
    assert.equal(st.falseNegatives30d, 1);
    assert.equal(st.falsePositives30d, 1);
  });

  test('paranoiaCalibration: เกณฑ์ 0.4 = unstable, 0.25 = watch', () => {
    const { paranoiaCalibration } = require('../src/services/reality-check.service');
    assert.equal(paranoiaCalibration(0.41), 'unstable');
    assert.equal(paranoiaCalibration(0.3), 'watch');
    assert.equal(paranoiaCalibration(0.2), 'calibrated');
    assert.equal(paranoiaCalibration(0), 'calibrated');
  });

  test('anchors: คืนรายการล่าสุดก่อน (เรียงใหม่สุดก่อน) — AI อ่านก่อนตัดสินใจ', async () => {
    await realityCheck.addCorrection('context', 'ล็อคหลังบ้านพังตั้งแต่วาน', 'admin');
    const anchors = realityCheck.anchors(2);
    assert.equal(anchors.length, 2);
    assert.equal(anchors[0].note, 'ล็อคหลังบ้านพังตั้งแต่วาน', 'อันใหม่สุดต้องมาก่อน');
  });
});