// release-check — ด่าน "พร้อมปล่อยแพทช์หรือยัง" ก่อน push tag
//
// เขียนก่อน implementation (red-first): tools/release-check.mjs ยังไม่มีตอนรันรอบแรก
// ทำไมต้องมี: workflow ปล่อยรุ่นหยุดทันทีถ้า tag ไม่ตรง version ใน packages และ
// ถ้า CHANGELOG ไม่มีหัวข้อของรุ่นนั้น ผู้ใช้จะไม่ได้ know what changed
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkChangelogSection,
  checkReleaseReadiness,
  checkUnreleasedEmpty,
  checkVersionsAligned,
} from '../release-check.mjs';

const changelogOk = `# CHANGELOG

## [Unreleased]

---

## [v1.3.1] — 2026-11-11 (released)

- ปิดช่องโหว่ OTA
`;

test('versions: ทุก package ต้องตรงกับรุ่นที่จะปล่อย', () => {
  const aligned = checkVersionsAligned({ root: '1.3.1', api: '1.3.1', frontend: '1.3.1' }, '1.3.1');
  assert.equal(aligned.ok, true);

  const drifted = checkVersionsAligned({ root: '1.0.0', api: '1.0.0', frontend: '1.3.1' }, '1.3.1');
  assert.equal(drifted.ok, false);
  assert.equal(drifted.failures.length, 2, 'ต้องชี้ทั้งสองไฟล์ที่ยังไม่ bump');
  assert.match(drifted.failures.join(' '), /root.*1\.0\.0/);
});

test('changelog: ต้องมีหัวข้อ v<version> พร้อมวันที่', () => {
  assert.equal(checkChangelogSection(changelogOk, '1.3.1').ok, true);

  const missing = checkChangelogSection(changelogOk, '1.3.2');
  assert.equal(missing.ok, false);
  assert.match(missing.failures.join(' '), /v1\.3\.2/);

  const noDate = checkChangelogSection('## [v1.3.1] — ยังไม่ระบุ\n', '1.3.1');
  assert.equal(noDate.ok, false, 'หัวข้อที่ไม่มีวันที่ต้องไม่ผ่าน');
});

test('changelog: [Unreleased] ต้องว่างก่อนปล่อย', () => {
  assert.equal(checkUnreleasedEmpty(changelogOk).ok, true);

  const leftover = changelogOk.replace('## [Unreleased]\n', '## [Unreleased]\n\n- งานที่ยังไม่ปิด\n');
  const res = checkUnreleasedEmpty(leftover);
  assert.equal(res.ok, false);
  assert.match(res.failures.join(' '), /Unreleased/);
});

test('readiness: รวมผลและสรุปว่าติดอะไร', () => {
  const ready = checkReleaseReadiness({ versions: { root: '1.3.1', api: '1.3.1', frontend: '1.3.1' }, changelog: changelogOk, expectedVersion: '1.3.1' });
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.failures, []);

  const notReady = checkReleaseReadiness({
    versions: { root: '1.0.0', api: '1.0.0', frontend: '1.3.1' },
    changelog: changelogOk.replace('## [Unreleased]\n', '## [Unreleased]\n\n- ค้าง\n'),
    expectedVersion: '1.3.1',
  });
  assert.equal(notReady.ok, false);
  assert.ok(notReady.failures.length >= 3, `ต้องรายงานครบทุกจุด (ได้ ${notReady.failures.length})`);
});
