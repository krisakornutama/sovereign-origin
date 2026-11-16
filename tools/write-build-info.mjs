#!/usr/bin/env node
// เขียนตราประทับ build ลง `sovereign-os/core-api/data/build-info.json`
//
// ทำไมต้องมี: คอนเทนเนอร์ core-api เมานต์แค่ `src` + `data` (ไม่มี .git) และไม่ได้ตั้ง
// GIT_COMMIT ⇒ /api/health ตอบ commit = null ทั้งที่ควรตอบได้ (ยืนยันของจริง 16/11/69
// ด้วย `docker inspect` + curl :3001) ไฟล์นี้คือทางเดียวที่ทำให้คอนเทนเนอร์รู้ commit
//
// ใช้:
//   node tools/write-build-info.mjs              # เขียน stamp จาก HEAD ปัจจุบัน
//   node tools/write-build-info.mjs --check      # exit 1 ถ้า stamp เก่ากว่า HEAD/ไม่มีไฟล์
//   node tools/write-build-info.mjs --json       # พิมพ์ JSON (สำหรับสคริปต์)
//   node tools/deploy-core-api.mjs                # เขียน stamp + restart + ตรวจ health (ทางที่ควรใช้)
//
// ไฟล์อยู่ใต้ `core-api/data/` ซึ่ง gitignore ไว้แล้ว — เป็นของ generated
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_STAMP = path.join(ROOT, 'sovereign-os', 'core-api', 'data', 'build-info.json');

/** รูปร่างของ stamp — commit เก็บสองแบบ (12 ตัวสำหรับแสดงผล, full สำหรับเทียบ) */
export function buildStampPayload({ commitFull, branch, dirty, now = new Date() }) {
  const full = String(commitFull ?? '').trim();
  return {
    commit: full ? full.slice(0, 12) : null,
    commitFull: full || null,
    branch: String(branch ?? '').trim() || null,
    dirty: !!dirty,
    builtAt: now.toISOString(),
    writtenBy: 'tools/write-build-info.mjs',
  };
}

/** อ่าน stamp แบบไม่โยน — ไม่มีไฟล์/JSON เสีย = null */
export function readStampFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * เทียบ stamp กับ HEAD: 'ok' | 'stale' | 'missing'
 * เทียบแบบ prefix เพราะ stamp เก็บ 12 ตัวแรก ส่วน HEAD อาจเป็น 40 ตัว
 */
export function stampStatus(stamp, head) {
  const stamped = String(stamp?.commit ?? '').trim();
  const current = String(head ?? '').trim();
  if (!stamped) return 'missing';
  if (!current) return 'missing';
  if (stamped === current) return 'ok';
  if (current.startsWith(stamped) || stamped.startsWith(current.slice(0, stamped.length))) return 'ok';
  return 'stale';
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** เขียน stamp ลงดิสก์ คืน payload ที่เขียน */
export function writeStamp(file = DEFAULT_STAMP, { commitFull, branch, dirty } = {}) {
  const payload = buildStampPayload({
    commitFull: commitFull ?? git(['rev-parse', 'HEAD']),
    branch: branch ?? git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: dirty ?? git(['status', '--porcelain']).length > 0,
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return payload;
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const json = argv.includes('--json');
  const stampFile = argValue(argv, '--stamp') || DEFAULT_STAMP;
  const headArg = argValue(argv, '--head');

  if (check) {
    const head = headArg || git(['rev-parse', 'HEAD']);
    const stamp = readStampFile(stampFile);
    const status = stampStatus(stamp, head);
    if (json) {
      console.log(JSON.stringify({ status, stamp: stamp ?? null, head: head || null }));
    } else if (status === 'ok') {
      console.log(`✓ build-info ตรงกับ HEAD (${String(head).slice(0, 12)})`);
    } else if (status === 'missing') {
      console.error(`✗ ยังไม่มี build-info ที่ใช้ได้ (${path.relative(ROOT, stampFile)}) — รัน: node tools/write-build-info.mjs`);
    } else {
      console.error(
        `✗ build-info เก่ากว่า HEAD — stamp ${stamp?.commit} แต่ HEAD ${String(head).slice(0, 12)}\n` +
          '  ถ้า restart ตอนนี้ /api/health จะรายงาน commit เก่า ⇒ รัน: node tools/deploy-core-api.mjs',
      );
    }
    return status === 'ok' ? 0 : 1;
  }

  const payload = writeStamp(stampFile, headArg ? { commitFull: headArg } : {});
  if (json) {
    console.log(JSON.stringify({ written: path.relative(ROOT, stampFile), ...payload }));
  } else {
    console.log(
      `✓ เขียน ${path.relative(ROOT, stampFile)} — commit ${payload.commit ?? 'ไม่ทราบ'}` +
        `${payload.dirty ? ' (working tree มีการแก้ที่ยังไม่ commit)' : ''}`,
    );
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
