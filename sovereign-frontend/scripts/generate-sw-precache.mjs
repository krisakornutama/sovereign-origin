// สร้าง precache manifest หลัง `next build` — สแกน static chunks (js/css)
// แล้วเขียน public/sw-precache.json ให้ service worker ดึงไป precache ตอน install
// เรียกจาก package.json: "build" (server → .next/static) หรือ "build:static" (export → out/_next/static)
import fs from 'fs';
import path from 'path';

const candidates = [
  path.join(process.cwd(), '.next', 'static'),   // server build (`next start`)
  path.join(process.cwd(), 'out', '_next', 'static'), // static export (desktop shell)
];
const nextStatic = candidates.find((p) => fs.existsSync(p));
if (!nextStatic) {
  console.error('[SW] ไม่พบ static chunks (.next/static และ out/_next/static) — เรียกหลัง next build เท่านั้น');
  process.exit(1);
}
const outFile = path.join(process.cwd(), 'public', 'sw-precache.json');

const urls = [];

function walk(dir, base = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(base, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name), rel);
    } else {
      urls.push('/_next/static/' + rel);
    }
  }
}

walk(nextStatic);

const manifest = {
  version: Date.now(),
  urls,
};

fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
console.log(`[SW] precache manifest: ${urls.length} assets -> public/sw-precache.json`);
