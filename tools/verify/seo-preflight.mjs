#!/usr/bin/env node
/* seo-preflight — ตรวจว่าเว็บพร้อมให้ Google จัดทำดัชนี หรือยัง (คำสั่งเจ้าของ 2/10/69)
   ใช้: node tools/verify/seo-preflight.mjs [--strict] [--test]
   เรียกอัตโนมัติ: tools/nightly-verify.mjs (ทุกคืน 02:00) + tools/verify/visitor-digest.mjs (รายสัปดาห์)

   ตรวจจาก "ของจริงบนโดเมน" ไม่ใช่โค้ด — เพราะบั๊กที่เคยเจอ (title หายทั้ง 3 หน้า, sitemap URL
   ไม่ตรง canonical, WAF บล็อก 4 หน้า) ล้มนอกเหนือจากที่โค้ดบอก:
     1) ทุก URL ใน sitemap ตอบ 200  (WAF บล็อก = Google crawl ไม่ได้)
     2) มี <title> ไม่ว่าง · มี meta description
     2b) **มี <h1> 1 อันพอดี** — จุดที่พังจริง 3/10/69: /sensors/ + /shop/ ตอบ 200 มี title
         canonical description ครบ แต่ h1=0 เพราะหน้ารอ hydrate = Google ได้ metadata ล้วน
         ไม่มีเนื้อหา (เช็คเดิมมองไม่เห็น เพราะไม่เคยถามว่า "หน้ามีเนื้อหาจริงไหม")
     2c) **ข้อความใน HTML ยาวพอ (ข.10/69 คำสั่งเจ้าของ)** — เกณฑ์เดียวกับที่ Google ใช้ตัดสิน
         "thin content": มี h1 ชัดเจน แต่ข้อความรวมไม่ถึง 800 ตัวอักษร = หน้าแทบไม่มีอะไรให้อ่าน
         (ต่างจากข้อ 2b: หน้าอาจมี h1 + ย่อหน้าสั้น แต่ไม่พอให้จัดทำดัชนี · SEO_MIN_TEXT_CHARS ปรับได้)
     3) มี rel=canonical และตรงกับ URL จริง (กันเนื้อหาซ้ำสองโดเมน)
     4) ไม่มี noindex ซ้อนกับการอยู่ใน sitemap (GSC ขึ้นเตือนตรงนี้)
     5) robots.txt 200 และชี้ Sitemap ของโฮสต์ที่ใช้งานจริง
     6) ไฟล์คีย์ IndexNow ที่รากตอบ 200 เนื้อหาตรงชื่อไฟล์ (ไม่งั้นบอทไม่รับ ping)
     7) control: /dashboard/ ต้อง 403 (กันเผลอเปิดหน้าในระบบให้บอท)

   fail-safe: ล้ม = exit 0 (ยกเว้น --strict) · ผลเขียน logs/seo-preflight.json เสมอ
   แจ้ง Telegram เฉพาะตอน "มีปัญหา" (ปกติเงียบ ไม่กวนทุกคืน) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { notify } from './telegram-creds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(ROOT, 'logs');
const OUT_FILE = path.join(OUT_DIR, 'seo-preflight.json');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const TEST = args.includes('--test'); // พิมพ์ข้อความ TG ออกจอ ไม่ส่งจริง
const HOST = (process.env.SEO_HOST || 'sovereignoriginshop.dpdns.org').trim();
// เกณฑ์ข้อ 2c: ต่ำกว่านี้ = thin content (ปรับผ่าน env ได้ถ้าภายหน้าเพิ่มเนื้อหาหน้าสั้นจริง)
const MIN_TEXT = Number(process.env.SEO_MIN_TEXT_CHARS || 800);
const BASE = `https://${HOST}`;
const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const log = (s) => console.log(s);
const pick = (h, re) => (h.match(re) || [])[1] ?? null;
const problems = [];
const rows = [];

async function grab(pathname, { head = false } = {}) {
  try {
    const res = await fetch(BASE + pathname, { method: head ? 'HEAD' : 'GET', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    const text = res.ok && !head ? await res.text() : '';
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: '', error: e?.message ?? String(e) };
  }
}

/** ข้อความที่คน/บอทอ่านได้จริงจาก HTML — ตัด script/style/svg และแท็กทิ้ง
 *  คืนจำนวน "ตัวอักษร" ไม่ใช่คำ เพราะเนื้อหาไทยไม่มีช่องว่าง (นับคำจะได้ตัวเลขหลอก ๆ)
 *  ตัด <nav>/<aside> ด้วย เพราะเมนูภายในไม่ใช่เนื้อหาหน้า (และซ่อนไปแล้วข้อ 1) */
export function visibleText(html) {
  const body = (String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1];
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(nav|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ตัวตรวจหน้าเดียว — แยกเป็นฟังก์ชันบริสุทธิ์เพื่อให้เทสต์ได้ (tools/test/seo-h1.test.mjs)
 *  เหตุผล: กติกา h1 คือสิ่งที่กันบั๊ก "หน้าว่าง" ซ้ำ — ถ้าไม่มีเทสต์ คนแก้ regex พลาด
 *  จะกลับไปเงียบเหมือนเดิมโดยไม่มีใครรู้ (เช่นนับ <h1class=... ติดไปด้วย) */
export function checkPage({ status, text }, url, minText = MIN_TEXT) {
  const title = pick(text, /<title[^>]*>([^<]*)<\/title>/);
  const desc = pick(text, /<meta[^>]+name="description"[^>]+content="([^"]*)"/);
  const canon = pick(text, /<link rel="canonical" href="([^"]+)"/);
  const robots = pick(text, /<meta name="robots" content="([^"]+)"/);
  // นับ <h1> = ตัวบอกว่า "หน้านี้มีเนื้อหาจริง" ไม่ใช่แค่ metadata ที่ฝังไว้
  // ใช้ [\s>] เพราะ <h1class=... ไม่ใช่ h1 (นับผิดได้ถ้าใช้แค่ <h1)
  const h1 = (text.match(/<h1[\s>]/g) || []).length;
  const chars = visibleText(text).length;
  const bad = [];
  if (status !== 200) bad.push(`ตอบ ${status || 'ไม่ตอบ'}`);
  if (!title || !title.trim()) bad.push('ไม่มี <title>');
  if (!desc) bad.push('ไม่มี meta description');
  if (!canon) bad.push('ไม่มี rel=canonical');
  else if (canon.replace(/\/$/, '') !== String(url).replace(/\/$/, '')) bad.push(`canonical ไม่ตรง URL (${canon})`);
  if (robots && /noindex/i.test(robots)) bad.push(`noindex แต่อยู่ใน sitemap (${robots})`);
  if (h1 === 0) bad.push('ไม่มี <h1> — หน้าว่าง (Google ได้แค่ metadata ไม่มีเนื้อหา)');
  else if (h1 > 1) bad.push(`มี <h1> ${h1} อัน (ควรมี 1)`);
  // เช็คความยาวเฉพาะหน้าที่ตอบ 200 — หน้าตาย/ไม่ตอบถูกจับที่ข้อ 1 แล้ว ไม่ต้องนับซ้ำ
  if (status === 200 && chars < minText) {
    bad.push(`ข้อความน้อย ${chars} ตัวอักษร (ต้อง ≥ ${minText}) — thin content, จัดทำดัชนีไม่ได้`);
  }
  return { bad, h1, chars };
}

async function main() {
  // ── 1) sitemap = รายการหน้าที่ประกาศว่าอยากให้ Google เข้า ──
  const sm = await grab('/sitemap.xml');
  if (sm.status !== 200) {
    problems.push(`sitemap.xml ตอบ ${sm.status || 'ไม่ตอบ'} — Google ดึงรายการหน้าไม่ได้`);
    return finish({ sitemap: { status: sm.status, urls: 0 } }, 0);
  }
  const urls = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!urls.length) problems.push('sitemap.xml ไม่มี <loc> เลย');

  // ── 2–4) ตรวจทีละหน้า ──
  for (const u of urls) {
    const p = new URL(u);
    const r = await grab(p.pathname + p.search);
    const { bad, h1, chars } = checkPage(r, u);
    if (bad.length) problems.push(`${u.replace(BASE, '')}: ${bad.join(' · ')}`);
    rows.push({ url: u.replace(BASE, ''), status: r.status, h1, chars, ok: bad.length === 0, issues: bad });
  }

  // ── 5) robots.txt ──
  const rb = await grab('/robots.txt');
  if (rb.status !== 200) problems.push(`robots.txt ตอบ ${rb.status || 'ไม่ตอบ'}`);
  else {
    if (!/^\s*Sitemap:\s*\S+/mi.test(rb.text)) problems.push('robots.txt ไม่มีบรรทัด Sitemap:');
    const listed = [...rb.text.matchAll(/Sitemap:\s*(\S+)/gi)].map((m) => m[1]);
    if (listed.length && !listed.includes(`${BASE}/sitemap.xml`)) problems.push(`robots.txt ไม่ได้ชี้ sitemap ของโฮสต์ที่ใช้จริง (${BASE})`);
    const dead = listed.filter((s) => s.startsWith('https://') && s.includes(HOST) === false);
    if (dead.length) log(`ℹ️ robots.txt ยังชี้ Sitemap ของโฮสต์อื่น: ${dead.join(', ')}`);
  }

  // ── 6) ไฟล์คีย์ IndexNow ──
  try {
    const pub = path.join(ROOT, 'sovereign-frontend', 'public');
    const keyFile = fs.readdirSync(pub).find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
    if (!keyFile) problems.push('ไม่เจอไฟล์คีย์ IndexNow ใน sovereign-frontend/public/');
    else {
      const kr = await grab(`/${keyFile}`);
      const body = kr.text.trim();
      if (kr.status !== 200) problems.push(`ไฟล์คีย์ IndexNow ตอบ ${kr.status || 'ไม่ตอบ'} — บอทจะปฏิเสธการยิงทั้งหมด`);
      else if (body !== keyFile.slice(0, -4)) problems.push('เนื้อในไฟล์คีย์ IndexNow ไม่ตรงกับชื่อไฟล์');
    }
  } catch (e) {
    problems.push(`ตรวจไฟล์คีย์ IndexNow ไม่สำเร็จ: ${e?.message ?? e}`);
  }

  // ── 7) control: หน้าในระบบต้องยังถูกบล็อกที่ edge ──
  const dash = await grab('/dashboard/', { head: true });
  if (dash.status !== 403) problems.push(`/dashboard/ ตอบ ${dash.status} (ควรเป็น 403 — WAF อาจเปิดหน้าในระบบให้บอท)`);

  return finish({ sitemap: { status: sm.status, urls: urls.length }, pages: rows, robots: rb.status, dashboard: dash.status }, urls.length);
}

function finish(data, checked) {
  const ok = problems.length === 0;
  const rec = { at: new Date().toISOString(), host: HOST, ok, checked, problems, ...data };
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(rec, null, 2) + '\n');
  } catch { /* soft */ }
  for (const r of rows ?? []) log(`${r.ok ? '✓' : '✗'} ${r.url} (${r.chars} ตัวอักษร)${r.ok ? '' : ` — ${r.issues.join(' · ')}`}`);
  log(`seo-preflight: ${ok ? 'ผ่าน' : `มีปัญหา ${problems.length} จุด`} · ${checked} URL · ${HOST}`);
  if (!ok) {
    const text = [
      '⚠️ <b>SEO pre-flight ไม่ผ่าน</b>',
      ...problems.slice(0, 12).map((p) => `• ${p}`),
      `<code>${new Date().toLocaleString('th-TH')}</code> · ${HOST}`,
    ].join('\n');
    if (TEST) log(`[dry] ${text.replace(/<[^>]+>/g, '')}`);
    else notify(text).then((r) => log(r.ok ? 'แจ้ง Telegram แล้ว' : `ส่ง TG ไม่สำเร็จ: ${r.error}`)).catch(() => {});
  }
  process.exitCode = STRICT && !ok ? 1 : 0;
}

// รันเฉพาะตอนเรียกตรง ๆ (ไม่ใช่ตอนถูก import ไปเทสต์)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
