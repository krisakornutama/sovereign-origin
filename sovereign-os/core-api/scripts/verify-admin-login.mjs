import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire('E:/My work/Project Sovereign Origin/sovereign-os/core-api/package.json');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const axios = require('axios');

const BASE = 'http://127.0.0.1:3001';
const USERNAME = 'admin';

function dbScalar(sql) {
  const tmp = mkdtempSync(join(tmpdir(), 'sovq-'));
  const f = join(tmp, 'q.sql');
  writeFileSync(f, sql, 'utf8');
  const r = spawnSync('docker', ['exec', '-i', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign_v2', '-t', '-A'], {
    input: sql, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function tryLogin(password) {
  try {
    const r = await axios.post(`${BASE}/api/auth/login`, { username: USERNAME, password });
    return { ok: true, data: r.data };
  } catch (e) {
    return { ok: false, status: e.response?.status, message: e.response?.data?.error || e.message };
  }
}

async function main() {
  console.log('== 1) อ่าน credential ของ admin ที่ migrate มา ==');
  const hash = dbScalar("SELECT password_hash FROM users WHERE username='admin';");
  const mfaSecret = dbScalar("SELECT mfa_secret FROM users WHERE username='admin';");
  console.log(`   hash: ${hash ? hash.slice(0, 12) + '...' : 'MISSING!'} | mfa_secret: ${mfaSecret ? 'present' : 'MISSING!'}`);
  if (!hash) throw new Error('admin hash หายไป — ตรวจ migration');

  console.log('== 2) ลองรหัสผ่านที่น่าจะเป็น (offline bcrypt) ==');
  const candidates = [
    'admin', 'admin123', 'admin1234', 'password', 'password123', 'sovereign',
    'sovereign123', 'changeme', '12345678', '123456789', '1234', 'test', 'test123',
    'root', 'admin@123', 'SovereignOS', 'sovereignos', 'qwerty', '11111111', '22222222',
  ];
  let password = null;
  for (const c of candidates) {
    if (await bcrypt.compare(c, hash)) { password = c; break; }
  }
  if (password) {
    console.log(`   ✅ เจอรหัสผ่านเดิม: "${password}"`);
  } else {
    console.log('   ❌ ไม่ตรงกับ candidate ใดเลย → reset เป็นค่าใหม่');
    password = speakeasy.generateSecret({ length: 20 }).base32.slice(0, 14).replace(/[^A-Za-z0-9]/g, 'X') + 'a1!';
    const newHash = await bcrypt.hash(password, 12);
    dbScalar(`UPDATE users SET password_hash = '${newHash}' WHERE username = '${USERNAME}';`);
    console.log(`   🔑 รหัสผ่านใหม่: ${password}`);
  }

  console.log('== 3) login ผ่าน API ==');
  const login = await tryLogin(password);
  if (!login.ok || !login.data?.token) {
    console.error(`   ❌ login ล้มเหลว: ${JSON.stringify(login)}`);
    process.exit(1);
  }
  const preToken = login.data.token;
  console.log('   ✅ login ผ่าน (token ได้, mfa_required =', login.data.mfa_required, ')');

  console.log('== 4) verify MFA ==');
  const code = speakeasy.totp({ secret: mfaSecret, encoding: 'base32' });
  let mfa;
  try {
    mfa = await axios.post(`${BASE}/api/auth/verify-mfa`, { code }, { headers: { Authorization: `Bearer ${preToken}` } });
  } catch (e) {
    console.error(`   ❌ verify-mfa ล้มเหลว: ${e.response?.data?.error || e.message}`);
    process.exit(1);
  }
  const token = mfa.data.token;
  console.log('   ✅ MFA ผ่าน (full token ได้)');

  console.log('== 5) เรียก endpoint ที่ต้อง auth ==');
  try {
    const r = await axios.get(`${BASE}/api/portfolio/summary`, { headers: { Authorization: `Bearer ${token}` } });
    console.log(`   ✅ /api/portfolio/summary → HTTP ${r.status} (portfolioUsd=${r.data.portfolioUsd}, runway=${r.data.runway?.months?.toFixed(1)} เดือน)`);
  } catch (e) {
    console.error(`   ❌ authed call ล้มเหลว: ${e.response?.status || e.message}`);
    process.exit(1);
  }

  console.log('\n🎉 RESULT: admin login + MFA + authed call ครบวงจร');
  console.log(`   username: ${USERNAME}`);
  console.log(`   password: ${password}`);
  console.log(`   MFA: ใช้แอป Authenticator เดิม (secret ถูก migrate มาแล้ว)`);
  if (!password) console.log('   ⚠️ หมายเหตุ: password เดิมยังไม่ถูกต้องตาม candidate — ใช้ค่านี้เข้าสู่ระบบแล้วค่อยเปลี่ยน');
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
