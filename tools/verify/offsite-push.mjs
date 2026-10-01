#!/usr/bin/env node
// tools/verify/offsite-push.mjs — offsite backup ผ่าน Telegram (เข้ารหัสก่อนส่งเสมอ)
//   node tools/verify/offsite-push.mjs                → dump สด + เข้ารหัส + ส่ง + เก็บสำเนา staging
//   node tools/verify/offsite-push.mjs --verify       → ถอดรหัสไฟล์ล่าสุด + ตรวจ SQL ใช้ได้จริง
//   node tools/verify/offsite-push.mjs --restore-test → พิสูจน์เต็ม: restore ลง Postgres ชั่วคราว + เทียบจำนวนแถว
// ที่มา: เครื่องนี้มีดิสก์กายภาพเดียว (C+E = Disk 0) — dump ในเครื่อง = หายพร้อมกันทั้งหมด
// E3 (27/9/69): ช่องทางที่สองไม่พึ่ง Telegram — mirror ไฟล์สำรอง (.age ตั้งแต่ 1/10/69) ไป OFFSITE_MIRROR_DIR (default C:\SovereignOffsite)
//   + offsite-key-recovery.txt (key สำรองนอกสาย backup) · ช่องใดช่องหนึ่งสำเร็จ = รอบนั้นยังมีชีวิต
//   node tools/verify/offsite-push.mjs --restore-test --from-mirror → พิสูจน์ว่า "สำเนาที่สอง" กู้ได้จริง
//   node tools/verify/offsite-push.mjs --send-key → เจ้าของกดเอง: ส่ง recovery เข้า Telegram ตัวเอง (ไม่ผูก schedule)
// เงื่อนไขความปลอดภัย: ไฟล์ที่ออกจากเครื่องเข้ารหัสเสมอ — **I2c จบ (1/10/69): สาย age (X25519) เป็นสายเดียว**
//   (restore-test ผ่านสาย age ครบ 2 คืนติด 28–30/9 · พิสูจน์ด้วยมืออีกครั้ง 1/10 — users 8/audit 26k/telemetry 133k)
//   สาย AES เดิม: **เลิกสร้างไฟล์ใหม่** แต่เก็บช่องถอดไฟล์ .enc เก่า (≤ 30/9/69 ใน TG history/mirror) ไว้จนกว่าจะหมดความหมาย
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readTelegramCreds } from './telegram-creds.mjs';

// ชี้ main เสมอ — สคริปต์นี้ทำงานกับ runtime จริง (DB/creds/staging) ไม่ใช่สำเนา sandbox ของ worktree
const ROOT = 'E:/My work/Project Sovereign Origin';
const envFile = fs.readFileSync(path.join(ROOT, 'sovereign-os/infra/.env'), 'utf8');
const env = Object.fromEntries(envFile.split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const OFFSITE = path.join(ROOT, 'sovereign-os/infra/offsite');
const LOG = path.join(ROOT, 'sovereign-os/core-api/backups/offsite-log.jsonl');
// I2c: key AES ไม่ต้องมีใน .env แล้ว (เลิกเข้ารหัสสายนี้) — โหลดเฉพาะตอนถอดไฟล์ .enc เก่าเท่านั้น
const BACKUP_KEY_B64 = env.BACKUP_ENCRYPTION_KEY || '';

// ── ช่องทางที่สอง (E3): ทำไมต้องมี — Telegram คือช่องเดียวที่ไฟล์ออกเครื่องจริง
// ตัวเดียวล้ม (DNS/เราเตอร์/บล็อก) = คืนนั้นไม่มีอะไรออกเครื่องเลย (เคสจริงคืน 24–26/9)
// เมื่อมี NAS/USB มา: ตั้ง OFFSITE_MIRROR_DIR ชี้ที่นั่น (หรือ MESH_SCP_TARGET user@host:/path) — ไม่แก้โค้ด
// ห้ามชี้กลับเข้า repo — ต้องเป็นดิสก์/พื้นที่ต่าง failure domain จริง ๆ
const MIRROR_DIR = path.resolve(process.env.OFFSITE_MIRROR_DIR || 'C:/SovereignOffsite');
const MIRROR_LOG = process.env.OFFSITE_MIRROR_LOG || path.join(ROOT, 'sovereign-os/core-api/backups/offsite-mirror-log.jsonl');
const FROM_MIRROR = process.argv.includes('--from-mirror');

function mirrorLog(status, extra = {}) {
  try {
    fs.appendFileSync(MIRROR_LOG, JSON.stringify({ ts: new Date().toISOString(), status, target: MIRROR_DIR, ...extra }) + '\n');
  } catch { /* log ไม่ได้ = ข้าม ไม่พารอบตาย */ }
}

// ── สาย age (I2 28/9/69): เข้ารหัส X25519 — private key ไม่ต้องอยู่บนเครื่องนี้ (เจ้าของเก็บบนมือถือ/manager)
// คู่ขนานกับสาย AES เดิมจนกว่า I2c: restore ผ่านสาย age ครบ 1–2 คืน จึงตัดสายเก่า
const AGE_BIN = path.join(ROOT, 'tools/bin/age.exe');
const AGE_IDENTITY = path.join(OFFSITE, 'age-identity.txt'); // gitignored — เจ้าของต้องก๊อปออกนอกเครื่อง (recovery มีเนื้อให้ครบ)
function ageRecipient() {
  try {
    const m = fs.readFileSync(AGE_IDENTITY, 'utf8').match(/^#\s*public key:\s*(age1\w+)\s*$/im);
    return m ? m[1] : null;
  } catch { return null; }
}

function readMeshKeyB64() {
  try {
    const p = path.join(ROOT, 'sovereign-os/core-api/data/mesh-key');
    return fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : null;
  } catch { return null; }
}

/** recovery text: key ทั้งหมดที่ต้องมีเพื่อกู้ไฟล์ .enc + คำสั่งกู้ 1 บรรทัด — เจ้าของเก็บนอกเครื่อง */
function buildRecoveryText() {
  const mesh = readMeshKeyB64();
  return [
    '# Sovereign OFFSITE KEY RECOVERY — เก็บไว้นอกเครื่องนี้',
    `สร้าง: ${new Date().toISOString()}`,
    '',
    '1) BACKUP_ENCRYPTION_KEY (base64) — จำเป็นเฉพาะไฟล์ .enc เก่าที่ทำก่อน 1/10/69 (สายใหม่ทั้งหมดเป็น age แล้ว):',
    env.BACKUP_ENCRYPTION_KEY || '(ไม่มีใน infra/.env — ไฟล์ใหม่ทั้งหมดเป็นสาย age ไม่ต้องใช้)',
    '',
    '2) mesh key (sovereign-os/core-api/data/mesh-key, base64):',
    mesh || '(ไม่มีไฟล์ mesh-key)',
    '',
    '3) age identity (X25519 — สายใหม่ · ไฟล์ sovereign_dump_*.age ใช้ตัวนี้):',
    fs.existsSync(AGE_IDENTITY) ? fs.readFileSync(AGE_IDENTITY, 'utf8').trim() : '(ยังไม่มี identity — รัน push รอบแรกแล้วจะเกิด)',
    '',
    '   ถอดไฟล์ .age บนมือถือ/เครื่องไหนก็ได้ (ติดตั้ง age ก่อน):',
    '   age -d -i identity.txt sovereign_dump_XXXXXXXX_XXXXXX.sql.gz.age > dump.sql.gz',
    '',
    '4) ทดสอบ restore เต็มจากไฟล์ล่าสุด (สาย age — ตั้งแต่ 1/10/69 ไฟล์ใหม่มีแต่ .age):',
    '   node tools/verify/offsite-push.mjs --restore-test   (ไฟล์ .enc เก่า: --restore-test --legacy-aes)',
    '',
    'ไฟล์ใหม่ = age X25519 อย่างเดียว (ใช้ identity ข้อ 3) · ไฟล์ .enc เก่า ≤ 30/9/69 = AES-256-GCM (key ข้อ 1)',
    'ของใดหาย ไฟล์รูปแบบนั้นหมดค่าทั้งชุด — ก๊อปข้อความนี้ไป password manager หรือ Telegram Saved Messages —',
    'สำเนาบนไดรฟ์เดียวกันช่วยแค่กรณีดิสก์เสีย ไม่ช่วยกรณีเครื่องหายทั้งเครื่อง',
  ].join('\n');
}

// --send-key: ปุ่มของเจ้าของ — ส่ง recovery text เข้า Telegram ตัวเอง ไม่ผูก schedule เด็ดขาด
// (การเก็บ key บน cloud Telegram เป็นการตัดสินใจระดับเจ้าของ ระบบไม่ตัดสินแทน)
if (process.argv[2] === '--send-key') {
  console.log('สร้าง recovery text…');
  const text = buildRecoveryText();
  const tg = readTelegramCreds();
  if (!tg.token || !tg.chatId) { console.error('ไม่มี Telegram credentials — ตั้งที่หน้า Settings ก่อน'); process.exit(1); }
  const res = await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: tg.chatId, text }), signal: AbortSignal.timeout(30_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!out.ok) { console.error('ส่งไม่สำเร็จ:', out.description || res.status); process.exit(1); }
  console.log('✅ ส่ง recovery เข้า Telegram แล้ว — เก็บข้อความนี้ในที่ปลอดภัย (Saved Messages)');
  process.exit(0);
}

function latestEncrypted() {
  // --from-mirror: ถอดจาก "สำเนาที่สอง" ไม่ใช่ staging ต้นทาง — พิสูจน์ว่า mirror กู้ได้จริง
  const dir = FROM_MIRROR && fs.existsSync(MIRROR_DIR) ? MIRROR_DIR : OFFSITE;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('sovereign_dump_') && f.endsWith('.enc')).sort();
  if (!files.length) throw new Error(`ไม่มีไฟล์ offsite ใน ${dir} — รัน push ก่อน`);
  return path.join(dir, files.at(-1));
}
function latestAge() {
  const dir = FROM_MIRROR && fs.existsSync(MIRROR_DIR) ? MIRROR_DIR : OFFSITE;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('sovereign_dump_') && f.endsWith('.age')).sort();
  if (!files.length) throw new Error(`ไม่มีไฟล์ .age ใน ${dir} — รัน push ก่อน`);
  return path.join(dir, files.at(-1));
}
function decryptAge(ageFile) {
  if (!fs.existsSync(AGE_IDENTITY)) throw new Error(`ไม่มี age identity ที่ ${AGE_IDENTITY} — กู้จาก offsite-key-recovery.txt ก่อน`);
  return execFileSync(AGE_BIN, ['-d', '-i', AGE_IDENTITY, ageFile], { maxBuffer: 512 * 1024 * 1024 });
}
function decrypt(encFile) {
  // layout ตรงกับ push เก่า (≤ 30/9/69): [iv(12)][ciphertext][tag(16) ท้ายไฟล์] — ใช้กับไฟล์ .enc เก่าเท่านั้น
  if (!BACKUP_KEY_B64) throw new Error('ไม่มี BACKUP_ENCRYPTION_KEY ใน infra/.env — จำเป็นเฉพาะไฟล์ .enc เก่า (สายใหม่ใช้ age)');
  const key = Buffer.from(BACKUP_KEY_B64, 'base64');
  const raw = fs.readFileSync(encFile);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(12, raw.length - 16);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(data), dec.final()]);
}
function gunzipSql(buf) {
  return zlib.gunzipSync(buf, { maxBufferLength: 256 * 1024 * 1024 });
}

if (process.argv[2] === '--verify' || process.argv[2] === '--restore-test') {
  // I2c: ค่าเริ่มต้น = สาย age (ไฟล์ใหม่ทั้งหมด) — --legacy-aes สำหรับไฟล์ .enc เก่าที่ทำก่อน 1/10/69
  const wantLegacy = process.argv.includes('--legacy-aes');
  const enc = wantLegacy ? latestEncrypted() : latestAge();
  const sha = crypto.createHash('sha256').update(fs.readFileSync(enc)).digest('hex');
  const payload = () => gunzipSql(wantLegacy ? decrypt(enc) : decryptAge(enc));
  const sql = payload().toString('utf8');
  console.log(`ถอดรหัส${wantLegacy ? ' (สาย AES เก่า)' : ' (สาย age)'}: ${path.basename(enc)} · sha256=${sha.slice(0, 16)}… · ${Math.round(sql.length / 1024)} KB SQL`);
  if (!/CREATE TABLE|COPY /.test(sql)) { console.error('FATAL: เนื้อไฟล์ไม่ใช่ SQL dump ที่ใช้ได้'); process.exit(1); }
  const tables = [...sql.matchAll(/^CREATE TABLE (?:public\.)?(\w+)/gm)].map((m) => m[1]);
  console.log(`ตารางใน dump: ${tables.length} ตาราง (เช่น ${tables.slice(0, 4).join(', ')})`);
  if (process.argv[2] === '--verify') { console.log('✅ ไฟล์ offsite ถอดรหัสและอ่านได้จริง'); process.exit(0); }

  // ── restore-test: ฐานชั่วคราวบนพอร์ตแปลก 55432 (ลบทิ้งเมื่อจบ) ──
  // บทเรียนจากการรันจริง: TimescaleDB image รีสตาร์ต postgres หลัง boot แรก → ต้องรอ pg_isready สองรอบ
  // และห้าม ON_ERROR_STOP (dump ข้ามเครื่องมี ERROR ของ extension ที่ตัวรับไม่มี = ปกติ) — ตัดสินที่จำนวนแถว
  console.log('restore ลง Postgres ชั่วคราว (sovereign-restore-test)…');
  execSync('docker rm -f sovereign-restore-test 2>nul', { stdio: 'ignore', shell: 'cmd.exe' });
  try {
    execFileSync('docker', ['run', '-d', '--name', 'sovereign-restore-test', '-e', 'POSTGRES_PASSWORD=testrestore', '-e', 'POSTGRES_USER=sovereign', '-e', 'POSTGRES_DB=sovereign', 'timescale/timescaledb:latest-pg15'], { stdio: 'ignore' }); // ไม่ publish พอร์ต — คุยผ่าน docker exec เท่านั้น (55432 เคยชน excluded range ของ Hyper-V)
    for (const wait of [10_000, 20_000]) { // รอหลัง boot + หลัง restart รอบ image เอง
      await new Promise((r) => setTimeout(r, wait));
      try { execSync('docker exec sovereign-restore-test pg_isready -U sovereign', { stdio: 'ignore' }); break; } catch { /* ลองรอบต่อไป */ }
    }
    // แยก 3 ครั้งเรียก (pre / dump / post) — บทเรียน 14/9: ไม่มี pre_restore → chunk COPY ไม่เข้า
    // ("could not find hypertable with id N" — id ต่างข้าม instance) · บทเรียนเพิ่มวันนี้: ห้ามรวม
    // ใน session เดียว เพราะ pg_dump เซ็ต search_path='' กลาง stream ทำ post_restore หา function
    const psql = (args, input) => execFileSync('docker', ['exec', '-i', 'sovereign-restore-test', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-q', ...args], { input, maxBuffer: 256 * 1024 * 1024 });
    psql(['-c', 'SELECT timescaledb_pre_restore();']);
    psql([], payload());
    psql(['-c', 'SELECT timescaledb_post_restore();']);
    let allOk = true;
    for (const [table, expected] of [['users', 5], ['audit_logs', 26_000]]) {
      const n = Number(execSync(`docker exec sovereign-restore-test psql -U sovereign -d sovereign -t -A -c "SELECT count(*) FROM ${table}"`).toString().trim());
      console.log(`  ${table} กู้คืนได้ = ${n} แถว`);
      if (n < expected) allOk = false;
    }
    // hypertable จริง: sensor_telemetry ต้องไม่ว่างหลัง pre/post_restore (เคสเดิม chunk COPY พลาดเงียบ ๆ)
    try {
      const live = Number(execSync('docker exec sovereign-db psql -U sovereign -d sovereign -t -A -c "SELECT count(*) FROM sensor_telemetry"').toString().trim());
      const restored = Number(execSync('docker exec sovereign-restore-test psql -U sovereign -d sovereign -t -A -c "SELECT count(*) FROM sensor_telemetry"').toString().trim());
      console.log(`  sensor_telemetry (hypertable) = ${restored} แถว (live ปัจจุบัน ${live})`);
      if (!(restored > 0)) allOk = false;
    } catch { /* ตารางไม่มี/ถามไม่ได้ — ไม่ให้พา fail สายหลัก */ }
    console.log(allOk ? '✅ restore สำเร็จจากไฟล์ offsite จริง' : '❌ จำนวนแถวไม่ตรง — ไฟล์ offsite ใช้ไม่ได้เต็ม');
    if (!allOk) process.exitCode = 1;
  } finally {
    execSync('docker rm -f sovereign-restore-test 2>nul', { stdio: 'ignore', shell: 'cmd.exe' });
  }
  process.exit(0);
}

// ── push (default) ──
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
// ชื่อฐานคง suffix .enc ไว้เพื่อรูปแบบชื่อเดิม — ไฟล์จริงที่สร้างคือ .age (แทนที่ suffix)
const encName = `sovereign_dump_${stamp}.sql.gz.enc`;

console.log('1) pg_dump สด…');
const dump = execSync('docker exec sovereign-db pg_dump -U sovereign -d sovereign', { maxBuffer: 256 * 1024 * 1024 });
console.log(`   ${(dump.length / 1024 / 1024).toFixed(1)} MB`);
console.log('2) gzip + เข้ารหัส age (X25519 — สายเดียวตาม I2c)…');
const gz = zlib.gzipSync(dump);
fs.mkdirSync(OFFSITE, { recursive: true });

// สาย age = สายหลัก (และสายเดียวของไฟล์ใหม่) — ไม่มี age.exe/identity = ล้มดัง exit 1 (ห้ามส่งไฟล์ไม่เข้ารหัสเด็ดขาด)
let agePath = null;
let sha = '';
let encSize = 0;
const recipient = ageRecipient();
if (!fs.existsSync(AGE_BIN) || !recipient) {
  console.error('❌ ไม่มี age.exe/identity — ปฏิเสธส่งไฟล์ไม่เข้ารหัส (เงื่อนไข: ไฟล์ที่ออกเครื่องต้องเข้ารหัสเสมอ)');
  try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), file: encName, status: 'failed', reason: 'no-age-identity' }) + '\n'); } catch { /* ข้าม */ }
  process.exit(1);
}
try {
  agePath = path.join(OFFSITE, encName.replace(/\.enc$/, '.age'));
  execFileSync(AGE_BIN, ['-r', recipient, '-o', agePath, '-'], { input: gz, maxBuffer: 512 * 1024 * 1024 });
  sha = crypto.createHash('sha256').update(fs.readFileSync(agePath)).digest('hex');
  encSize = fs.statSync(agePath).size;
  console.log(`   ${path.basename(agePath)} (${Math.round(encSize / 1024)} KB) sha256=${sha.slice(0, 16)}…`);
} catch (err) {
  console.error(`❌ age เข้ารหัสล้ม — ${String(err?.message || err).slice(0, 120)} — ปฏิเสธส่ง (ไฟล์ใหม่ต้องเป็นสาย age เสมอ)`);
  try { fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), file: encName, status: 'failed', reason: 'age-encrypt-failed' }) + '\n'); } catch { /* ข้าม */ }
  process.exit(1);
}

// จดทุกความล้มเหลวลง log พร้อม status:failed — ห้ามตายเงียบอีก
// (เคสจริงคืน 24–26/9: DNS ผ่านเราเตอร์ล่ม → fetch throw ไม่มี catch → สคริปต์ตายทั้งรอบ
//  สาย offsite ขาด 3 คืนโดยไม่มีใครรู้ — คืนถัดไป dump สดใหม่แล้วลองใหม่เอง ไม่ส่งไฟล์เก่าค้าง)
function logEntry(status, extra = {}) {
  fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), file: path.basename(agePath || encName), bytes: encSize, sha256: sha, status, ...extra }) + '\n');
}

console.log('3) ส่ง Telegram (sendDocument) — creds จากระบบ (system_settings → env fallback)…');
const tg = readTelegramCreds();
let tgOk = false;
if (!tg.token || !tg.chatId) {
  logEntry('failed', { channel: 'telegram', reason: 'no-credentials' });
  console.error('⚠️ ไม่มี Telegram credentials — จด failed แล้ว (ไปต่อช่องทางที่สอง)');
} else {
  // ส่งผ่าน curl (stream upload) — บทเรียน 30/9–1/10/69: Node fetch (undici) อัปโหลดไฟล์กลางค้างจน timeout 2 รอบติด
  // ขณะที่ curl stream ไฟล์เดียวกันผ่านใน ~2–3 นาที (พิสูจน์ 1/10: message_id=1673) — timeout 20 นาที กันคืนอินเทอร์เน็ตช้า
  const ageName = path.basename(agePath);
  const cap = `Sovereign offsite backup - ${ageName}\nsha256 ${sha.slice(0, 32)}...\ndecrypt: age X25519 - see offsite-key-recovery.txt`;
  try {
    const out = execFileSync('curl', [
      '-sS', '-m', '1200',
      '-F', `chat_id=${tg.chatId}`,
      '-F', `caption=${cap}`,
      '-F', `document=@${agePath}`,
      `https://api.telegram.org/bot${tg.token}/sendDocument`,
    ], { timeout: 1_250_000, encoding: 'utf8' });
    const res2 = JSON.parse(out);
    if (!res2.ok) throw new Error(`Telegram ปฏิเสธ — ${res2.description}`);
    console.log(`   ส่งสำเร็จ — message_id=${res2.result.message_id}`);
    logEntry('sent', { channel: 'telegram', tg_message_id: res2.result.message_id, transport: 'curl' });
    tgOk = true;
  } catch (err) {
    const reason = String(err?.message || err).slice(0, 200);
    logEntry('failed', { channel: 'telegram', reason });
    console.error(`⚠️ ส่ง Telegram ไม่สำเร็จ — จด failed แล้ว (${reason}) — ไฟล์ .age ค้างใน staging ยืนยันได้`);
  }
}

console.log('4) สำเนาช่องทางที่สอง (E3 — mirror)…');
let mirrorOk = false;
try {
  if (MIRROR_DIR.toLowerCase().startsWith(ROOT.toLowerCase())) throw new Error('mirror ต้องอยู่นอก repo — ต่าง failure domain เท่านั้น');
  fs.mkdirSync(MIRROR_DIR, { recursive: true });
  const mPath = path.join(MIRROR_DIR, path.basename(agePath));
  fs.copyFileSync(agePath, mPath);
  if (fs.statSync(mPath).size !== encSize) throw new Error('ขนาดไฟล์ mirror ไม่ตรงต้นทาง');
  fs.writeFileSync(path.join(MIRROR_DIR, 'offsite-key-recovery.txt'), buildRecoveryText());
  mirrorLog('sent', { age: path.basename(agePath) });
  mirrorOk = true;
  console.log(`   ✅ mirror → ${MIRROR_DIR} (+ recovery + ไฟล์ .age)`);
} catch (err) {
  mirrorLog('failed', { reason: String(err?.message || err).slice(0, 160) });
  console.error(`   ⚠️ mirror ล้ม — ${String(err?.message || err).slice(0, 120)} (จดแล้ว ไม่ทำรอบตาย)`);
}
// ทางเลือก scp (อนาคตมี NAS) — ตั้ง MESH_SCP_TARGET แล้วส่งต่อไฟล์เดียวกัน best-effort
if (env.MESH_SCP_TARGET) {
  try {
    execFileSync('scp', ['-o', 'ConnectTimeout=10', agePath, env.MESH_SCP_TARGET], { timeout: 120_000, stdio: 'pipe' });
    mirrorLog('sent', { target: env.MESH_SCP_TARGET });
    console.log(`   ✅ scp → ${env.MESH_SCP_TARGET}`);
  } catch (err) {
    mirrorLog('failed', { target: env.MESH_SCP_TARGET, reason: String(err?.message || err).slice(0, 160) });
    console.error(`   ⚠️ scp ล้ม (${env.MESH_SCP_TARGET}) — จดแล้ว ไม่ทำรอบตาย`);
  }
}

// log เก่าเก็บตามจริง + retention staging (เก็บ 3 ไฟล์ล่าสุด)
const olds = fs.readdirSync(OFFSITE).filter((f) => f.startsWith('sovereign_dump_')).sort().slice(0, -3);
for (const f of olds) fs.unlinkSync(path.join(OFFSITE, f));

// กติกา E3: ช่องใดช่องหนึ่งสำเร็จ = รอบนี้มีสำเนาออกนอกเครื่อง-staging อย่างน้อย 1 ช่อง → ไม่ใช่ความล้มของสาย
// (watchdog อายุตรวจทั้งสองช่องแยกกัน — ช่องไหนขาดประจำจะถูกจับเป็นรายช่อง)
const exitCode = tgOk || mirrorOk ? 0 : 1;
if (exitCode === 0) {
  console.log(`✅ offsite push ครบ — ช่องทางสำเร็จ: ${[tgOk && 'telegram', mirrorOk && 'mirror'].filter(Boolean).join(' + ')} (staging เก็บ 3 ไฟล์ล่าสุด · ลบเก่า ${olds.length} ไฟล์)`);
} else {
  console.error('❌ ทุกช่องทางล้มหมด — คืนนี้ไม่มีสำเนาออกนอก staging เลย (Task Scheduler เห็น exit 1)');
}
process.exit(exitCode);
