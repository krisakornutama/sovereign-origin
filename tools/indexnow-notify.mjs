#!/usr/bin/env node
/* indexnow-notify — ยิง IndexNow (Bing/Yandex/Seznam/Naver) ให้บอทมา crawl หน้าเว็บใหม่ทันที
   ที่มา: STATUS รอบ 2026-09-15 — เผยแพร่แล้วแต่ลืมส่ง IndexNow ทีหลัง (ต้องยิงมือ curl)
   ใช้: node tools/indexnow-notify.mjs [--wait] [--expect-sha=<sha>] [--verify-file=<rel>] [--dry-run] [--strict]
   --wait          = รอให้ production เปลี่ยนตามที่ push จริงก่อนแล้วค่อยส่ง (ไม่ยิงก่อน deploy เสร็จ)
   --expect-sha=   = sha ของ publish repo ที่เพิ่ง push (publish script ส่งมาให้)
   --verify-file=  = ไฟล์ที่เปลี่ยน (เทียบเนื้อหาบนเว็บกับในเครื่อง = หลักฐานตรง ไม่ต้องใช้ API) ใส่ซ้ำได้
   --dry-run       = ตรวจ+พิมพ์สิ่งที่จะส่ง โดยไม่ยิงจริง (ไว้ทดสอบ)
   --strict        = ส่งไม่สำเร็จให้ exit 1 (ดีฟอลต์ = exit 0 เสมอ — งานหลักต้องไม่ล้มตาม)
   หมายเหตุ: ใช้ fetch ของ Node เองทั้งหมด — ไม่พึ่ง curl/gh (ของแบบนั้นล้มต่าง environment) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE_DIR = path.join(ROOT, 'portfolio');
const args = process.argv.slice(2);
const WAIT = args.includes('--wait');
const DRY = args.includes('--dry-run');
const STRICT = args.includes('--strict');
const EXPECT_SHA = (args.find((a) => a.startsWith('--expect-sha=')) || '').slice('--expect-sha='.length).trim();
const VERIFY_FILES = args.filter((a) => a.startsWith('--verify-file=')).map((a) => a.slice('--verify-file='.length).trim()).filter(Boolean);
/* ค่าพวกนี้เป็นดีฟอลต์ของ production — override ได้ทาง env เฉพาะตอนเทสต์ (tools/test/hook-contract.test.mjs)
   ไม่มี env ไหนถูกตั้งเองในเส้นทาง publish จริง */
const POLL_MS = Number(process.env.INDEXNOW_POLL_MS || 15000);
const POLLS = Number(process.env.INDEXNOW_POLLS || 20); // ~5 นาที

const HOST = process.env.INDEXNOW_HOST || 'krisakornutama.github.io';
const REPO = process.env.INDEXNOW_REPO || 'krisakornutama/project-sovereign';
const BASE = process.env.INDEXNOW_BASE || `https://${HOST}/project-sovereign`;
const ENDPOINT = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow/'; // ส่งที่นี่ = ไปถึง Bing/Yandex/Seznam/Naver ทุกตัว

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const log = (s) => console.log(s);
const norm = (s) => s.replace(/\r\n/g, '\n').trim();

/* ประวัติทุกรอบลงไฟล์ท้ายโปรเจกต์ (gitignore *.log อยู่แล้ว) — ล้มได้ ต้องไม่ทำตัวยิงพัง */
const LOG_FILE = path.join(ROOT, 'publish-indexnow.log');
function note(kind, fields) {
  try {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const pairs = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, ' ')}`)
      .join(' ');
    fs.appendFileSync(LOG_FILE, `${ts}  ${kind.padEnd(14)} ${pairs}\n`);
  } catch { /* เขียน log ไม่ได้ = ไม่สำคัญพอให้งานล้ม */ }
}

/* ล้มแบบไม่ลากงานหลัก: ดีฟอลต์ exit 0 (IndexNow ล้ม = เสียโอกาสให้บอทมาเร็ว ไม่ใช่ publish พัง) */
function fail(msg) {
  note('indexnow-fail', { sha: EXPECT_SHA || '-', why: msg });
  console.error(`✗ indexnow: ${msg}`);
  process.exit(STRICT ? 1 : 0);
}

/* คีย์ — อ่านจากไฟล์จริงใน portfolio/ (ไฟล์นี้ถูก publish ขึ้นเว็บ = หลักฐานความเป็นเจ้าของ) */
function loadKey() {
  const f = fs.readdirSync(SITE_DIR).find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
  if (!f) return null;
  const body = fs.readFileSync(path.join(SITE_DIR, f), 'utf8').trim();
  const stem = f.slice(0, -4);
  return body === stem ? { key: stem, file: f } : null; // เนื้อหาไฟล์ต้อง = ชื่อไฟล์ ตามกติกา IndexNow
}

/* รายการ URL — ไฟล์ .html ทั้งหมดใน portfolio/ + og.png (ห้ามเดา: ให้ไฟล์จริงเป็นตัวตัดสิน)
   index.html → BASE/ (canonical ราก), ที่เหลือ → BASE/ชื่อไฟล์ */
function collectUrls() {
  const files = fs.readdirSync(SITE_DIR).filter((n) => n.endsWith('.html') || n === 'og.png');
  if (!files.includes('index.html')) return [];
  return files.sort().map((f) => (f === 'index.html' ? `${BASE}/` : `${BASE}/${f}`));
}

async function getJson(url, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sovereign-indexnow-notify' },
      signal: ac.signal,
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
  finally { clearTimeout(t); }
}

/* สถานะ deploy ของ sha ที่เพิ่ง push — 'ready' = Pages ขึ้นจริง, 'pending' = กำลังสร้าง,
   'absent' = ยังไม่เห็น, null = ถาม API ไม่ได้ (repo สาธารณะไม่ต้องมี token) */
async function deployState(expectSha) {
  const deps = await getJson(`https://api.github.com/repos/${REPO}/deployments?per_page=5`);
  if (!Array.isArray(deps)) return null;
  const dep = deps.find((d) => (d.sha || '').startsWith(expectSha));
  if (!dep) return 'absent';
  const st = await getJson(`https://api.github.com/repos/${REPO}/deployments/${dep.id}/statuses?per_page=1`);
  const state = Array.isArray(st) ? st[0]?.state : undefined;
  return state === 'success' ? 'ready' : state || 'pending';
}

const found = loadKey();
if (!found) fail('ไม่เจอไฟล์คีย์ IndexNow (32 hex .txt ที่เนื้อหา = ชื่อไฟล์) ใน portfolio/');
const urls = collectUrls();
if (!urls.length) fail('portfolio/ ไม่มี index.html — ไม่รู้จะส่งอะไร');

/* production เสิร์ฟเนื้อหาชุดเดียวกับที่ push แล้วหรือยัง — เทียบ byte กับไฟล์ในเครื่อง (ข้ามแคชด้วย query) */
async function servedMatches(rel, cb) {
  let local;
  try { local = norm(fs.readFileSync(path.join(SITE_DIR, rel)).toString()); } catch { return false; }
  try {
    const res = await fetch(`${BASE}/${rel}${cb ? `?cb=${cb}` : ''}`, {
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'sovereign-indexnow-notify' },
      signal: AbortSignal.timeout(15000),
    });
    return res.ok && norm(await res.text()) === local;
  } catch { return false; }
}

/* พร้อมยิงหรือยัง — หลักฐาน 2 ทาง:
   (ก) เนื้อหาไฟล์ที่เปลี่ยนบนเว็บตรงกับในเครื่อง = ตัวตัดสินหลัก (ไม่ต้องใช้ API)
   (ข) GitHub Pages deployment ของ sha นั้น state=success = ทางลัด · API ล่ม/ไม่ตอบ = ยังไม่ถือว่าพร้อม (ลองใหม่) */
async function checkProduction(cb, withApi) {
  const parts = [];
  let ok = false;
  if (withApi && EXPECT_SHA) {
    const state = await deployState(EXPECT_SHA);
    parts.push(`deploy ${state === null ? 'API ไม่ตอบ' : state}`);
    if (state === 'ready') ok = true;
  }
  if (VERIFY_FILES.length) {
    let pass = 0;
    for (const f of VERIFY_FILES) if (await servedMatches(f, cb)) pass++;
    parts.push(`เนื้อหา ${pass}/${VERIFY_FILES.length}`);
    if (pass === VERIFY_FILES.length) ok = true;
  }
  return { ok, note: parts.join(' · ') };
}

/* --wait: ห้ามยิงก่อน production เปลี่ยนตามที่ push — รอวนซ้ำจนพร้อม (สูงสุด ~5 นาที)
   ประวัติ: รอบแรกของสคริปต์นี้เลิกรอทันทีเมื่อ API ตอบไม่ได้ (null) → ยิงก่อน deploy เสร็จ = แก้ที่ต้นเหตุแล้ว */
if (WAIT && (EXPECT_SHA || VERIFY_FILES.length)) {
  const cb = EXPECT_SHA || String(Date.now());
  let r = await checkProduction(cb, true);
  if (!r.ok) {
    log(`indexnow: รอ production ตามที่ push (${cb}) — ${r.note}`);
    for (let i = 0; i < POLLS && !r.ok; i++) {
      sleep(POLL_MS);
      r = await checkProduction(cb, i % 2 === 1); // ถาม API วันเว้นรอบ กันชน rate limit
      if (!r.ok) process.stdout.write('.');
    }
    log(r.ok ? `\nindexnow: ✓ production ตรงแล้ว (${r.note})`
      : `\nindexnow: ⏱ ยังไม่ตรงใน ${(POLLS * POLL_MS) / 60000} นาที (${r.note}) — ส่งต่อ (IndexNow แค่เข้าคิวให้บอทมาภายหลัง)`);
  } else {
    log(`indexnow: ✓ production ตรงอยู่แล้ว (${r.note})`);
  }
  note('deploy-check', { sha: cb, result: r.ok ? 'ready' : 'timeout', detail: r.note });
} else if (WAIT) {
  log('indexnow: ไม่มี --expect-sha/--verify-file — ไม่มีอะไรให้รอ');
}

const payload = JSON.stringify({
  host: HOST,
  key: found.key,
  keyLocation: `${BASE}/${found.file}`,
  urlList: urls,
});

if (DRY) {
  note('indexnow-dry', { urls: urls.length, key: found.file });
  log(`indexnow: dry-run — จะส่ง ${urls.length} URL ไป ${ENDPOINT}`);
  log(`indexnow: คีย์ ${found.file} · host ${HOST} · keyLocation ${BASE}/${found.file}`);
  urls.forEach((u, i) => log(`indexnow:   ${String(i + 1).padStart(2, '0')}. ${u}`));
  process.exit(0);
}

const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 20000);
let status = 0;
try {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: payload,
    signal: ac.signal,
  });
  status = res.status;
} catch (e) {
  fail(`ส่งไม่สำเร็จ: ${e.name === 'AbortError' ? 'หมดเวลา 20 วิ' : (e.message || e)}`);
} finally { clearTimeout(timer); }

if (status === 200 || status === 202) {
  note('indexnow', { http: status, urls: urls.length, sha: EXPECT_SHA || '-', key: found.file });
  log(`indexnow: ✓ HTTP ${status} — ส่ง ${urls.length} URL ให้ Bing/Yandex/Seznam/Naver (คีย์ ${found.file})`);
  log('indexnow: ' + urls.slice(0, 3).join(' ') + (urls.length > 3 ? ` … +${urls.length - 3}` : ''));
  log(`indexnow: ประวัติ → ${path.relative(ROOT, LOG_FILE)}`);
} else if (status === 429) {
  fail('HTTP 429 — ยิงถี่เกิน (IndexNow จำกัดความถี่) ข้ามได้ บอทจะวนมาเอง');
} else {
  fail(`HTTP ${status || 'no-response'} — ส่งไม่สำเร็จ (ไม่กระทบการ publish)`);
}
