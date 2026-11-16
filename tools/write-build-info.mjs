#!/usr/bin/env node
// เขียนตราประทับ build ลง `sovereign-os/core-api/data/build-info.json`
//
// ทำไมต้องมี: คอนเทนเนอร์ core-api เมานต์แค่ `src` + `data` (ไม่มี .git) และไม่ได้ตั้ง
// GIT_COMMIT ⇒ /api/health ตอบ commit = null ทั้งที่ควรตอบได้ (ยืนยันของจริง 16/11/69
// ด้วย `docker inspect` + curl :3001) ไฟล์นี้คือทางเดียวที่ทำให้คอนเทนเนอร์รู้ commit
//
// ใช้: `node tools/write-build-info.mjs` ก่อน `docker restart sovereign-core-api`
// (ไฟล์อยู่ใต้ `core-api/data/` ซึ่ง gitignore ไว้แล้ว — เป็นของ generated)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'sovereign-os', 'core-api', 'data', 'build-info.json');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const commitFull = git(['rev-parse', 'HEAD']);
const dirty = git(['status', '--porcelain']).length > 0;
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

const info = {
  commit: commitFull ? commitFull.slice(0, 12) : null,
  commitFull: commitFull || null,
  branch: branch || null,
  dirty,
  builtAt: new Date().toISOString(),
  writtenBy: 'tools/write-build-info.mjs',
};

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, JSON.stringify(info, null, 2) + '\n', 'utf8');

console.log(
  `✓ เขียน ${path.relative(ROOT, TARGET)} — commit ${info.commit ?? 'ไม่ทราบ'}${dirty ? ' (working tree มีการแก้ที่ยังไม่ commit)' : ''}`,
);
