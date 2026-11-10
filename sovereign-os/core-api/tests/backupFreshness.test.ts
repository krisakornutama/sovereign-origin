import './setup-env';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestServer, makeToken, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// Backup freshness — "ข้อมูลไม่หาย" ต้องตอบได้ว่าสำรองล่าสุดเมื่อไร
//
// เจตนา: backup ที่หยุดเงียบ ๆ คือความเสียหายที่แย่กว่าการไม่มี backup เพราะคิดว่ามี
// (เคสจริง 22–26/9: marker หยุดที่ 22/9 โดยไม่มีอะไรฟ้อง — ความหวังเดิมคือ
// "machine-health เตือนที่ 26 ชม." แต่บริการนั้นไม่มีอยู่ในโค้ดแล้ว)
//
// ครอบ: pure function (ขอบ 26 ชม. / ยังไม่เคยสำรอง / อ่าน schedule) และ route จริง
//        (role gate + ต่อสายกับไฟล์บนดิสก์) — ไม่ทดสอบ pg_dump
//
// ⚠️ ห้าม import backup.service แบบ static: `BACKUP_DIR` ถูกอ่านครั้งเดียวตอนโมดูลโหลด
// ถ้า import ก่อนตั้ง env เทสต์จะไปอ่านโฟลเดอร์ backup จริงของเครื่อง
// ────────────────────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-11T12:00:00.000Z');

const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-backup-freshness-'));
process.env.BACKUP_DIR = backupDir;

let svc: typeof import('../src/services/backup.service');
let server: TestServer;

before(async () => {
  svc = await import('../src/services/backup.service');
  const { default: backupRoutes } = await import('../src/modules/backup/backup.routes');
  const file = path.join(backupDir, 'sovereign_backup_20261111_090000.sql.gz');
  fs.writeFileSync(file, 'x');
  fs.utimesSync(file, new Date(Date.now() - 3 * HOUR), new Date(Date.now() - 3 * HOUR));
  server = await createTestServer((app) => app.use('/api/backup', backupRoutes));
});

after(async () => {
  if (server) await server.close();
  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch {}
  delete process.env.BACKUP_DIR;
});

const S_003 = { enabled: true, time: '02:00' };
const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };
const VIEWER = { Authorization: `Bearer ${makeToken('USER')}` };

function entry(dateMs: number) {
  return { file: 'sovereign_backup_x.sql.gz', size: 10, date: new Date(dateMs).toISOString() };
}

describe('computeBackupStatus — ความสดของ backup', () => {
  test('ยังไม่เคยสำรอง: never + stale (ไม่มีอะไรให้เชื่อถือ)', () => {
    const s = svc.computeBackupStatus([], S_003, NOW);
    assert.strictEqual(s.never, true);
    assert.strictEqual(s.stale, true);
    assert.strictEqual(s.lastBackupAt, null);
    assert.strictEqual(s.ageHours, null);
    assert.strictEqual(s.count, 0);
    assert.deepStrictEqual(s.schedule, S_003);
    assert.strictEqual(s.staleAfterHours, svc.BACKUP_STALE_AFTER_HOURS);
  });

  test('สำรอง 3 ชม. ที่แล้ว = สด', () => {
    const s = svc.computeBackupStatus([entry(NOW - 3 * HOUR)], S_003, NOW);
    assert.strictEqual(s.never, false);
    assert.strictEqual(s.stale, false);
    assert.strictEqual(s.ageHours, 3);
    assert.strictEqual(s.lastBackupAt, new Date(NOW - 3 * HOUR).toISOString());
  });

  test('ขอบ 26 ชม.: เท่ากับเกณฑ์ยังไม่เตือน เกินหนึ่งมิลลิวินาทีเตือน', () => {
    const atLimit = svc.computeBackupStatus([entry(NOW - svc.BACKUP_STALE_AFTER_HOURS * HOUR)], S_003, NOW);
    assert.strictEqual(atLimit.stale, false, 'เท่าเกณฑ์พอดี = ยังอยู่ในกรอบที่ยอมรับ');
    const overLimit = svc.computeBackupStatus(
      [entry(NOW - svc.BACKUP_STALE_AFTER_HOURS * HOUR - 1)],
      S_003,
      NOW
    );
    assert.strictEqual(overLimit.stale, true);
  });

  test('ใช้ไฟล์ที่ใหม่ที่สุด ไม่ใช่ตัวแรกในลิสต์ และปัดอายุขึ้นเป็นชั่วโมง', () => {
    const s = svc.computeBackupStatus(
      [entry(NOW - 40 * HOUR), entry(NOW - 90 * 60 * 1000), entry(NOW - 10 * HOUR)],
      { enabled: false, time: '02:00' },
      NOW
    );
    assert.strictEqual(s.count, 3);
    assert.strictEqual(s.ageHours, 2, '90 นาที = 1.5 ชม. → ปัดขึ้นเป็น 2');
    assert.strictEqual(s.stale, false);
    assert.deepStrictEqual(s.schedule, { enabled: false, time: '02:00' });
  });
});

describe('GET /api/backup/status', () => {
  test('ต้องเป็น SUPERADMIN (401 / 403)', async () => {
    assert.strictEqual((await fetch(server.baseUrl + '/api/backup/status')).status, 401);
    assert.strictEqual((await fetch(server.baseUrl + '/api/backup/status', { headers: VIEWER })).status, 403);
  });

  test('อ่านไฟล์จริงบนดิสก์: สำรอง 3 ชม. ที่แล้ว = สด และแนบ schedule', async () => {
    const res = await fetch(server.baseUrl + '/api/backup/status', { headers: AUTH });
    assert.strictEqual(res.status, 200);
    const body: any = await res.json();
    assert.strictEqual(body.never, false);
    assert.strictEqual(body.stale, false);
    assert.strictEqual(body.count, 1);
    assert.ok(body.ageHours >= 3 && body.ageHours <= 4, `ageHours=${body.ageHours}`);
    assert.strictEqual(body.staleAfterHours, svc.BACKUP_STALE_AFTER_HOURS);
    assert.deepStrictEqual(body.schedule, S_003);
  });

  test('ไฟล์เก่าเกิน 26 ชม. = stale (คำเตือนต้องดังจริง)', async () => {
    const file = path.join(backupDir, 'sovereign_backup_20261111_090000.sql.gz');
    const old = new Date(Date.now() - 30 * HOUR);
    fs.utimesSync(file, old, old);
    const body: any = await (await fetch(server.baseUrl + '/api/backup/status', { headers: AUTH })).json();
    assert.strictEqual(body.stale, true);
    assert.ok(body.ageHours >= 30);
  });
});
