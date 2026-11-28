#!/usr/bin/env node
/* build-outbox — แปลง 20 ฉบับใน marketing/outreach-20-emails.json เป็นไฟล์ .eml แยกฉบับ (1 ผู้รับ/1 ฉบับ)
   ใช้: node tools/outreach/build-outbox.mjs [--check]
   ทำไมต้องมี: เครื่องที่ทำงานนี้ไม่มี SMTP/Gmail credential ⇒ ส่งตรงจากสคริปต์ไม่ได้
   แต่ "เปิดไฟล์ .eml แล้วกด Send" หรือ `node tools/outreach/send-outreach.mjs --send` ใช้ชุดเดียวกันได้ทันที
   กติกา: ห้าม BCC หมู่ (ไฟล์ละ 1 To), ลิงก์เดียว = buy.html, ไม่มีเลขบัญชี — ตรวจซ้ำก่อนเขียนทุกครั้ง */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'marketing', 'outreach-20-emails.json');
const OUT_DIR = path.join(ROOT, 'outbox');
const CHECK = process.argv.includes('--check');

/* ด่านเดิมต้องผ่านก่อนเสมอ — ไม่มีข้อยกเว้น (อีเมลจริง/ลิงก์เดียว/ไม่มีเลขบัญชี/ราคาถูกต้อง) */
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'outreach', 'outreach-mail.mjs')], { stdio: 'inherit' });

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
if (!Array.isArray(data.emails) || data.emails.length !== 20) {
  console.error('✗ ต้องมี 20 ฉบับ');
  process.exit(1);
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
const enc = (s) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'target';
/* ชื่อธุรกิจส่วนใหญ่เป็นไทย → ใช้ local part ของอีเมลปลายทางเป็นชื่อไฟล์ (อ่านง่าย เรียงลำดับได้) */
const fileSlug = (e) => slug(String(e.to).split('@')[0]).slice(0, 32) || 'target';
const domain = process.env.OUTREACH_FROM || 'owenhoper3@gmail.com';
const stamp = new Date().toISOString().slice(0, 10);

const files = [];
for (const e of data.emails) {
  const messageId = `<so-outreach-${e.id}-${stamp.replace(/-/g, '')}@sovereignoriginshop.dpdns.org>`;
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `From: กฤษกรณ์ อุตมะ <${domain}>`,
    `To: ${e.to}`,
    `Subject: ${enc(e.subject)}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'X-Sovereign-Outreach: ' + e.id,
  ].join('\r\n');
  const eml = `${headers}\r\n\r\n${b64(e.body)}\r\n`;
  const file = path.join(OUT_DIR, `${String(e.id).padStart(2, '0')}-${fileSlug(e)}.eml`);
  files.push({ id: e.id, to: e.to, file });
  if (!CHECK) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(file, eml);
  }
}

if (CHECK) {
  const have = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.eml')).length : 0;
  console.log(`outbox: ${have} ไฟล์ .eml (คาด 20) — ${files.map((f) => path.basename(f.file)).slice(0, 2).join(', ')} …`);
  process.exit(have === 20 ? 0 : 1);
}
console.log(`✓ outbox: เขียน ${files.length} ไฟล์ .eml → ${path.relative(ROOT, OUT_DIR)}/ (1 ผู้รับต่อฉบับ, ไม่มี BCC)`);
