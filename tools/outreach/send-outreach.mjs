#!/usr/bin/env node
/* send-outreach — ส่งไฟล์ .eml จาก outbox/ ผ่าน SMTP ของ Gmail (curl smtps, ไม่ต้องติดตั้ง dependency)
   ใช้:
     node tools/outreach/send-outreach.mjs                     # ดูแผนอย่างเดียว (dry-run, ไม่ส่งอะไร)
     SMTP_USER=me@gmail.com SMTP_PASS=<app password> node tools/outreach/send-outreach.mjs --send --limit=5
   กติกา:
     • ไม่ส่งเกิน limit ต่อครั้ง (ค่าเริ่มต้น 5 = เพดานต่อวันตาม outreach-20.md — กันบัญชีอีเมลเสีย)
     • ส่งทีละฉบับ (1 To) ไม่มี BCC หมู่ · ล้มฉบับไหนหยุดฉบับนั้น รายงาน แล้วไปต่อ
     • ไม่ส่งซ้ำ: อ่าน marketing/outreach-log.jsonl ถ้า id นั้นเคยส่งสำเร็จแล้ว → ข้าม
     • credential มาจาก env เท่านั้น ห้ามเขียนลงไฟล์/args (จะโผล่ใน process list) */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTBOX = path.join(ROOT, 'outbox');
const LOG = path.join(ROOT, 'marketing', 'outreach-log.jsonl');
const args = process.argv.slice(2);
const SEND = args.includes('--send');
const limitArg = (args.find((a) => a.startsWith('--limit=')) || '').split('=')[1];
const LIMIT = Math.max(1, Math.min(20, Number(limitArg) || 5));
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const HOST = process.env.SMTP_HOST || 'smtps://smtp.gmail.com:465';

if (!fs.existsSync(OUTBOX)) {
  console.error('✗ ยังไม่มี outbox/ — รัน node tools/outreach/build-outbox.mjs ก่อน');
  process.exit(1);
}
const sent = new Set();
if (fs.existsSync(LOG)) {
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean)) {
    try { const r = JSON.parse(line); if (r.ok) sent.add(r.id); } catch { /* บรรทัดเสียไม่ทำให้หยุด */ }
  }
}
const files = fs.readdirSync(OUTBOX).filter((f) => f.endsWith('.eml')).sort();
const plan = files.map((f) => ({ file: f, id: Number(f.slice(0, 2)), to: (fs.readFileSync(path.join(OUTBOX, f), 'utf8').match(/^To: (.+)$/m) || [])[1] || '' }))
  .filter((p) => !sent.has(p.id));

console.log(`outbox: ${files.length} ฉบับ · ส่งไปแล้ว ${sent.size} · จะส่งครั้งนี้ ${Math.min(LIMIT, plan.length)} (เพดาน ${LIMIT})`);
for (const p of plan.slice(0, LIMIT)) console.log(`  ${p.id}. ${p.to}  ← ${p.file}`);
if (plan.length > LIMIT) console.log(`  … เหลือ ${plan.length - LIMIT} ฉบับสำหรับรอบถัดไป (กติกา: สูงสุด 5 ฉบับ/วัน)`);

if (!SEND) {
  console.log('\n(dry-run) ยังไม่ส่งอะไร — เตรียมพร้อมแล้ว รอ credential:');
  console.log('  SMTP_USER=<อีเมลผู้ส่ง> SMTP_PASS=<app password> node tools/outreach/send-outreach.mjs --send');
  process.exit(0);
}
if (!USER || !PASS) {
  console.error('✗ ไม่มี SMTP_USER/SMTP_PASS ใน env — ส่งไม่ได้ (ไม่มีการเดา credential)');
  process.exit(2);
}

let ok = 0;
for (const p of plan.slice(0, LIMIT)) {
  const r = spawnSync('curl', [
    '-sS', '--url', HOST, '--user', `${USER}:${PASS}`,
    '--mail-from', USER, '--mail-rcpt', p.to,
    '--upload-file', path.join(OUTBOX, p.file),
  ], { encoding: 'utf8' });
  const good = (r.status === 0);
  const entry = { at: new Date().toISOString(), id: p.id, to: p.to, subject: p.file, channel: 'email', ok: good, error: good ? undefined : (r.stderr || '').trim().slice(0, 300) };
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
  console.log(`${good ? '✓' : '✗'} ${p.id}. ${p.to}${good ? '' : ' — ' + entry.error}`);
  if (good) ok++;
}
console.log(`\nส่งสำเร็จ ${ok}/${Math.min(LIMIT, plan.length)} · บันทึกที่ ${path.relative(ROOT, LOG)}`);
process.exit(ok === Math.min(LIMIT, plan.length) ? 0 : 1);
