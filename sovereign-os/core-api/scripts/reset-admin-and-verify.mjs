// Verify the full login + MFA flow end-to-end against the live API.
//
// Modes:
//   - No ADMIN_PASSWORD  -> reset admin password to a fresh secure value first
//   - ADMIN_PASSWORD set -> reuse that password (no DB change)
//
// Checks:
//   1. wrong 2FA code                    -> must be rejected (400)
//   2. code from OLD_BACKUP_SECRET       -> rejected if DB secret differs,
//                                          accepted if DB secret was restored
//   3. code from CURRENT DB secret       -> must pass, then authed call works
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const axios = require('axios');

const BASE = process.env.API_BASE || 'http://127.0.0.1:3001';
const USERNAME = 'admin';
// mfa_secret ที่อยู่ใน DB ก่อน seed ถูก re-run (จาก backup 2026-08-11 23:20)
const OLD_BACKUP_SECRET = 'KMQTU5BBIVPEYKKSK53XIODUGRESY3KWEEYTYVTUFRZCKNDGEZZA';

function db(sql) {
  const tmp = mkdtempSync(join(tmpdir(), 'sovq-'));
  const f = join(tmp, 'q.sql');
  writeFileSync(f, sql, 'utf8');
  const r = spawnSync('docker', ['exec', '-i', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign_v2', '-t', '-A'], {
    input: sql, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function post(path, body, headers = {}) {
  const r = await axios.post(`${BASE}${path}`, body, { headers, validateStatus: () => true });
  return { status: r.status, data: r.data };
}

async function main() {
  const currentSecret = db(`SELECT mfa_secret FROM users WHERE username='${USERNAME}';`);
  const restored = currentSecret === OLD_BACKUP_SECRET;

  let password = process.env.ADMIN_PASSWORD;
  if (password) {
    console.log(`== 1) ใช้รหัสผ่านเดิม (ไม่ reset): ${password} ==`);
  } else {
    console.log(`== 1) รีเซ็ตรหัสผ่าน admin เป็นค่าใหม่ (secure random) ==`);
    password = crypto.randomBytes(18).toString('base64url'); // 24 chars, 144-bit entropy
    const newHash = await bcrypt.hash(password, 12);
    db(`UPDATE users SET password_hash = '${newHash}' WHERE username = '${USERNAME}';`);
    console.log(`   ✅ ตั้งรหัสผ่านใหม่แล้ว: ${password}`);
  }
  console.log(`   ℹ️  mfa_secret ปัจจุบันใน DB: ${currentSecret}`);
  console.log(`   ℹ️  mfa_secret เก่า (backup 11 ส.ค. 23:20): ${OLD_BACKUP_SECRET}`);
  console.log(restored
    ? '   ✅ secret ตรงกับ backup → แอป Authenticator เดิมกลับมาใช้ได้อีกครั้ง'
    : '   ⚠️  secret ต่างจาก backup → seed ถูก re-run แล้ว rotate secret');

  console.log(`\n== 2) login ผ่าน API ==`);
  const login = await post('/api/auth/login', { username: USERNAME, password });
  if (login.status !== 200 || !login.data?.token) {
    console.error(`   ❌ login ล้มเหลว: HTTP ${login.status} ${JSON.stringify(login.data)}`);
    process.exit(1);
  }
  const preToken = login.data.token;
  console.log(`   ✅ login ผ่าน (HTTP ${login.status}, mfa_required = ${login.data.mfa_required})`);
  if (login.data.mfa_required !== true) {
    console.error('   ❌ คาดว่า mfa_required = true แต่ได้', login.data.mfa_required);
    process.exit(1);
  }

  console.log(`\n== 3) NEGATIVE: ส่งรหัส 2FA ผิด (ควรโดน reject) ==`);
  const wrong = await post('/api/auth/verify-mfa', { code: '000000' }, { Authorization: `Bearer ${preToken}` });
  console.log(`   HTTP ${wrong.status} → ${JSON.stringify(wrong.data)}`);
  if (wrong.status !== 400) { console.error('   ❌ ควรได้ 400'); process.exit(1); }
  console.log('   ✅ รหัสผิดถูก reject ถูกต้อง');

  console.log(`\n== 4) รหัสจาก OLD secret (แอป Authenticator ของ user) ==`);
  const oldCode = speakeasy.totp({ secret: OLD_BACKUP_SECRET, encoding: 'base32' });
  const old = await post('/api/auth/verify-mfa', { code: oldCode }, { Authorization: `Bearer ${preToken}` });
  console.log(`   code ที่คำนวณจาก secret เก่า: ${oldCode}`);
  console.log(`   HTTP ${old.status} → ${old.data?.token ? '✅ ผ่าน (full token ได้)' : JSON.stringify(old.data)}`);
  if (restored) {
    if (old.status !== 200 || !old.data?.token) { console.error('   ❌ ควรผ่านเพราะกู้ secret เก่ากลับมาแล้ว'); process.exit(1); }
    console.log('   ✅ แอป Authenticator เดิมใช้ได้อีกครั้ง');
  } else if (old.status !== 400) {
    console.error('   ❌ ควรได้ 400 (secret ยังไม่ตรงกับแอป)'); process.exit(1);
  } else {
    console.log('   ✅ โดน reject → แอป user ยังไม่ sync (ยืนยันว่าตัวตน 2FA เก่าไม่ถูกต้อง)');
  }

  console.log(`\n== 5) POSITIVE: รหัสจาก secret ปัจจุบันใน DB (ควรผ่าน) ==`);
  const newCode = speakeasy.totp({ secret: currentSecret, encoding: 'base32' });
  const ok = await post('/api/auth/verify-mfa', { code: newCode }, { Authorization: `Bearer ${preToken}` });
  console.log(`   HTTP ${ok.status} → token: ${ok.data?.token ? ok.data.token.slice(0, 24) + '...' : JSON.stringify(ok.data)}`);
  if (ok.status !== 200 || !ok.data?.token) { console.error('   ❌ MFA ควรผ่าน'); process.exit(1); }
  const fullToken = ok.data.token;
  console.log('   ✅ MFA ผ่าน (full token ได้)');

  console.log(`\n== 6) เรียก endpoint ที่ต้อง auth (portfolio/summary) ==`);
  const authed = await axios.get(`${BASE}/api/portfolio/summary`, { headers: { Authorization: `Bearer ${fullToken}` }, validateStatus: () => true });
  console.log(`   HTTP ${authed.status} → ${JSON.stringify(authed.data).slice(0, 160)}`);
  if (authed.status !== 200) { console.error('   ❌ authed call ควรสำเร็จ'); process.exit(1); }
  console.log('   ✅ ครบวงจร');

  console.log(`\n🎉 RESULT:`);
  console.log(`   username : ${USERNAME}`);
  console.log(`   password : ${password}`);
  console.log(`   mfa_secret (ใน DB ตอนนี้): ${currentSecret}`);
  if (!restored) {
    console.log(`   mfa_secret (แอป user ใช้อยู่):  ${OLD_BACKUP_SECRET}`);
    console.log('   ⚠️  ยังไม่ sync — ต้องกู้ secret เก่าหรือ re-enroll');
  } else {
    console.log('   ✅ sync แล้ว — แอป Authenticator เดิมใช้กับรหัสผ่านนี้ได้ทันที');
  }
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
