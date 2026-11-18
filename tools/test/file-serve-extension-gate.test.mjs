// ด่านกัน "เสิร์ฟไฟล์ที่ผู้ใช้ควบคุมนามสกุลด้วย Content-Type ที่อันตราย"
//
// เคสจริง 17/11/69 (SEC-053): `GET /api/knowledge/uploads/:file` ใช้ `res.sendFile`
// ซึ่งตั้ง Content-Type ตามนามสกุล ⇒ ไฟล์ `.html` ที่ถูกเขียนลงโฟลเดอร์นั้น
// (ผ่าน `POST /file/uploads%2Fevil.html` ที่ไม่จำกัดนามสกุล) ถูก render เป็นหน้าเว็บ
// ใน origin ของแอป (domain → :3000 → rewrite /api/* → :3001 = origin เดียวกับ JWT
// ใน localStorage) ⇒ stored XSS ที่ขโมย session ได้
//
// กติกาที่ด่านนี้บังคับ:
//   1. ทุก `res.sendFile(...)` ใน backend ต้องมี "การจำกัดนามสกุล" อยู่ใกล้ ๆ
//      (ต้องเห็น `extname(` ในหน้าต่างรอบจุดนั้น + ไฟล์ต้องมีชุดนามสกุลแบบ `new Set(['.x', ...])`)
//      — heuristic ที่จับ "ลืมตรวจ" ได้ ซึ่งเป็นต้นเหตุจริงของเคสนี้
//   2. ข้อยกเว้นต้องประกาศใน EXEMPT พร้อมเหตุผล และต้องไม่ค้าง (ไฟล์ต้องยังมี sendFile จริง)
//   3. ห้ามมี `express.static` ใน backend — โฟลเดอร์ข้อมูล (knowledge/, uploads/, data/)
//      ต้องไม่ถูกเปิดเป็นไฟล์สาธารณะทั้งโฟลเดอร์
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SRC = path.join(ROOT, 'sovereign-os', 'core-api', 'src');

/** ไฟล์ที่ยกเว้น — ต้องมีเหตุผลว่า "ทำไมนามสกุลเป็นอันตรายไม่ได้" */
const EXEMPT = new Map([
  [
    'modules/agent-machines/agent-machines.routes.ts',
    'ชื่อไฟล์ถูกสร้างจากฝั่งเซิร์ฟเวอร์ (job-<jobId>-<เวลา>-<uuid8>.<ext>) และต้องผ่าน ' +
      'jobIdFromScreenshotFile() ซึ่งเป็น regex ที่ล็อกนามสกุลไว้ที่ .png/.jpg/.jpeg/.webp ' +
      '⇒ ไม่มีทางเป็น .html/.svg',
  ],
]);

/** ระยะที่ยอมให้การตรวจนามสกุลอยู่ห่างจากจุด sendFile (บรรทัด) */
const WINDOW = 40;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** ทุกจุด sendFile: { rel, line, text(ทั้งไฟล์), window } */
function findSendFileSites() {
  const sites = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/\b(res\.)?sendFile\s*\(/.test(line)) return;
      if (/^\s*(\*|\/\/)/.test(line)) return; // คอมเมนต์
      const from = Math.max(0, i - WINDOW);
      const window = lines.slice(from, Math.min(lines.length, i + 3)).join('\n');
      sites.push({ rel, line: i + 1, text, window });
    });
  }
  return sites;
}

/** ไฟล์นั้นมีชุดนามสกุลแบบ `new Set(['.x', ...])` ไหม */
function hasExtensionSet(text) {
  return /new Set\(\s*\[[\s\S]{0,400}?['"]\.[a-z0-9]+['"]/i.test(text);
}

test('ทุก sendFile ต้องจำกัดนามสกุลก่อนส่ง (หรืออยู่ใน EXEMPT พร้อมเหตุผล)', () => {
  const sites = findSendFileSites();
  assert.ok(sites.length > 0, 'ต้องเจอจุด sendFile อย่างน้อย 1 จุด — ถ้าไม่เจอแปลว่า scanner พัง');

  const problems = [];
  for (const site of sites) {
    if (EXEMPT.has(site.rel)) continue;
    const hasExtname = /\bextname\s*\(/.test(site.window);
    const hasSet = hasExtensionSet(site.text);
    if (!hasExtname || !hasSet) {
      problems.push(
        `${site.rel}:${site.line} — ` +
          (hasExtname ? '' : 'ไม่พบ extname() ใกล้จุด sendFile · ') +
          (hasSet ? '' : 'ไม่พบชุดนามสกุล (new Set([".x", ...])) ในไฟล์')
      );
    }
  }

  assert.deepEqual(
    problems,
    [],
    'sendFile ที่ไม่จำกัดนามสกุล = ผู้ใช้วางไฟล์ .html/.svg แล้วถูก render ใน origin ของแอป ' +
      '(SEC-053) — เติมการตรวจนามสกุล หรือประกาศยกเว้นใน EXEMPT พร้อมเหตุผล:\n' +
      problems.join('\n')
  );
});

test('รายการยกเว้นต้องไม่ค้าง — ไฟล์ที่ยกเว้นต้องยังมี sendFile จริง', () => {
  const sites = findSendFileSites();
  const withSendFile = new Set(sites.map((s) => s.rel));
  const stale = [...EXEMPT.keys()].filter((rel) => !withSendFile.has(rel));
  assert.deepEqual(
    stale,
    [],
    'EXEMPT อ้างไฟล์ที่ไม่มี sendFile แล้ว — ลบออกเพื่อไม่ให้ด่านนี้ค่อย ๆ ตาบอด'
  );
});

test('backend ต้องไม่มี express.static (โฟลเดอร์ข้อมูลต้องไม่ถูกเปิดทั้งโฟลเดอร์)', () => {
  const hits = walk(SRC)
    .filter((file) => /express\.static\s*\(|\bserveStatic\s*\(/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file).replace(/\\/g, '/'));
  assert.deepEqual(
    hits,
    [],
    'การเปิดโฟลเดอร์ทั้งก้อนทำให้ไฟล์ที่ผู้ใช้วางได้ (knowledge/, uploads/) กลายเป็นไฟล์สาธารณะ ' +
      'และข้ามการตรวจสิทธิ์/นามสกุลของ route — ใช้ route ที่ตรวจสิทธิ์ทีละไฟล์แทน'
  );
});
