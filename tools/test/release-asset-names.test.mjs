// release-asset-names — ชื่อไฟล์ใน SHA256SUMS ต้องตรงกับชื่อ asset ที่ GitHub ปล่อยจริง
//
// เจอของจริงจาก Release v1.3.1: manifest เขียน "Sovereign OS-1.3.1-win.zip" (เว้นวรรค)
// แต่ GitHub เปลี่ยนเป็น "Sovereign.OS-1.3.1-win.zip" ⇒ `sha256sum -c` ใช้ไม่ได้เลย
// ทั้งที่เนื้อไฟล์ถูกต้อง (hash ตรง) — ผู้ใช้จึงตรวจสอบการดาวน์โหลดไม่ได้
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { githubAssetName, parseChecksumManifest, stageReleaseArtifacts } from '../release-build.mjs';

test('githubAssetName: แทนอักขระที่ GitHub ไม่รับด้วยจุด', () => {
  assert.equal(githubAssetName('Sovereign OS-1.3.1-win.zip'), 'Sovereign.OS-1.3.1-win.zip');
  assert.equal(githubAssetName('Sovereign-OS-1.3.1-portable.exe'), 'Sovereign-OS-1.3.1-portable.exe');
  assert.equal(githubAssetName('a b c.zip'), 'a.b.c.zip');
});

test('stage: ชื่อใน SHA256SUMS ตรงกับชื่อไฟล์ที่ถูกปล่อย', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relstage-'));
  const dist = path.join(root, 'dist');
  const out = path.join(root, 'out');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'Sovereign OS-9.9.9-win.zip'), 'zip-bytes');
  fs.writeFileSync(path.join(dist, 'Sovereign-OS-9.9.9-portable.exe'), 'exe-bytes');

  const res = await stageReleaseArtifacts({ distDir: dist, outDir: out, version: '9.9.9' });
  const staged = fs.readdirSync(out).filter((n) => n !== 'SHA256SUMS.txt').sort();
  assert.deepEqual(staged, ['Sovereign-OS-9.9.9-portable.exe', 'Sovereign.OS-9.9.9-win.zip']);

  const rows = parseChecksumManifest(fs.readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8'));
  assert.deepEqual(rows.map((r) => r.name).sort(), staged);
  assert.ok(res.files.every((n) => n === githubAssetName(n)), 'ชื่อที่คืนต้องเป็นชื่อที่ปล่อยได้แล้ว');

  fs.rmSync(root, { recursive: true, force: true });
});
