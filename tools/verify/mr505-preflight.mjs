// tools/verify/mr505-preflight.mjs — ด่านตรวจก่อนทดสอบ AES MR505 กับสัญญาณจริง (งาน A3)
//
// ทำไม: งาน A3 รออยู่เพราะ login จริงที่ผิดพลาด = lockout 2 ชม. (รหัสผิด 4 ครั้ง)
// สคริปต์นี้ตรวจ "พร้อมไหม" โดย **ไม่ยิง login แม้แต่ครั้งเดียว** (read-only ต่อ router):
//   1) router ตอบ TCP 443 ไหม (ping HTTP ครั้งเดียว — ไม่มี challenge)
//   2) system_settings key=router.adminPassword ตั้งค่าไว้แล้วหรือยัง (ว่าง = service ไม่ยิงเอง — fail-safe เดิม)
//   3) โค้ด AES ครบในซอร์ส (syncEncryptor/aesDecryptBase64/readModel ID 141/151/145/142)
//   4) อธิบายขั้นยิงจริงเมื่อพร้อม
//
// ใช้: node tools/verify/mr505-preflight.mjs [--fire]
//   --fire = ยิง fetchRouterSimData จริงผ่าน container (เฉพาะเมื่อเจ้าของยืนยันว่า router login ปกติ)
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICE = 'sovereign-os/core-api/src/services/tplink-mr505.service.ts';
const FIRE = process.argv.includes('--fire');

function psql(sql) {
  return execFileSync('docker', ['exec', 'sovereign-db', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-tAc', sql], { encoding: 'utf8' }).trim();
}

// 1) อ่าน router host จาก service (default 192.168.1.1)
const src = readFileSync(join(ROOT, SERVICE), 'utf8');
const hostMatch = src.match(/ROUTER_HOST = process\.env\.ROUTER_HOST \|\| '([^']+)'/);
const routerHost = hostMatch ? hostMatch[1] : '192.168.1.1';

// (env จริงของ container มีลำดับความสำคัญเหนือ default — เช็คได้จาก compose ถ้ามีตั้ง)
let host = routerHost;
try {
  const envRow = execFileSync('docker', ['exec', 'sovereign-core-api', 'printenv', 'ROUTER_HOST'], { encoding: 'utf8' }).trim();
  if (envRow) host = envRow;
} catch { /* container ไม่มีตัวแปร — ใช้ default */ }

const results = [];
function check(name, ok, note) { results.push({ name, ok, note }); console.log(`${ok ? '✓' : '✗'} ${name}${note ? ' — ' + note : ''}`); }

// ── 1) router ตอบไหม (GET ครั้งเดียว timeout 3 วิ — ไม่มี login attempt ใด ๆ) ──
const alive = await new Promise((resolve) => {
  const req = http.get({ host, port: 80, path: '/', timeout: 3000 }, (res) => { res.resume(); resolve(res.statusCode !== undefined); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});
check(`router ${host} ตอบ (HTTP probe, ไม่มี login)`, alive, alive ? 'ติดต่อได้ — ไม่มีความเสี่ยง lockout จากสคริปต์นี้' : 'ไม่ตอบ — เช็คว่าอยู่ LAN เดียวกัน/เปิดเครื่อง');

// ── 2) รหัส admin ใน DB ──
let pwSet = false, pwLen = 0;
try {
  const row = psql(`SELECT length(value) FROM system_settings WHERE key='router.adminPassword';`);
  pwLen = parseInt(row || '0', 10) || 0;
  pwSet = pwLen > 0;
} catch (e) {
  check('อ่าน system_settings', false, e.message.split('\n')[0]);
}
check(`system_settings router.adminPassword`, pwSet, pwSet ? `ตั้งแล้ว (ความยาว ${pwLen} ตัวอักษร — ไม่แสดงค่า) — service พร้อมยิง login ได้` : 'ยังว่าง — service จะไม่ยิง login เอง (กัน lockout ตามดีไซน์) · ใส่ผ่าน UI หน้า /system หรือ SQL');

// ── 3) โค้ด AES ครบในซอร์ส ──
for (const needle of ['function syncEncryptor', 'aesDecryptBase64', 'readModel(141', 'readModel(151', '145, 142']) {
  check(`ซอร์สมี ${needle}`, src.includes(needle));
}

// ── 4) สรุป ──
const allOk = results.every((r) => r.ok);
console.log('\n── สรุป A3 ──');
if (!allOk) {
  console.log('ยังไม่พร้อมยิงจริง — แก้รายการ ✗ ด้านบนก่อน (สคริปต์นี้ไม่ได้ยิง login เลย จึงไม่มีผล lockout)');
  process.exit(1);
}
console.log('พร้อมยิงจริงทุกเงื่อนไข ✓');
console.log('การยิงจริง (กิน 1 attempt login ของ router — ผิด 4 ครั้ง = lock 2 ชม.):');
console.log('  node tools/verify/mr505-preflight.mjs --fire');
console.log('ผลลัพธ์ที่คาด: GET /api/system/wan/sim คืน loggedIn:true + signal/servingCell (ถอด AES อัตโนมัติถ้า firmware ส่ง key มา)');
console.log('⚠ ยิงเมื่อเจ้าของยืนยันว่า login ผ่านหน้า router ปกติแล้ว (ตามหมายเหตุเดิมใน QUEUE.md)');

if (FIRE) {
  if (!allOk) { console.error('ยังไม่ผ่าน preflight — ห้ามยิง (--fire ทำงานเฉพาะหลังผ่านทุกเช็ค)'); process.exit(1); }
  console.log('\n── ยิงจริง (--fire) ──');
  try {
    // ยิงผ่าน API ของ container เอง (ต้องมี token SUPERADMIN — ให้ผู้รันส่งมาทาง env SOVEREIGN_TOKEN)
    const token = process.env.SOVEREIGN_TOKEN || '';
    const out = execFileSync('curl', ['-s', '--max-time', '30', '-H', `Authorization: Bearer ${token}`, 'http://localhost:3001/api/system/wan/sim'], { encoding: 'utf8', shell: true });
    console.log(out.slice(0, 600));
  } catch (e) {
    console.error('ยิงไม่สำเร็จ:', e.message.split('\n')[0]);
    process.exit(1);
  }
}
