#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stage-release.mjs — รวมชุดติดตั้งเดสก์ท็อปไว้ใน release/ พร้อมแฮชให้ตรวจ
//
// ทำไมต้องมีชั้นนี้:
//   ตัวติดตั้งจริงเกิดจาก 2 ที่ ซึ่งชื่อไฟล์ไม่เหมือนกันและอยู่คนละโฟลเดอร์
//     · sovereign-frontend/dist-electron/          → electron-builder (portable .exe + win .zip)
//     · <repo>/../Project Sovereign Origin Install/desktop/ → ชุด unpacked + DESKTOP-INFO.json (PACK-DESKTOP)
//   เวลาจะก๊อปไปเครื่องอื่นต้องรู้ว่า "ไฟล์ไหนคือของล่าสุด" — ชั้นนี้ทำให้เหลือโฟลเดอร์เดียว
//   ที่ชื่อมีเวอร์ชัน + มี SHA256SUMS.txt ตรวจก่อนก๊อปได้
//
// ใช้:
//   node tools/stage-release.mjs
//   node tools/stage-release.mjs --install="E:\ทาง\Project Sovereign Origin Install"
//   node tools/stage-release.mjs --out="E:\ทาง\release\custom"
//
// หมายเหตุ: .exe/.zip ถูก .gitignore อยู่แล้ว → commit ได้เฉพาะ README/SHA256SUMS/INFO
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'sovereign-frontend');
const DIST = path.join(FE, 'dist-electron');

const argv = process.argv.slice(2);
const value = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const INSTALL = path.resolve(value('install', path.join(ROOT, '..', 'Project Sovereign Origin Install')));
const version = JSON.parse(fs.readFileSync(path.join(FE, 'package.json'), 'utf8')).version || '0.0.0';
const OUT = path.resolve(value('out', path.join(ROOT, 'release', `Sovereign-OS-${version}-win-x64`)));

const say = (m = '') => console.log(m);
const die = (m) => { console.error(`[stage-release] ERROR: ${m}`); process.exit(1); };
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const sha256File = (file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });

say('══════════════════════════════════════════════════');
say(`  stage-release — Sovereign OS v${version}`);
say('══════════════════════════════════════════════════');

if (!fs.existsSync(DIST)) die(`ไม่พบ ${DIST} — รัน "npm run electron:build" ใน sovereign-frontend ก่อน`);

// ── 1) เก็บ artifact จาก electron-builder ──────────────────────────────────────
const all = fs.readdirSync(DIST);
const portable = all.filter((n) => /^Sovereign-OS-.*-portable\.exe$/i.test(n));
const zips = all.filter((n) => /^Sovereign[ -]OS-.*\.zip$/i.test(n));
if (!portable.length) {
  die('ไม่พบไฟล์ portable exe ใน dist-electron — ตรวจ target "portable" ใน electron-builder แล้ว build ใหม่');
}

// เตือนถ้า artifact เก่ากว่าซอร์สที่เพิ่งแก้ (เคสจริง: แพ็กแล้วเปิดแอปแล้วยังเป็นของเก่า)
const exeMtime = Math.max(...portable.map((n) => fs.statSync(path.join(DIST, n)).mtimeMs));
const srcProbe = path.join(FE, 'electron', 'main.js');
if (fs.existsSync(srcProbe) && fs.statSync(srcProbe).mtimeMs > exeMtime) {
  say('  ⚠ ไฟล์ติดตั้งเก่ากว่า electron/main.js — ควรสั่ง PACK-DESKTOP.mjs ใหม่ก่อนส่งมอบ');
}

const wanted = [...portable, ...zips];

// ── 2) เขียนโฟลเดอร์ส่งมอบ ────────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const staged = [];
for (const name of wanted) {
  fs.copyFileSync(path.join(DIST, name), path.join(OUT, name));
  staged.push(name);
  say(`  + ${name}  (${mb(fs.statSync(path.join(OUT, name)).size)})`);
}

const info = path.join(INSTALL, 'desktop', 'DESKTOP-INFO.json');
if (fs.existsSync(info)) {
  fs.copyFileSync(info, path.join(OUT, 'DESKTOP-INFO.json'));
  staged.push('DESKTOP-INFO.json');
  say('  + DESKTOP-INFO.json  (version/hash/ชิ้นส่วนที่ครบ)');
} else {
  say(`  ! ไม่พบ ${info} — ข้าม DESKTOP-INFO.json (รัน PACK-DESKTOP.mjs ถ้าต้องการชุด unpacked)`);
}

const doc = path.join(ROOT, 'docs', 'DESKTOP-INSTALL.md');
if (fs.existsSync(doc)) {
  fs.copyFileSync(doc, path.join(OUT, 'README-INSTALL.md'));
  staged.push('README-INSTALL.md');
  say('  + README-INSTALL.md');
}

// ── 3) SHA256SUMS.txt (ตรวจก่อนก๊อปไปเครื่องอื่น) ─────────────────────────────
const lines = [];
for (const name of staged) {
  lines.push(`${await sha256File(path.join(OUT, name))}  ${name}`);
}
fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');

say('');
say(`✅ พร้อมส่งมอบ: ${path.relative(ROOT, OUT)}`);
say(`   ${staged.length} ไฟล์ · SHA256SUMS.txt เขียนแล้ว`);
say('   วิธีติดตั้งที่เครื่องปลายทาง: ดู README-INSTALL.md (portable = ดับเบิลคลิกได้เลย)');
