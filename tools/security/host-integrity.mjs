// ─────────────────────────────────────────────────────────────────────────────
//  host-integrity — ด่าน "สคริปต์ host ถูกแก้โดยไม่มีใครรู้"
//
//  ทำไมต้องมี: เครื่องนี้เคยเจอ malware persistence ผ่าน scheduled task ที่เขียน
//  `Add-MpPreference -ExclusionProcess` เอง (SEC-037) และนโยบาย Defender ที่ถูกลบ
//  ถูกเขียนกลับหลังบูต (SEC-032) ⇒ ไฟล์ที่ "รันด้วยสิทธิ์ admin" หรือ "ถูกเรียกจาก
//  scheduled task ทุกคืน" คือจุดที่การแก้ 1 บรรทัดเปลี่ยนพฤติกรรมทั้งเครื่องได้
//
//  กติกา: ทุกสคริปต์ host ต้องมี sha256 ใน `tools/security/host-integrity.json`
//  ตรวจแล้วไม่ตรง = exit 1 (CI แดงผ่าน tools/test/host-integrity.test.mjs)
//
//  ใช้:  node tools/security/host-integrity.mjs            # ตรวจ (ค่าเริ่มต้น)
//        node tools/security/host-integrity.mjs --write    # อัปเดต manifest
//        node tools/security/host-integrity.mjs --root <dir>   # ใช้ในเทสต์
//        exit 0 = ตรง · 1 = พบ drift · 2 = ใช้ผิด/อ่าน manifest ไม่ได้
//
//  ขอบเขตความจริง: manifest อยู่ใน git ⇒ การแก้สคริปต์ที่ถูกต้องต้องมี commit
//  ที่แก้ manifest ด้วย (ตรวจย้อนได้ว่าใครเปลี่ยน) · `--write` จึงปฏิเสธถ้าสคริปต์
//  ที่ track แล้วยังไม่ commit — กันการ "เขียนทับร่องรอย" ในเครื่องโดยไม่ผ่าน git
//  หมายเหตุ: hash เป็นค่าไบต์ตรง ๆ (CRLF ≠ LF) — เปลี่ยน line ending ถือว่าเปลี่ยนไฟล์
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
export const MANIFEST_REL = 'tools/security/host-integrity.json';
/** ตัวด่านเอง — hash ตัวเองไม่ได้ และไม่ควรทำให้ต้อง regen ทุกครั้งที่แก้ตัวตรวจ */
export const SELF_REL = 'tools/security/host-integrity.mjs';

const HASHED_DIR = 'tools/security';
const DIR_EXTS = new Set(['.ps1', '.psm1', '.cmd', '.bat', '.vbs', '.mjs']);
/** สคริปต์ระดับ tools/ ที่ scheduled task / autostart เรียกได้ */
const ROOT_EXTS = new Set(['.ps1', '.cmd', '.bat', '.vbs']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'dist-portable', 'release', 'coverage']);

const posix = (p) => p.split(path.sep).join('/');

/** sha256 ของไบต์ตรง ๆ (ไม่ normalize line ending) */
export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.isFile()) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/**
 * รายการไฟล์ที่ต้องป้องกัน (rel path, เรียงตามตัวอักษร)
 * = ทุกไฟล์สคริปต์ใน tools/security/** + สคริปต์ host ที่ tools/* (ชั้นเดียว)
 */
export function collectProtected(root = DEFAULT_ROOT) {
  const out = [];
  for (const full of walk(path.join(root, HASHED_DIR), [])) {
    if (!DIR_EXTS.has(path.extname(full).toLowerCase())) continue;
    const rel = posix(path.relative(root, full));
    if (rel === SELF_REL || rel === MANIFEST_REL) continue;
    out.push(rel);
  }
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(path.join(root, 'tools'), { withFileTypes: true });
  } catch {
    rootEntries = [];
  }
  for (const e of rootEntries) {
    if (!e.isFile()) continue;
    if (!ROOT_EXTS.has(path.extname(e.name).toLowerCase())) continue;
    out.push('tools/' + e.name);
  }
  return out.sort();
}

export function buildManifest(root = DEFAULT_ROOT) {
  const files = {};
  for (const rel of collectProtected(root)) {
    files[rel] = sha256(fs.readFileSync(path.join(root, rel)));
  }
  return {
    version: 1,
    algorithm: 'sha256',
    note: 'ไฟล์ที่ห้ามแก้โดยไม่มี commit — อัปเดตด้วย node tools/security/host-integrity.mjs --write',
    files,
  };
}

export function loadManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('manifest ไม่ใช่ JSON ที่อ่านได้: ' + e.message);
  }
  const files = parsed && parsed.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('manifest ต้องมีช่อง "files" เป็น object (path → sha256)');
  }
  return parsed;
}

/** เทียบ manifest กับดิสก์ — คืน findings เรียงตามชื่อไฟล์ (ว่าง = ตรง) */
export function verifyManifest(manifest, root = DEFAULT_ROOT) {
  const expected = (manifest && manifest.files) || {};
  const actual = collectProtected(root);
  const actualSet = new Set(actual);
  const findings = [];
  for (const rel of actual) {
    if (!Object.prototype.hasOwnProperty.call(expected, rel)) {
      findings.push({ code: 'unlisted', file: rel, detail: 'ไฟล์ใหม่ที่ยังไม่มี hash ใน manifest' });
      continue;
    }
    let got;
    try {
      got = sha256(fs.readFileSync(path.join(root, rel)));
    } catch (e) {
      findings.push({ code: 'unreadable', file: rel, detail: e.message });
      continue;
    }
    if (got !== expected[rel]) {
      findings.push({ code: 'modified', file: rel, expected: expected[rel], actual: got });
    }
  }
  for (const rel of Object.keys(expected).sort()) {
    if (!actualSet.has(rel)) findings.push({ code: 'missing', file: rel, detail: 'มี hash ใน manifest แต่ไม่พบไฟล์' });
  }
  return findings;
}

/**
 * ปฏิเสธการเขียน manifest ถ้าสคริปต์ที่ track แล้วยังไม่ commit
 * (manifest ต้องสะท้อนสถานะที่ตรวจย้อนได้ใน git ไม่ใช่สถานะในหน่วยความจำเครื่อง)
 * @returns {string[]} ไฟล์ที่ dirty (ว่าง = เขียนได้)
 */
export function refuseIfDirty(root, files, opts = {}) {
  const runGit =
    opts.runGit ||
    ((args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  let out = '';
  try {
    out = runGit(['diff', '--name-only', '--', ...files]) || '';
  } catch {
    return []; // ไม่มี git / ไม่ใช่ repo → ไม่บล็อก (ยังตรวจด้วย manifest ได้)
  }
  const dirty = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (dirty.length > 0) {
    throw new Error(
      'สคริปต์ host ถูกแก้แต่ยังไม่ commit: ' + dirty.join(', ') + ' — commit ก่อนแล้วค่อย --write'
    );
  }
  return dirty;
}

export function writeManifest(root = DEFAULT_ROOT, opts = {}) {
  const files = collectProtected(root);
  refuseIfDirty(root, files, opts);
  const manifest = buildManifest(root);
  const target = path.join(root, MANIFEST_REL);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { manifest, findings: verifyManifest(manifest, root) };
}

function readRootArg(argv) {
  const i = argv.indexOf('--root');
  if (i < 0) return DEFAULT_ROOT;
  const val = argv[i + 1];
  if (!val || val.startsWith('--')) throw new Error('--root ต้องตามด้วย path');
  return path.resolve(val);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const known = new Set(['--write', '--root', '--help', '-h']);
  const unknown = argv.filter((a, i) => a.startsWith('-') && !known.has(a) && argv[i - 1] !== '--root');
  if (unknown.length > 0) {
    console.error('❌ host-integrity: flag ที่ไม่รู้จัก: ' + unknown.join(', '));
    console.error('   ใช้: node tools/security/host-integrity.mjs [--write] [--root <dir>]');
    process.exit(2);
  }
  let root;
  try {
    root = readRootArg(argv);
  } catch (e) {
    console.error('❌ host-integrity: ' + e.message);
    process.exit(2);
  }
  const manifestPath = path.join(root, MANIFEST_REL);

  if (argv.includes('--write')) {
    try {
      const { manifest, findings } = writeManifest(root);
      if (findings.length > 0) {
        console.error('❌ host-integrity: เขียน manifest แล้วแต่ยังตรวจไม่ผ่าน');
        for (const f of findings) console.error('  [' + f.code + '] ' + f.file);
        process.exit(2);
      }
      console.log('✅ host-integrity: อัปเดต manifest ' + Object.keys(manifest.files).length + ' ไฟล์ (' + MANIFEST_REL + ')');
      process.exit(0);
    } catch (e) {
      console.error('❌ host-integrity: ' + e.message);
      process.exit(2);
    }
  }

  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (e) {
    console.error('❌ host-integrity: อ่าน manifest ไม่ได้ (' + MANIFEST_REL + '): ' + e.message);
    console.error('   ถ้ายังไม่มี manifest ให้รัน: node tools/security/host-integrity.mjs --write');
    process.exit(2);
  }

  const findings = verifyManifest(manifest, root);
  const count = Object.keys(manifest.files).length;
  if (findings.length === 0) {
    console.log('✅ host-integrity: สคริปต์ host ' + count + ' ไฟล์ตรงกับ manifest');
    process.exit(0);
  }
  console.error('❌ host-integrity: พบ ' + findings.length + ' จุดที่ไม่ตรงกับ manifest');
  for (const f of findings) {
    if (f.code === 'modified') console.error('  [modified] ' + f.file + '\n      expected ' + f.expected + '\n      actual   ' + f.actual);
    else console.error('  [' + f.code + '] ' + f.file + (f.detail ? ' — ' + f.detail : ''));
  }
  console.error('  ⇒ ถ้าเป็นการแก้ที่ตั้งใจ: ตรวจ diff ให้แน่ใจแล้วรัน --write (ต้อง commit สคริปต์ก่อน)');
  process.exit(1);
}
