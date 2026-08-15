import './setup-env';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Survival: Backup State Bundle + Retention', () => {
  let tmp: string;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-surv-'));
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.BACKUP_RETAIN = '3';
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
    delete process.env.BACKUP_DIR;
    delete process.env.BACKUP_RETAIN;
  });

  test('stateBundleName: รูปแบบ sovereign_state_YYYYMMDD_HHMMSS.json.gz', async () => {
    const { stateBundleName } = await import('../src/services/backup.service');
    const name = stateBundleName(new Date(2026, 7, 15, 9, 30, 5));
    assert.match(name, /^sovereign_state_20260815_093005\.json\.gz$/);
  });

  test('collectStateFiles: รวบรวม data/*.json จาก cwd ที่กำหนด', async () => {
    const { collectStateFiles } = await import('../src/services/backup.service');
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'a.json'), '{"a":1}');
    fs.writeFileSync(path.join(dataDir, 'b.json'), '{"b":2}');
    fs.writeFileSync(path.join(dataDir, 'ignore.txt'), 'x');
    const files = collectStateFiles(tmp);
    const names = files.map((f) => f.name).sort();
    assert.deepEqual(names, ['data/a.json', 'data/b.json']);
    assert.equal(files.find((f) => f.name === 'data/a.json')?.content, '{"a":1}');
  });

  test('collectStateFiles: รวบรวม host-infra.env ถ้ามี', async () => {
    const { collectStateFiles } = await import('../src/services/backup.service');
    fs.writeFileSync(path.join(tmp, 'host-infra.env'), 'SECRET=abc');
    const files = collectStateFiles(tmp);
    const env = files.find((f) => f.name === 'host-infra.env');
    assert.ok(env, 'ต้องพบ host-infra.env');
    assert.equal(env?.content, 'SECRET=abc');
  });

  test('applyRetention: ลบไฟล์เก่าเกิน keep (เรียงตาม mtime)', async () => {
    const { applyRetention } = await import('../src/services/backup.service');
    const dir = path.join(tmp, 'rt');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      const f = path.join(dir, `b_${i}.sql.gz`);
      fs.writeFileSync(f, 'x');
      const t = new Date(Date.now() - i * 60_000);
      fs.utimesSync(f, t, t);
    }
    const removed = applyRetention(dir, '.sql.gz', 3);
    assert.equal(removed.length, 2, 'ต้องลบ 2 ไฟล์เก่าสุด');
    const left = fs.readdirSync(dir).filter((f) => f.endsWith('.sql.gz'));
    assert.equal(left.length, 3);
    assert.ok(left.includes('b_0.sql.gz') || left.includes('b_1.sql.gz'), 'เก็บของใหม่สุดไว้');
  });

  test('getSchedule: ไม่มี schedule.json = เปิดอัตโนมัติ 02:00', async () => {
    const { backupService } = await import('../src/services/backup.service');
    const sched = backupService.getSchedule();
    assert.equal(sched.enabled, true, 'default ต้องเปิด (survival)');
    assert.equal(sched.time, '02:00');
  });
});

describe('Survival: System Monitor', () => {
  test('parseDfLine: แยก total/free/usedPct จาก df -Pk', async () => {
    const { parseDfLine } = await import('../src/services/system-monitor.service');
    const info = parseDfLine('/dev/sda1 1024000 512000 512000 50% /app');
    assert.ok(info);
    assert.equal(info.totalMb, 1024000);
    assert.equal(info.freeMb, 512000);
    assert.equal(info.usedPct, 50);
  });

  test('parseDfLine: บรรทัดไม่ถูกต้อง = null', async () => {
    const { parseDfLine } = await import('../src/services/system-monitor.service');
    assert.equal(parseDfLine(''), null);
    assert.equal(parseDfLine('Filesystem 1024-blocks Used Available Capacity Mounted'), null);
    assert.equal(parseDfLine('abc'), null);
  });
});