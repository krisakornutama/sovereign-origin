// tools/consent-smoke.mjs — ทดสอบความยินยอม/PDPA กับระบบจริง (ไม่ใช่ mock)
//
// ทำอะไร: สร้างบัญชีชั่วคราว → ออก token ของบัญชีนั้น → ยิง API จริงทุกเส้น →
//         ตรวจผลใน DB → ลบบัญชีชั่วคราวทิ้ง
// ข้อบังคับ: ต้องสั่งด้วย --confirm + ประกาศ CONSENT_SMOKE_ENV=test
//            (กันเผลอรันบนระบบที่ใช้งานจริงโดยไม่ตั้งใจ — ค่าเริ่มต้นของ --hub คือ :3001)
// ใช้:  cd sovereign-os/core-api && CONSENT_SMOKE_ENV=test node tools/consent-smoke.mjs --confirm [--hub=http://localhost:3101]
// ทางที่แนะนำ (ตรวจ hub + scratch DB ให้ก่อน): node tools/consent-smoke-runner.mjs --full --env=test --hub=... --scratch-db=...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const HUB = ((args.find((a) => a.startsWith('--hub=')) || '').slice(6) || 'http://localhost:3001').replace(/\/$/, '');

if (!args.includes('--confirm')) {
  console.error('ปฏิเสธการทำงาน: สคริปต์นี้สร้าง/ลบบัญชีจริง ต้องสั่งด้วย --confirm');
  process.exit(2);
}

// ── ด่านสภาพแวดล้อม (03/11/69) ─────────────────────────────────────────────
// ค่าเริ่มต้นของ --hub คือ localhost:3001 = production ที่มีคนใช้จริง
// สคริปต์นี้สร้าง/ลบบัญชี ⇒ ต้องประกาศว่าเป็นสภาพแวดล้อมทดสอบเท่านั้น
// ทางที่ปลอดภัยกว่า: `node tools/consent-smoke-runner.mjs --full --env=test ...`
// (ตรวจว่า hub ไม่ใช่ :3001 + scratch DB schema ไม่ใช่ public แล้วตั้งธงนี้ให้เอง)
const SMOKE_ENV = String(process.env.CONSENT_SMOKE_ENV ?? '').trim();
if (SMOKE_ENV !== 'test' && !args.includes('--allow-non-test')) {
  console.error(
    'ปฏิเสธการทำงาน: ต้องประกาศ CONSENT_SMOKE_ENV=test ก่อน (สคริปต์สร้าง/ลบบัญชีจริง)',
  );
  console.error(
    '   ถ้าจำเป็นต้องตรวจกับระบบจริงครั้งเดียวโดยมีคนเฝ้า: เพิ่ม --allow-non-test (จะพิมพ์เตือนชัดเจน)',
  );
  process.exit(2);
}
if (SMOKE_ENV !== 'test' && args.includes('--allow-non-test')) {
  console.error(`⚠️  --allow-non-test: กำลังสร้าง/ลบบัญชีจริงบน ${HUB} — ตรวจครั้งเดียวเท่านั้น`);
}

function readEnvFile(key) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    const m = txt.match(new RegExp('^' + key + '\\s*=\\s*(.*)$', 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

const SECRET = process.env.JWT_SECRET || readEnvFile('JWT_SECRET');
if (!SECRET) {
  console.error('ไม่พบ JWT_SECRET (env หรือ .env) — ออก token ทดสอบไม่ได้');
  process.exit(2);
}

const prisma = new PrismaClient();
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} · ${name}${detail ? ' — ' + detail : ''}`);
}

async function call(pathname, token, init = {}) {
  const res = await fetch(`${HUB}${pathname}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function makeUser(suffix, label) {
  const password = 'Smoke-Test-Pass-123!';
  const user = await prisma.user.create({
    data: {
      username: `smoke-${suffix}-${label}`,
      password_hash: await bcrypt.hash(password, 4),
      role: 'OPERATOR',
      must_change_password: false,
      token_version: 0,
    },
  });
  const token = jwt.sign(
    { userId: user.id, role: 'OPERATOR', mfa_verified: true, token_version: 0, assigned_node_id: null },
    SECRET,
    { expiresIn: '10m' },
  );
  return { user, token, password };
}

const created = [];
let exitCode = 0;

try {
  const suffix = crypto.randomBytes(4).toString('hex');

  // ── บัญชี A: เส้นหลัก ────────────────────────────────────────────────────
  const a = await makeUser(suffix, 'main');
  created.push(a.user.id);

  const policy = await call('/api/consent/policy', null);
  check('นโยบายสาธารณะอ่านได้ก่อนล็อกอิน', policy.status === 200 && Array.isArray(policy.body?.sections), `HTTP ${policy.status}`);

  const list = await call('/api/consent', a.token);
  check('GET /api/consent 200 + วัตถุประสงค์ครบ', list.status === 200 && (list.body?.purposes?.length ?? 0) >= 5, `HTTP ${list.status}`);
  check('เวอร์ชันนโยบายตรงกับ consent', !!list.body?.policyVersion && list.body.policyVersion === policy.body?.version, String(list.body?.policyVersion));

  const grant = await call('/api/consent', a.token, {
    method: 'PUT',
    body: JSON.stringify({ purpose: 'marketing', granted: true }),
  });
  check('ให้ความยินยอมการตลาด = 200', grant.status === 200 && grant.body?.granted === true, `HTTP ${grant.status}`);

  const history = await call('/api/consent/history', a.token);
  check('ประวัติมี event granted', history.status === 200 && history.body?.events?.[0]?.action === 'granted', `HTTP ${history.status}`);

  const essential = await call('/api/consent', a.token, {
    method: 'PUT',
    body: JSON.stringify({ purpose: 'essential', granted: false }),
  });
  check('ปิดวัตถุประสงค์จำเป็น = 409', essential.status === 409, `HTTP ${essential.status}`);

  const unknown = await call('/api/consent', a.token, {
    method: 'PUT',
    body: JSON.stringify({ purpose: 'not-a-purpose', granted: true }),
  });
  check('วัตถุประสงค์แปลกปลอม = 400', unknown.status === 400, `HTTP ${unknown.status}`);

  const wrongPw = await call('/api/consent/account', a.token, {
    method: 'DELETE',
    body: JSON.stringify({ password: 'definitely-wrong', confirm: 'DELETE' }),
  });
  check('ลบบัญชีด้วยรหัสผิด = 401', wrongPw.status === 401, `HTTP ${wrongPw.status}`);

  const anon = await call('/api/consent/account', a.token, {
    method: 'DELETE',
    body: JSON.stringify({ password: a.password, confirm: 'DELETE' }),
  });
  check('ลบบัญชีด้วยรหัสถูก = 200', anon.status === 200, `HTTP ${anon.status}`);

  const after = await prisma.user.findUnique({ where: { id: a.user.id } });
  check('DB: ชื่อเปลี่ยนเป็น deleted-*', String(after?.username ?? '').startsWith('deleted-'), after?.username ?? 'null');
  check('DB: deleted_at ถูกตั้ง', !!after?.deleted_at);
  check('DB: MFA ถูกเคลียร์', after?.mfa_secret === null && after?.mfa_backup_hash === null);
  check('DB: token_version ถูก bump', (after?.token_version ?? 0) === 1, String(after?.token_version));

  const stale = await call('/api/consent', a.token);
  check('token เดิมใช้ไม่ได้หลังลบบัญชี', stale.status === 401, `HTTP ${stale.status}`);

  // ── บัญชี B: ด่านกันเดารหัสผ่าน ─────────────────────────────────────────
  const b = await makeUser(suffix, 'ratelimit');
  created.push(b.user.id);
  let limited = 0;
  for (let i = 0; i < 6; i += 1) {
    const attempt = await call('/api/consent/account', b.token, {
      method: 'DELETE',
      body: JSON.stringify({ password: `wrong-${i}`, confirm: 'DELETE' }),
    });
    if (attempt.status === 429) limited += 1;
  }
  check('เดารหัสผ่านลบบัญชีซ้ำ ๆ = โดน 429', limited >= 1, `429 × ${limited}`);
} catch (err) {
  console.error('ERROR:', err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  for (const id of created) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nสรุป: ${results.length - failed}/${results.length} ผ่าน`);
if (failed > 0) exitCode = 1;
process.exit(exitCode);
