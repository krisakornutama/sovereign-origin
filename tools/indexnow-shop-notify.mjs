#!/usr/bin/env node
/* indexnow-shop-notify — ยิง IndexNow ให้โดเมนร้าน (sovereignoriginshop.dpdns.org) ทราบทันทีที่ URL เปลี่ยน
   ที่มา: คำสั่งเจ้าของ 2/10/69 — "ผูก sitemap/IndexNow เข้ากับวง weekly/nightly"
   ใช้: node tools/indexnow-shop-notify.mjs [--dry-run] [--strict]
   เรียกอัตโนมัติจาก: tools/nightly-verify.mjs (ทุกคืน 02:00) + tools/verify/visitor-digest.mjs (รายสัปดาห์)

   หลักการ (แบบเดียวกับ tools/indexnow-notify.mjs ของ portfolio — อ่านของจริง ไม่เดา):
     - คีย์ = ไฟล์ 32-hex .txt ใน sovereign-frontend/public/ (เนื้อหาไฟล์ต้อง = ชื่อไฟล์ ตามกติกา IndexNow)
     - URL  = ดึงจาก sitemap.xml ที่ "เว็บตอบจริง" (fallback: อ่าน PUBLIC_PATHS ใน src/pages/sitemap.xml.ts)
     - pre-flight: ต้องเห็นไฟล์คีย์บนโดเมนจริง 200 + เนื้อหาตรงกับคีย์ก่อนถึงยิง
       (ถ้า key file เสิร์ฟไม่ได้ = ยัง verify ไม่ผ่าน — ยิงไปก็ถูกปฏิเสธ เสียเปล่า)
   หมายเหตุเรื่อง Google: IndexNow ไปถึง Bing/Yandex/Seznam/Naver เท่านั้น — Google ปิด sitemap ping
   endpoint ไปตั้งแต่ปี 2023 (ยืนยันแล้ว 2/10/69) ฝั่ง Google ต้องพึ่ง GSC sitemap + recrawl ตาม runbook
   fail-safe: ล้ม = exit 0 เสมอ (ยกเว้น --strict) — เสียโอกาสเร็วกว่าทำให้ nightly พัง */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'sovereign-frontend', 'public');
const SITEMAP_SRC = path.join(ROOT, 'sovereign-frontend', 'src', 'pages', 'sitemap.xml.ts');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'indexnow-shop.log');
const LAST_FILE = path.join(LOG_DIR, 'indexnow-shop-last.json');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const STRICT = args.includes('--strict');
const arg = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3).trim() || d;

const HOST = arg('host', 'sovereignoriginshop.dpdns.org');
const BASE = `https://${HOST}`;
const ENDPOINT = arg('endpoint', 'https://api.indexnow.org/indexnow/');
const log = (s) => console.log(s);

function note(kind, fields) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const p = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const pairs = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, ' ')}`)
      .join(' ');
    fs.appendFileSync(LOG_FILE, `${ts}  ${kind.padEnd(16)} ${pairs}\n`);
  } catch { /* เขียน log ไม่ได้ = ไม่ใช่เหตุให้งานหลักล้ม */ }
}

/* ผลรอบล่าสุดไว้อ่านทีหลัง (weekly digest อ่านไฟล์นี้บอกสถานะ ไม่ต้องยิงซ้ำเพื่อรู้ผล) */
function recordLast(rec) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LAST_FILE, JSON.stringify({ at: new Date().toISOString(), ...rec }, null, 2) + '\n');
  } catch { /* soft */ }
}

/* ออกแบบเป็น main() + process.exitCode ไม่ใช่ process.exit() —
   เจอจริงบน Node 24/Windows: process.exit() ทันทีหลัง fetch ที่ใช้ AbortSignal.timeout
   ทำให้ libuv assert ("UV_HANDLE_CLOSING") ออก exit 127 แม้งานสำเร็จ (ทดสอบเทียบ fetch+exit แล้ว) */
function fail(msg) {
  note('fail', { host: HOST, why: msg });
  recordLast({ ok: false, stage: 'fail', detail: msg });
  console.error(`✗ indexnow-shop: ${msg}`);
  process.exitCode = STRICT ? 1 : 0;
}

/* คีย์ — ไฟล์จริงใน public/ (ไฟล์นี้ถูกเสิร์ฟที่ราก = หลักฐานความเป็นเจ้าของโดเมน) */
function loadKey() {
  let names = [];
  try { names = fs.readdirSync(PUBLIC_DIR); } catch { return null; }
  const f = names.find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (!f) return null;
  const body = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8').trim();
  const stem = f.slice(0, -4);
  return body === stem ? { key: stem, file: f } : null;
}

/* pre-flight: ไฟล์คีย์ต้องเสิร์ฟได้จริงก่อน (เคยเจอ: next start แคชรายการ public/ ตอนบูต
   → ไฟล์ที่เพิ่มทีหลังตอบ 404 จนกว่าจะ restart server) */
async function keyServed(found) {
  const url = `${BASE}/${found.file}`;
  try {
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
    // ต้องอ่าน body ทิ้งเสมอแม้ 404 — ทิ้งก่อน process.exit แล้ว socket ยังเปิด
    // → Node/Windows assert ตอนออกโปรแกรม (เจอจริงรอบแรก: exit 127)
    const body = (await res.text().catch(() => '')).trim();
    if (!res.ok) return { ok: false, why: `ไฟล์คีย์ตอบ ${res.status} ที่ ${url}` };
    return body === found.key ? { ok: true, url } : { ok: false, why: `เนื้อหาในไฟล์คีย์ไม่ตรงกับชื่อไฟล์ (${url})` };
  } catch (e) {
    return { ok: false, why: `เช็คไฟล์คีย์ไม่สำเร็จ: ${e?.message ?? e}` };
  }
}

/* URL จาก sitemap ที่เว็บตอบจริง — ถ้าล่มค่อยอ่านรายการจาก sitemap.xml.ts ในเครื่อง (ไม่เดา) */
async function collectUrls() {
  try {
    const res = await fetch(`${BASE}/sitemap.xml`, { signal: AbortSignal.timeout(15_000) });
    const xml = res.ok ? await res.text() : '';
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    if (urls.length) return { urls, from: 'live-sitemap' };
  } catch { /* ไปใช้ตัวสำรอง */ }
  try {
    const src = fs.readFileSync(SITEMAP_SRC, 'utf8');
    const host = (src.match(/FALLBACK_HOST = '([^']+)'/) || [])[1] || HOST;
    const paths = [...src.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
    if (!paths.length) return { urls: [], from: 'source' };
    return {
      urls: paths.map((p) => `https://${host}${p === '/' ? '/' : `${p}/`}`),
      from: 'source-fallback',
    };
  } catch {
    return { urls: [], from: 'none' };
  }
}

async function main() {
  const found = loadKey();
  if (!found) return fail('ไม่เจอไฟล์คีย์ IndexNow (ชื่อ 32 hex .txt ที่เนื้อหา = ชื่อไฟล์) ใน sovereign-frontend/public/');

  const served = await keyServed(found);
  if (!served.ok) return fail(`${served.why} — ยังยิงไม่ได้ (ต้อง restart next start ให้เห็นไฟล์ใหม่ใน public/ ก่อน)`);

  const { urls, from } = await collectUrls();
  if (!urls.length) return fail('ไม่มี URL จาก sitemap ทั้งแบบออนไลน์และในเครื่อง');

  const payload = JSON.stringify({
    host: HOST,
    key: found.key,
    keyLocation: `${BASE}/${found.file}`,
    urlList: urls,
  });

  if (DRY) {
    note('dry', { host: HOST, urls: urls.length, from });
    log(`indexnow-shop: dry-run — จะส่ง ${urls.length} URL ไป ${ENDPOINT} (รายการจาก ${from})`);
    log(`indexnow-shop: คีย์ ${found.file} · keyLocation ${BASE}/${found.file}`);
    urls.forEach((u, i) => log(`indexnow-shop:   ${String(i + 1).padStart(2, '0')}. ${u}`));
    return;
  }

  let status = 0;
  let why = '';
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: payload,
      signal: AbortSignal.timeout(20_000),
    });
    status = res.status;
    await res.text().catch(() => ''); // อ่านทิ้งเสมอ — กัน socket ค้างตอนจบโปรแกรม
  } catch (e) {
    why = e?.name === 'TimeoutError' ? 'ส่งไม่ทัน 20 วิ' : (e?.message ?? String(e));
  }

  if (status === 200 || status === 202) {
    note('sent', { host: HOST, http: status, urls: urls.length, from, key: found.file });
    recordLast({ ok: true, stage: 'sent', http: status, urls: urls.length, from, key: found.file });
    log(`indexnow-shop: ✓ HTTP ${status} — ส่ง ${urls.length} URL ให้ Bing/Yandex/Seznam/Naver (คีย์ ${found.file})`);
    log(`indexnow-shop: ${urls.slice(0, 3).join(' ')}${urls.length > 3 ? ` … +${urls.length - 3}` : ''}`);
    return;
  }
  if (status === 429) return fail('HTTP 429 — ยิงถี่เกิน (IndexNow จำกัดความถี่) ข้ามได้ บอทจะวนมาเอง');
  return fail(`HTTP ${status || 'no-response'} — ส่งไม่สำเร็จ${why ? ` (${why})` : ''} (ไม่กระทบงานหลัก)`);
}

await main();
