// build-info — "ที่รันอยู่คือ commit ไหน" ต้องตอบได้จาก /api/health
//
// เคสจริงที่ต้องกัน: prod รัน build เก่าโดยไม่มีใครรู้ (23 ก.ย. 69: build 21 ก.ย. ทั้งที่โค้ดใหม่มา 2 วัน)
// fingerprint บอกได้ว่า "ไฟล์ชุดเดิมหรือไม่" แต่ตอบไม่ได้ว่า "commit ไหน" และ "build เมื่อไร"
// ⇒ health ต้องคืน commit + builtAt และทั้งคู่ต้องเปลี่ยนเมื่อ build ใหม่
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildInfo, readGitCommit, readBuiltAt } from '../src/lib/build-info';

function makeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-info-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
  return dir;
}

test('buildInfo: คืน commit + builtAt + fingerprint จากไดเรกทอรีที่กำหนด', async () => {
  const dir = makeDir({ 'index.js': 'console.log(1);\n' });
  const info = await buildInfo({ codeDir: dir, env: { GIT_COMMIT: 'abc123def456', BUILD_TIME: '2026-11-16T10:00:00.000Z' } });

  assert.equal(info.commit, 'abc123def456');
  assert.equal(info.builtAt, '2026-11-16T10:00:00.000Z');
  assert.equal(info.files, 1);
  assert.match(info.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(info.loadedDir, path.basename(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fingerprint เปลี่ยนเมื่อ build ใหม่ (เนื้อไฟล์เปลี่ยน)', async () => {
  const dir = makeDir({ 'index.js': 'console.log(1);\n' });
  const before = await buildInfo({ codeDir: dir, env: {} });
  fs.writeFileSync(path.join(dir, 'index.js'), 'console.log(2);\n', 'utf8');
  const after = await buildInfo({ codeDir: dir, env: {} });

  assert.notEqual(after.fingerprint, before.fingerprint, 'build ใหม่ต้องได้ fingerprint ใหม่');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fingerprint คงที่เมื่อเนื้อไฟล์เหมือนเดิม (ไม่แกว่งตามเวลา/ลำดับ)', async () => {
  const dir = makeDir({ 'a.js': 'x', 'b.js': 'y' });
  const first = await buildInfo({ codeDir: dir, env: {} });
  const second = await buildInfo({ codeDir: dir, env: {} });
  assert.equal(first.fingerprint, second.fingerprint);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fingerprint เปลี่ยนเมื่อ "ไฟล์ใหม่" โผล่ขึ้นใน build (build ค้าง/ไม่ครบ)', async () => {
  const dir = makeDir({ 'index.js': 'x' });
  const before = await buildInfo({ codeDir: dir, env: {} });
  fs.writeFileSync(path.join(dir, 'extra.js'), 'y', 'utf8');
  const after = await buildInfo({ codeDir: dir, env: {} });
  assert.notEqual(after.fingerprint, before.fingerprint);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('builtAt: ใช้ BUILD_TIME ถ้าตั้งไว้ ไม่งั้นใช้เวลาของไฟล์ที่ถูกเขียนล่าสุด', async () => {
  const dir = makeDir({ 'index.js': 'x' });
  const fromFiles = await buildInfo({ codeDir: dir, env: {} });
  const fileMtime = fs.statSync(path.join(dir, 'index.js')).mtimeMs;
  // mtimeMs มีเศษทศนิยม ส่วน ISO ปัดเศษ ⇒ เทียบในระดับมิลลิวินาที
  assert.ok(Math.abs(Date.parse(String(fromFiles.builtAt)) - fileMtime) <= 5, `builtAt ${fromFiles.builtAt} vs mtime ${fileMtime}`);

  const forced = await readBuiltAt(dir, { BUILD_TIME: '2026-01-02T03:04:05.000Z' });
  assert.equal(forced, '2026-01-02T03:04:05.000Z');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('builtAt ต้องขยับเมื่อ build ใหม่ — เขียนทับไฟล์เดิมก็ต้องเห็น (เครื่อง NTFS ไม่ขยับ mtime ของโฟลเดอร์)', async () => {
  const dir = makeDir({ 'lib/index.js': 'old' });
  const before = await readBuiltAt(dir, {});
  // เขียนทับไฟล์เดิมในโฟลเดอร์ย่อย (แบบที่ tsc ทำ) ให้ mtime ต่างจากเดิมชัด ๆ
  const target = path.join(dir, 'lib', 'index.js');
  const later = new Date(Date.now() + 60_000);
  fs.writeFileSync(target, 'new', 'utf8');
  fs.utimesSync(target, later, later);
  const after = await readBuiltAt(dir, {});

  assert.notEqual(after, before, 'builtAt ต้องเปลี่ยนเมื่อ build ใหม่ทับไฟล์เดิม');
  assert.ok(Math.abs(Date.parse(String(after)) - later.getTime()) <= 5, `builtAt ${after} vs ${later.toISOString()}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('commit: env ชนะ git, ไม่มี env และไม่มี .git = null (ไม่โยน)', async () => {
  const dir = makeDir({ 'index.js': 'x' });
  assert.equal(await readGitCommit(dir, { GIT_COMMIT: 'deadbeef' }), 'deadbeef');
  assert.equal(await readGitCommit(dir, { SOURCE_COMMIT: 'cafebabe' }), 'cafebabe');
  // ไม่มี .git ใน temp dir → null (ห้าม throw ทำให้ /api/health ล้ม)
  assert.equal(await readGitCommit(dir, {}), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('commit: ไม่มี env/git แต่มี data/build-info.json = ใช้ค่าที่ประทับไว้ (ทางของคอนเทนเนอร์)', async () => {
  const dir = makeDir({ 'index.js': 'x', 'data/build-info.json': JSON.stringify({ commit: 'stamp1234567' }) });
  assert.equal(await readGitCommit(dir, {}), 'stamp1234567');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('commit: ไฟล์ประทับที่เสียหาย/ว่าง ต้องไม่ทำให้ health ล้ม', async () => {
  const dir = makeDir({ 'index.js': 'x', 'data/build-info.json': '{ not json' });
  assert.equal(await readGitCommit(dir, {}), null);
  const empty = makeDir({ 'index.js': 'x', 'data/build-info.json': JSON.stringify({ commit: '  ' }) });
  assert.equal(await readGitCommit(empty, {}), null);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
});

test('commit: อ่านจาก git จริงใน repo นี้ได้ (ตัวที่รันอยู่คือ HEAD)', async () => {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    assert.ok(true, 'ไม่มี .git (รันจาก tarball) — ข้าม');
    return;
  }
  const commit = await readGitCommit(path.join(process.cwd(), 'src'), {});
  assert.ok(commit, 'ต้องอ่าน commit จาก git ได้');
  assert.match(String(commit), /^[0-9a-f]{7,40}$/);
});

test('routes.ts: /api/health ใช้ buildInfo (commit + builtAt อยู่ใน payload)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'routes.ts'), 'utf8');
  assert.match(src, /from '\.\/lib\/build-info'/);
  assert.match(src, /buildInfo\(/);
});
