import './setup-env';
import { test, before } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
import jwt from 'jsonwebtoken';
import { AuthService, prisma } from '../src/services/auth.service';
import { mockModel } from './helpers';

// ── MFA backup codes — รหัสสำรองใช้ครั้งเดียว กัน lockout ตอนโทรศัพท์หาย ──
// เก็บเฉพาะ sha256(code) ใน users.mfa_backup_hash (JSON array) — plaintext แสดงครั้งเดียวตอน generate

const USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TOTP_SECRET = 'abcdefghijklmnop'; // base32 สำหรับทดสอบ

const sha256 = (s: string) => crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex');

let userRow: any;
let lastUpdate: any = null;

before(async () => {
  mockModel(prisma, 'user', {
    findUnique: async ({ where }: any) => {
      if (where?.id !== USER_ID) return null;
      return userRow;
    },
    update: async ({ where, data }: any) => {
      if (where?.id !== USER_ID) throw new Error('no such user');
      lastUpdate = data;
      userRow = { ...userRow, ...data };
      return userRow;
    },
  });
});

test('confirmMfa generates 8 backup codes and stores only their hashes', async () => {
  userRow = { id: USER_ID, username: 'admin', role: 'SYSTEM_AI', pending_mfa_secret: TOTP_SECRET, mfa_secret: null, mfa_backup_hash: null };
  const code = speakeasy.totp({ secret: TOTP_SECRET, encoding: 'base32' });

  const result = await AuthService.confirmMfa(USER_ID, code);

  assert.strictEqual(result.enabled, true);
  assert.ok(Array.isArray(result.backupCodes));
  assert.strictEqual(result.backupCodes.length, 8);
  // ทุกรหัสเป็น hex 10 ตัว
  for (const c of result.backupCodes) assert.match(c, /^[0-9a-f]{10}$/);
  // ไม่มีรหัสซ้ำ
  assert.strictEqual(new Set(result.backupCodes).size, 8);
  // DB เก็บ hash ครบ 8 (ไม่มี plaintext หลุดเข้า DB)
  const stored = JSON.parse(lastUpdate.mfa_backup_hash ?? userRow.mfa_backup_hash);
  assert.strictEqual(stored.length, 8);
  for (const c of result.backupCodes) assert.ok(stored.includes(sha256(c)), 'hash ของรหัสต้องอยู่ใน DB');
  assert.ok(!JSON.stringify(stored).includes(result.backupCodes[0]), 'plaintext ห้ามถูกเก็บ');
});

test('verifyMfa accepts a valid backup code and burns it (single use)', async () => {
  const codes = ['deadbeef01', 'cafebabe02'];
  userRow = {
    id: USER_ID, username: 'admin', role: 'SYSTEM_AI',
    mfa_secret: TOTP_SECRET, mfa_backup_hash: JSON.stringify(codes.map(sha256)),
  };

  const token = await AuthService.verifyMfa(USER_ID, ' deadbeef01 '); // เว้นวรรค/พิมพ์ใหญ่ก็ยังใช้ได้
  assert.ok(token);

  const payload = jwt.decode(token) as any;
  assert.strictEqual(payload.mfa_verified, true);

  // โดนเผา: DB ต้องเหลือ 1 hash
  const remaining = JSON.parse(lastUpdate.mfa_backup_hash);
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0], sha256('cafebabe02'));
});

test('verifyMfa rejects a burned backup code', async () => {
  // user row ตอนนี้ (หลัง update mock) เหลือแค่ hash ของ cafebabe02
  await assert.rejects(
    () => AuthService.verifyMfa(USER_ID, 'deadbeef01'),
    /Invalid MFA code/
  );
});

test('verifyMfa still accepts TOTP codes when backup codes exist', async () => {
  const code = speakeasy.totp({ secret: TOTP_SECRET, encoding: 'base32' });
  const token = await AuthService.verifyMfa(USER_ID, code);
  const payload = jwt.decode(token) as any;
  assert.strictEqual(payload.mfa_verified, true);
});

test('verifyMfa rejects unknown 10-hex strings without touching TOTP', async () => {
  await assert.rejects(
    () => AuthService.verifyMfa(USER_ID, '1234567890'),
    /Invalid MFA code/
  );
});

test('regenerateBackupCodes replaces the whole set and requires MFA enabled', async () => {
  // ไม่มี mfa_secret → ปฏิเสธ
  userRow = { id: USER_ID, username: 'admin', role: 'SYSTEM_AI', mfa_secret: null, mfa_backup_hash: null };
  lastUpdate = null;
  await assert.rejects(() => AuthService.regenerateBackupCodes(USER_ID), /MFA not configured/);

  // เปิด MFA → ได้ชุดใหม่ 8 รหัส และ DB ถูกทับด้วย hash ชุดใหม่ล้วน
  userRow = { ...userRow, mfa_secret: 'totp-secret' };
  lastUpdate = null;
  const result = await AuthService.regenerateBackupCodes(USER_ID);
  assert.strictEqual(result.backupCodes.length, 8);
  const stored = JSON.parse(lastUpdate.mfa_backup_hash);
  assert.strictEqual(stored.length, 8);
  for (const c of result.backupCodes) assert.ok(stored.includes(sha256(c)));
});

test('disableMfa clears the backup code hashes too', async () => {
  userRow = { id: USER_ID, username: 'admin', role: 'SYSTEM_AI', mfa_secret: 'x', mfa_backup_hash: '["h"]' };
  await AuthService.disableMfa(USER_ID);
  assert.ok('mfa_backup_hash' in lastUpdate, 'ต้องส่ง mfa_backup_hash: null ไปกับ update');
  assert.strictEqual(lastUpdate.mfa_backup_hash, null);
  assert.strictEqual(lastUpdate.mfa_secret, null);
});
