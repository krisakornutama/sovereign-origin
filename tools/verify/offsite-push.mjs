#!/usr/bin/env node
// tools/verify/offsite-push.mjs — offsite backup ผ่าน Telegram (เข้ารหัสก่อนส่งเสมอ)
//   node tools/verify/offsite-push.mjs                → dump สด + เข้ารหัส + ส่ง + เก็บสำเนา staging
//   node tools/verify/offsite-push.mjs --verify       → ถอดรหัสไฟล์ล่าสุด + ตรวจ SQL ใช้ได้จริง
//   node tools/verify/offsite-push.mjs --restore-test → พิสูจน์เต็ม: restore ลง Postgres ชั่วคราว + เทียบจำนวนแถว
// ที่มา: เครื่องนี้มีดิสก์กายภาพเดียว (C+E = Disk 0) — dump ในเครื่อง = หายพร้อมกันทั้งหมด
// เมื่อมี NAS/ดิสก์สอง: ตั้ง MESH_RSYNC_TARGET แล้วชี้ staging นี้ (offsite/) ไป sync เพิ่มได้ทันที
// เงื่อนไขความปลอดภัย: ไฟล์ที่ออกจากเครื่องเข้ารหัส AES-256-GCM ทุกครั้ง (key อยู่ infra/.env เครื่องนี้เท่านั้น)
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
const key = Buffer.from(env.BACKUP_ENCRYPTION_KEY, 'base64');

function latestEncrypted() {
  const files = fs.readdirSync(OFFSITE).filter((f) => f.startsWith('sovereign_dump_') && f.endsWith('.enc')).sort();
  if (!files.length) throw new Error('ไม่มีไฟล์ offsite ใน staging — รัน push ก่อน');
  return path.join(OFFSITE, files.at(-1));
}
function decrypt(encFile) {
  // layout ตรงกับ push: [iv(12)][ciphertext][tag(16) ท้ายไฟล์]
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
  const enc = latestEncrypted();
  const sha = crypto.createHash('sha256').update(fs.readFileSync(enc)).digest('hex');
  const sql = gunzipSql(decrypt(enc)).toString('utf8');
  console.log(`ถอดรหัส: ${path.basename(enc)} · sha256=${sha.slice(0, 16)}… · ${Math.round(sql.length / 1024)} KB SQL`);
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
    execFileSync('docker', ['run', '-d', '--name', 'sovereign-restore-test', '-e', 'POSTGRES_PASSWORD=testrestore', '-e', 'POSTGRES_USER=sovereign', '-e', 'POSTGRES_DB=sovereign', '-p', '127.0.0.1:55432:5432', 'timescale/timescaledb:latest-pg15'], { stdio: 'ignore' });
    for (const wait of [10_000, 20_000]) { // รอหลัง boot + หลัง restart รอบ image เอง
      await new Promise((r) => setTimeout(r, wait));
      try { execSync('docker exec sovereign-restore-test pg_isready -U sovereign', { stdio: 'ignore' }); break; } catch { /* ลองรอบต่อไป */ }
    }
    // แยก 3 ครั้งเรียก (pre / dump / post) — บทเรียน 14/9: ไม่มี pre_restore → chunk COPY ไม่เข้า
    // ("could not find hypertable with id N" — id ต่างข้าม instance) · บทเรียนเพิ่มวันนี้: ห้ามรวม
    // ใน session เดียว เพราะ pg_dump เซ็ต search_path='' กลาง stream ทำ post_restore หา function
    const psql = (args, input) => execFileSync('docker', ['exec', '-i', 'sovereign-restore-test', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-q', ...args], { input, maxBuffer: 256 * 1024 * 1024 });
    psql(['-c', 'SELECT timescaledb_pre_restore();']);
    psql([], gunzipSql(decrypt(enc)));
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
const encName = `sovereign_dump_${stamp}.sql.gz.enc`;
const encPath = path.join(OFFSITE, encName);

console.log('1) pg_dump สด…');
const dump = execSync('docker exec sovereign-db pg_dump -U sovereign -d sovereign', { maxBuffer: 256 * 1024 * 1024 });
console.log(`   ${(dump.length / 1024 / 1024).toFixed(1)} MB`);
console.log('2) gzip + เข้ารหัส AES-256-GCM…');
const gz = zlib.gzipSync(dump);
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([iv, Buffer.from(cipher.update(gz)), Buffer.from(cipher.final()), Buffer.from(cipher.getAuthTag())]);
fs.mkdirSync(OFFSITE, { recursive: true });
fs.writeFileSync(encPath, enc);
const sha = crypto.createHash('sha256').update(enc).digest('hex');
console.log(`   ${encName} (${Math.round(enc.length / 1024)} KB) sha256=${sha.slice(0, 16)}…`);

// จดทุกความล้มเหลวลง log พร้อม status:failed — ห้ามตายเงียบอีก
// (เคสจริงคืน 24–26/9: DNS ผ่านเราเตอร์ล่ม → fetch throw ไม่มี catch → สคริปต์ตายทั้งรอบ
//  สาย offsite ขาด 3 คืนโดยไม่มีใครรู้ — คืนถัดไป dump สดใหม่แล้วลองใหม่เอง ไม่ส่งไฟล์เก่าค้าง)
function logEntry(status, extra = {}) {
  fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), file: encName, bytes: enc.length, sha256: sha, status, ...extra }) + '\n');
}

console.log('3) ส่ง Telegram (sendDocument) — creds จากระบบ (system_settings → env fallback)…');
const tg = readTelegramCreds();
if (!tg.token || !tg.chatId) {
  logEntry('failed', { reason: 'no-credentials' });
  console.error('FATAL: ไม่มี Telegram credentials — จด status:failed แล้ว (watchdog อายุ backup จะแจ้งแทน)');
  process.exit(1);
}
const form = new FormData();
form.append('chat_id', tg.chatId);
form.append('caption', `🗄 Sovereign offsite backup · ${encName}\nsha256 ${sha.slice(0, 32)}…\nถอดรหัส: AES-256-GCM (key บนเครื่องเท่านั้น)`);
form.append('document', new Blob([enc]), encName);
try {
  const res = await fetch(`https://api.telegram.org/bot${tg.token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(90_000) });
  const out = await res.json();
  if (!out.ok) throw new Error(`Telegram ปฏิเสธ — ${out.description}`);
  console.log(`   ส่งสำเร็จ — message_id=${out.result.message_id}`);
  logEntry('sent', { tg_message_id: out.result.message_id });
} catch (err) {
  const reason = String(err?.cause?.code || err?.message || err).slice(0, 200);
  logEntry('failed', { reason });
  console.error(`⚠️ ส่ง Telegram ไม่สำเร็จ — จด status:failed แล้ว (${reason}) — ไฟล์ .enc ค้างใน staging ยืนยันได้ · Task Scheduler จะเห็น exit 1`);
  process.exit(1);
}

// log เก่าเก็บตามจริง + retention staging (เก็บ 3 ไฟล์ล่าสุด)
const olds = fs.readdirSync(OFFSITE).filter((f) => f.startsWith('sovereign_dump_')).sort().slice(0, -3);
for (const f of olds) fs.unlinkSync(path.join(OFFSITE, f));
console.log(`✅ offsite push ครบ (staging เก็บ 3 ไฟล์ล่าสุด · ลบเก่า ${olds.length} ไฟล์)`);
