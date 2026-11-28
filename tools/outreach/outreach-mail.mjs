#!/usr/bin/env node
/* outreach-mail — ตรวจและเรนเดอร์ชุดอีเมล outreach 20 ฉบับ (marketing/outreach-20-emails.json)
   ใช้: node tools/outreach/outreach-mail.mjs [--render] [--json]

   ทำไมต้องมีตัวตรวจ: ชุดนี้จะถูกส่งจากอีเมลจริงของเจ้าของ ⇒ ความผิดพลาดหนึ่งครั้ง
   แพงกว่าการรันสคริปต์หนึ่งครั้ง (ส่งผิดคน/ใส่ราคาเก่า/หลุดเลขบัญชีออกไปในข้อความ)
   กติกาที่บังคับ (ตรงกับ marketing/README.md และ outreach-20.md):
     1. 20 ฉบับ เรียงเลข 1..20 ไม่ซ้ำ
     2. 1 ฉบับ = 1 ลิงก์ และต้องเป็นหน้าร้านเดียวเท่านั้น
     3. ห้ามมีเลขบัญชี/เลข 10 หลักในข้อความ
     4. ราคาที่อ้างได้มีแค่ $59 / $199 / $599
     5. ห้ามเหลือ placeholder {{...}}
     6. "to" ว่างได้ (ยังไม่พบอีเมลจริง) แต่ถ้ากรอกต้องเป็นอีเมลที่ถูกรูปแบบ
   ตัวสคริปต์ไม่ส่งอีเมลเอง — การส่งต้องรอเจ้าของยืนยัน */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'marketing', 'outreach-20-emails.json');
const OUT = path.join(ROOT, 'marketing', 'outreach-20-emails.md');
const args = process.argv.slice(2);
const RENDER = args.includes('--render');
const AS_JSON = args.includes('--json');

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const emails = Array.isArray(data.emails) ? data.emails : [];
const problems = [];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const priceOk = new Set(['59', '199', '599']);

function checkCommon(where, text) {
  if (typeof text !== 'string' || !text.trim()) { problems.push(`${where}: ว่าง`); return false; }
  if (/\d{10,}/.test(text)) problems.push(`${where}: พบตัวเลข 10 หลักขึ้นไป (ห้ามใส่เลขบัญชี)`);
  if (/\{\{|\}\}/.test(text)) problems.push(`${where}: ยังมี placeholder {{...}}`);
  for (const m of text.matchAll(/\$\s*(\d+)/g)) {
    if (!priceOk.has(m[1])) problems.push(`${where}: ราคา $${m[1]} ไม่อยู่ในชุดที่ขายจริง ($59/$199/$599)`);
  }
  return true;
}

/* ลิงก์เดียวต่อฉบับ — เฉพาะเนื้ออีเมล (หัวเรื่องไม่ต้องมีลิงก์) */
function checkSingleLink(where, text) {
  const urls = text.match(/https?:\/\/\S+/g) || [];
  if (urls.length !== 1) problems.push(`${where}: ต้องมีลิงก์เดียว (พบ ${urls.length})`);
  else if (urls[0] !== data.shopUrl) problems.push(`${where}: ลิงก์ต้องเป็น ${data.shopUrl} (พบ ${urls[0]})`);
}

if (emails.length !== 20) problems.push(`ต้องมี 20 ฉบับ (พบ ${emails.length})`);
const seen = new Set();
for (const [i, e] of emails.entries()) {
  const where = `#${e.id ?? i + 1}`;
  if (!Number.isInteger(e.id)) problems.push(`${where}: ไม่มี id`);
  if (seen.has(e.id)) problems.push(`${where}: id ซ้ำ`);
  seen.add(e.id);
  if (i + 1 !== e.id) problems.push(`${where}: ลำดับไม่ต่อเนื่อง (ควรเป็น ${i + 1})`);
  if (!e.segment || !e.target) problems.push(`${where}: ต้องมี segment และ target`);
  if (typeof e.to !== 'string') problems.push(`${where}: to ต้องเป็นสตริง`);
  else if (e.to && !EMAIL_RE.test(e.to)) problems.push(`${where}: to ไม่ถูกรูปแบบอีเมล (${e.to})`);
  if (typeof e.subject !== 'string' || !e.subject.trim()) problems.push(`${where}: ไม่มีหัวเรื่อง`);
  else if (e.subject.length > 120) problems.push(`${where}: หัวเรื่องยาวเกิน 120 ตัวอักษร`);
  else if (/[\r\n]/.test(e.subject)) problems.push(`${where}: หัวเรื่องมีขึ้นบรรทัดใหม่`);
  if (checkCommon(`${where} subject`, e.subject) && typeof e.body === 'string') {
    if (checkCommon(`${where} body`, e.body)) checkSingleLink(`${where} body`, e.body);
  }
  if (typeof e.body === 'string' && e.body.length < 250) problems.push(`${where}: เนื้อหาสั้นผิดปกติ (${e.body.length} ตัวอักษร)`);
}
checkCommon('followUp subject', data.followUp?.subject);
checkCommon('followUp body', data.followUp?.body);

const ready = emails.filter((e) => EMAIL_RE.test(e.to || ''));
const summary = {
  file: path.relative(ROOT, SRC),
  total: emails.length,
  readyToSend: ready.length,
  awaitingAddress: emails.length - ready.length,
  problems,
};

if (AS_JSON) console.log(JSON.stringify(summary, null, 2));

if (problems.length) {
  if (!AS_JSON) {
    console.error(`✗ outreach: ${problems.length} ปัญหา`);
    problems.forEach((p) => console.error(`  - ${p}`));
  }
  process.exit(1);
}

if (!AS_JSON) {
  console.log(`✓ outreach: ${emails.length} ฉบับผ่านกติกา · พร้อมส่ง ${ready.length} · รออีเมลปลายทาง ${emails.length - ready.length}`);
  console.log('  ตรวจแล้ว: ลิงก์เดียว/ฉบับ, ไม่มีเลขบัญชี, ราคา $59/$199/$599, ไม่มี placeholder');
}

if (RENDER) {
  const lines = [
    '# Outreach 20 — ชุดอีเมลพร้อมส่ง (สร้างจาก JSON)',
    '',
    '> ไฟล์นี้สร้างอัตโนมัติจาก `marketing/outreach-20-emails.json` — แก้ที่ JSON แล้วรัน `npm run outreach:render`',
    `> หน้าร้านเดียวที่ใช้: ${data.shopUrl} · ห้ามใส่เลขบัญชีในข้อความ (เลขอยู่ในหน้าเว็บเท่านั้น)`,
    '',
    `สรุป: ${emails.length} ฉบับ · มีอีเมลปลายทางแล้ว ${ready.length} · รออีเมลจริงจากหน้า "ติดต่อเรา" ของเป้าหมาย ${emails.length - ready.length}`,
    '',
    '| # | กลุ่ม | เป้าหมาย | To |',
    '|---|---|---|---|',
    ...emails.map((e) => `| ${e.id} | ${e.segment} | ${e.target} | ${e.to || '_(ยังไม่กรอก)_'} |`),
    '',
    '---',
    '',
  ];
  for (const e of emails) {
    lines.push(`## ${e.id}. ${e.segment} — ${e.target}`, '', `**To:** ${e.to || '_(กรอกอีเมลจริงจากหน้า "ติดต่อเรา" หรือเพจของร้านนั้น — ห้ามเดา)_'}`, '', `**หัวเรื่อง:** ${e.subject}`, '', '```', e.body, '```', '');
  }
  lines.push('---', '', `## ข้อความติดตาม (ใช้ครั้งเดียว หลัง ${data.rules.followUpAfterDays} วัน ไม่มีการตอบ)`, '', `**หัวเรื่อง:** ${data.followUp.subject}`, '', '```', data.followUp.body, '```', '');
  lines.push('**กติกาก่อนกดส่ง:** สูงสุด 5 ฉบับ/วัน · ห้าม BCC หมู่ · ตอบกลับทุกคนภายใน 24 ชม. · ตอบกลับข้อความใด ๆ = หยุดขายทันที', '');
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(`✓ outreach: เขียน ${path.relative(ROOT, OUT)}`);
}
