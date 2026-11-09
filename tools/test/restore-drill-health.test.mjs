// restore-drill-health.test.mjs — ผลของ restore drill ต้องโผล่ใน machine-health
// เจตนา: "มี backup ใหม่ทุกคืน" ไม่เท่ากับ "กู้คืนได้" — ถ้า drill ล้มหรือไม่เคยรัน
// ต้องเห็นใน verdict เดียวกับที่แจ้ง Telegram ไม่ใช่ต้องไปเปิด logs/backup-restore-check.json เอง
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HEALTH = join(ROOT, 'tools', 'machine-health.mjs');
const HOUR = 3_600_000;

function sandbox(record) {
  const dir = mkdtempSync(join(tmpdir(), 'mh-restore-'));
  const live = join(dir, 'live');
  mkdirSync(live, { recursive: true });
  // dump สด เพื่อไม่ให้ปัญหา backup มาบดบังปัญหาที่กำลังทดสอบ
  const dumpPath = join(live, 'sovereign_test.dump');
  writeFileSync(dumpPath, 'x');
  const file = join(dir, 'backup-restore-check.json');
  if (record) writeFileSync(file, JSON.stringify(record, null, 2));
  return { dir, live, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runHealth(box) {
  const out = execFileSync(process.execPath, [HEALTH], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      MH_LIVE_BACKUP_DIR: box.live,
      MH_DB_BACKUP_DIR: join(box.dir, 'legacy-empty'),
      MH_RESTORE_CHECK_FILE: box.file,
      MH_RESTORE_MAX_AGE_H: '36',
    },
  });
  return JSON.parse(out);
}

const restoreProblems = (json) => (json.problems || []).filter((p) => p.area === 'restore');
const record = (over = {}) => ({
  at: new Date().toISOString(),
  ok: true,
  problems: [],
  dump: 'sovereign_20261110_030002.dump',
  liveTables: 150,
  restoredTables: 150,
  ...over,
});

test('drill ผ่านสด ๆ → ไม่มีปัญหา + health เห็นตัวเลขตาราง', () => {
  const box = sandbox(record());
  try {
    const json = runHealth(box);
    assert.deepEqual(restoreProblems(json), []);
    assert.equal(json.info.restoreDrill.ok, true);
    assert.equal(json.info.restoreDrill.liveTables, 150);
    assert.equal(json.info.restoreDrill.restoredTables, 150);
  } finally {
    box.cleanup();
  }
});

test('drill ไม่เคยรัน → เตือน (ไม่ใช่เงียบ)', () => {
  const box = sandbox(null);
  try {
    const [problem] = restoreProblems(runHealth(box));
    assert.ok(problem, 'ต้องมีปัญหา restore');
    assert.equal(problem.level, 'warn');
    assert.match(problem.message, /ยังไม่เคยพิสูจน์/);
  } finally {
    box.cleanup();
  }
});

test('drill ล้ม → critical พร้อมเหตุผลแรก', () => {
  const box = sandbox(record({ ok: false, problems: ['pg_restore มีข้อความ/ข้อผิดพลาด: could not find hypertable'] }));
  try {
    const [problem] = restoreProblems(runHealth(box));
    assert.ok(problem);
    assert.equal(problem.level, 'critical');
    assert.match(problem.message, /restore drill ล้มเหลว/);
    assert.match(problem.message, /hypertable/);
  } finally {
    box.cleanup();
  }
});

test('ผลเก่าเกินกำหนด → เตือนว่าขาดการพิสูจน์รอบล่าสุด', () => {
  const box = sandbox(record());
  try {
    const old = (Date.now() - 48 * HOUR) / 1000;
    utimesSync(box.file, old, old);
    writeFileSync(box.file, JSON.stringify(record({ at: new Date(Date.now() - 48 * HOUR).toISOString() }), null, 2));
    utimesSync(box.file, old, old);
    const [problem] = restoreProblems(runHealth(box));
    assert.ok(problem);
    assert.equal(problem.level, 'warn');
    assert.match(problem.message, /เก่า 48/);
  } finally {
    box.cleanup();
  }
});

test('กู้ได้ตารางน้อยกว่าจริง → critical (backup ขาดตาราง)', () => {
  const box = sandbox(record({ liveTables: 150, restoredTables: 142 }));
  try {
    const [problem] = restoreProblems(runHealth(box));
    assert.ok(problem);
    assert.equal(problem.level, 'critical');
    assert.match(problem.message, /กู้ได้ 142 ตาราง แต่ของจริงมี 150/);
  } finally {
    box.cleanup();
  }
});
