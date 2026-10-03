#!/usr/bin/env node
/* seo-publish-audit — ตรวจว่า "หน้าสาธารณะทุกหน้าบนดิสก์" ถูกประกาศให้ถูกทางหรือยัง (3/10/69, แก้รอบ 4/10/69)
 *
 * ทำไมต้องมี: seo-preflight.mjs ตรวจจาก sitemap ไปข้างหน้า (URL ที่ประกาศต้องดี)
 * แต่ไม่ตรวจกลับ — ถ้าหน้าใดหน้าหนึ่ง "พร้อมประกาศ" แล้วหลุด sitemap หรือถูกทิ้งไว้เป็น noindex
 * จะไม่มีอะไรจับได้เลย (ไม่มี error ไม่มี warning · คนคิดว่าประกาศอยู่แล้ว)
 *
 * ── บั๊กที่เคยทำให้เครื่องมือนี้ "ผ่าน" ทั้งที่มีหน้าหลุด ──
 * รุ่นแรกอ่านรายการหน้าสาธารณะด้วย regex จากซอร์ส (.ts) แล้วคิดเฉพาะหน้าที่ "ประกาศ index"
 * ผลคือ หน้าที่ยังไม่ประกาศอะไรเลย (robots=none) หรือประกาศ noindex จะ **หายไปจากการตรวจ**
 * และถ้าซอร์สเปลี่ยนรูปแบบ regex จะได้ 0 รายการแบบเงียบ ๆ (ไม่ error)
 * เกิดขึ้นจริงกับ /partners/me — เรนเดอร์ได้โดยไม่ต้องล็อกอิน (auth-free) แต่ไม่อยู่ใน sitemap
 *   → คำสั่งของเจ้าของคือ "ตรวจทุกหน้าสาธารณะว่ามีอะไรพร้อมประกาศแต่ยังไม่ได้ใส่ใน sitemap
 *     หรือเป็น noindex อยู่" เครื่องมือรุ่นแรกตอบไม่ได้เลย
 *
 * ── หลักการที่แก้ให้ตรงคำสั่ง (อ่านก่อนแก้ไฟล์นี้) ──
 * 1) รายการหน้าสาธารณะ "import ของจริง" ไม่ใช่ regex — Node 24 ตัดชนิด TS ทิ้งให้เอง
 *    (publicAccess.ts เป็น TS ล้วนไม่มี React) → รูปแบบไฟล์เปลี่ยนเมื่อไร import พัง = ดักทันที
 *    และถ้าอ่านไม่ได้/ได้ array ว่าง/ชนิดผิด → throw ไม่ใช่รายงาน "ผ่าน"
 * 2) route มาจาก "เดินดิสก์ src/pages" เสมอ ไม่มีรายการ route ที่เขียนไว้เอง
 *    → หน้าใหม่ที่เพิ่งสร้างจะถูกตรวจโดยอัตโนมัติ ไม่ต้องไปแก้เครื่องมือ
 * 3) ทุก route บนดิสก์ต้องถูกจัดเข้ากอง**กองเดียวเสมอ** และเครื่องมือตรวจเองว่าครบทุกหน้า
 *    (sum(buckets) === routes) ถ้าไม่ครบ = throw ไม่ใช่เงียบ
 * 4) เกณฑ์ auth-free ใช้ "ไม่อ้าง useAuthStore" เป็น**ป้ายกำกับตอนพิมพ์รายงานเท่านั้น**
 *    ไม่มีวันใช้มันกรองข้อผิดพลาดออก — ถ้าหน้าสาธารณะใบใดไปเรียก useAuthStore
 *    ข้อ 1-3 ยังตรวจมันครบเหมือนกันทุกประการ
 *
 * กติกาที่ fail (--strict → exit 1):
 *   - หน้าที่ประกาศ index,follow แต่ไม่อยู่ใน sitemap  = "พร้อมประกาศแต่ไม่ถูกส่ง" (บั๊กรุ่นแรก)
 *   - หน้าที่อยู่ใน sitemap แต่เป็น noindex            = ขัดกันเอง ต้องเลือกอย่างใดอย่างหนึ่ง
 *   - URL ใน sitemap ที่ไม่มีไฟล์หน้าจริง             = รายการตาย
 *   - เครื่องมืออ่านรายการหน้าสาธารณะไม่ได้           = fail เสมอ แม้ไม่ใส่ --strict
 *
 * กติกาที่ "รายงาน" แต่ไม่ fail (เจ้าของต้องตัดสินใจเอง — แก้ต้องแตะโค้ดหน้า):
 *   - หน้า auth-free ที่ประกาศ noindex แล้วไม่อยู่ใน sitemap = ตั้งใจไม่ให้ Google (เช่น /partners/me)
 *   - หน้า auth-free ที่ไม่มี robots เลยและไม่อยู่ใน sitemap = ยังไม่เคยตัดสินใจ → อาจหลุด
 *     (--fail-candidates จะทำให้สองกองนี้กลายเป็น fail ด้วย ถ้าต้องการบังคับ)
 *
 * ใช้: node tools/verify/seo-publish-audit.mjs [--strict] [--fail-candidates] [--public-list <ไฟล์>]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PAGES = join(ROOT, 'sovereign-frontend', 'src', 'pages');
const ACCESS = join(ROOT, 'sovereign-frontend', 'src', 'lib', 'publicAccess.ts');

/** หน้าข้อผิดพลาดของ Next — ไม่ใช่เนื้อหาที่จะประกาศ จึงไม่ต้องตัดสินใจเรื่อง sitemap */
const SPECIAL_ROUTES = new Set(['/404', '/500']);

/** route ของไฟล์หน้า: src/pages/about.tsx → /about · src/pages/partners/guide.tsx → /partners/guide
 *  · src/pages/index.tsx → / · src/pages/terrain-demo/index.tsx → /terrain-demo */
export function routeOf(file, pagesDir = PAGES) {
  const rel = relative(pagesDir, file).replace(/\\/g, '/').replace(/\.tsx?$/, '');
  const trimmed = rel.replace(/(^|\/)index$/, '').replace(/\/+$/, '');
  return trimmed === '' ? '/' : '/' + trimmed;
}

/** หน้านี้ประกาศว่าจะเปิดให้ Google เข้ามาดูหรือไม่ (อ่านจากโค้ด ไม่เดา)
 *  - ใช้ <SeoHead> = ประกาศว่าเป็นหน้าสาธารณะ (ค่าเริ่มต้น index,follow)
 *  - มี noindex ทั้งแบบ meta ตรง ๆ และแบบส่ง prop ให้ SeoHead = ไม่ต้องประกาศ */
export function classify(src) {
  if (/content="noindex"/.test(src)) return 'noindex';
  if (/<SeoHead\b[\s\S]{0,600}?\bnoindex\b/.test(src)) return 'noindex';
  if (/content="index,follow"/.test(src)) return 'index';
  if (/<SeoHead\b/.test(src)) return 'index';
  return 'none';
}

/** หน้านี้เปิดดูได้โดยไม่ต้องล็อกอินไหม — ใช้เป็น**ป้ายกำกับตอนพิมพ์รายงาน**เท่านั้น
 *  หน้าที่ไม่อ้าง auth store = ไม่ได้อ่านสถานะล็อกอิน = ไม่อยู่หลังระบบ
 *  ⚠ ห้ามใช้ค่านี้กรองข้อผิดพลาดออก — เกณฑ์ข้อ 1-3 ตรวจทุกหน้าเท่ากันหมด */
export function isAuthFree(src) {
  return !/\buseAuthStore\b/.test(src);
}

/** อ่านรายการหน้าสาธารณะจาก**โมดูลจริง** (import) ไม่ใช่ regex
 *  throw เสมอถ้าอ่านไม่ได้/ไม่ใช่ array/ว่าง/ชนิดผิด/มี path ซ้ำ
 *  — เพราะการรายงาน "ผ่าน" จากรายการที่อ่านไม่ได้ แย่กว่าการไม่รู้เลย */
export async function loadPublicPaths(accessFile = ACCESS) {
  const where = relative(ROOT, accessFile) || accessFile;
  let mod;
  try {
    mod = await import(pathToFileURL(accessFile).href);
  } catch (err) {
    throw new Error(`อ่านรายการหน้าสาธารณะไม่ได้ — ${where}: ${err.message}`);
  }
  const list = mod?.PUBLIC_PATHS;
  if (!Array.isArray(list)) {
    throw new Error(`${where} ไม่ได้ export PUBLIC_PATHS เป็น array (ได้ ${list === undefined ? 'ไม่มี export' : typeof list}) — หยุดตรวจแทนที่จะรายงานผ่าน`);
  }
  if (list.length === 0) {
    throw new Error(`${where} export PUBLIC_PATHS ว่างเปล่า — หยุดตรวจแทนที่จะรายงาน "sitemap 0 URL ผ่าน"`);
  }
  const bad = list.filter((p) => typeof p?.path !== 'string' || !p.path.startsWith('/'));
  if (bad.length) {
    throw new Error(`${where} มี ${bad.length} รายการที่ path ไม่ใช่ข้อความที่ขึ้นต้นด้วย "/" (${JSON.stringify(bad[0])}) — รูปแบบเปลี่ยนไปหรือยัง`);
  }
  const paths = list.map((p) => p.path);
  const dup = paths.filter((p, i) => paths.indexOf(p) !== i);
  if (dup.length) throw new Error(`${where} มี path ซ้ำ: ${[...new Set(dup)].join(', ')}`);
  return paths;
}

/** เดินดิสก์ src/pages → ทุก route ที่ Next จะเสิร์ฟ (ไม่มีรายการ route ที่เขียนไว้เอง)
 *  คืน { routes, nonPageRoutes } — routes = ไฟล์ .tsx (หน้า), nonPageRoutes = .ts (เช่น sitemap.xml.ts) */
export function enumerateRoutes(pagesDir = PAGES) {
  const routes = [];
  const nonPageRoutes = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue; // _app/_document = ไม่ใช่ route
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const record = {
        route: routeOf(full, pagesDir),
        file: full,
        dynamic: /\[[^\]]+\]/.test(entry.name),
      };
      if (entry.name.endsWith('.tsx')) routes.push(record);
      else nonPageRoutes.push(record);
    }
  };
  walk(pagesDir);
  routes.sort((a, b) => a.route.localeCompare(b.route));
  nonPageRoutes.sort((a, b) => a.route.localeCompare(b.route));
  return { routes, nonPageRoutes };
}

/** ตรวจทั้งระบบ — คืน findings (ต้องแก้/ต้อง fail) + candidates (ต้องให้เจ้าของตัดสินใจ)
 *  ทุก route จะอยู่ใน buckets กองใดกองหนึ่งเสมอ (ตรวจสมบูรณ์ท้ายฟังก์ชัน) */
export async function audit({ pagesDir = PAGES, accessFile = ACCESS } = {}) {
  const sitemapPaths = await loadPublicPaths(accessFile); // throw ถ้าอ่านไม่ได้
  const sitemapSet = new Set(sitemapPaths);
  const { routes, nonPageRoutes } = enumerateRoutes(pagesDir);

  const findings = [];
  const candidates = [];
  const buckets = {
    announced: [],      // ประกาศใน sitemap + robots=index → ถูกต้อง
    noDirective: [],    // ประกาศใน sitemap แต่ไม่มี robots meta (default index → ใช้ได้ แต่ควรเขียนให้ชัด)
    contradiction: [],  // ประกาศใน sitemap แต่เป็น noindex → ขัดกัน
    missed: [],         // robots=index แต่ไม่อยู่ใน sitemap → บั๊กรุ่นแรก
    deliberate: [],     // auth-free + noindex + ไม่ประกาศ → ตั้งใจไม่ให้ Google
    undecided: [],      // auth-free + ไม่มี robots + ไม่ประกาศ → ยังไม่เคยตัดสินใจ
    internal: [],       // อยู่หลังระบบล็อกอิน → ไม่ต้องประกาศ
  };

  const seen = new Set();
  for (const entry of routes) {
    const src = readFileSync(entry.file, 'utf8');
    const robots = classify(src);
    const authFree = isAuthFree(src);
    const announced = sitemapSet.has(entry.route);
    const row = { route: entry.route, robots, authFree, file: relative(ROOT, entry.file) };

    if (SPECIAL_ROUTES.has(entry.route)) { buckets.internal.push({ ...row, why: 'หน้าข้อผิดพลาดของ Next' }); continue; }
    if (announced && robots === 'noindex') {
      findings.push(`${entry.route} อยู่ใน sitemap แต่หน้าเป็น noindex — ขัดกันเอง ต้องเลือกอย่างใดอย่างหนึ่ง (${row.file})`);
      buckets.contradiction.push(row); continue;
    }
    if (announced) {
      (robots === 'none' ? buckets.noDirective : buckets.announced).push(row); continue;
    }
    if (robots === 'index') {
      findings.push(`${entry.route} ประกาศ index,follow แต่ไม่อยู่ใน sitemap — Google จะไม่รู้จักหน้านี้เลย (${row.file})`);
      buckets.missed.push(row); continue;
    }
    if (robots === 'noindex') {
      candidates.push({ ...row, why: 'auth-free + noindex + ไม่อยู่ใน sitemap (ตั้งใจไม่ให้ index)' });
      buckets.deliberate.push(row); continue;
    }
    // robots = none
    if (authFree) {
      candidates.push({ ...row, why: 'auth-free + ไม่มี robots meta + ไม่อยู่ใน sitemap (ยังไม่เคยตัดสินใจ)' });
      buckets.undecided.push(row); continue;
    }
    buckets.internal.push({ ...row, why: 'อยู่หลังระบบล็อกอิน' });
  }

  // สมบูรณ์: ทุก route ต้องถูกจัดเข้ากอง ไม่มีหน้าไหนหายไปเงียบ ๆ
  const classified = Object.values(buckets).reduce((n, list) => n + list.length, 0);
  if (classified !== routes.length) {
    throw new Error(`ข้อมูลไม่ครบ: จัดเข้ากองได้ ${classified} หน้า แต่บนดิสก์มี ${routes.length} หน้า — หยุดตรวจ`);
  }

  // รายการตาย: URL ใน sitemap ที่ไม่มีไฟล์หน้าจริง
  const byRoute = new Map(routes.map((r) => [r.route, r]));
  for (const p of sitemapPaths) {
    if (!byRoute.has(p)) findings.push(`sitemap มี ${p} แต่ไม่มีไฟล์ src/pages${p === '/' ? '/index' : p}.tsx`);
  }

  return { sitemapPaths, routes, nonPageRoutes, byRoute, buckets, findings, candidates };
}

const names = (list) => list.map((r) => r.route).join(', ') || '—';

async function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const failCandidates = argv.includes('--fail-candidates');
  const listArg = argv.indexOf('--public-list');
  // resolve ไม่ใช่ join: ถ้าผู้ใช้ใส่พาธแบบสัมบูรณ์ (C:\... หรือ /abs) join จะเอาไปต่อท้าย cwd จนพาธพัง
  const accessFile = listArg >= 0 && argv[listArg + 1] ? resolve(process.cwd(), argv[listArg + 1]) : ACCESS;

  let report;
  try {
    report = await audit({ accessFile });
  } catch (err) {
    // ดักที่ชั้นนี้โดยเฉพาะ: เครื่องมืออ่านไม่ได้ = fail เสมอ แม้ไม่ใส่ --strict
    // เพราะการรายงาน "ผ่าน" ตอนที่ยังไม่ได้ตรวจอะไรเลย คือความล้มเหลวที่แย่กว่า error
    console.error(`✗ seo-publish-audit ตรวจไม่ได้: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const { sitemapPaths, routes, nonPageRoutes, buckets, findings, candidates } = report;
  console.log(`หน้าบนดิสก์: ${routes.length} route (${nonPageRoutes.length} ไฟล์ route ที่ไม่ใช่หน้า: ${names(nonPageRoutes.map((r) => ({ route: r.route })))})`);
  console.log(`sitemap (PUBLIC_PATHS): ${sitemapPaths.length} URL`);

  console.log(`\n— ประกาศแล้ว (${buckets.announced.length}) — ${names(buckets.announced)}`);
  if (buckets.noDirective.length) {
    console.log(`— ประกาศแล้วแต่ไม่มี robots meta (${buckets.noDirective.length}) — ${names(buckets.noDirective)} (default index,follow → ใช้ได้ แต่ควรเขียนให้ชัด)`);
  }
  console.log(`— อยู่หลังระบบล็อกอิน ไม่ต้องประกาศ (${buckets.internal.length})`);
  if (buckets.missed.length) console.log(`— ประกาศ index แต่หลุด sitemap (${buckets.missed.length}) — ${names(buckets.missed)}`);
  if (buckets.contradiction.length) console.log(`— อยู่ใน sitemap แต่เป็น noindex (${buckets.contradiction.length}) — ${names(buckets.contradiction)}`);

  console.log(`\nต้องให้เจ้าของตัดสินใจ (auth-free ที่ยังไม่ถูกประกาศ) — ${candidates.length} หน้า`);
  for (const c of candidates) console.log(`  ⚠ ${c.route} — ${c.why} (${c.file})`);

  for (const f of findings) console.log(`✗ ${f}`);
  const problems = findings.length + (failCandidates ? candidates.length : 0);
  console.log(
    `\nseo-publish-audit: ${problems ? `มีปัญหา ${problems} จุด` : 'ผ่าน'}` +
      `${candidates.length && !failCandidates ? ` (เตือน: หน้าที่รอตัดสินใจ ${candidates.length} หน้า — ดูด้านบน)` : ''}`,
  );
  process.exitCode = problems ? 1 : 0;
}

// รันเฉพาะตอนเรียกตรง ๆ (ไม่ใช่ตอนถูก import ไปเทสต์)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();