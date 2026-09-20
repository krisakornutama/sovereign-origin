// tools/verify/full-system-check.mjs — regression suite ความเชื่อมั่นระบบ (รันซ้ำได้จาก repo root)
// ใช้: node tools/verify/full-system-check.mjs   (ต้องมี :3001 + ฐาน sovereign รันอยู่)
//  1) ทุก mount ต้อง "ปฏิเสธ" GET แบบไม่มี token (401/403/404) ยกเว้น public ที่ประกาศ
//  2) ทุก mount ด้วย token ต้องไม่ตอบ 500
//  3) write lifecycle จริงด้วยบัญชีทดสอบชั่วคราว: สร้าง → reset → เปลี่ยนรหัส → temp ตาย → ลบ → audit รอด
//  4) frontend :3000 serve จริง
// หมายเหตุ: mint session จาก claims จริงใน DB (read-only ต่อ user จริง — ไม่แตะรหัสผ่านใคร)
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
  .split(/\r?\n/).find(l => l.startsWith('JWT_SECRET=')).slice('JWT_SECRET='.length).replace(/^["']|["']$/g, '');

const [adminId, tvStr] = psql("SELECT id||'|'||token_version FROM users WHERE username='mock-admin'").split('|');
if (!adminId) { console.error('FATAL ไม่พบ mock-admin (จำเป็นสำหรับ mint session)'); process.exit(2); }
const tok = jwt.sign({ userId: adminId, role: 'SUPERADMIN', assigned_node_id: null, mfa_verified: true, must_change_password: false, token_version: Number(tvStr) }, secret, { expiresIn: '30m' });
const H = { 'Authorization': `Bearer ${tok}`, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); cond ? pass++ : fail++; };

// ── mount จริงจาก routes.ts ──
const routesSrc = fs.readFileSync(path.join(ROOT, 'sovereign-os/core-api/src/routes.ts'), 'utf8');
const mounts = [...new Set([...routesSrc.matchAll(/app\.(?:use|get)\('\/api\/([a-z0-9-]+)/g)].map(m => m[1]))];
const PUBLIC = new Set(['auth', 'shop', 'health', 'client-monitor']);

console.log(`── 1) ทุก mount ปฏิเสธก่อน auth (${mounts.length} mounts) ──`);
const leaks = [];
for (const m of mounts) {
  if (PUBLIC.has(m)) continue;
  const r = await fetch(`${API}/api/${m}`).catch(() => null);
  if (!(r && [401, 403, 404].includes(r.status))) leaks.push(`${m}=${r ? r.status : 'ERR'}`);
}
ok('ทุก mount ปฏิเสธก่อน auth', leaks.length === 0, `${mounts.length - PUBLIC.size} guarded` + (leaks.length ? ` · รั่ว: ${leaks.join(', ')}` : ''));

console.log('── 2) public endpoints ตอบตามดีไซน์ ──');
{
  const r = await fetch(`${API}/api/health`).catch(() => null);
  ok('GET /api/health (public)', r?.status === 200, `HTTP ${r?.status}`);
  const r3 = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nobody', password: 'wrong' }) }).catch(() => null);
  ok('login ผิดรหัส → 401', r3?.status === 401, `HTTP ${r3?.status}`);
}

console.log(`── 3) ไม่มี mount ไหน 500 (${mounts.length} mounts) ──`);
const crashed = [];
for (const m of mounts) {
  const r = await fetch(`${API}/api/${m}`, { headers: H }).catch(() => null);
  if (!r || r.status >= 500) crashed.push(`${m}=${r ? r.status : 'ERR'}`);
}
ok('ไม่มี 500 กับ GET ธรรมดา', crashed.length === 0, `${mounts.length} mounts` + (crashed.length ? ` · พัง: ${crashed.join(', ')}` : ''));

console.log('── 4) อ่านข้อมูลจริง (feature ที่เปิด) ──');
const reads = [
  ['/api/audit?limit=5', d => Array.isArray(d) || Array.isArray(d?.logs ?? d?.data ?? d?.items)],
  ['/api/audit?q=user_password', d => Array.isArray(d) || Array.isArray(d?.logs ?? d?.data ?? d?.items)],
  ['/api/users', d => Array.isArray(d) || Array.isArray(d?.users ?? d?.data)],
  ['/api/system/client-health?days=7', d => d && (d.total !== undefined || d.summary !== undefined || d.data !== undefined)],
  ['/api/features/me', d => !!d], ['/api/modules', d => !!d], ['/api/agent/jobs', d => !!d],
  ['/api/notes', d => Array.isArray(d) || Array.isArray(d?.notes ?? d?.data ?? d?.items)],
];
for (const [p, shape] of reads) {
  const r = await fetch(`${API}${p}`, { headers: H }).catch(() => null);
  const j = r && await r.json().catch(() => null);
  ok(`GET ${p}`, r?.status === 200 && j && shape(j), `HTTP ${r?.status}`);
}

console.log('── 5) Write lifecycle จริง (บัญชีชั่วคราว ลบทิ้งเสมอ) ──');
const uname = 'trust-' + Date.now().toString(36).slice(-4);
let r = await fetch(`${API}/api/users`, { method: 'POST', headers: H, body: JSON.stringify({ username: uname, password: 'Trust-Init-2026!', role: 'OPERATOR' }) });
ok('สร้าง user', [200, 201].includes(r.status), `HTTP ${r.status}`);
const uid = psql(`SELECT id FROM users WHERE username='${uname}'`);
r = await fetch(`${API}/api/users/${uid}/reset-password`, { method: 'POST', headers: H });
ok('admin reset', r.status === 200, `HTTP ${r.status}`);
const { temporaryPassword: temp } = await r.json();
r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: temp }) });
ok('login temp', r.status === 200, `HTTP ${r.status}`);
const utok = (await r.json())?.token;
r = await fetch(`${API}/api/auth/change-password`, { method: 'POST', headers: { Authorization: `Bearer ${utok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: 'Trust-Changed-2026!' }) });
ok('เปลี่ยนรหัส forced', r.status === 200, `HTTP ${r.status}`);
r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: temp }) });
ok('temp ตายหลังเปลี่ยน', r.status === 401, `HTTP ${r.status}`);
r = await fetch(`${API}/api/users/${uid}`, { method: 'DELETE', headers: H });
ok('DELETE user', r.status === 200, `HTTP ${r.status}`);
const rows = psql(`SELECT count(*) FROM audit_logs WHERE payload::text LIKE '%${uname}%'`);
const orphan = psql(`SELECT count(*) FROM audit_logs WHERE user_id='${uid}'`);
ok('audit รอด + ไม่มี orphan', Number(rows) >= 1 && Number(orphan) === 0, `rows=${rows} orphan=${orphan}`);

console.log('── 6) Frontend serve จริง ──');
for (const p of ['/', '/dashboard', '/audit', '/users', '/system']) {
  const rr = await fetch(`${WEB}${p}`, { redirect: 'manual' }).catch(() => null);
  ok(`:3000${p}`, [200, 307, 308].includes(rr?.status), `HTTP ${rr?.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
