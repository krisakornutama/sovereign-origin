// สร้าง precache manifest หลัง `next build` — สแกน .next/static (js/css chunks)
// แล้วเขียน public/sw-precache.json ให้ service worker ดึงไป precache ตอน install
// เรียกจาก package.json: "build": "next build && node scripts/generate-sw-precache.mjs"
import fs from 'fs';
import path from 'path';

const nextStatic = path.join(process.cwd(), '.next', 'static');
const outFile = path.join(process.cwd(), 'public', 'sw-precache.json');

const urls = [];

function walk(dir, base = '') {
  if (!fs.existsSync(dir)) return;
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
