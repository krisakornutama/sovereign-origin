#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// check-parity.mjs — พิสูจน์ว่า fingerprint สองฝั่ง "ตรงกันทุกไบต์" เสมอ
//   ฝั่ง tools : tools/fingerprint-lib.mjs        (ใช้โดย tools/prod-truth.mjs + verify)
//   ฝั่ง runtime: dist/lib/runtime-fingerprint.js (ใช้โดย /api/health ใน prod container)
// ถ้าอัลกอริทึมเหลื่อมกัน prod-truth gate จะเทียบผิดทั้งระบบ — ไฟล์นี้จึงต้องรันบน CI ทุก PR
//
// ใช้: node tools/check-parity.mjs [--dist sovereign-os/core-api/dist]
//      (ต้อง build backend ก่อน: npm run build ที่ sovereign-os/core-api)
// ────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const distIdx = process.argv.indexOf('--dist');
const DIST = resolve(distIdx >= 0 ? process.argv[distIdx + 1] : join(ROOT, 'sovereign-os', 'core-api', 'dist'));

if (!existsSync(DIST)) {
  console.error(`❌ ไม่มี ${DIST} — build backend ก่อน (npm run build ที่ sovereign-os/core-api)`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const toolsLib = require('./fingerprint-lib.mjs'); // .mjs ผ่าน require = sync default export shape
const runtimeLib = require(join(DIST, 'lib', 'runtime-fingerprint.js'));

const disk = toolsLib.computeDirFingerprintSync(DIST);
let runtimeFp;
try {
  const self = await runtimeLib.computeDirFingerprint(DIST);
  runtimeFp = self.fingerprint;
} catch (e) {
  console.error(`❌ เรียก runtime fingerprint ล้ม: ${e.message}`);
  process.exit(1);
}

console.log(`═══ Fingerprint Parity ═══`);
console.log(`  · tools   = ${disk.fingerprint} (${disk.files} ไฟล์)`);
console.log(`  · runtime = ${runtimeFp}`);

if (disk.fingerprint === runtimeFp && disk.files > 0) {
  console.log('✅ parity ตรงกันทุกไบต์ — prod-truth gate เทียบได้ถูกต้อง');
  process.exit(0);
}
console.error('❌ fingerprint สองฝั่งไม่ตรงกัน — อัลกอริทึมเหลื่อมกัน (แก้ runtime-fingerprint.ts / fingerprint-lib.mjs ให้ตรงกันก่อน merge)');
process.exit(1);
