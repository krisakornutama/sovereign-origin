#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// release-build.mjs — ด่าน Release Automation (ใช้ทั้งบน CI และเครื่องจริง)
//
// ทำไมต้องมี:
//   stage-release.mjs เดิมทำงานได้เฉพาะบนเครื่องที่ build แล้ว และ import แล้วมี
//   side effect (อ่าน dist-electron ทันที) — ใช้เป็นด่านใน CI ไม่ได้
//   โมดูลนี้แยก "logic ที่ทดสอบได้" ออกจาก CLI:
//     1) คัดเฉพาะ artifact ของเวอร์ชันที่กำลังปล่อย (กันของเก่าปนขึ้น Release)
//     2) เขียน/ตรวจ SHA256SUMS.txt รูปแบบ "<64hex>␣␣<ชื่อไฟล์>"
//     3) ดัก tag ไม่ตรง version ก่อนเสียเวลา build
//     4) stage เฉพาะ exe + zip ลงโฟลเดอร์เดียวให้ workflow อัปโหลด
//
// ใช้:
//   node tools/release-build.mjs --check-tag=v1.2.1
//   node tools/release-build.mjs --stage --dir=sovereign-frontend/dist-electron --out=release-assets
//   node tools/release-build.mjs --verify --dir=release-assets
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'sovereign-frontend');

export const CHECKSUM_FILE = 'SHA256SUMS.txt';
const HASH_RE = /^[0-9a-f]{64}$/;

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/** ชื่อไฟล์ใน manifest ต้องอยู่ในโฟลเดอร์เดียวกันเท่านั้น — ห้าม path traversal/absolute/drive */
function assertSafeName(name, lineNo = 0) {
  const where = lineNo ? ` (บรรทัด ${lineNo})` : '';
  const bad =
    typeof name !== 'string' ||
    name.length === 0 ||
    name !== name.trim() ||
    name === '.' ||
    name === '..' ||
    path.isAbsolute(name) ||
    /[\\/:]/.test(name) ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f]/.test(name);
  if (bad) throw fail('E_UNSAFE_NAME', `ชื่อไฟล์ไม่ปลอดภัย${where}: ${JSON.stringify(name)}`);
}

/** คัดเฉพาะ artifact ของเวอร์ชันปัจจุบัน — dist-electron มีของรุ่นเก่าค้างได้เสมอ */
export function collectDesktopArtifacts(names, version) {
  const isVersioned = (name) => name.includes(`-${version}-`);
  return {
    portable: names
      .filter((n) => /^Sovereign-OS-.*-portable\.exe$/i.test(n) && isVersioned(n))
      .sort(),
    zips: names.filter((n) => /^Sovereign[ -]OS-.*\.zip$/i.test(n) && isVersioned(n)).sort(),
  };
}

/** คืนเนื้อหา SHA256SUMS.txt (เรียงตามชื่อ, ลงท้าย newline เสมอ) */
export function buildChecksumManifest(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw fail('E_EMPTY', 'ไม่มีไฟล์สำหรับเขียน SHA256SUMS');
  }
  const seen = new Set();
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const lines = sorted.map(({ name, hash }) => {
    assertSafeName(name);
    if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
      throw fail('E_HASH', `SHA-256 ของ ${name} ไม่ถูกต้อง (ต้องเป็น hex 64 ตัว)`);
    }
    if (seen.has(name)) throw fail('E_DUPLICATE', `ชื่อไฟล์ซ้ำใน manifest: ${name}`);
    seen.add(name);
    return `${hash}  ${name}`;
  });
  return `${lines.join('\n')}\n`;
}

/** อ่าน SHA256SUMS.txt — รองรับทั้ง "<hash>  <file>" และ "<hash> *<file>" (binary marker) */
export function parseChecksumManifest(text) {
  const rows = [];
  const seen = new Set();
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(raw);
    if (!m) {
      throw fail('E_BAD_LINE', `บรรทัด ${i + 1} ไม่ตรงรูปแบบ "<sha256>␣␣<ชื่อไฟล์>": ${raw.slice(0, 80)}`);
    }
    const name = m[2];
    assertSafeName(name, i + 1);
    if (seen.has(name)) throw fail('E_DUPLICATE', `ชื่อไฟล์ซ้ำใน manifest: ${name}`);
    seen.add(name);
    rows.push({ name, hash: m[1].toLowerCase() });
  }
  if (rows.length === 0) throw fail('E_EMPTY', 'SHA256SUMS ว่าง');
  return rows;
}

/** SHA-256 ของไฟล์แบบ streaming — exe/zip ระดับ 200MB ไม่กินแรมทั้งก้อน */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('error', reject);
    s.on('data', (chunk) => h.update(chunk));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/** เขียน SHA256SUMS.txt ให้ไฟล์ที่ระบุในโฟลเดอร์ dir */
export async function writeChecksumFile(dir, names) {
  const entries = [];
  for (const name of names) {
    entries.push({ name, hash: await sha256File(path.join(dir, name)) });
  }
  const text = buildChecksumManifest(entries);
  fs.writeFileSync(path.join(dir, CHECKSUM_FILE), text, 'utf8');
  return { entries, text };
}

/** ตรวจทุกไฟล์ในโฟลเดอร์กับ SHA256SUMS.txt — คืนรายการที่พลาดแทนการ throw */
export async function verifyChecksumFile(dir) {
  const manifestPath = path.join(dir, CHECKSUM_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw fail('E_NO_MANIFEST', `ไม่พบ ${CHECKSUM_FILE} ใน ${dir}`);
  }
  const entries = parseChecksumManifest(fs.readFileSync(manifestPath, 'utf8'));
  const failures = [];
  for (const { name, hash } of entries) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      failures.push({ name, reason: 'missing' });
      continue;
    }
    const actual = await sha256File(file);
    if (actual !== hash) failures.push({ name, reason: 'mismatch', expected: hash, actual });
  }
  return { ok: failures.length === 0, checked: entries.length, failures };
}

/** คัดลอก exe + zip ของเวอร์ชันนี้ไป outDir แล้วเขียน + ตรวจ SHA256SUMS ในรอบเดียว */
export async function stageReleaseArtifacts({ distDir, outDir, version }) {
  const DIST = path.resolve(distDir);
  const OUT = path.resolve(outDir);
  if (!fs.existsSync(DIST)) throw fail('E_NO_DIST', `ไม่พบโฟลเดอร์ artifact: ${DIST}`);

  const { portable, zips } = collectDesktopArtifacts(fs.readdirSync(DIST), version);
  if (portable.length === 0) {
    throw fail('E_NO_EXE', `ไม่พบ portable exe ของ v${version} ใน ${DIST} — build electron-builder ก่อน`);
  }
  if (zips.length === 0) {
    throw fail('E_NO_ZIP', `ไม่พบ zip ของ v${version} ใน ${DIST} — electron-builder ต้องมี target zip`);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const names = [...portable, ...zips];
  for (const name of names) {
    fs.copyFileSync(path.join(DIST, name), path.join(OUT, name));
  }

  const { entries } = await writeChecksumFile(OUT, names);
  const check = await verifyChecksumFile(OUT);
  if (!check.ok) {
    const detail = check.failures.map((f) => `${f.name} (${f.reason})`).join(', ');
    throw fail('E_CHECKSUM', `ตรวจ SHA256SUMS ไม่ผ่าน: ${detail}`);
  }
  return { files: names, entries, outDir: OUT };
}

/** tag ต้องเป็น v<version> ตรงกับ sovereign-frontend/package.json เป๊ะ ๆ */
export function assertTagMatchesVersion(tag, version) {
  const v = String(version ?? '').trim();
  if (!v) throw fail('E_VERSION', 'ไม่พบ version — อ่าน sovereign-frontend/package.json ไม่ได้');
  const t = String(tag ?? '').trim();
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(t)) {
    throw fail('E_TAG_FORMAT', `tag "${t}" ต้องอยู่ในรูป v<major>.<minor>.<patch> (เช่น v1.2.1)`);
  }
  if (t.slice(1) !== v) {
    throw fail(
      'E_TAG_VERSION',
      `tag ${t} ไม่ตรงกับ version ใน sovereign-frontend/package.json (${v}) — bump version ก่อนออก release`
    );
  }
  return v;
}

/** อ่าน version จาก sovereign-frontend/package.json */
export function readFrontendVersion(feDir = FE) {
  const pkgPath = path.join(feDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.version) throw fail('E_VERSION', `package.json ไม่มี version: ${pkgPath}`);
  return pkg.version;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flagValue = (name, fallback = '') => {
  const hit = argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!hit) return fallback;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
};
const hasFlag = (name) => argv.some((a) => a === name || a.startsWith(`${name}=`));
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const usage = () => {
  console.log(`release-build — ด่าน Release Automation

  node tools/release-build.mjs --check-tag=v1.2.1
  node tools/release-build.mjs --stage [--dir=sovereign-frontend/dist-electron] [--out=release-assets]
  node tools/release-build.mjs --verify [--dir=release-assets]

  --check-tag  เทียบ tag กับ version ใน sovereign-frontend/package.json
  --stage      คัดเฉพาะ exe/zip ของเวอร์ชันนี้ + เขียน SHA256SUMS.txt
  --verify     ตรวจ SHA256SUMS.txt กับไฟล์จริง (exit 1 ถ้าไม่ผ่าน)`);
};

async function main() {
  if (argv.length === 0 || argv.includes('--help')) {
    usage();
    if (argv.length === 0) process.exitCode = 2;
    return;
  }

  if (hasFlag('--check-tag')) {
    const version = readFrontendVersion(path.resolve(flagValue('--frontend', FE)));
    const tag = flagValue('--check-tag', process.env.GITHUB_REF_NAME || '');
    const v = assertTagMatchesVersion(tag, version);
    console.log(`✅ tag ${tag} ตรงกับ version ${v}`);
    return;
  }

  if (argv.includes('--stage')) {
    const version = readFrontendVersion(path.resolve(flagValue('--frontend', FE)));
    const distDir = path.resolve(flagValue('--dir', path.join(FE, 'dist-electron')));
    const outDir = path.resolve(flagValue('--out', path.join(ROOT, 'release-assets')));
    const res = await stageReleaseArtifacts({ distDir, outDir, version });

    console.log(`✅ staged ${res.entries.length} ไฟล์ · v${version} → ${res.outDir}`);
    for (const { name, hash } of res.entries) {
      const size = fs.statSync(path.join(res.outDir, name)).size;
      console.log(`   ${hash}  ${name} (${mb(size)})`);
    }
    console.log(`   ${CHECKSUM_FILE} เขียนแล้ว และตรวจกลับผ่าน`);
    return;
  }

  if (argv.includes('--verify')) {
    const dir = path.resolve(flagValue('--dir', path.join(ROOT, 'release-assets')));
    const res = await verifyChecksumFile(dir);
    if (!res.ok) {
      for (const f of res.failures) {
        console.error(`   ✖ ${f.name} — ${f.reason}${f.actual ? ` (actual ${f.actual.slice(0, 12)}…)` : ''}`);
      }
      throw fail('E_CHECKSUM', `ตรวจ SHA256SUMS ไม่ผ่าน ${res.failures.length}/${res.checked} ไฟล์`);
    }
    console.log(`✅ SHA256SUMS ตรงทุกไฟล์ (${res.checked}/${res.checked}) · ${dir}`);
    return;
  }

  usage();
  process.exitCode = 2;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error(`[release-build] ERROR: ${e.message}`);
    process.exitCode = 1;
  });
}
