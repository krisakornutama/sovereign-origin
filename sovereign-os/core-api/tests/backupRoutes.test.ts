import './setup-env';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestServer, makeToken, TestServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// Backup routes — รายการไฟล์ / ตารางเวลา / ลบไฟล์ (mock suite, ไม่แตะ DB จริง)
//
// ครอบ: list (เรียงใหม่สุดก่อน + กรองเฉพาะ .sql.gz) · role gate SUPERADMIN ทุก endpoint
//        ที่เขียน/ลบ · validate รูปแบบเวลา HH:mm · schedule default 02:00
//        **path traversal: ชื่อไฟล์ปลอมต้องถูกปฏิเสธ** (endpoint นี้คือจุดที่ถ้าหลุด
//        = ใครก็อ่าน/ลบไฟล์นอก backup dir ได้)
//
// หมายเหตุ: createBackup/restoreBackup ยิง pg_dump/psql จริง → ไม่ทดสอบในชุด mock
// (ชุด restore จริงอยู่ที่ tools/verify/backup-restore-check.mjs และ nightly)
// ────────────────────────────────────────────────────────────────────────────

let server: TestServer;
let backupDir: string;
const TOKEN = makeToken('SUPERADMIN');
const VIEWER = makeToken('USER');
const AUTH = { Authorization: `Bearer ${TOKEN}` };

// ⚠️ ต้องตั้ง env ที่ระดับ module body (ไม่ใช่ใน before) เพราะ backup.service อ่าน BACKUP_DIR
// ครั้งเดียวตอนโมดูลถูกโหลด — ถ้าไปตั้งใน before() (ซึ่งรันหลัง import) จะชี้ไปที่โฟลเดอร์จริง
// ของระบบแทน แล้วเทสต์จะไปอ่าน/ลบไฟล์ backup ตัวจริง
backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-backup-routes-'));
process.env.BACKUP_DIR = backupDir;

before(async () => {
  // dynamic import: ให้ env ข้างบนถูกอ่านก่อน service โหลด
  const { default: backupRoutes } = await import('../src/modules/backup/backup.routes');
  // ไฟล์จริง 2 ไฟล์ + ไฟล์หลอกที่ต้องไม่โผล่
  fs.writeFileSync(path.join(backupDir, 'sovereign_backup_20261001_020000.sql.gz'), 'x');
  fs.writeFileSync(path.join(backupDir, 'sovereign_backup_20261002_020000.sql.gz'), 'yy');
  fs.writeFileSync(path.join(backupDir, 'sovereign_state_20261002_020000.json.gz'), 'zzz');
  fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'ignore me');
  // service เรียงด้วย mtime — ไฟล์ที่สร้างในมิลลิวินาทีเดียวกันจะเท่ากัน ต้องกำหนดเวลาเอง
  fs.utimesSync(path.join(backupDir, 'sovereign_backup_20261001_020000.sql.gz'), new Date('2026-10-01T02:00:00Z'), new Date('2026-10-01T02:00:00Z'));
  fs.utimesSync(path.join(backupDir, 'sovereign_backup_20261002_020000.sql.gz'), new Date('2026-10-02T02:00:00Z'), new Date('2026-10-02T02:00:00Z'));

  server = await createTestServer((app) => app.use('/api/backup', backupRoutes));
});

after(async () => {
  if (server) await server.close();
  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch {}
  delete process.env.BACKUP_DIR;
});

function post(url: string, body: any, headers: Record<string, string> = AUTH) {
  return fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ────────────────────────────────────────────────────────────────────────────
describe('GET /api/backup', () => {
  test('คืนเฉพาะ .sql.gz เรียงใหม่สุดก่อน + schedule', async () => {
    const res = await fetch(server.baseUrl + '/api/backup', { headers: AUTH });
    assert.strictEqual(res.status, 200);
    const body: any = await res.json();
    assert.deepStrictEqual(body.backups.map((b: any) => b.file), [
      'sovereign_backup_20261002_020000.sql.gz',
      'sovereign_backup_20261001_020000.sql.gz',
    ]);
    assert.ok(body.backups[0].size > 0);
    assert.ok(body.backups[0].date);
    assert.deepStrictEqual(body.schedule, { enabled: true, time: '02:00' }, 'ไม่มี schedule.json = เปิดอัตโนมัติ 02:00');
  });

  test('ไม่ต้อง login = 401', async () => {
    const res = await fetch(server.baseUrl + '/api/backup');
    assert.strictEqual(res.status, 401);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /api/backup/schedule', () => {
  test('เวลาผิดรูปแบบ = 400 (ต้องเป็น HH:mm สองหลักครบ)', async () => {
    for (const bad of ['2:00', 'abc', '02-00', '0200', '02:00:00', '๐๒:๐๐']) {
      const res = await post(server.baseUrl + '/api/backup/schedule', { enabled: true, time: bad });
      assert.strictEqual(res.status, 400, `time=${bad}`);
    }
  });

  test('ไม่ส่ง time หรือส่งค่าว่าง = ใช้ default 02:00 (พฤติกรรมที่ตั้งใจ)', async () => {
    for (const body of [{}, { enabled: true }, { enabled: true, time: '' }]) {
      const res = await post(server.baseUrl + '/api/backup/schedule', body);
      assert.strictEqual(res.status, 200, JSON.stringify(body));
      assert.strictEqual((await res.json()).schedule.time, '02:00');
    }
  });

  // ⚠️ บั๊กจริงที่เจอตอนเขียนเทสต์ (3/10/69) — ยังไม่แก้ ต้องได้รับอนุญาตจากเจ้าของก่อน
  // regex /^\d{2}:\d{2}$/ ตรวจแค่ "รูปทรง" ไม่ตรวจช่วงค่า → "25:00" ผ่าน
  // แล้ว toMin('25:00') = 1500 นาที ซึ่งเกิน nowMin สูงสุด (1439) เสมอ
  // = catch-up window ไม่มีวันเข้า → **backup ไม่เคยรันอีก** แต่ไม่มีอะไรฟ้อง
  // (ตอนนี้ machine-health จะเตือนเมื่ออายุ backup เกิน 26 ชม. — ช้ากว่าที่ควร)
  test('⚠️ ข้อบกพร่อง: "25:00" ผ่าน validation แล้วทำให้ scheduler ไม่มีวันรัน', async () => {
    const res = await post(server.baseUrl + '/api/backup/schedule', { enabled: true, time: '25:00' });
    assert.strictEqual(res.status, 200, 'พฤติกรรมปัจจุบัน = รับ (ถ้าจะแก้ = 400)');
    const body: any = await res.json();
    assert.strictEqual(body.schedule.time, '25:00');
    // พิสูจน์ผลกระทบ: ชั่วโมง 25 อยู่นอกช่วงเวลาของวันเสมอ
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    assert.ok(toMin('25:00') > 23 * 60 + 59, 'toMin เกินเวลาที่เป็นไปได้ของวัน = window ไม่มีวันเข้า');
  });

  test('⚠️ ข้อบกพร่อง: "02:60" ผ่าน แต่จะกลายเป็น 03:00 ตอนรันจริง', async () => {
    const res = await post(server.baseUrl + '/api/backup/schedule', { enabled: true, time: '02:60' });
    assert.strictEqual(res.status, 200, 'พฤติกรรมปัจจุบัน = รับ (ถ้าจะแก้ = 400)');
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    assert.strictEqual(toMin('02:60'), 180, '= 03:00 จริง ไม่ใช่ 02:60');
  });

  test('เวลาถูกรูป = บันทึกและอ่านกลับได้ตรงกัน', async () => {
    const res = await post(server.baseUrl + '/api/backup/schedule', { enabled: false, time: '23:45' });
    assert.strictEqual(res.status, 200);
    const body: any = await res.json();
    assert.deepStrictEqual(body.schedule, { enabled: false, time: '23:45' });

    const readBack: any = await (await fetch(server.baseUrl + '/api/backup', { headers: AUTH })).json();
    assert.deepStrictEqual(readBack.schedule, { enabled: false, time: '23:45' });
  });

  test('role ต่ำกว่า SUPERADMIN = 403', async () => {
    const res = await post(server.baseUrl + '/api/backup/schedule', { enabled: true, time: '02:00' }, { Authorization: `Bearer ${VIEWER}` });
    assert.strictEqual(res.status, 403);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/backup/:file — กันหลุดออกนอกโฟลเดอร์', () => {
  test('ชื่อไฟล์จริง = ลบได้ และหายจากดิสก์', async () => {
    fs.writeFileSync(path.join(backupDir, 'delete-me.sql.gz'), 'x');
    const res = await fetch(server.baseUrl + '/api/backup/delete-me.sql.gz', { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { success: true });
    assert.strictEqual(fs.existsSync(path.join(backupDir, 'delete-me.sql.gz')), false);
  });

  test('path traversal (../) ถูกปฏิเสธ ไม่ลบไฟล์นอก backup dir', async () => {
    const victim = path.join(path.dirname(backupDir), 'victim.sql.gz');
    fs.writeFileSync(victim, 'important');
    try {
      const res = await fetch(server.baseUrl + '/api/backup/..%2Fvictim.sql.gz', { method: 'DELETE', headers: AUTH });
      assert.strictEqual(res.status, 500, 'ชื่อไฟล์ที่ไม่ผ่านการ validate ต้อง error ไม่ใช่ success');
      assert.strictEqual(fs.existsSync(victim), true, 'ไฟล์นอก backup dir ต้องไม่ถูกแตะ');
    } finally {
      fs.rmSync(victim, { force: true });
    }
  });

  test('นามสกุลอื่นนอกจาก .sql.gz ถูกปฏิเสธ', async () => {
    const res = await fetch(server.baseUrl + '/api/backup/notes.txt', { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 500);
    assert.strictEqual(fs.existsSync(path.join(backupDir, 'notes.txt')), true);
  });

  test('ลบไฟล์ที่ไม่มีอยู่จริง = ยัง success (idempotent ไม่ error)', async () => {
    const res = await fetch(server.baseUrl + '/api/backup/never-existed.sql.gz', { method: 'DELETE', headers: AUTH });
    assert.strictEqual(res.status, 200);
  });

  test('role ต่ำกว่า SUPERADMIN = 403', async () => {
    fs.writeFileSync(path.join(backupDir, 'admin-only.sql.gz'), 'x');
    const res = await fetch(server.baseUrl + '/api/backup/admin-only.sql.gz', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${VIEWER}` },
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(fs.existsSync(path.join(backupDir, 'admin-only.sql.gz')), true, 'ห้ามลบก่อนผ่าน role gate');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('POST /api/backup/restore — validate ชื่อไฟล์ก่อนแตะ psql', () => {
  test('ชื่อไฟล์ผ่าน path traversal = 500 และไม่ไปถึง psql', async () => {
    const res = await post(server.baseUrl + '/api/backup/restore', { file: '../../etc/passwd' });
    assert.strictEqual(res.status, 500);
    assert.match((await res.json()).error, /Invalid backup file name/);
  });

  test('ไฟล์ที่ไม่มีอยู่จริง = 500 พร้อมบอกว่าไม่เจอ (ไม่ใช่ psql error)', async () => {
    const res = await post(server.baseUrl + '/api/backup/restore', { file: 'no-such-backup.sql.gz' });
    assert.strictEqual(res.status, 500);
    assert.match((await res.json()).error, /not found/);
  });

  test('ไม่ส่งชื่อไฟล์ = ถูกปฏิเสธ', async () => {
    const res = await post(server.baseUrl + '/api/backup/restore', {});
    assert.strictEqual(res.status, 500);
    assert.match((await res.json()).error, /Invalid backup file name/);
  });

  test('role ต่ำกว่า SUPERADMIN = 403 (restore มีผลกับทั้งฐานข้อมูล)', async () => {
    const res = await post(server.baseUrl + '/api/backup/restore', { file: 'sovereign_backup_20261001_020000.sql.gz' }, { Authorization: `Bearer ${VIEWER}` });
    assert.strictEqual(res.status, 403);
  });
});
