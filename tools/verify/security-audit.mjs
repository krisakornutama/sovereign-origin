#!/usr/bin/env node
// tools/verify/security-audit.mjs — เจาะระบบตัวเอง (Sovereign ของเราเอง — authorized ตลอดเส้น)
//   1) security headers + information disclosure + CORS — WARN (ปรับได้ค่อย ๆ ไม่ตื่ม gate)
//   2) SQL injection probes บนฟอร์มตัวเอง (login / audit search) — FAIL ถ้า 500 / รั่ว SQL error / เข้าได้
//   3) brute-force login — พิสูจน์ loginLimiter (per-IP 10/15 นาที) ตอบ 429 จริง (ใช้ username ที่ไม่มีจริง ไม่แตะบัญชีใคร)
//   4) over-privilege / IDOR — OPERATOR ชั่วคราวต้องเข้า admin API ไม่ได้
// WARN = ควรปรับ · FAIL = ช่องโหว่จริง → nightly gate ส่ง Telegram (check นี้ต้องรันสุดท้ายของ gate — กิน login rate-limit window)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.API_URL || 'http://127.0.0.1:3001';
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3000';
const require = createRequire(import.meta.url);
const jwt = require(path.join(ROOT, 'sovereign-os/core-api/node_modules/jsonwebtoken'));
const psql = (sql) => execSync(`docker exec sovereign-db psql -U sovereign -d sovereign -t -A -c "${sql}"`, { encoding: 'utf8' }).trim();
const secret = fs.readFileSync(path.join(ROOT, 'sovereign-os/infra/.env'), 'utf8')
  .split(/\r?\n/).find(l => l.startsWith('JWT_SECRET=')).slice('JWT_SECRET='.length).replace(/^[\"']|[\"']$/g, '');

const [adminId, tvStr] = psql("SELECT id||'|'||token_version FROM users WHERE username='mock-admin'").split('|');
if (!adminId) { console.error('FATAL ไม่พบ mock-admin'); process.exit(2); }
const H = { 'Authorization': `Bearer ${jwt.sign({ userId: adminId, role: 'SUPERADMIN', assigned_node_id: null, mfa_verified: true, must_change_password: false, token_version: Number(tvStr) }, secret, { expiresIn: '20m' })}`, 'Content-Type': 'application/json' };

let pass = 0, fail = 0, warnCount = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); cond ? pass++ : fail++; };
const warn = (name, extra = '') => { console.log(`WARN  ${name}${extra ? ' — ' + extra : ''}`); warnCount++; };

console.log('── 1) Security headers + information disclosure ──');
const REQUIRED = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'];
for (const [label, url] of [['web :3000', `${WEB}/`], ['api :3001', `${API}/api/health`]]) {
  const r = await fetch(url).catch(() => null);
  if (!r) { warn(`headers ${label}`, 'เชื่อมต่อไม่ได้'); continue; }
  const h = Object.fromEntries([...r.headers].map(([k, v]) => [k.toLowerCase(), v]));
  for (const name of REQUIRED) {
    if (h[name]) continue;
    warn(`ขาด ${name} (${label})`, 'ควรเพิ่มใน middleware');
  }
  if (h['x-powered-by']) warn(`X-Powered-By รั่วชื่อ framework (${label})`, h['x-powered-by']);
  if ((h['server'] || '').match(/express|node/i)) warn(`Server header รั่ว (${label})`, h['server']);
}
{
  const r = await fetch(`${API}/api/health`, { headers: { Origin: 'https://evil.example' } }).catch(() => null);
  const acao = r?.headers?.get('access-control-allow-origin');
  if (acao === 'https://evil.example') ok('CORS ไม่สะท้อน origin แปลกปลอม', false, `สะท้อน evil origin = ช่องโหว่`);
  else if (acao === '*') warn('CORS ตอบ wildcard *', 'ยอมรับได้สำหรับ public endpoint แต่ควรจำกัด');
  else ok('CORS ไม่สะท้อน origin แปลกปลอม', true, acao ? `ACAO=${acao}` : 'ไม่มี ACAO');
}

console.log('── 2) SQL injection probes (ฟอร์มตัวเอง) ──');
const SQLERR = /pg::|syntax error|sequelize|sqlite|unterminated|psql/i;
const sqliPayloads = ["' OR '1'='1' --", "admin'--", "' OR 1=1#", "'; WAITFOR DELAY '0:0:3'--"];
let loginBlocked = false;
{
  const probe = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pentest-probe', password: 'x' }) });
  loginBlocked = probe.status === 429;
  if (loginBlocked) warn('login endpoint ยังถูกบล็อกจากรอบก่อน (429)', 'รอ 15 นาทีแล้วรันใหม่ ผลส่วน SQLi/brute-force จะสมบูรณ์');
}
if (!loginBlocked) {
  for (const p of sqliPayloads) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: p, password: p }) }).catch(() => null);
    const body = r ? await r.text().catch(() => '') : '';
    ok(`SQLi login ${JSON.stringify(p.slice(0, 14))}`, !!r && [400, 401, 422, 429].includes(r.status) && !SQLERR.test(body), `HTTP ${r?.status}`);
  }
  {
    const r = await fetch(`${API}/api/audit?q=${encodeURIComponent("' OR '1'='1")}`, { headers: H }).catch(() => null);
    const body = r ? await r.text().catch(() => '') : '';
    ok('SQLi audit search', !!r && r.status < 500 && !SQLERR.test(body), `HTTP ${r?.status}`);
  }
}

console.log('── 3) Over-privilege / IDOR (OPERATOR ชั่วคราว) ──');
// ต้องรับก่อน brute-force: ถ้า brute กิน per-IP window ก่อน login ของส่วนนี้จะได้ 429/401 ลวง
// (token ตายเพราะ rate limit ไม่ใช่ RBAC ปฏิเสธ) — จึง assert ว่าได้ token จริงก่อน probe ทุกครั้ง
{
  const uname = 'pentest-op-' + Date.now().toString(36).slice(-4);
  let r = await fetch(`${API}/api/users`, { method: 'POST', headers: H, body: JSON.stringify({ username: uname, password: 'Pentest-Init-2026!', role: 'OPERATOR' }) });
  if (![200, 201].includes(r.status)) {
    ok('เตรียมบัญชี OPERATOR ทดสอบ', false, `สร้างไม่ได้ HTTP ${r.status}`);
  } else {
    const uid = psql(`SELECT id FROM users WHERE username='${uname}'`);
    r = await fetch(`${API}/api/users/${uid}/reset-password`, { method: 'POST', headers: H });
    const { temporaryPassword: temp } = await r.json();
    r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: temp }) });
    const partial = r.ok ? (await r.json())?.token : null;
    ok('login ด้วยรหัสชั่วคราวได้จริง', !!partial, `HTTP ${r.status}`);
    let OH = null;
    if (partial) {
      await fetch(`${API}/api/auth/change-password`, { method: 'POST', headers: { Authorization: `Bearer ${partial}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: 'Pentest-Changed-2026!' }) });
      r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'Pentest-Changed-2026!' }) });
      const tok = r.ok ? (await r.json())?.token : null;
      ok('login รอบสอง (หลังเปลี่ยนรหัส) ได้จริง', !!tok, `HTTP ${r.status}`);
      OH = tok ? { Authorization: `Bearer ${tok}` } : null;
    }
    const probe = async (name, url, init) => {
      const rr = await fetch(`${API}${url}`, init).catch(() => null);
      ok(name, !!rr && [401, 403, 404].includes(rr.status), `HTTP ${rr?.status}`);
    };
    if (OH) {
      await probe('OPERATOR อ่านรายชื่อ user ไม่ได้', '/api/users', { headers: OH });
      await probe('OPERATOR อ่าน audit ไม่ได้', '/api/audit?limit=5', { headers: OH });
      await probe('IDOR อ่าน user อื่นตรง ๆ ไม่ได้', `/api/users/${adminId}`, { headers: OH });
      await probe('IDOR แก้ user อื่นไม่ได้', `/api/features/users/${adminId}`, { method: 'PUT', headers: { ...OH, 'Content-Type': 'application/json' }, body: '{}' });
      await probe('IDOR ลบ user อื่นไม่ได้', `/api/users/${adminId}`, { method: 'DELETE', headers: OH });
    } else {
      ok('IDOR probes', false, 'ไม่มี token (ถูก rate limit ขวางหรือ flow พัง) — นับ FAIL กันผลลวง');
    }
    await fetch(`${API}/api/users/${uid}`, { method: 'DELETE', headers: H }).catch(() => {});
    const gone = psql(`SELECT count(*) FROM users WHERE username='${uname}'`);
    ok('เก็บกวาดบัญชีทดสอบ', gone === '0', `เหลือ=${gone}`);
  }
}

console.log('── 4) Brute-force — rate limit ต้องตอบ 429 ──');
if (!loginBlocked) {
  const rlUser = 'pentest-rl-' + Date.now().toString(36);
  let n429 = 0, first429 = null, statuses = [];
  for (let i = 1; i <= 18; i++) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: rlUser, password: `Wrong-${i}-xY!` }) }).catch(() => null);
    const s = r?.status ?? 0;
    statuses.push(s);
    if (s === 429 && first429 === null) first429 = i;
    if (s === 429) n429++;
  }
  ok('per-IP rate limit บล็อกจริง', n429 > 0 && !statuses.includes(200), `429×${n429}/18 · เริ่มบล็อกครั้งที่ ${first429}`);
  if (first429 === 1) warn('โดนบล็อกตั้งแต่ครั้งแรก', 'IP ยังอยู่ใน window จากรอบก่อน — ตัวเลขอาจไม่สะท้อนของจริง');
}

console.log(`\n${pass} passed, ${fail} failed, ${warnCount} warn (warn ไม่ทำให้ gate ตื่ม)`);
process.exit(fail ? 1 : 0);
