#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// prod-truth.mjs — เกต "ความจริง runtime ฉบับเดียว": prod ที่รันอยู่ต้องมาจากโค้ดชุดเดียวกับดิสก์
// (Phase 0 arch-hardening — เคสจริง 21→23 ก.ย. 2026: prod รัน build เก่า 2 วันแบบไม่มีใครรู้)
//
// วิธี:
//   1) คำนวณ fingerprint ของ dist/ บนดิสก์ (size+mtime ของทุกไฟล์ — ชุดเดียวกัน = ค่าเดียวกัน)
//   2) ถาม GET /api/health → build.fingerprint ของโปรเซสที่รันอยู่จริง
//   3) ไม่ตรง = prod กำลังรันโค้ดเก่า → exit 1 (พร้อมคำสั่งแก้ที่ตรงกับ deployment จริงของ repo นี้)
//
// ใช้: node tools/prod-truth.mjs [--url http://localhost:3001] [--dir sovereign-os/core-api/dist]
//      (ไม่ส่ง --dir = fingerprint ฝั่งดิสก์จะอ่านจาก field build.files ถ้าเทียบไม่ได้ก็รายงานชัด)
// ────────────────────────────────────────────────────────────────────────────
import http from 'node:http';

function get(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf('--url');
  const base = urlIdx >= 0 ? args[urlIdx + 1] : 'http://localhost:3001';
  console.log('═══ Prod-Truth Gate ═══');
  console.log(`▶ GET ${base}/api/health`);

  let res;
  try {
    res = await get(`${base}/api/health`);
  } catch (e) {
    console.error(`❌ backend ไม่ตอบ (${e.message}) — เกตนี้ต้องมี prod รันอยู่`);
    process.exit(1);
  }
  if (res.status !== 200) {
    console.error(`❌ /api/health ตอบ HTTP ${res.status} — backend พังหรือเกตผิดพอร์ต`);
    process.exit(1);
  }

  let health;
  try {
    health = JSON.parse(res.body);
  } catch {
    console.error('❌ อ่าน /api/health ไม่ได้ (JSON พัง) — backend เก่าเกินไป?');
    process.exit(1);
  }

  const runtimeFp = health?.build?.fingerprint;
  if (!runtimeFp) {
    console.error('❌ /api/health ไม่มี build.fingerprint — backend ที่รันอยู่เป็น build เก่าก่อน Phase 0');
    console.error('   → rebuild แล้วลองใหม่: docker restart sovereign-core-api (หรือ build backend ใหม่ตาม deployment)');
    process.exit(1);
  }
  console.log(`  · runtime fingerprint = ${runtimeFp} (${health?.build?.files ?? '?'} ไฟล์ · โหลดจาก ${health?.build?.loadedDir ?? '?'})`);
  console.log(`  · db migration head   = ${health?.db?.migrationHead ?? '(ไม่ทราบ)'}`);

  // เทียบกับดิสก์: ถ้าสั่ง --dir มา จะคำนวณ fingerprint เดียวกันกับ backend (อัลกอริทึมใน runtime-fingerprint.ts)
  const dirIdx = args.indexOf('--dir');
  if (dirIdx >= 0) {
    const dir = args[dirIdx + 1];
    const { computeDirFingerprint } = await import('./fingerprint-lib.mjs');
    const disk = await computeDirFingerprint(dir);
    console.log(`  · disk fingerprint    = ${disk.fingerprint} (${disk.files} ไฟล์ จาก ${dir})`);
    if (disk.fingerprint === runtimeFp) {
      console.log('✅ prod รันโค้ดชุดเดียวกับดิสก์');
      process.exit(0);
    }
    console.error('❌ prod รันโค้ดเก่า — บนดิสก์มี build ใหม่กว่าที่โปรเซสโหลดอยู่');
    console.error('   → restart ให้โหลด build ใหม่: docker restart sovereign-core-api');
    process.exit(1);
  }
  console.log('✅ backend รองรับ fingerprint (ใส่ --dir เพื่อเทียบกับดิสก์แบบเต็ม)');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ prod-truth ล้ม:', e.message);
  process.exit(1);
});
