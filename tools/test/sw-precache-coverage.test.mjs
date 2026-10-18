// tools/test/sw-precache-coverage.test.mjs
//
// ── เทสต์: service worker ต้อง precache asset ที่หน้าจริงเรียกใช้ ──
//
// ที่มา (เจอจริง 19/10/69): อัปเกรด next 16.3.6 → 16.4.2 แล้วจำนวน asset
// ใน public/sw-precache.json ลดจาก 208 → 147 ตัว
//   ⇒ ถ้าลดเพราะ "ของหาย" ไม่ใช่ "next รวม chunk ให้เล็กลง" แอปเดสก์ท็อป
//     จะเข้าโหมดออฟไลน์ไม่ได้ (ผู้ใช้ไม่เห็นอาการจนกว่าจะเน็ตหลุด = เจอช้าที่สุด)
//   ⇒ ตรวจด้วยตารอบเดียวไม่พอ ต้องมีอะไรจับทุกครั้งที่ build
//
// ⚠ เทสต์นี้ต้องมี build อยู่ (.next) — ถ้าไม่มีจะ skip ไม่ใช่ fail
//   เพราะคนที่ clone ใหม่ยังไม่ build ก็ไม่ควรเจอแดง
//   และ sw-precache.json ไม่ได้ถูก track ใน git (เป็นของที่ build สร้าง)
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGES_DIR = path.join(ROOT, 'sovereign-frontend/.next/server/pages');
const MANIFEST_PATH = path.join(ROOT, 'sovereign-frontend/public/sw-precache.json');

const hasBuild = fs.existsSync(PAGES_DIR) && fs.existsSync(MANIFEST_PATH);
const SKIP = hasBuild ? false : 'ยังไม่มี build (.next/sw-precache.json) — ข้าม';

/** HTML ทุกหน้าที่ prerender ไว้ (รวมโฟลเดอร์ย่อย) */
function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** asset ใต้ /_next ที่ HTML อ้างถึง (js/css เท่านั้น) */
function refsIn(html) {
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)) {
    const clean = m[1].split('?')[0];
    if (clean.endsWith('.js') || clean.endsWith('.css')) refs.add(clean);
  }
  return refs;
}

describe('SW precache ครอบ asset ที่หน้าจริงเรียก', { skip: SKIP }, () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const known = new Set(manifest.urls);

  test('manifest มีรูปร่างที่ใช้ได้ (version + urls ที่ไม่ว่าง)', () => {
    assert.ok(Number.isFinite(Number(manifest.version)), 'manifest ต้องมี version เป็นตัวเลข (กันไฟล์เปล่า/ไฟล์เสีย)');
    assert.ok(Array.isArray(manifest.urls) && manifest.urls.length > 0, 'urls ต้องเป็น array ที่ไม่ว่าง');
  });

  test('ทุก asset ที่หน้าเว็บอ้างถึง ต้องอยู่ใน precache (ไม่งั้นโหมดออฟไลน์พังเงียบ)', () => {
    const pages = htmlFiles(PAGES_DIR);
    const missing = [];
    let checked = 0;

    for (const f of pages) {
      for (const ref of refsIn(fs.readFileSync(f, 'utf8'))) {
        checked += 1;
        if (!known.has(ref)) missing.push(`${path.relative(PAGES_DIR, f)} → ${ref}`);
      }
    }

    // ⚠ กันเทสต์ผ่านแบบกลวง — ถ้าอ่าน HTML ไม่ได้เลย checked จะเป็น 0 แล้วเทสต์จะ "ผ่าน" ทั้งที่ไม่ได้ตรวจอะไร
    assert.ok(pages.length > 10, `ต้องเจอหน้าที่ prerender มากพอ (เจอ ${pages.length})`);
    assert.ok(checked > 50, `ต้องตรวจ asset มากพอ (เจอ ${checked}) — ถ้าน้อยกว่านี้แปลว่าตัวจับ ref พัง`);
    assert.deepEqual(missing, [], `asset ที่หายจาก precache ${missing.length} รายการ:\n  ${missing.slice(0, 15).join('\n  ')}`);
  });

  test('precache ต้องไม่มีรายการซ้ำ (ของซ้ำ = เบิ้ลพื้นที่เก็บในเครื่องผู้ใช้)', () => {
    const dupes = manifest.urls.filter((u, i) => manifest.urls.indexOf(u) !== i);
    assert.deepEqual([...new Set(dupes)], []);
  });
});
