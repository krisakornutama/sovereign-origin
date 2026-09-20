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
  const tmpGz = path.join(OFFSITE, '.restore-test.sql.gz');
  try {
    execFileSync('docker', ['run', '-d', '--name', 'sovereign-restore-test', '-e', 'POSTGRES_PASSWORD=testrestore', '-e', 'POSTGRES_USER=sovereign', '-e', 'POSTGRES_DB=sovereign', '-p', '127.0.0.1:55432:5432', 'timescale/timescaledb:latest-pg15'], { stdio: 'ignore' });
    for (const wait of [10_000, 20_000]) { // รอหลัง boot + หลัง restart รอบ image เอง
      await new Promise((r) => setTimeout(r, wait));
      try { execSync('docker exec sovereign-restore-test pg_isready -U sovereign', { stdio: 'ignore' }); break; } catch { /* ลองรอบต่อไป */ }
    }
    execFileSync('docker', ['exec', '-i', 'sovereign-restore-test', 'psql', '-U', 'sovereign', '-d', 'sovereign', '-q'], { input: gunzipSql(decrypt(enc)), maxBuffer: 256 * 1024 * 1024 });
    let allOk = true;
    for (const [table, expected] of [['users', 5], ['audit_logs', 26_000]]) {
      const n = Number(execSync(`docker exec sovereign-restore-test psql -U sovereign -d sovereign -t -A -c "SELECT count(*) FROM ${table}"`).toString().trim());
      console.log(`  ${table} กู้คืนได้ = ${n} แถว`);
      if (n < expected) allOk = false;
    }
    console.log(allOk ? '✅ restore สำเร็จจากไฟล์ offsite จริง' : '❌ จำนวนแถวไม่ตรง — ไฟล์ offsite ใช้ไม่ได้เต็ม');
    if (!allOk) process.exitCode = 1;
  } finally {
    execSync('docker rm -f sovereign-restore-test 2>nul', { stdio: 'ignore', shell: 'cmd.exe' });
    fs.unlinkSync(tmpGz);
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

console.log('3) ส่ง Telegram (sendDocument) — creds จากระบบ (system_settings → env fallback)…');
const tg = readTelegramCreds();
if (!tg.token || !tg.chatId) { console.error('FATAL: ไม่มี Telegram credentials — ตั้งที่หน้า Settings หรือ infra/.env'); process.exit(1); }
const form = new FormData();
form.append('chat_id', tg.chatId);
form.append('caption', `🗄 Sovereign offsite backup · ${encName}\nsha256 ${sha.slice(0, 32)}…\nถอดรหัส: AES-256-GCM (key บนเครื่องเท่านั้น)`);
form.append('document', new Blob([enc]), encName);
const res = await fetch(`https://api.telegram.org/bot${tg.token}/sendDocument`, { method: 'POST', body: form });
const out = await res.json();
if (!out.ok) { console.error('FATAL: Telegram ปฏิเสธ —', out.description); process.exit(1); }
console.log(`   ส่งสำเร็จ — message_id=${out.result.message_id}`);

// log + retention staging (เก็บ 3 ไฟล์ล่าสุด)
fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), file: encName, bytes: enc.length, sha256: sha, tg_message_id: out.result.message_id }) + '\n');
const olds = fs.readdirSync(OFFSITE).filter((f) => f.startsWith('sovereign_dump_')).sort().slice(0, -3);
for (const f of olds) fs.unlinkSync(path.join(OFFSITE, f));
console.log(`✅ offsite push ครบ (staging เก็บ 3 ไฟล์ล่าสุด · ลบเก่า ${olds.length} ไฟล์)`);
