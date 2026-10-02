#!/usr/bin/env node
/* gsc-coverage — เทียบ "หน้าที่ Google เห็นจริง" กับ sitemap (คำสั่งเจ้าของ 2/10/69)
   ใช้: node tools/verify/gsc-coverage.mjs [--strict] [--test] [--days 28]
   เรียกอัตโนมัติ: tools/nightly-verify.mjs (ทุกคืน 02:00) · เรียกเองได้เพื่อดูสถานะทันที

   ทำไมต้องมี (คำสั่งเจ้าของ): เคยเจอบั๊กที่ "sitemap ประกาศ 10 หน้า แต่ Google ไม่เข้ามาเลย"
   และหน้าที่เคยมี traffic แล้วหลุดวง (canonical ผิด/noindex ซ้อน/ถูก WAF บล็อก)
   — ทุกอย่างนี้ SEO pre-flight (ตรวจจากของจริง) มองไม่เห็น เพราะมันไม่รู้ว่า "Google เข้ามาแล้วหรือยัง"

   ตรวจ 4 อย่าง (เทียบ 2 หน้าต่างเพื่อจับ "หลุดวง" ไม่ใช่แค่ยอดตอนนี้):
     1) API เข้าถึงได้ + property ยัง verified (ไม่งั้น = แจ้งเตือน · ค่า TXT หลุด/โดนลบคือปัญหาจริง)
     2) หน้าที่เคยมี impression แล้วหายไป (regression = แจ้งเตือน) ← อันนี้สำคัญที่สุด
     3) หน้าที่ Google เข้ามาแต่ไม่อยู่ใน sitemap (orphan = แจ้งเตือนกลาง ๆ)
     4) หน้าใน sitemap ที่ยังไม่เคยมี impression = ข้อมูล (เว็บใหม่ยังไม่มี traffic = ปกติ ไม่ต้องร้อง)

   fail-safe: ยังไม่ได้ตั้งค่า credential = exit 0 + ข้าม (ไม่ทำให้ nightly แดง เพราะยังไม่ได้ Verify)
              ตั้งค่าแล้วแต่ API พัง = exit 1 เฉพาะ --strict · ผลเขียน logs/gsc-coverage.json เสมอ
   credential อ่านจาก process.env หรือ sovereign-os/infra/.env (GSC_CLIENT_ID/GSC_CLIENT_SECRET/GSC_REFRESH_TOKEN/GSC_SITE_URL) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { notify } from './telegram-creds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_FILE = path.join(ROOT, 'logs', 'gsc-coverage.json');
const INFRA_ENV = path.join(ROOT, 'sovereign-os', 'infra', '.env');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const TEST = args.includes('--test');
const daysArg = args.indexOf('--days');
const DAYS = daysArg >= 0 ? Math.max(3, Number(args[daysArg + 1]) || 28) : 28;
const HOST = 'sovereignoriginshop.dpdns.org';

// GSC ข้อมูลช้า ~2-3 วัน → ถามถึงเมื่อ 3 วันก่อน ไม่งั้นจะเห็นยอดตกชั่วคราวแล้วร้อง false alarm
const LAG_DAYS = 3;

function readEnv() {
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(INFRA_ENV, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* รันจาก worktree ที่ไม่มี .env — ใช้ process.env อย่างเดียว */ }
  return env;
}

const iso = (d) => d.toISOString().slice(0, 10);
function windows() {
  const end = new Date(Date.now() - LAG_DAYS * 86400_000);
  const start = new Date(end.getTime() - DAYS * 86400_000);
  const prevStart = new Date(start.getTime() - DAYS * 86400_000);
  return { startDate: iso(start), endDate: iso(end), prevStartDate: iso(prevStart) };
}

async function getAccessToken(env) {
  if (env.GSC_ACCESS_TOKEN) return env.GSC_ACCESS_TOKEN; // ทางลัด (อายุ ~1 ชม. — ใช้ตอน debug)
  const { GSC_CLIENT_ID: id, GSC_CLIENT_SECRET: secret, GSC_REFRESH_TOKEN: refresh } = env;
  if (!id || !secret || !refresh) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: id, client_secret: secret, refresh_token: refresh }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`token: ${res.status} ${j?.error_description ?? j?.error ?? ''}`.trim());
  return j.access_token;
}

async function query(token, site, win, rowLimit = 1000) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchanalytics/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...win, dimensions: ['page'], rowLimit }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`searchanalytics ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return j.rows ?? [];
}

// รวมยอดต่อหน้า (บางหน้าคืนหลายแถวถ้าแบ่งตามประเทศ/อุปกรณ์ — เราไม่ขอ dimension อื่น แต่กันเหนือไว้)
function byPage(rows) {
  const m = new Map();
  for (const r of rows) {
    const p = String(r.keys?.[0] ?? '');
    if (!p) continue;
    const cur = m.get(p) ?? { clicks: 0, impressions: 0 };
    m.set(p, { clicks: cur.clicks + (r.clicks ?? 0), impressions: cur.impressions + (r.impressions ?? 0) });
  }
  return m;
}
export const norm = (u) => String(u).replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
const sum = (m) => [...m.values()].reduce((a, b) => ({ clicks: a.clicks + b.clicks, impressions: a.impressions + b.impressions }), { clicks: 0, impressions: 0 });

/** เทียบ sitemap กับสิ่งที่ Google เห็นจริง — pure (ไม่ยิงเน็ต) เพื่อให้เทสต์ได้
 *  cur/prev = Map<url, {clicks, impressions}> · sitemapUrls = Set<string>
 *  normalize ข้างในทั้งสามฝั่งเสมอ (http vs https · trailing slash) — เคยพังตรงนี้:
 *  เอา key ดิบไปเทียบกับชุดที่ normalize แล้ว = ทุกหน้ากลายเป็น orphan ร้องเตือนทุกคืน
 *  คืน { problems, dropped, orphans, unseen } — problems = อย่างที่ต้องแจ้งเตือน */
export function compareCoverage(sitemapUrls, curRaw, prevRaw) {
  const sitemap = new Set([...sitemapUrls].map(norm));
  const cur = new Map([...curRaw].map(([p, v]) => [norm(p), v]));
  const prev = new Map([...prevRaw].map(([p, v]) => [norm(p), v]));
  const problems = [];
  const dropped = [];
  for (const [p, v] of prev) {
    if (v.impressions > 0 && !(cur.get(p)?.impressions > 0)) {
      dropped.push(`${p} (เคย ${v.impressions} impressions → หายไป)`);
    }
  }
  if (dropped.length) problems.push(`หน้าที่เคยติด index หายไป ${dropped.length} หน้า: ${dropped.slice(0, 4).join(', ')}`);

  const orphans = [...cur.keys()].filter((p) => !sitemap.has(p));
  if (orphans.length) problems.push(`Google เข้ามา ${orphans.length} หน้าที่ไม่อยู่ใน sitemap: ${orphans.slice(0, 4).join(', ')}`);

  // หน้าใน sitemap ที่ยังไม่เคยมี impression = ข้อมูล ไม่ใช่ปัญหา (เว็บใหม่ = ปกติ) → ไม่ขึ้น problems
  const unseen = [...sitemap].filter((u) => !cur.has(u) && !prev.has(u));
  return { problems, dropped, orphans, unseen };
}

function finish(rec, message) {
  try {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(rec, null, 2) + '\n');
  } catch { /* soft */ }
  console.log(message);
  const problems = rec.problems ?? [];
  if (problems.length) {
    const text = [
      '⚠️ <b>GSC coverage ไม่ปกติ</b>',
      ...problems.slice(0, 10).map((p) => `• ${p}`),
      `clicks ${rec.current?.clicks ?? 0} · impressions ${rec.current?.impressions ?? 0} (28 วันล่าสุด)`,
      `<code>${new Date().toLocaleString('th-TH')}</code>`,
    ].join('\n');
    if (TEST) console.log(`[dry] ${text.replace(/<[^>]+>/g, '')}`);
    else notify(text).then((r) => console.log(r.ok ? 'แจ้ง Telegram แล้ว' : `ส่ง TG ไม่สำเร็จ: ${r.error}`)).catch(() => {});
  }
  process.exitCode = STRICT && problems.length ? 1 : 0;
}

async function main() {
  const env = readEnv();
  const win = windows();
  // ── 0) ยังไม่ได้ตั้งค่า = ข้ามแบบเงียบ (ยังไม่ได้ Verify บน GSC จึงยังไม่มีสิทธิ์ API) ──
  let token;
  try { token = await getAccessToken(env); } catch (e) { token = null; }
  if (!token) {
    console.log('gsc-coverage: ยังไม่ได้ตั้งค่า GSC credential — ข้าม (ใส่ GSC_CLIENT_ID/GSC_CLIENT_SECRET/GSC_REFRESH_TOKEN ใน sovereign-os/infra/.env)');
    return finish({ at: new Date().toISOString(), configured: false, ok: true, skipped: true, problems: [], window: win }, 'gsc-coverage: ข้าม (ยังไม่ได้ตั้งค่า)');
  }

  // ── 1) sitemap จริงจากโดเมน (แหล่งความจริงเดียวกับ seo-preflight) ──
  const sitemapUrls = new Set();
  try {
    const sm = await fetch(`https://${HOST}/sitemap.xml`, { signal: AbortSignal.timeout(20_000) });
    const text = await sm.text();
    for (const m of text.matchAll(/<loc>([^<]+)<\/loc>/g)) sitemapUrls.add(norm(m[1]));
  } catch (e) {
    return finish({ at: new Date().toISOString(), configured: true, ok: false, window: win, problems: [`ดึง sitemap ไม่ได้: ${e?.message ?? e}`] }, 'gsc-coverage: ดึง sitemap ไม่ได้');
  }

  // ── 2) ถาม GSC 2 หน้าต่าง (property เป็น domain → ลอง sc-domain ก่อน แล้วค่อย URL-prefix) ──
  const candidates = [env.GSC_SITE_URL, `sc-domain:${HOST}`, `https://${HOST}/`].filter(Boolean);
  let site = null, rows = [], prevRows = [], lastErr = null;
  for (const c of candidates) {
    try {
      rows = await query(token, c, { startDate: win.startDate, endDate: win.endDate });
      prevRows = await query(token, c, { startDate: win.prevStartDate, endDate: win.startDate });
      site = c;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!site) {
    // ยังไม่ Verify (หรือ credential ไม่มีสิทธิ์) = ยังตรวจไม่ได้ → ข้าม ไม่ใช่ปัญหา (แต่บอกให้เห็น)
    const msg = String(lastErr?.message ?? '');
    const notVerified = /403|404|not found|permission/i.test(msg);
    if (notVerified) {
      console.log(`gsc-coverage: GSC ยังไม่เข้าถึง property ได้ (${msg.slice(0, 120)}) — ข้ามรอบนี้ (ยังไม่ Verify / ยังไม่ได้ใส่ credential)`);
      return finish({ at: new Date().toISOString(), configured: true, ok: true, skipped: true, window: win, problems: [], note: msg.slice(0, 200) }, 'gsc-coverage: ข้าม (ยังเข้าถึง property ไม่ได้)');
    }
    return finish({ at: new Date().toISOString(), configured: true, ok: false, window: win, problems: [`เรียก GSC API ไม่สำเร็จ: ${msg.slice(0, 160)}`] }, 'gsc-coverage: API ล้ม');
  }

  const cur = byPage(rows);
  const prev = byPage(prevRows);
  const current = sum(cur);
  const previous = sum(prev);

  // ── 3) เทียบ ──
  const { problems, dropped, orphans, unseen } = compareCoverage(sitemapUrls, cur, prev);
  console.log(`  · property: ${site} · หน้าต่าง ${win.startDate}→${win.endDate} (เทียบก่อนหน้า ${win.prevStartDate}→${win.startDate})`);
  console.log(`  · clicks ${previous.clicks} → ${current.clicks} · impressions ${previous.impressions} → ${current.impressions}`);
  console.log(`  · sitemap ${sitemapUrls.size} หน้า · Google เห็น ${cur.size} หน้า · ยังไม่เคยมี impression ${unseen.length} หน้า (ปกติสำหรับเว็บใหม่)`);
  if (unseen.length) console.log(`    · ${unseen.slice(0, 12).join(', ')}`);

  return finish({
    at: new Date().toISOString(), configured: true, ok: problems.length === 0, skipped: false,
    site, window: win, sitemapUrls: sitemapUrls.size,
    current, previous,
    indexed: [...cur.keys()].map(norm),
    dropped, orphans, unseen,
    problems,
  }, `gsc-coverage: ${problems.length ? `มีปัญหา ${problems.length} จุด` : 'ผ่าน'} · ${cur.size}/${sitemapUrls.size} หน้า · clicks ${current.clicks} · impressions ${current.impressions}`);
}

// รันเฉพาะตอนเรียกตรง ๆ (ไม่ใช่ตอนถูก import ไปเทสต์)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
