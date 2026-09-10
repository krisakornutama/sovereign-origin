// ─────────────────────────────────────────────────────────────
// build-desktop.mjs — ประกอบ desktop runtime + generate electron overlay จากซอร์ส
//
// ปัญหาเดิม: ไฟล์ electron (main.js/offline.html/preload.js) ถูก "ก๊อปมือ" ลง
//   dist-portable/resources/app/ — เวลาแก้ซอร์สแล้วลืม sync ก็ drift ทันที
//   (STATUS 2026-09-09: exe portable ฝัง asar เก่าในตัว จอดำ เพราะ overlay เดิม)
//
// ทำงาน:
//   1) copy electron runtime (win-unpacked) → dist-portable/   (default; --skip-runtime ข้าม)
//   2) generate overlay จากซอร์ส → dist-portable/resources/app/
//      (electron/ copy ตรง + package.json ปรับ: เติม "main": "electron/main.js" และตัด scripts —
//       ตัวเดียวที่ต่างจากซอร์สโดยดีไซน์)
//   3) copy sidecar backend → dist-portable/resources/core-api/ (--skip-sidecar ข้าม)
//      (ถ้าไม่มี core-api/dist ให้ build ก่อน — sidecar ไม่มี dist = จอดำแบบเดิม)
//   4) ตรวจ sync ซอร์ส ↔ overlay ทุกไฟล์ ไม่ตรง = exit 1
//
// ใช้: node tools/build-desktop.mjs [--skip-runtime] [--skip-sidecar]
// ─────────────────────────────────────────────────────────────
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'sovereign-frontend');
const CORE_API = path.join(ROOT, 'sovereign-os', 'core-api');
const DIST = path.join(FE, 'dist-electron', 'win-unpacked');
const PORTABLE = path.join(ROOT, 'dist-portable');
const APP = path.join(PORTABLE, 'resources', 'app');

const skipRuntime = process.argv.includes('--skip-runtime');
const skipSidecar = process.argv.includes('--skip-sidecar');
const log = (...a) => console.log('[build-desktop]', ...a);
const die = (m) => { console.error('[build-desktop] ERROR:', m); process.exit(1); };

// ── 1) electron runtime → dist-portable ──
if (!skipRuntime) {
  if (!existsSync(DIST)) {
    die('ไม่พบ electron runtime ที่ sovereign-frontend/dist-electron/win-unpacked — รัน "npm run electron:build" ใน sovereign-frontend ก่อน (หรือใช้ --skip-runtime ถ้า runtime เดิมยังใช้ได้)');
  }
  log('copy electron runtime →', path.relative(ROOT, PORTABLE));
  mkdirSync(PORTABLE, { recursive: true });
  cpSync(DIST, PORTABLE, { recursive: true, force: true });
}

// ── 2) overlay จากซอร์ส → resources/app ──
const electronSrc = path.join(FE, 'electron');
if (!existsSync(electronSrc)) die(`ไม่พบซอร์ส overlay: ${electronSrc}`);
log('overlay:', path.relative(ROOT, electronSrc), '→', path.relative(ROOT, path.join(APP, 'electron')));
mkdirSync(APP, { recursive: true });
cpSync(electronSrc, path.join(APP, 'electron'), { recursive: true, force: true });

// package.json overlay = generate จากซอร์ส (ไม่ใช่ก๊อปมือ): main ชี้ electron/main.js + ตัด scripts
const pkg = JSON.parse(readFileSync(path.join(FE, 'package.json'), 'utf8'));
const overlayPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  main: 'electron/main.js',
  _comment: 'Generated from sovereign-frontend/package.json by tools/build-desktop.mjs — ห้ามแก้มือ แก้ที่ซอร์สแล้วรัน build-desktop ใหม่',
};
writeFileSync(path.join(APP, 'package.json'), JSON.stringify(overlayPkg, null, 2) + '\n', 'utf8');
log('overlay: package.json generated (main=electron/main.js, ไม่มี scripts)');
// overlay ต้องเป็นไฟล์ซอร์สเท่านั้น — ห้าม node_modules ติดมา
if (readdirSync(APP).includes('node_modules')) die('resources/app/node_modules ไม่ควรมี — ตรวจซอร์ส');

// ── 3) sidecar backend → resources/core-api ──
if (!skipSidecar) {
  if (!existsSync(path.join(CORE_API, 'dist', 'server.js'))) {
    log('ไม่มี core-api/dist — build ก่อน (npm run build ใน sovereign-os/core-api)');
    const r = spawnSync('npm', ['run', 'build'], { cwd: CORE_API, stdio: 'inherit', shell: true });
    if (r.status !== 0) die('core-api build ล้มเหลว');
  }
  const sidecar = [
    { src: path.join(CORE_API, 'dist'), dest: path.join(PORTABLE, 'resources', 'core-api', 'dist') },
    { src: path.join(CORE_API, 'prisma'), dest: path.join(PORTABLE, 'resources', 'core-api', 'prisma') },
    { src: path.join(CORE_API, 'package.json'), dest: path.join(PORTABLE, 'resources', 'core-api', 'package.json') },
  ];
  for (const f of sidecar) {
    if (!existsSync(f.src)) die(`ไม่พบ sidecar source: ${f.src}`);
    log('sidecar:', path.relative(ROOT, f.src), '→', path.relative(ROOT, f.dest));
    cpSync(f.src, f.dest, { recursive: true, force: true });
  }
}

// ── 4) ตรวจ sync ซอร์ส ↔ overlay ──
function tree(dir, base = '') {
  const out = new Map();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(base, e.name);
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      for (const [k, v] of tree(p, rel)) out.set(k, v);
    } else {
      out.set(rel.split(path.sep).join('/'), readFileSync(p));
    }
  }
  return out;
}
const srcTree = tree(electronSrc);
const overlayTree = tree(path.join(APP, 'electron'));
for (const [f, buf] of srcTree) {
  if (!overlayTree.has(f)) die(`overlay ขาดไฟล์: ${f} (ต้อง generate จากซอร์สเสมอ)`);
  if (Buffer.compare(buf, overlayTree.get(f)) !== 0) die(`overlay ต่างจากซอร์ส: ${f}`);
}
for (const f of overlayTree.keys()) {
  if (!srcTree.has(f)) die(`overlay มีไฟล์แปลกปลอม: ${f}`);
}
log('✅ overlay sync ตรงซอร์ส 100%');
log('เสร็จ: dist-portable/ พร้อมใช้ (runtime' + (skipRuntime ? ' [คงเดิม]' : ' ใหม่') + ' + overlay' + (skipSidecar ? ' [sidecar คงเดิม]' : ' + sidecar') + ')');
