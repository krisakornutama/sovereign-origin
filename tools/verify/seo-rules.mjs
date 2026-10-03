// ─────────────────────────────────────────────────────────────────────────────
// seo-rules — "กติกา" ทั้งหมดของ seo-publish-audit แยกเป็นโมดูลที่ไม่มี I/O
//
// ── ทำไมต้องแยก ──
// ไฟล์เดิมทำ 5 อย่างพร้อมกัน: อ่านไฟล์ · import โมดูลจริง · เดิน src/pages · ตัดสิน robots · พิมพ์รายงาน
// ส่วนที่เปลี่ยนบ่อยและพังง่ายที่สุดคือ "อ่านซอร์สหน้าแล้วรู้ว่าประกาศ index หรือ noindex"
// ถ้ามันปนอยู่กับการอ่านดิสก์ บั๊กแบบที่เคยเกิดจริง (จับคำว่า noindex ที่อยู่ในคอมเมนต์) จะหาเจอก็ต่อเมื่อ
// รันเครื่องมือทั้งตัวบนโค้ดจริง — ย้ายออกมาแล้วทดสอบด้วยสตริงสั้น ๆ ในไฟล์เดียว โดยผลกับเครื่องมือเดิมทุกประการ
//
// ── ข้อตกลงของไฟล์นี้ (อ่านก่อนแก้) ──
// 1) ไม่แตะดิสก์ ไม่แตะ process — ห้าม node:fs · readFileSync · readdirSync · console · process.exitCode
//    ทุกฟังก์ชันรับข้อมูลเข้าแล้วคืนคำตอบล้วน ๆ (หรือ throw เมื่อ "ข้อมูลไม่ครบ" = บอกไม่ได้ ซึ่งถูกกว่าเดา)
//    ข้อยกเว้นเดียว: `relative` จาก node:path เป็นฟังก์ชันจัดการสตริงล้วน ไม่แตะดิสก์
// 2) คอมเมนต์ที่อธิบายว่า **"รูปแบบไหนแปลว่าเครื่องมือบอกไม่ได้"** ต้องอยู่ที่นี่ ไม่ใช่ที่ผู้เรียก
//    เพราะเหตุผลพวกนั้นเป็นเหตุผลของ "กติกา" ไม่ใช่ของ "วิธีอ่านไฟล์" — ย้ายไปกับตัวเรียกแล้วหายตอนคนมาแก้
// 3) เพิ่มกติกาใหม่ในไฟล์นี้ = ต้องเพิ่มเทสต์ใน tools/test/seo-publish-audit.test.mjs พร้อมกันเสมอ
//    กติกาไหนไม่มีเทสต์คุม = พังเงียบ ๆ ตอนคนแก้ ซึ่งคือบั๊กชนิดเดียวกับที่เคยเกิด
//
// ── หลักการเดียวที่ใช้ตัดสินทุกกรณีที่ "อ่านไม่ออก" ──
// เครื่องมือนี้มีหน้าที่จับหน้าที่ **หายไปเงียบ ๆ** ฉะนั้นเมื่อไม่แน่ใจว่าหน้าประกาศ noindex หรือไม่
// ให้ตอบว่า "ไม่ใช่ noindex" เสมอ เพราะผลคือหน้าถูกจับเป็นข้อผิดพลาดที่ **ดัง** (exit 1) ให้คนไปแก้
// ถ้าเดาว่าเป็น noindex แทน หน้านั้นจะถูกยกเป็น "ตัดสินใจไม่ประกาศแล้ว" แล้วหายไปจากสายตาของเจ้าของ
// ซึ่งเป็นบั๊กชนิดเดียวกับที่ regex 600 ตัวอักษรเคยทำ — ดัง ๆ ช้า ๆ แต่เงียบ ๆ แย่กว่า
// ─────────────────────────────────────────────────────────────────────────────
import { relative } from 'node:path';

/** หน้าข้อผิดพลาดของ Next — ไม่ใช่เนื้อหาที่จะประกาศ จึงไม่ต้องตัดสินใจเรื่อง sitemap */
export const SPECIAL_ROUTES = new Set(['/404', '/500']);

/** route ของไฟล์หน้า: src/pages/about.tsx → /about · src/pages/partners/guide.tsx → /partners/guide
 *  · src/pages/index.tsx → / / · src/pages/terrain-demo/index.tsx → /terrain-demo */
export function routeOf(file, pagesDir) {
  const rel = relative(pagesDir, file).replace(/\\/g, '/').replace(/\.tsx?$/, '');
  const trimmed = rel.replace(/(^|\/)index$/, '').replace(/\/+$/, '');
  return trimmed === '' ? '/' : '/' + trimmed;
}

/** ตัดคอมเมนต์ออกก่อนอ่าน — ไม่งั้น “คำว่า noindex ในคอมเมนต์” จะถูกมองเป็นโค้ดจริง
 *  `//` นับเป็นคอมเมนต์เฉพาะที่ไม่ได้ตามด้วย `:` (กัน URL อย่าง https:// ถูกตัดทิ้ง) */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** attribute string ของทุกเปิดแท็ก JSX ที่ชื่อนี้ — จบที่ `>` แรกที่ไม่อยู่ใน quote
 *  (จำเป็น: title="a > b" ต้องไม่ตัดแท็กกลางคัน) */
function openTags(src, name) {
  return [...src.matchAll(new RegExp(`<${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g'))].map((m) => m[1]);
}

/** attribute string ของ <SeoHead> นี้ “สั่งให้ไม่ประกาศจริง” ไหม — ไม่ใช่แค่ “มีชื่อแอตทริบิวต์ว่า noindex”
 *
 * เชื่อได้เฉพาะค่าที่ยืนยันว่าเปิดจริง:
 *   noindex            → boolean เปล่า = true            (หน้าจริง 3 หน้าใช้แบบนี้)
 *   noindex={true}     → true
 *   noindex={false}    → false = เจ้าของสั่งให้เปิดให้ Google เข้า → ไม่ใช่ noindex
 *   noindex={นิพจน์อื่น}  → เครื่องมืออ่านค่าไม่ได้ = ไม่ใช่หลักฐาน → ไม่นับเป็น noindex
 *
 * บั๊กที่แก้รอบนี้ (4/10/69): รุ่นก่อนใช้แค่ /(^|\s)noindex(\s|=|\/|$)/ ซึ่งจับ `noindex={false}`
 * ได้ด้วย → หน้าที่เจ้าของ**สั่งให้ประกาศ** ถูกยกเป็น “ตัดสินใจไม่ประกาศแล้ว” เงียบ ๆ
 * ทิศทางผิดตรงข้ามกับเจตนาของเครื่องมือ (จับหน้าที่หาย) และเป็นบั๊กชนิดเดียวกับที่ regex 600 ตัวอักษรเคยทำ
 * (ปัจจุบันยังไม่มีหน้าไหนเขียน `noindex={false}` — ตรวจแล้วทั้ง src/pages · กติกานี้กันไว้ก่อนใครเขียน) */
function declaresNoindex(attrs) {
  const at = attrs.match(/(^|\s)noindex(?=\s|=|\/|$)/);
  if (!at) return false;
  const value = /^\s*=\s*(\{[^{}]*\}|[^\s/>]+)/.exec(attrs.slice(at.index + at[0].length));
  if (!value) return true;                                  // noindex ลอย ๆ = true
  const raw = value[1]                                       // ถอด {...} ของ JSX แล้วถอด quote ของ string
    .replace(/^\{(.*)\}$/s, '$1').replace(/^(['"])(.*)\1$/s, '$2').trim();
  return raw === '' || raw === 'true';                       // {false} · {นิพจน์อื่น} → ไม่ใช่ noindex
}

/** หน้านี้ประกาศว่าจะเปิดให้ Google เข้ามาดูหรือไม่ (อ่านจากโค้ด ไม่เดา)
 *
 * กติกา: อ่าน **แอตทริบิวต์ของแท็กจริง** ไม่ใช่ “มีคำว่า noindex อยู่ใกล้ ๆ”
 * มีแค่สองทางที่ noindex ไปถึงหน้าจริง (ดู SeoHead.tsx):
 *   ① <SeoHead ... noindex />            → prop ในเปิดแท็ก (ต้องเป็นค่าจริง ดู declaresNoindex)
 *   ② <meta name="robots" content="noindex" />  (ใช้ตรง ๆ เช่น partners/me)
 *
 * บั๊กที่เคยเกิด (4/10/69): รุ่นก่อนใช้ /<SeoHead\b[\s\S]{0,600}?\bnoindex\b/
 * ซึ่งจับคำในคอมเมนต์ได้ → หน้าที่ใช้ index จริงถูกอ่านว่า noindex = หน้าหายจากการพิจารณา
 * โดยไม่มีเหตุผล ซึ่งเป็นบั๊กชนิดเดียวกับที่เครื่องมือนี้ถูกรีบเขียนใหม่เพื่อแก้
 *
 * เคสไหนที่ยังทำให้สงสัยว่า "รูปแบบนี้แปลว่าเครื่องมือบอกไม่ได้" (รู้ไว้ ไม่ปิดบัง ไม่แก้รอบนี้):
 *   - content ที่มีเว้นวรรคนำหน้า แก้แล้ว (เดิมอ่านเป็น none = หน้าหลุดเงียบ)
 *   - คอมเมนต์ /* ที่ไม่ปิดท้าย → stripComments เก็บไปจนถึง /* ถัดไป หรือท้ายไฟล์
 *     = กินโค้ดทั้งท้ายไฟล์ · เป็นปัญหาของไฟล์ (lint) ไม่ใช่การตัดสินผิดของหน้าที่เขียนถูก
 *     ถ้าวันหนึ่งอยากให้จับ ให้แก้ที่ stripComments และเพิ่มเทสต์พร้อมกัน
 *   - ถ้าหน้าไหนส่ง props แบบ spread (`<SeoHead {...SEO} />`) และซ่อน noindex
 *     ไว้ในอ็อบเจกต์ เครื่องมือนี้มองไม่เห็น — ปัจจุบันไม่มีหน้าไหนเขียนแบบนั้น (ตรวจแล้ว 4 จุด)
 *     ถ้าวันหนึ่งมี ให้เขียน noindex ตรง ๆ แทน จะได้ไม่หลุด */
export function classify(src) {
  const code = stripComments(src);
  const seoTags = openTags(code, 'SeoHead');
  const metaTags = openTags(code, 'meta');
  const isRobots = (t) => /\bname\s*=\s*["']robots["']/.test(t);
  // \s* หลัง quote: content=" noindex, nofollow" คือรูปแบบที่เขียนกันปกติ (เว้นวรรคหลังเครื่องหมายคำพูด)
  // เดิมบังคับให้ไม่มีช่องว่าง → อ่านเป็น none = หน้าที่สั่ง noindex หายไปจากการพิจารณาแบบเงียบ ๆ
  if (seoTags.some(declaresNoindex)) return 'noindex';
  if (metaTags.some((t) => isRobots(t) && /\bcontent\s*=\s*["']\s*noindex/.test(t))) return 'noindex';
  if (metaTags.some((t) => isRobots(t) && /\bcontent\s*=\s*["']\s*index/.test(t))) return 'index';
  if (seoTags.length) return 'index';
  return 'none';
}

/** หน้านี้เปิดดูได้โดยไม่ต้องล็อกอินไหม — ใช้เป็น**ป้ายกำกับตอนพิมพ์รายงาน**เท่านั้น
 *  หน้าที่ไม่อ้าง auth store = ไม่ได้อ่านสถานะล็อกอิน = ไม่อยู่หลังระบบ
 *  ⚠ ห้ามใช้ค่านี้กรองข้อผิดพลาดออก — เกณฑ์ข้อ 1-3 ตรวจทุกหน้าเท่ากันหมด */
export function isAuthFree(src) {
  return !/\buseAuthStore\b/.test(src);
}

/** หน้านี้อยู่ในกองไหน + ต้องรายงานอะไร — ตัดสินจากข้อเท็จจริงที่ผู้เรียกเก็บมาให้ทั้งหมด
 *
 * คืน { bucket, bucketRow, finding?, candidate?, excluded? }
 *   - bucket    = กองที่หน้านี้ต้องอยู่ (ครบทุกหน้าเสมอ ไม่มีหน้าไหนหลุดเงียบ)
 *   - bucketRow = แถวที่เก็บลงกอง (บางกองมี `why` บางกองไม่มี = คงเดิมทุกตัวอักษร)
 *   - finding   = ข้อผิดพลาดที่ต้องแก้ (exit 1)
 *   - candidate = หน้าที่ **ยังไม่เคยตัดสินใจ** → ต้องให้เจ้าของตัดสินใจ
 *   - excluded  = หน้าที่ **ตัดสินใจแล้วว่าไม่ประกาศ** → ไม่ใช่งานค้าง
 * หน้าเดียวจะได้ finding เป็น null เสมอถ้าไม่ใช่ปัญหา (ไม่ throw ที่นี่ · ผู้เรียกเป็นคน push ลงกอง) */
export function classifyRoute({ route, robots, authFree, announced, file }) {
  const row = { route, robots, authFree, file };

  if (SPECIAL_ROUTES.has(route)) {
    return { bucket: 'internal', bucketRow: { ...row, why: 'หน้าข้อผิดพลาดของ Next' } };
  }
  if (announced && robots === 'noindex') {
    return {
      bucket: 'contradiction',
      bucketRow: row,
      finding: `${route} อยู่ใน sitemap แต่หน้าเป็น noindex — ขัดกันเอง ต้องเลือกอย่างใดอย่างหนึ่ง (${file})`,
    };
  }
  if (announced) {
    return { bucket: robots === 'none' ? 'noDirective' : 'announced', bucketRow: row };
  }
  if (robots === 'index') {
    return {
      bucket: 'missed',
      bucketRow: row,
      finding: `${route} ประกาศ index,follow แต่ไม่อยู่ใน sitemap — Google จะไม่รู้จักหน้านี้เลย (${file})`,
    };
  }
  if (robots === 'noindex') {
    // noindex = “ตัดสินใจแล้วว่าไม่ประกาศ” ไม่ใช่ “ยังไม่ตัดสินใจ”
    // (แยกสองอย่างนี้ออกจากกัน 4/10/69 — ก่อนหน้านี้หน้าที่สั่งไม่ประกาศอย่างชัดเจน
    //  ถูกนับปนกับหน้าที่ยังไม่เคยตัดสินใจ ทำให้เจ้าของเห็นงานค้างที่ไม่มีจริง)
    return {
      bucket: 'deliberate',
      bucketRow: row,
      excluded: { ...row, why: 'ประกาศ noindex ไว้อย่างชัดเจน = ตัดสินใจไม่ประกาศแล้ว' },
    };
  }
  // robots = none
  if (authFree) {
    return {
      bucket: 'undecided',
      bucketRow: row,
      candidate: { ...row, why: 'auth-free + ไม่มี robots meta + ไม่อยู่ใน sitemap (ยังไม่เคยตัดสินใจ)' },
    };
  }
  return { bucket: 'internal', bucketRow: { ...row, why: 'อยู่หลังระบบล็อกอิน' } };
}

/** รายการตาย: URL ใน sitemap ที่ไม่มีไฟล์หน้าจริง (ประกาศไว้แต่ 404 = เสียคะแนนเปล่า)
 *  คืนรายการข้อความ error (ว่าง = ไม่มี) */
export function findDeadPaths(sitemapPaths, routes) {
  const byRoute = new Set(routes.map((r) => r.route));
  return sitemapPaths
    .filter((p) => !byRoute.has(p))
    .map((p) => `sitemap มี ${p} แต่ไม่มีไฟล์ src/pages${p === '/' ? '/index' : p}.tsx`);
}

/** สมบูรณ์: ทุก route ต้องถูกจัดเข้ากอง ไม่มีหน้าไหนหายไปเงียบ ๆ
 *  ไม่ครบ = บอกไม่ได้ → throw (ไม่ใช่รายงานผ่าน) */
export function assertAllBucketed(buckets, total) {
  const classified = Object.values(buckets).reduce((n, list) => n + list.length, 0);
  if (classified !== total) {
    throw new Error(`ข้อมูลไม่ครบ: จัดเข้ากองได้ ${classified} หน้า แต่บนดิสก์มี ${total} หน้า — หยุดตรวจ`);
  }
}