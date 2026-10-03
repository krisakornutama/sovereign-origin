#!/usr/bin/env node
/* seo-publish-audit — ตรวจว่า "หน้าที่ประกาศว่าจะเปิดให้ index" ตรงกับ sitemap จริงหรือไม่ (3/10/69)
 *
 * เหตุผลที่ต้องมี: seo-preflight.mjs ตรวจจาก sitemap ไปข้างหน้า (URL ที่ประกาศต้องดี)
 * แต่ไม่ตรวจกลับ — ถ้าหน้าใดหน้าหนึ่งประกาศในโค้ดว่า index,follow แล้วหลุด sitemap
 * จะไม่มีอะไรจับได้เลย (ไม่มี error, ไม่มี warning · คนคิดว่าประกาศอยู่แล้ว)
 * เคยเจอกรณีจริง: /partners/me เป็น noindex ถูกต้อง แต่ถ้าวันหนึ่งมีคนสลับ flag ผิด
 * หรือเพิ่มหน้าใหม่แล้วลืมใส่ sitemap → ต้องมีคนจับ
 *
 * ตรวจจากโค้ด (ไม่ต้องรอ build) — เร็วและจับได้ตั้งแต่ก่อน merge:
 *   1) ทุกหน้าที่ประกาศ index,follow ในโค้ด ต้องอยู่ใน PUBLIC_PATHS (รายการกลาง)
 *   2) ทุก URL ใน sitemap ต้องมีไฟล์หน้าจริงใน src/pages (กันรายการตาย)
 *   3) หน้าที่เป็น noindex ต้องไม่อยู่ใน sitemap (ข้อนี้ preflight เช็คจากของจริงอยู่แล้ว
 *      รายการนี้ทำซ้ำในเชิง "โค้ด" เพื่อจับก่อนขึ้น production)
 *
 * ใช้: node tools/verify/seo-publish-audit.mjs [--strict]
 * ผล: exit 0 ถ้าไม่มีปัญหา (--strict แล้ว exit 1 เมื่อมีปัญหา)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PAGES = join(ROOT, 'sovereign-frontend', 'src', 'pages');
const ACCESS = join(ROOT, 'sovereign-frontend', 'src', 'lib', 'publicAccess.ts');
const STRICT = process.argv.includes('--strict');

/** route ของไฟล์หน้า: src/pages/about.tsx → /about · src/pages/partners/guide.tsx → /partners/guide */
function routeOf(file) {
  const rel = relative(PAGES, file).replace(/\\/g, '/').replace(/\.tsx?$/, '');
  const base = rel === 'index' ? '/' : '/' + rel;
  return base.replace(/\/+$/, '') || '/';
}

/** หน้านี้ประกาศว่าจะเปิดให้ Google เข้ามาดูหรือไม่ (อ่านจากโค้ด ไม่เดา)
 *  - ใช้ &lt;SeoHead&gt; = ประกาศว่าเป็นหน้าสาธารณะ (ค่าเริ่มต้น index,follow)
 *  - มี noindex ทั้งแบบ meta ตรง ๆ และแบบส่ง prop ให้ SeoHead = ไม่ต้องประกาศ */
export function classify(src) {
  if (/content="noindex"/.test(src)) return 'noindex';
  if (/<SeoHead\b[\s\S]{0,600}?\bnoindex\b/.test(src)) return 'noindex';
  if (/content="index,follow"/.test(src)) return 'index';
  if (/<SeoHead\b/.test(src)) return 'index';
  return 'none';
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.tsx$/.test(name) && !/^_/.test(name)) out.push(f);
  }
  return out;
}

/** สแกนจริง — แยกเป็นฟังก์ชันเพื่อให้เทสต์เรียก classify() ได้โดยไม่ต้องรันทั้งสแกน */
export function audit() {
  const found = [];
  const accessSrc = readFileSync(ACCESS, 'utf8');
  const sitemapPaths = [...accessSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  if (!sitemapPaths.length) found.push(`อ่าน PUBLIC_PATHS จาก ${relative(ROOT, ACCESS)} ไม่ได้`);

  const pages = walk(PAGES);
  const byRoute = new Map(pages.map((f) => [routeOf(f), f]));
  return { sitemapPaths, pages, byRoute, found };
}

function main() {
  const { sitemapPaths, pages, byRoute, found } = audit();

  // ── 1) หน้าที่ประกาศ index,follow ในโค้ด แต่ไม่อยู่ใน sitemap ──
  const declared = [];
  for (const file of pages) {
    const route = routeOf(file);
    const kind = classify(readFileSync(file, 'utf8'));
    if (kind === 'noindex') {
      if (sitemapPaths.includes(route)) found.push(`${route} = noindex แต่อยู่ใน sitemap (ต้องเลือกอย่างใดอย่างหนึ่ง)`);
      continue;
    }
    if (kind !== 'index') continue;
    declared.push(route);
    if (!sitemapPaths.includes(route)) {
      found.push(`${route} ประกาศ index แต่ไม่อยู่ใน sitemap — จะไม่ถูกส่งให้ Google เลย (${relative(ROOT, file)})`);
    }
  }

  // ── 2) URL ใน sitemap ที่ไม่มีไฟล์หน้าจริง ──
  for (const p of sitemapPaths) {
    if (!byRoute.has(p)) found.push(`sitemap มี ${p} แต่ไม่มีไฟล์ src/pages${p === '/' ? '/index' : p}.tsx`);
  }

  console.log(`ประกาศในโค้ด (index): ${declared.length} หน้า — ${declared.sort().join(', ')}`);
  console.log(`sitemap (PUBLIC_PATHS): ${sitemapPaths.length} URL`);
  for (const p of found) console.log(`✗ ${p}`);
  console.log(`seo-publish-audit: ${found.length ? `มีปัญหา ${found.length} จุด` : 'ผ่าน'}`);
  process.exitCode = STRICT && found.length ? 1 : 0;
}

// รันเฉพาะตอนเรียกตรง ๆ (ไม่ใช่ตอนถูก import ไปเทสต์)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();