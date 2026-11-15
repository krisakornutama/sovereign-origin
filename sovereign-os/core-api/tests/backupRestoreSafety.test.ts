// POST /api/backup/restore — การกระทำที่ทำลายข้อมูลมากที่สุดในระบบ ต้อง "ตั้งใจ" จริงและมีร่องรอย
//
// ปัญหาที่เทสต์นี้ยึด:
//   1) ตัวเรียกใช้ต้องพิมพ์ชื่อไฟล์ยืนยัน (confirm) ให้ตรง — window.confirm ฝั่ง UI เป็นแค่
//      ความสะดวก ยิง API ตรงได้เสมอ และการกู้คืนผิดไฟล์คือข้อมูลหายถาวร
//   2) สถานะต้องแยกให้ถูก: ชื่อไฟล์ผิดรูป = 400, ไฟล์ไม่มี = 404 (เดิม 500 ทั้งคู่
//      ซึ่งอ่านว่า "เซิร์ฟเวอร์พัง" และทำให้เครื่องมือ retry ซ้ำ)
//   3) ต้องมีร่องรอยที่ "รอดจากการกู้คืน": audit ใน DB อาจถูกแทนที่ด้วย dump รุ่นเก่า
//      ที่กำลังกู้คืน ⇒ เขียน journal ลงไฟล์ข้าง backup ด้วย (ใคร/เมื่อไร/ไฟล์ไหน/ผลลัพธ์)
import './setup-env';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestServer, makeToken, TestServer } from './helpers';

// ⚠️ ต้องตั้งก่อน import service — backup.service อ่าน BACKUP_DIR ตอนโมดูลถูกโหลด
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovereign-restore-safety-'));
process.env.BACKUP_DIR = backupDir;

const MISSING = 'sovereign_backup_20261101_020000.sql.gz';
const CORRUPT = 'sovereign_backup_20261102_020000.sql.gz'; // มีไฟล์แต่ไม่ใช่ gzip ⇒ ล้มก่อนถึง psql
const JOURNAL = 'restore-history.jsonl';

let server: TestServer;
let service: typeof import('../src/services/backup.service');

const AUTH = { Authorization: `Bearer ${makeToken('SUPERADMIN')}` };

before(async () => {
  const { default: backupRoutes } = await import('../src/modules/backup/backup.routes');
  service = await import('../src/services/backup.service');
  fs.writeFileSync(path.join(backupDir, CORRUPT), 'not a gzip stream');
  server = await createTestServer((app) => app.use('/api/backup', backupRoutes));
});

after(async () => {
  if (server) await server.close();
  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch {}
  delete process.env.BACKUP_DIR;
});

async function post(body: any, headers: Record<string, string> = AUTH) {
  const res = await fetch(server.baseUrl + '/api/backup/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function journal(): any[] {
  const file = path.join(backupDir, JOURNAL);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

function clearJournal() {
  const file = path.join(backupDir, JOURNAL);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

test('ไม่มี confirm = 400 และต้องไม่เริ่มกู้คืนเลย (ไม่มีร่องรอย journal)', async () => {
  clearJournal();
  const { status, body } = await post({ file: CORRUPT });
  assert.equal(status, 400);
  assert.match(body.error, /ยืนยัน|confirm/i);
  assert.deepEqual(journal(), [], 'ยังไม่ผ่านด่านยืนยัน = ต้องไม่แตะไฟล์/psql เลย');
});

test('confirm ไม่ตรงชื่อไฟล์ = 400 (พิมพ์ผิดตัวเดียวก็ห้ามผ่าน)', async () => {
  clearJournal();
  const { status, body } = await post({ file: CORRUPT, confirm: MISSING });
  assert.equal(status, 400);
  assert.match(body.error, /ยืนยัน|confirm/i);
  assert.deepEqual(journal(), []);
});

test('confirm ไม่ใช่สตริง (หรือช่องว่าง) = 400', async () => {
  for (const confirm of [null, 12345, '   ', {}]) {
    const { status } = await post({ file: CORRUPT, confirm });
    assert.equal(status, 400, `confirm=${JSON.stringify(confirm)} ต้องไม่ผ่าน`);
  }
  assert.deepEqual(journal(), []);
});

test('ชื่อไฟล์ไม่ปลอดภัย = 400 (เดิม 500) และไม่แตะ psql', async () => {
  const { status, body } = await post({ file: '../../etc/passwd', confirm: '../../etc/passwd' });
  assert.equal(status, 400);
  assert.match(body.error, /Invalid backup file name/);
});

test('ไฟล์ที่ไม่มีอยู่จริง = 404 (เดิม 500) — ไม่ใช่ความผิดของเซิร์ฟเวอร์', async () => {
  clearJournal();
  const { status, body } = await post({ file: MISSING, confirm: MISSING });
  assert.equal(status, 404);
  assert.match(body.error, /not found/i);
  const entries = journal();
  assert.equal(entries.length, 1, 'ความพยายามที่ล้มเหลวต้องมีร่องรอย');
  assert.equal(entries[0].ok, false);
  assert.equal(entries[0].status, 404);
  assert.equal(entries[0].file, MISSING);
});

test('ไฟล์เสียหาย = 500 พร้อมบันทึกร่องรอย (ok:false + error) และไม่เรียก psql', async () => {
  clearJournal();
  const { status } = await post({ file: CORRUPT, confirm: CORRUPT });
  assert.equal(status, 500);
  const entries = journal();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ok, false);
  assert.equal(entries[0].status, 500);
  assert.equal(entries[0].file, CORRUPT);
  assert.ok(entries[0].at && !Number.isNaN(Date.parse(entries[0].at)), 'ต้องมีเวลาที่เกิดเหตุ');
  assert.equal(typeof entries[0].userId, 'string');
  assert.ok(entries[0].ip, 'ต้องบันทึก IP ของผู้สั่ง');
  assert.match(String(entries[0].error), /incorrect header|not in gzip/i);
});

test('ยังต้องเป็น SUPERADMIN เท่านั้น — confirm ไม่ใช่ทางข้ามสิทธิ์', async () => {
  clearJournal();
  const { status } = await post({ file: CORRUPT, confirm: CORRUPT }, { Authorization: `Bearer ${makeToken('OPERATOR')}` });
  assert.equal(status, 403);
  assert.deepEqual(journal(), []);
});

test('GET /restore-history คืนรายการล่าสุดก่อน และเป็น SUPERADMIN เท่านั้น', async () => {
  clearJournal();
  await post({ file: MISSING, confirm: MISSING });
  service.appendRestoreJournal({ at: '2026-11-12T01:00:00.000Z', file: 'older.sql.gz', ok: true, status: 200, userId: 'x', ip: '127.0.0.1' });

  const res = await fetch(server.baseUrl + '/api/backup/restore-history', { headers: AUTH });
  assert.equal(res.status, 200);
  const { restores } = await res.json();
  assert.equal(restores.length, 2);
  assert.equal(restores[0].file, 'older.sql.gz', 'ใหม่สุดต้องมาก่อน');

  const denied = await fetch(server.baseUrl + '/api/backup/restore-history', {
    headers: { Authorization: `Bearer ${makeToken('OPERATOR')}` },
  });
  assert.equal(denied.status, 403);
});

test('journal ไม่โตไม่จำกัด — เก็บเฉพาะรายการล่าสุดตามเพดาน', async () => {
  clearJournal();
  for (let i = 0; i < 60; i++) {
    service.appendRestoreJournal({ at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), file: `f${i}.sql.gz`, ok: true, status: 200 });
  }
  const entries = journal();
  assert.ok(entries.length <= 50, `ต้องถูกตัดให้เหลือ ≤ 50 แถว (ได้ ${entries.length})`);
  assert.equal(entries[entries.length - 1].file, 'f59.sql.gz', 'รายการใหม่สุดต้องอยู่');
  assert.notEqual(entries[0].file, 'f0.sql.gz', 'รายการเก่าสุดต้องถูกตัดทิ้ง');
});

test('บรรทัดที่เสียหายใน journal ต้องไม่ทำให้ GET ล้ม (อ่านข้ามได้)', async () => {
  clearJournal();
  service.appendRestoreJournal({ at: new Date().toISOString(), file: 'good.sql.gz', ok: true, status: 200 });
  fs.appendFileSync(path.join(backupDir, JOURNAL), '{ not json\n');
  const res = await fetch(server.baseUrl + '/api/backup/restore-history', { headers: AUTH });
  assert.equal(res.status, 200);
  const { restores } = await res.json();
  assert.deepEqual(restores.map((r: any) => r.file), ['good.sql.gz']);
});
