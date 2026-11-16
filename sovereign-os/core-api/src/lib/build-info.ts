// src/lib/build-info.ts
// ─────────────────────────────────────────────────────────────────────────────
// "ที่รันอยู่คือ commit ไหน และ build เมื่อไร" — ตอบจาก GET /api/health
//
// ทำไมต้องมี: fingerprint บอกได้ว่า "ไฟล์ชุดเดิมหรือไม่" แต่เทียบข้าม build ไม่ได้
// และ version ก็ไม่ขยับทุก commit ⇒ เคส prod รัน build เก่า (23 ก.ย. 69: build 21 ก.ย.
// ทั้งที่โค้ดใหม่มา 2 วัน) ไม่มีใครรู้จนของพัง
//
// แหล่งข้อมูล (เรียงตามความน่าเชื่อถือ):
//   1. env `GIT_COMMIT` / `SOURCE_COMMIT` / `BUILD_TIME` — คนที่ build รู้ดีที่สุด (CI/docker)
//   2. git จริงของ checkout ที่มี .git (รัน `git rev-parse --short=12 HEAD` ครั้งเดียว)
//   3. `data/build-info.json` ที่ขั้น build เขียนไว้ (สำหรับเครื่องที่ runt ไม่มี git)
//   4. builtAt = mtime ของโฟลเดอร์โค้ดที่โปรเซสโหลด (dist = เวลา build, src = เวลาแก้ล่าสุด)
// ทุกทาง "ล้มเงียบ" คืน null — สัญญาของ /api/health คือ status:'ok' ต้องไม่พังเพราะข้อมูลเสริม
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { appVersion } from './app-version';
import { computeDirFingerprint, getLoadedCodeDir, getLoadedCodeDirLabel } from './runtime-fingerprint';

export interface BuildInfo {
  version: string | null;
  /** commit ของโค้ดชุดที่โหลดอยู่ — null = ไม่มีทางรู้ (ไม่มี env/git/build-info.json) */
  commit: string | null;
  /** เวลาที่โค้ดชุดนี้ถูก build/เขียนลงดิสก์ (ISO) */
  builtAt: string | null;
  fingerprint: string;
  files: number;
  /** 'dist' (prod build) หรือ 'src' (tsx dev) */
  loadedDir: string;
}

const COMMIT_ENV_KEYS = ['GIT_COMMIT', 'SOURCE_COMMIT', 'COMMIT_SHA'];
const BUILT_AT_ENV_KEYS = ['BUILD_TIME', 'BUILT_AT', 'BUILD_TIMESTAMP'];

/** หา root ของ repo (โฟลเดอร์ที่มี .git) ไล่ขึ้นไปไม่เกิน maxDepth ชั้น */
export function findRepoRoot(startDir: string, maxDepth = 6): string | null {
  let current = path.resolve(startDir);
  for (let i = 0; i <= maxDepth; i++) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function readBuildInfoFile(startDir: string): { commit?: unknown } | null {
  const root = findRepoRoot(startDir);
  const candidates = [path.join(startDir, 'data', 'build-info.json')];
  if (root) candidates.push(path.join(root, 'data', 'build-info.json'));
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // ไฟล์ถัดไป
    }
  }
  return null;
}

/**
 * commit ของโค้ดที่โหลดอยู่ — env ชนะเสมอ, แล้วจึง git, แล้วจึง data/build-info.json
 * คืน null แทนการโยน เพราะ health ต้องไม่ล้มเพราะเรื่องนี้
 */
export async function readGitCommit(startDir: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  for (const key of COMMIT_ENV_KEYS) {
    const value = String(env[key] ?? '').trim();
    if (value) return value;
  }

  const root = findRepoRoot(startDir);
  if (root) {
    try {
      const out = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out) return out;
    } catch {
      // ไม่มี git / รันในคอนเทนเนอร์ที่ไม่มีไบนารี git
    }
  }

  const fromFile = readBuildInfoFile(startDir);
  const commit = typeof fromFile?.commit === 'string' ? fromFile.commit.trim() : '';
  return commit || null;
}

/**
 * เวลาที่โค้ดชุดนี้ถูก build — env ชนะ, ไม่งั้น "mtime ใหม่สุด" ของไฟล์ในโฟลเดอร์ที่โหลด
 *
 * ทำไมไม่ใช้ mtime ของโฟลเดอร์: tsc เขียนทับไฟล์เดิม ⇒ mtime ของ directory ไม่ขยับบน NTFS
 * ค่าที่ได้จะค้างเป็นวันที่สร้าง build แรก — ซึ่งคือบั๊กเดิมที่เรากำลังกันอยู่
 */
export async function readBuiltAt(codeDir: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  for (const key of BUILT_AT_ENV_KEYS) {
    const value = String(env[key] ?? '').trim();
    if (value) return value;
  }
  let newest = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 12) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          const at = fs.statSync(full).mtimeMs;
          if (at > newest) newest = at;
        }
      } catch {
        // ไฟล์หายระหว่างเดิน (build ค้างเขียน) = ข้าม
      }
    }
  };
  walk(codeDir, 0);
  if (!newest) {
    // โฟลเดอร์ว่าง/อ่านไม่ได้ — ยังตอบเวลาที่มี ดีกว่า null
    try {
      return fs.statSync(codeDir).mtime.toISOString();
    } catch {
      return null;
    }
  }
  return new Date(newest).toISOString();
}

/**
 * ข้อมูลระบุตัวตนของ build ที่โปรเซสนี้รันอยู่
 * @param opts.codeDir โฟลเดอร์โค้ดที่โหลด (default = dist/src ที่โปรเซสนี้อยู่)
 * @param opts.env แทน process.env สำหรับเทสต์
 */
export async function buildInfo(opts: { codeDir?: string; env?: NodeJS.ProcessEnv } = {}): Promise<BuildInfo> {
  const codeDir = opts.codeDir ?? getLoadedCodeDir();
  const env = opts.env ?? process.env;
  const [fp, commit, builtAt] = await Promise.all([
    computeDirFingerprint(codeDir),
    readGitCommit(codeDir, env),
    readBuiltAt(codeDir, env),
  ]);
  return {
    version: appVersion(),
    commit,
    builtAt,
    fingerprint: fp.fingerprint,
    files: fp.files,
    // โฟลเดอร์ที่กำหนดเอง (เทสต์) ให้ใช้ชื่อโฟลเดอร์จริง ไม่ใช่ label dist/src ของโปรเซส
    loadedDir: opts.codeDir ? path.basename(path.resolve(codeDir)) : getLoadedCodeDirLabel(),
  };
}
