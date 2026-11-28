#!/usr/bin/env node
/* verify-sources — พิสูจน์ว่าอีเมลปลายทางของ outreach 20 ฉบับ "อยู่บนหน้าจริง" ที่อ้างใน sourceUrl
   ใช้: node tools/outreach/verify-sources.mjs [--ci] [--json] [--only=<id,id>]

   ทำอะไร: ดึง sourceUrl สดของทุกฉบับ → ตรวจว่า HTML ที่ได้มีสตริง `to` อยู่จริง (ไม่สนตัวพิมพ์)
            → บันทึกผลลง marketing/outreach-20-verified.json (HTTP status, เจอ/ไม่เจอ, บริบท, เวลาที่ดึง)

   Exit code:
     0 = ทุกฉบับยืนยันได้
     1 = ดึงหน้าได้ แต่ไม่พบอีเมลบนหน้า (ของจริงเสีย — ต้องเปลี่ยนเป้าหมาย)
     2 = ดึงหน้าไม่ได้/เครือข่ายล่ม (สิ่งแวดล้อม ไม่ใช่ตัวคิว)
   --ci = โหมด CI: exit 2 กลายเป็น 0 พร้อมเตือน (เครือข่ายบล็อกไม่ทำให้ pipeline แดง)
          แต่ exit 1 ยังล้มเสมอ เพราะเป็น defect ของคิวเอง

   หมายเหตุ: ตัวสคริปต์อ่านอย่างเดียว ไม่ส่งอีเมลและไม่แตะ Gmail */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'marketing', 'outreach-20-emails.json');
const OUT = path.join(ROOT, 'marketing', 'outreach-20-verified.json');
const args = process.argv.slice(2);
const CI = args.includes('--ci');
const AS_JSON = args.includes('--json');
const onlyArg = (args.find((a) => a.startsWith('--only=')) || '').slice(7).trim();
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const TIMEOUT_MS = Number(process.env.OUTREACH_VERIFY_TIMEOUT_MS || 25000);
const CONCURRENCY = 5;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 SovereignOutreachVerify/1.0';

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const emails = (data.emails || []).filter((e) => !ONLY || ONLY.has(String(e.id)));

/* หน้าเว็บบางแห่งเขียน @ เป็น entity (&#64; / &commat;) หรือให้ mailto: ถูก encode
   ⇒ ถอด entity ก่อนเทียบ ไม่งั้นจะรายงาน "ไม่พบ" ทั้งที่ตัวอักษรอยู่บนหน้าจริง */
function decodeEntities(html) {
  return html
    .replace(/&#64;|&commat;/gi, '@')
    .replace(/&#x40;/gi, '@')
    .replace(/&#(\d{1,7});/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/gi, '&');
}

/* บริบทที่พบอีเมล (ตัด whitespace/แท็กให้อ่านได้) — ใช้เป็นหลักฐานว่าเจอบนหน้านั้นจริง */
function contextAround(html, needle, span = 90) {
  const i = html.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return '';
  const raw = html.slice(Math.max(0, i - span), i + needle.length + span);
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchPage(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'th,en;q=0.8' },
      signal: ac.signal,
    });
    const body = await res.text();
    return { status: res.status, ok: res.ok, finalUrl: res.url || url, body };
  } catch (err) {
    return { status: 0, ok: false, finalUrl: url, body: '', error: err.name === 'AbortError' ? 'timeout' : (err.code || err.message || String(err)) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkOne(e) {
  const at = new Date().toISOString();
  const page = await fetchPage(e.sourceUrl);
  const needle = String(e.to).toLowerCase();
  const rawHit = page.body.toLowerCase().includes(needle);
  const decoded = page.ok && !rawHit ? decodeEntities(page.body) : page.body;
  const found = page.ok && (rawHit || decoded.toLowerCase().includes(needle));
  return {
    id: e.id,
    name: e.name,
    to: e.to,
    sourceUrl: e.sourceUrl,
    checkedAt: at,
    httpStatus: page.status,
    finalUrl: page.finalUrl,
    emailFound: found,
    matchedAs: found ? (rawHit ? 'raw-html' : 'html-entity-decoded') : '',
    context: found ? contextAround(decoded, e.to) : '',
    error: page.error || '',
  };
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < emails.length) {
    const e = emails[cursor++];
    results.push(await checkOne(e));
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, emails.length) }, worker));
results.sort((a, b) => a.id - b.id);

const failed = results.filter((r) => r.httpStatus !== 0 && r.httpStatus < 400 && !r.emailFound);
const unreachable = results.filter((r) => r.httpStatus === 0 || r.httpStatus >= 400);
const passed = results.filter((r) => r.emailFound);

if (!ONLY) {
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    checker: 'tools/outreach/verify-sources.mjs',
    summary: { total: results.length, passed: passed.length, emailMissing: failed.length, unreachable: unreachable.length },
    results,
  }, null, 2));
}

if (AS_JSON) console.log(JSON.stringify({ summary: { total: results.length, passed: passed.length, emailMissing: failed.length, unreachable: unreachable.length }, results }, null, 2));
else {
  console.log('ลำดับ  HTTP  พบอีเมล  เป้าหมาย');
  for (const r of results) {
    const mark = r.emailFound ? '✓' : (r.httpStatus === 0 || r.httpStatus >= 400 ? '!' : '✗');
    console.log(`  ${String(r.id).padStart(2)}   ${String(r.httpStatus || 'ERR').padStart(4)}    ${mark}      ${r.name} <${r.to}>${r.matchedAs === 'html-entity-decoded' ? ' [entity]' : ''}`);
    if (r.error) console.log(`        ↳ ${r.error} — ${r.sourceUrl}`);
  }
  console.log(`\nสรุป: ยืนยันได้ ${passed.length}/${results.length} · ดึงได้แต่ไม่พบอีเมล ${failed.length} · ดึงไม่ได้ ${unreachable.length}`);
  if (passed.length) console.log(`บันทึกหลักฐาน → ${path.relative(ROOT, OUT)}`);
}

if (failed.length) {
  console.error(`\n✗ มี ${failed.length} รายการที่หน้าโหลดได้แต่ไม่พบอีเมล — ต้องเปลี่ยนเป้าหมาย: ` + failed.map((r) => `#${r.id}`).join(', '));
  process.exit(1);
}
if (unreachable.length) {
  const msg = `\n${CI ? '⚠' : '✗'} ${unreachable.length} รายการดึงหน้าไม่ได้ (เครือข่าย/เซิร์ฟเวอร์): ` + unreachable.map((r) => `#${r.id}`).join(', ');
  if (CI) { console.warn(msg + ' — โหมด CI: ไม่ทำให้ pipeline ล้ม'); process.exit(0); }
  console.error(msg);
  process.exit(2);
}
console.log('\n✓ ยืนยันครบทุกฉบับ: อีเมลปลายทางปรากฏจริงบนหน้า sourceUrl');
