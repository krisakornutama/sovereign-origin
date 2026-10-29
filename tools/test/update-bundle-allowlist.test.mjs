#!/usr/bin/env node
// tools/test/update-bundle-allowlist.test.mjs
// ── ชุดอัปเดตต้อง "ผ่าน allowlist ของ runner เอง" ก่อนเผยแพร่ ──────────────────
// ทำไมต้องมี (30/10/69 — เจอจริงกับเครื่อง 2):
//   pack เผยแพร่ชุดที่มี install-plan.mjs / modules.mjs / INSTALL.cmd / doctor.mjs /
//   INSTALL-CHECK.cmd แต่ ALLOWED ใน selfUpdate.mjs ไม่ได้ตาม ⇒ เครื่องลูกเรียก
//   applyUpdate() แล้ว assertSafeRel() โยน error **ก่อนดึงไฟล์แรก**
//   ⇒ เห็น update/manifest 200 แต่ไม่มี update/file เลยสักครั้ง และเงียบสนิท
//   เพราะ log อยู่ใน console ที่คนไม่ได้เปิดดู
// กติกาที่ล็อกไว้:
//   · ทุก rel ใน bundleFiles() ต้องผ่าน isAllowedUpdatePath() (ตัวเดียวกับที่ runner ใช้)
//   · path อันตราย (../, absolute, ไดรฟ์, นามสกุลนอกชุด) ต้องถูกปฏิเสธเสมอ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pack from '../agent-pack/pack.mjs';
import { isAllowedUpdatePath } from '../../sovereign-os/agent-runner/src/selfUpdate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

test('ทุกไฟล์ที่ pack จะเผยแพร่ ต้องผ่าน allowlist ของ runner (ไม่งั้นเครื่องลูกปฏิเสธทั้งชุดก่อนดาวน์โหลด)', () => {
  const files = pack.bundleFiles(ROOT);
  const rejected = files.filter((rel) => !isAllowedUpdatePath(rel));
  assert.deepEqual(
    rejected,
    [],
    `runner จะปฏิเสธทั้งชุดเพราะไฟล์เหล่านี้: ${rejected.join(', ')} — แก้ ALLOWED ใน sovereign-os/agent-runner/src/selfUpdate.mjs ให้ตรงกับ bundleFiles()`,
  );
});

test('path อันตรายต้องถูกปฏิเสธเสมอ (allowlist ต้องไม่เปิดช่องออกนอกโฟลเดอร์)', () => {
  const bad = ['../evil.mjs', 'src/../../evil.mjs', 'C:\\evil.mjs', '/etc/passwd', 'src/x.exe', 'src/x.mjs.exe', ''];
  for (const rel of bad) {
    assert.equal(isAllowedUpdatePath(rel), false, `ต้องปฏิเสธ: ${JSON.stringify(rel)}`);
  }
});

test('ไฟล์ติดตั้งที่เคยหลุด allowlist (5 ไฟล์) ต้องถูกยอมรับอย่างชัดเจน', () => {
  for (const rel of ['install-plan.mjs', 'modules.mjs', 'INSTALL.cmd', 'doctor.mjs', 'INSTALL-CHECK.cmd']) {
    assert.equal(isAllowedUpdatePath(rel), true, `ต้องยอมรับ: ${rel}`);
  }
});

test('publishUpdateBundle({ excludePaths }) — ตัดไฟล์สำหรับเครื่องรุ่นเก่าได้ และชุดที่เหลือยังครบ', () => {
  const dir = path.join(ROOT, '.freebuff', 'tmp', `update-exclude-${Date.now()}`);
  try {
    const out = pack.publishUpdateBundle({
      root: ROOT,
      dataDir: dir,
      excludePaths: ['install-plan.mjs', 'INSTALL.cmd'],
    });
    const paths = out.files.map((f) => f.path);
    assert.equal(paths.includes('install-plan.mjs'), false, 'ไฟล์ที่สั่งตัดต้องไม่อยู่ในชุด');
    assert.equal(paths.includes('INSTALL.cmd'), false);
    assert.equal(paths.includes('src/selfUpdate.mjs'), true, 'ไฟล์ runtime ต้องยังอยู่ครบ');
    assert.equal(paths.includes('run-runner.cmd'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('publishUpdateBundle ปฏิเสธชื่อไฟล์ที่สั่งตัดแต่ไม่มีในชุด (กันพิมพ์ผิดเงียบ ๆ)', () => {
  const dir = path.join(ROOT, '.freebuff', 'tmp', `update-exclude-bad-${Date.now()}`);
  try {
    assert.throws(
      () => pack.publishUpdateBundle({ root: ROOT, dataDir: dir, excludePaths: ['src/does-not-exist.mjs'] }),
      /excludePaths/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
