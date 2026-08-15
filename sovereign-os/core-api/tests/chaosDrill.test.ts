import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Chaos Drill (Antifragility Self-Check)', () => {
  let testDir: string;
  let reportFile: string;

  before(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-drill-'));
    reportFile = path.join(testDir, 'chaos-drill-last.json');
    process.env.CHAOS_DRILL_FILE = reportFile;
  });

  after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
    delete process.env.CHAOS_DRILL_FILE;
  });

  test('runChaosDrill: ครบทุก check + verdict ถูกต้อง + persist ไฟล์', async () => {
    const { runChaosDrill } = await import('../src/services/chaos-drill.service');
    const report = await runChaosDrill();
    assert.ok(report.checks.length >= 5, `ต้องมีอย่างน้อย 5 check (ได้ ${report.checks.length})`);
    assert.equal(report.passed, report.checks.filter((c: any) => c.ok).length);
    assert.equal(report.total, report.checks.length);
    assert.ok(['PASS', 'DEGRADED', 'FAIL'].includes(report.verdict));
    for (const c of report.checks) {
      assert.ok(c.name, 'ทุก check ต้องมีชื่อ');
      assert.ok(c.detail, 'ทุก check ต้องมีรายละเอียด');
    }
    assert.ok(fs.existsSync(reportFile), 'ต้องบันทึก report ลงไฟล์');
    const saved = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assert.equal(saved.total, report.total);
  });

  test('lastDrillReport: อ่านรายงานล่าสุดได้', async () => {
    const { lastDrillReport } = await import('../src/services/chaos-drill.service');
    const report = lastDrillReport();
    assert.ok(report);
    assert.ok(report.at);
    assert.ok(Array.isArray(report.checks));
  });
});