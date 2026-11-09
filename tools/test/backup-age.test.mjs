// backup-age.test.mjs — เฝ้าความจริงของ "อายุ backup" ใน machine-health
// เจตนา: เคสจริง 10/11/69 — backups/postgres หายไป แต่ health ไปหยิบไฟล์ legacy
// (sovereign_shadow_orch_20261023) แล้วรายงานว่า "backup เก่า 421 ชม." ทำให้เข้าใจผิดว่า
// สาย 03:00 ตายมานาน แทนที่จะบอกว่า "โฟลเดอร์จริงไม่มีไฟล์"
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

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'mh-backup-'));
  const live = join(dir, 'live');
  const legacy = join(dir, 'legacy');
  mkdirSync(live, { recursive: true });
  mkdirSync(legacy, { recursive: true });
  return { dir, live, legacy, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function dump(dir, name, ageHours) {
  const p = join(dir, name);
  writeFileSync(p, 'x');
  const t = (Date.now() - ageHours * HOUR) / 1000;
  utimesSync(p, t, t);
}

function runHealth(box) {
  const out = execFileSync(process.execPath, [HEALTH], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      MH_LIVE_BACKUP_DIR: box.live,
      MH_DB_BACKUP_DIR: box.legacy,
      MH_BACKUP_MAX_AGE_H: '26',
    },
  });
  return JSON.parse(out);
}

const backupProblems = (json) => (json.problems || []).filter((p) => p.area === 'backup');

test('live มี dump ใหม่ → ไม่มีปัญหาและบอก source=live', () => {
  const box = sandbox();
  try {
    dump(box.live, 'sovereign_20261110_030002.dump', 1);
    const json = runHealth(box);
    assert.deepEqual(backupProblems(json), []);
    assert.equal(json.info.dbBackupSource, 'live');
    assert.ok(json.info.dbBackupAgeH < 2, `อายุควรใกล้ 1 ชม. แต่ได้ ${json.info.dbBackupAgeH}`);
  } finally {
    box.cleanup();
  }
});

test('live ว่าง + legacy เก่า → ต้องบอกว่าเป็น legacy ไม่ใช่แค่ "backup เก่า"', () => {
  const box = sandbox();
  try {
    dump(box.legacy, 'sovereign_shadow_orch_20261023_132906.dump', 421);
    const json = runHealth(box);
    const [problem] = backupProblems(json);
    assert.ok(problem, 'ต้องมีปัญหา backup');
    assert.equal(problem.level, 'critical');
    assert.equal(json.info.dbBackupSource, 'legacy');
    assert.match(problem.message, /legacy/i, 'ต้องระบุว่าไฟล์มาจาก legacy');
    assert.match(problem.message, /โฟลเดอร์จริง/i, 'ต้องบอกว่าโฟลเดอร์จริงไม่มีไฟล์');
  } finally {
    box.cleanup();
  }
});

test('legacy ยังใหม่ → เตือนระดับ warn ไม่ใช่ critical (ไม่ปิด nightly)', () => {
  const box = sandbox();
  try {
    dump(box.legacy, 'sovereign_20261110_010000.dump', 2);
    const json = runHealth(box);
    const [problem] = backupProblems(json);
    assert.ok(problem, 'ต้องเตือนว่ากำลังอ่านจาก legacy');
    assert.equal(problem.level, 'warn');
    assert.equal(json.info.dbBackupSource, 'legacy');
  } finally {
    box.cleanup();
  }
});

test('เลือกไฟล์ล่าสุดด้วย mtime ไม่ใช่ชื่อไฟล์', () => {
  const box = sandbox();
  try {
    // เรียงตามชื่อ: sovereign_zz… มาก่อน sovereign_aa… → sort() แบบชื่อจะหยิบผิดตัว
    dump(box.live, 'sovereign_aa_20261110.dump', 30);
    dump(box.live, 'sovereign_zz_20261110.dump', 1);
    const json = runHealth(box);
    assert.equal(json.info.dbBackupFile, 'sovereign_zz_20261110.dump');
    assert.ok(json.info.dbBackupAgeH < 2, `ต้องอ่านอายุของไฟล์ใหม่ แต่ได้ ${json.info.dbBackupAgeH}`);
    assert.deepEqual(backupProblems(json), []);
  } finally {
    box.cleanup();
  }
});
