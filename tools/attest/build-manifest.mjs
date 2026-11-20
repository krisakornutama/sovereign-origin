// ─────────────────────────────────────────────────────────────────────────────
// build-manifest.mjs — ผนึก "ไบต์นี้สร้างมาจากอะไร" ไว้ในใบรับรองที่เซ็นแล้ว
//
// ทำไมต้องมี:
//   ใบรับรองเดิมบอกได้แค่ว่า "ไบต์ชุดนี้ถูกเซ็นโดยกุญแจของเจ้าของ" — ไม่ได้บอกว่า
//   ไบต์นั้นมาจากโค้ดชุดไหน ถ้าอยากรู้ว่าบิลด์มาจาก commit ใด ต้องเชื่อคำโฆษณา
//   หรือไปไล่ log ของ CI เอง ไฟล์นี้สร้าง manifest ที่ระบุ commit + toolchain +
//   แฮชของไฟล์ที่ใช้สร้าง (lockfile/build script/workflow) แล้วให้ attest-release
//   เอาไปฝังใน meta ของ receipt ⇒ manifest อยู่ในลายเซ็นเดียวกับ artifact
//
//   ขอบเขตที่ยังไม่ครอบ (โดยเจตนา): ยังไม่พิสูจน์ว่า build ซ้ำได้ 100% (reproducible)
//   manifest คือ "บันทึกที่ตรวจย้อนได้" ว่าเครื่องปล่อยบิลด์ใช้ input อะไร — ถ้า input
//   ที่ระบุไว้ต่างจากที่ผู้ตรวจมี ก็เอา manifest ไปสร้างใหม่แล้วเทียบได้
//
// ใช้:
//   node tools/attest/build-manifest.mjs --tag=v1.3.11 --out=build-manifest.json
//   node tools/attest-release.mjs --sign --dir=release-assets --tag=v1.3.11 --provenance
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeBuild, manifestDigest, sha256Hex } from './document.mjs';

// ข้อความสรุปอยู่ที่ document.mjs ⇒ ตัวตรวจ 2 ไฟล์รายงานได้โดยไม่ต้องโหลดโมดูลนี้
export { describeBuild };

export const BUILD_MANIFEST_VERSION = 1;

/**
 * ไฟล์ที่ "ถ้าเปลี่ยน ไบต์ที่ปล่อยก็เปลี่ยนตาม" — รายการตายตัวเพื่อให้ผู้ตรวจรู้
 * ล่วงหน้าว่าจะต้องเจออะไร ถ้าไฟล์หายไปจะถูกบันทึกใน `missing` ไม่ใช่หายเงียบ
 */
export const BUILD_INPUT_PATHS = [
  'sovereign-frontend/package-lock.json',
  'sovereign-os/core-api/package-lock.json',
  'sovereign-frontend/package.json',
  'sovereign-os/core-api/package.json',
  'tools/build-desktop.mjs',
  'tools/stage-release.mjs',
  'tools/release-build.mjs',
  'tools/attest-release.mjs',
  'tools/attest/document.mjs',
  '.github/workflows/release.yml',
];

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** เติม digest ให้ manifest — digest = sha256 ของ canonical JSON ที่ไม่มีฟิลด์ digest เอง */
export function sealBuildManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw fail('E_BUILD', 'build manifest ต้องเป็นออบเจกต์');
  }
  const { digest: _dropped, ...rest } = manifest;
  const sealed = { ...rest, v: rest.v ?? BUILD_MANIFEST_VERSION };
  return { ...sealed, digest: manifestDigest(sealed) };
}

/**
 * ตรวจความสอดคล้องของ manifest (ไม่ตรวจ commit ว่ามีจริงใน repo — ผู้ตรวจปลายทาง
 * ทำเองได้ด้วย git) เน้นจับ "ถูกแก้หลังเซ็น" และ "รูปแบบที่เอาไปใช้ต่อไม่ได้"
 */
export function verifyBuildManifest(manifest, options = {}) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, problems: ['build manifest ไม่ใช่ออบเจกต์'], digest: null };
  }
  if (manifest.v !== BUILD_MANIFEST_VERSION) {
    problems.push(`build manifest เวอร์ชันไม่รองรับ: ${manifest.v}`);
  }
  if (typeof manifest.tag !== 'string' || manifest.tag.length === 0) {
    problems.push('build manifest ไม่ระบุ tag');
  }
  const commit = manifest.commit;
  if (!commit || typeof commit !== 'object') {
    problems.push('build manifest ไม่มี commit');
  } else {
    if (!SHA40_RE.test(String(commit.sha))) {
      problems.push(`commit sha ผิดรูป: ${String(commit.sha).slice(0, 12)}`);
    }
    if (typeof commit.dirty !== 'boolean') problems.push('commit.dirty ต้องเป็น boolean');
    if (commit.dirty === true && !options.allowDirty) {
      problems.push('manifest มาจาก working tree ที่ไม่สะอาด (dirty) — ไบต์อาจไม่ตรงกับ commit นั้น');
    }
    if (typeof commit.ref !== 'string' || commit.ref.length === 0) {
      problems.push('commit.ref ว่าง');
    }
  }
  const toolchain = manifest.toolchain;
  if (!toolchain || typeof toolchain !== 'object' || typeof toolchain.node !== 'string') {
    problems.push('build manifest ไม่ระบุ toolchain.node');
  }
  if (!Array.isArray(manifest.inputs) || manifest.inputs.length === 0) {
    problems.push('build manifest ไม่มี input ที่ใช้สร้าง');
  } else {
    for (const input of manifest.inputs) {
      if (!input || typeof input.path !== 'string' || !SHA256_RE.test(String(input.sha256))) {
        problems.push(`input ผิดรูป: ${String(input?.path)}`);
        break;
      }
      if (typeof input.size !== 'number') {
        problems.push(`input ไม่ระบุขนาด: ${input.path}`);
        break;
      }
    }
  }
  if (manifest.missing !== undefined && !Array.isArray(manifest.missing)) {
    problems.push('missing ต้องเป็น array');
  }
  if (typeof manifest.digest !== 'string' || !SHA256_RE.test(manifest.digest)) {
    problems.push('build manifest ไม่มี digest');
  } else if (manifestDigest(manifest) !== manifest.digest) {
    problems.push('build manifest ถูกแก้หลังผนึก (digest ไม่ตรงกับเนื้อหา)');
  }
  return { ok: problems.length === 0, problems, digest: manifest.digest ?? null };
}

/** รัน git ใน root — แยกออกมาเพื่อให้เทสต์ใส่ตัวปลอมได้ */
export function defaultGitRunner(root) {
  return (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
}

function npmVersionOf(env, platform = process.platform) {
  // 1) ผู้เรียกบอกมาตรง ๆ (workflow ส่ง NPM_VERSION=$(npm --version) มา)
  const declared = String(env.NPM_VERSION ?? '').trim();
  if (/^[0-9]+\.[0-9]+\.[0-9]+/.test(declared)) return declared;
  // 2) ตอนรันผ่าน npm script มี user agent ให้อ่าน
  const match = String(env.npm_config_user_agent ?? '').match(/npm\/([0-9][0-9.]*)/);
  if (match) return match[1];
  // 3) release.yml เรียก node ตรง ๆ ⇒ ถาม npm เอง (win32: ต้องผ่าน cmd — execFileSync('npm.cmd') โดน EINVAL)
  try {
    const out =
      platform === 'win32'
        ? execFileSync(env.ComSpec ?? 'cmd', ['/c', 'npm', '--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 15000,
          }).trim()
        : execFileSync('npm', ['--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 15000,
          }).trim();
    return /^[0-9]+\.[0-9]+\.[0-9]+/.test(out) ? out : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * เก็บ manifest จาก repo จริง: commit/ref/dirty จาก git, toolchain จากโปรเซสที่รัน,
 * และแฮชของไฟล์ใน BUILD_INPUT_PATHS
 */
export function collectBuildManifest(options = {}) {
  const root = options.root ?? ROOT;
  const tag = options.tag ?? process.env.GITHUB_REF_NAME ?? 'unknown';
  const env = options.env ?? process.env;
  const runGit = options.runGit ?? defaultGitRunner(root);
  const nodeVersion = options.nodeVersion ?? process.version;

  let sha;
  let ref;
  let dirty;
  try {
    sha = runGit(['rev-parse', 'HEAD']);
    ref = runGit(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD';
    dirty = runGit(['status', '--porcelain']).length > 0;
  } catch (error) {
    if (!options.allowMissingGit) {
      throw fail(
        'E_NO_GIT',
        `อ่าน commit จาก git ไม่ได้ (${error.message}) — build provenance ต้องรู้ว่าบิลด์มาจาก commit ไหน`
      );
    }
    sha = options.fallbackSha ?? '0'.repeat(40);
    ref = 'unknown';
    dirty = true;
  }
  if (!SHA40_RE.test(sha)) {
    throw fail('E_NO_GIT', `git ให้ sha ที่ผิดรูป: ${sha.slice(0, 12)}`);
  }

  const inputs = [];
  const missing = [];
  for (const rel of BUILD_INPUT_PATHS) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      missing.push(rel);
      continue;
    }
    const bytes = fs.readFileSync(file);
    inputs.push({ path: rel, sha256: sha256Hex(bytes), size: bytes.length });
  }
  if (inputs.length === 0) {
    throw fail('E_NO_INPUTS', `ไม่พบไฟล์ที่ใช้สร้างสักไฟล์ใน ${root} — ตรวจ BUILD_INPUT_PATHS`);
  }

  return sealBuildManifest({
    v: BUILD_MANIFEST_VERSION,
    tag,
    commit: { sha, ref, dirty },
    toolchain: {
      node: nodeVersion,
      npm: npmVersionOf(env),
      platform: `${process.platform}-${process.arch}`,
    },
    inputs,
    missing,
  });
}

function argOf(argv, name, fallback) {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const manifest = collectBuildManifest({
      root: argOf(argv, 'root', ROOT),
      tag: argOf(argv, 'tag', process.env.GITHUB_REF_NAME),
    });
    const out = argOf(argv, 'out', undefined);
    if (out) fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(describeBuild(manifest));
    if (manifest.missing.length > 0) {
      console.log(`ไม่พบ input ที่ควรมี (บันทึกไว้ ไม่ตัดทิ้ง): ${manifest.missing.join(', ')}`);
    }
    if (out) console.log(`เขียน manifest → ${out}`);
  } catch (error) {
    console.error(`✖ ${error.code ?? 'E_UNKNOWN'}: ${error.message}`);
    process.exit(1);
  }
}
