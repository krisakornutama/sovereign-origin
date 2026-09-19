// พิสูจน์ filter ใหม่ของ GET /api/audit ต่อ harness จริง (Postgres ทดสอบแยก):
//  1) สร้าง audit จริงผ่าน actions ที่ลง log แน่ ๆ (reset password ต่อ id + PUT toggle)
//  2) q= (ค้นหา) / actionPrefix= (กรอง) / ไม่ส่ง = ทั้งหมด
//  3) q ต้องค้นเจอใน payload (string_contains) และ case-insensitive บน action_type
const BASE = process.env.HARNESS_URL || 'http://127.0.0.1:3199';

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json };
}

function assert(name, cond, detail = '') {
  if (!cond) { console.error(`FAIL ${name} ${detail}`); process.exitCode = 1; }
  else console.log(`PASS ${name}`);
}

const login = await api('POST', '/api/auth/login', null, { username: 'verify-admin', password: 'Verify-Admin-2026!' });
assert('login admin', login.status === 200 && !!login.json?.token, `got ${login.status}`);
const token = login.json.token;
const auth = { authorization: `Bearer ${token}` };

// 1) สร้างข้อมูล audit จริง 3 กลุ่ม: password (2), ไม่ใช่ password (1) — ทำซ้ำได้ (idempotent)
const existed = await api('GET', '/api/users', token);
if (!(existed.json || []).some((u) => u.username === 'audit-target')) {
  const created = await api('POST', '/api/users', token, { username: 'audit-target', password: 'Target-2026!', role: 'OPERATOR' });
  assert('create target user', created.status === 200 || created.status === 201, `got ${created.status}`);
}
// POST คืนแค่ {success:true} — ดึง id จาก GET /api/users
const users = await api('GET', '/api/users', token);
const target = (users.json || []).find((u) => u.username === 'audit-target');
assert('got target id', !!target?.id, `users=${users.status}`);
const targetId = target.id;

const reset = await api('POST', `/api/users/${targetId}/reset-password`, token);
assert('reset password (audit USER_PASSWORD_RESET_BY_ADMIN)', reset.status === 200, `got ${reset.status}`);
assert('temp password 12 chars', typeof reset.json?.temporaryPassword === 'string' && reset.json.temporaryPassword.length === 12);

const toggle = await api('PUT', `/api/users/${targetId}`, token, { must_change_password: false });
assert('toggle flag (audit PUT)', toggle.status === 200, `got ${toggle.status}`);

// 2) audit ดิบ: ต้องมี 3+ แถว
const all = await api('GET', '/api/audit?limit=500', token);
assert('GET audit ไม่ส่ง filter → ทั้งหมด', all.status === 200 && all.json.length >= 3, `got ${all.status}, rows=${all.json?.length}`);
const pwRows = all.json.filter((l) => l.action_type.startsWith('USER_PASSWORD'));
assert('มี USER_PASSWORD อย่างน้อย 1 แถว', pwRows.length >= 1, `rows=${pwRows.length}`);
const targetUsername = 'audit-target';

// 3) actionPrefix=USER_PASSWORD → เฉพาะ password
const pw = await api('GET', '/api/audit?actionPrefix=USER_PASSWORD&limit=500', token);
assert('actionPrefix ตอบ 200', pw.status === 200, `got ${pw.status}`);
assert('actionPrefix เฉพาะ USER_PASSWORD', pw.json.length >= 1 && pw.json.every((l) => l.action_type.startsWith('USER_PASSWORD')), `rows=${pw.json?.length}`);

// 4) q= ค้นเจอ username ใน payload (auto-audit ลง payload มี path มี body) + case-insensitive บน action_type
const qUser = await api('GET', `/api/audit?q=${encodeURIComponent(targetUsername)}&limit=500`, token);
assert('q=ค้น username ใน payload เจอ', qUser.status === 200 && qUser.json.some((l) => JSON.stringify(l.payload || {}).includes(targetUsername)), `rows=${qUser.json?.length}`);
const qAction = await api('GET', '/api/audit?q=user_password&limit=500', token);
assert('q=case-insensitive บน action_type', qAction.status === 200 && qAction.json.every((l) => l.action_type.toLowerCase().includes('user_password')), `rows=${qAction.json?.length}`);

// 5) q + actionPrefix รวมกันได้
const combo = await api('GET', '/api/audit?actionPrefix=USER_PASSWORD&q=somewhere-no-match&limit=500', token);
assert('q ไม่ match → ว่าง', combo.status === 200 && combo.json.length === 0, `rows=${combo.json?.length}`);

console.log(process.exitCode ? '=== มีตัวที่ FAIL ===' : '=== ผ่านทั้งหมด ===');
