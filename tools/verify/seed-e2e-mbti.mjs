// tools/verify/seed-e2e-mbti.mjs — seed บัญชีทดสอบ e2e-mbti ลง DB จริง (งาน A5b)
//
// ทำไม: e2e/mbti-real-backend.spec.ts (npm run test:mbti:real) ต้อง login จริงด้วย
// บัญชี USER ธรรมดา — ห้ามใช้บัญชีคนจริง และห้ามเดารหัส สคริปต์นี้สร้างบัญชีให้เองอย่างปลอดภัย:
//   • role OPERATOR (สิทธิ์ default ต่ำสุด) · must_change_password=false · ไม่มี MFA
//   • รหัสผ่านสุ่ม (เก็บ sovereign-os/infra/.credentials/e2e-mbti.txt — gitignore แล้ว · ไม่ print)
//   • idempotent: มีบัญชีอยู่แล้ว = ข้าม (ตาม AGENTS.md ข้อ 5 ไม่ลบ/ไม่แก้ของเดิม)
//   • --reset-password = สุ่มรหัสใหม่ทับ (เมื่อลืม — ไม่แตะคอลัมน์อื่น)
//
// ใช้ (ต้องมี container sovereign-db รันอยู่):
//   node tools/verify/seed-e2e-mbti.mjs            → seed/ตรวจ + พิมพ์สรุป (ไม่พิมพ์รหัส)
//   node tools/verify/seed-e2e-mbti.mjs --reset    → สุ่มรหัสใหม่ให้บัญชีเดิม
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CRED_FILE = join(ROOT, 'sovereign-os', 'infra', '.credentials', 'e2e-mbti.txt');
const USERNAME = 'e2e-mbti';
const RESET = process.argv.includes('--reset');

function psql(sql) {
  return execFileSync('docker', ['exec', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-tAc', sql], { encoding: 'utf8' }).trim();
}
function bcryptHash(plain) {
  // hash ผ่าน container core-api (มี bcryptjs ครบ) — ไม่ติดตั้งอะไรเพิ่มบน host
  return execFileSync('docker', ['exec', 'sovereign-core-api', 'node', '-e', `console.log(require('bcryptjs').hashSync(process.argv[1], 10))`, plain], { encoding: 'utf8' }).trim();
}
function readStoredPassword() {
  try {
    const m = readFileSync(CRED_FILE, 'utf8').match(/^password:\s*(\S+)\s*$/m);
    return m ? m[1] : null;
  } catch { return null; }
}

const existing = psql(`SELECT id, role, must_change_password FROM users WHERE username='${USERNAME}';`);
let password = readStoredPassword();

if (existing && !RESET) {
  const [id, role, mustChange] = existing.split('|');
  console.log(`✓ มีบัญชี ${USERNAME} อยู่แล้ว (id=${id.slice(0, 8)}… role=${role} must_change_password=${mustChange}) — ข้าม`);
  if (!password) console.log('⚠ ไม่พบรหัสใน .credentials/e2e-mbti.txt — รันด้วย --reset เพื่อสุ่มรหัสใหม่');
} else {
  if (!password || RESET) password = `E2e-${randomBytes(12).toString('base64url')}`;
  const hash = bcryptHash(password);
  if (existing) {
    const [id] = existing.split('|');
    psql(`UPDATE users SET password_hash='${hash.replaceAll("'", "''")}', must_change_password=false WHERE id='${id}';`);
    console.log(`✓ สุ่มรหัสใหม่ให้ ${USERNAME} (id=${id.slice(0, 8)}…) แล้ว`);
  } else {
    // ตารางจริงไม่มี default ให้ id (สร้างก่อน migration ครั้งแรก) — generate UUID เอง
    psql(`INSERT INTO users (id, username, password_hash, role, must_change_password, token_version) VALUES ('${randomUUID()}', '${USERNAME}', '${hash.replaceAll("'", "''")}', 'OPERATOR', false, 0);`);
    console.log(`✓ สร้างบัญชี ${USERNAME} (role=OPERATOR) แล้ว`);
  }
  mkdirSync(dirname(CRED_FILE), { recursive: true });
  writeFileSync(CRED_FILE, `# บัญชีทดสอบ e2e (งาน A5b) — gitignore แล้ว ห้าม commit\nusername: ${USERNAME}\npassword: ${password}\ncreated: ${new Date().toISOString()}\n`);
  console.log(`✓ บันทึกรหัสไว้ที่ sovereign-os/infra/.credentials/e2e-mbti.txt (ไม่แสดงบนจอ)`);
}

// สรุปการใช้งาน (ไม่พิมพ์รหัส)
console.log('\nรัน e2e กับ backend จริง:');
console.log('  cd sovereign-frontend');
console.log('  MBTI_E2E_USER=e2e-mbti MBTI_E2E_PASS=$(cat ../sovereign-os/infra/.credentials/e2e-mbti.txt | grep password | cut -d" " -f2) npm run test:mbti:real');
console.log('\n(เงื่อนไข: backend :3001 รันอยู่ · dev :3000 ชี้ :3001 · MBTI_E2E_ALLOW_REAL=1 ไม่ต้องตั้งเพราะตอนนี้ login จริง)');
