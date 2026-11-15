// release-build — ด่าน Release Automation: คัด artifact, SHA256SUMS, tag ↔ version, workflow
// เขียนก่อน implementation (red-first): ไฟล์ ../release-build.mjs ยังไม่มีตอนรันรอบแรก
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHECKSUM_FILE,
  assertTagMatchesVersion,
  buildChecksumManifest,
  collectDesktopArtifacts,
  parseChecksumManifest,
  sha256File,
  stageReleaseArtifacts,
  verifyChecksumFile,
} from '../release-build.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const codeIs = (code) => (e) => e && e.code === code;

const tmpDir = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `sovereign-release-${label}-`));
const cleanup = (t, dir) => t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// ── 1) คัดเฉพาะ artifact ของเวอร์ชันที่กำลังปล่อย ───────────────────────────────
test('collectDesktopArtifacts ตัดของรุ่นเก่าและไฟล์แปลกปลอมออก', () => {
  const picked = collectDesktopArtifacts(
    [
      'Sovereign-OS-1.2.0-portable.exe',
      'Sovereign-OS-1.2.1-portable.exe',
      'Sovereign OS-1.2.0-win.zip',
      'Sovereign OS-1.2.1-win.zip',
      'builder-debug.yml',
      'win-unpacked',
    ],
    '1.2.1'
  );

  assert.deepEqual(picked.portable, ['Sovereign-OS-1.2.1-portable.exe']);
  assert.deepEqual(picked.zips, ['Sovereign OS-1.2.1-win.zip']);
});

test('collectDesktopArtifacts ไม่ match อะไรเลย = ลิสต์ว่าง (ให้ caller ตายพร้อมเหตุผล)', () => {
  const picked = collectDesktopArtifacts(['Sovereign-OS-1.2.0-portable.exe'], '1.2.1');
  assert.deepEqual(picked, { portable: [], zips: [] });
});

// ── 2) รูปแบบ SHA256SUMS.txt ───────────────────────────────────────────────────
test('buildChecksumManifest เรียงตามชื่อ + ใช้ "<hash>␣␣<ไฟล์>" + ลงท้าย newline', () => {
  const text = buildChecksumManifest([
    { name: 'Sovereign-OS-1.2.1-portable.exe', hash: HASH_A },
    { name: 'Sovereign OS-1.2.1-win.zip', hash: HASH_B },
  ]);

  // ช่องว่าง (32) มาก่อนขีด (45) ในการเรียงแบบ code unit
  assert.equal(text, `${HASH_B}  Sovereign OS-1.2.1-win.zip\n${HASH_A}  Sovereign-OS-1.2.1-portable.exe\n`);
});

test('buildChecksumManifest ปฏิเสธ hash ผิดรูป / ชื่อไฟล์อันตราย / ชื่อซ้ำ', () => {
  assert.throws(() => buildChecksumManifest([{ name: 'a.exe', hash: 'xyz' }]), codeIs('E_HASH'));
  assert.throws(
    () => buildChecksumManifest([{ name: '../evil.exe', hash: HASH_A }]),
    codeIs('E_UNSAFE_NAME')
  );
  assert.throws(
    () =>
      buildChecksumManifest([
        { name: 'a.exe', hash: HASH_A },
        { name: 'a.exe', hash: HASH_B },
      ]),
    codeIs('E_DUPLICATE')
  );
  assert.throws(() => buildChecksumManifest([]), codeIs('E_EMPTY'));
});

test('parseChecksumManifest อ่านบรรทัดมาตรฐานและแบบ binary (*) ได้', () => {
  const rows = parseChecksumManifest(`${HASH_A}  a.exe\n${HASH_B} *b.zip\n\n`);
  assert.deepEqual(rows, [
    { name: 'a.exe', hash: HASH_A },
    { name: 'b.zip', hash: HASH_B },
  ]);
});

test('parseChecksumManifest ปฏิเสธ hash สั้น/ไม่ใช่ hex/คั่นด้วยช่องเดียว/พาธหลบหนี', () => {
  assert.throws(() => parseChecksumManifest(`${'a'.repeat(63)}  a.exe\n`), codeIs('E_BAD_LINE'));
  assert.throws(() => parseChecksumManifest(`${'z'.repeat(64)}  a.exe\n`), codeIs('E_BAD_LINE'));
  assert.throws(() => parseChecksumManifest(`${HASH_A} a.exe\n`), codeIs('E_BAD_LINE'));
  assert.throws(() => parseChecksumManifest(`${HASH_A}  ../evil.exe\n`), codeIs('E_UNSAFE_NAME'));
  assert.throws(() => parseChecksumManifest(''), codeIs('E_EMPTY'));
});

// ── 3) ตรวจไฟล์จริงกับ manifest ────────────────────────────────────────────────
test('verifyChecksumFile ผ่านเมื่อไฟล์ครบ และจับ mismatch/missing ได้', async (t) => {
  const dir = tmpDir('verify');
  cleanup(t, dir);

  fs.writeFileSync(path.join(dir, 'a.exe'), 'alpha');
  fs.writeFileSync(path.join(dir, 'b.zip'), 'beta');
  const manifest = buildChecksumManifest([
    { name: 'a.exe', hash: await sha256File(path.join(dir, 'a.exe')) },
    { name: 'b.zip', hash: await sha256File(path.join(dir, 'b.zip')) },
  ]);
  fs.writeFileSync(path.join(dir, CHECKSUM_FILE), manifest, 'utf8');

  const ok = await verifyChecksumFile(dir);
  assert.equal(ok.ok, true);
  assert.equal(ok.checked, 2);
  assert.deepEqual(ok.failures, []);

  fs.appendFileSync(path.join(dir, 'a.exe'), 'tampered');
  const bad = await verifyChecksumFile(dir);
  assert.equal(bad.ok, false);
  assert.deepEqual(
    bad.failures.map((f) => f.name),
    ['a.exe']
  );
  assert.equal(bad.failures[0].reason, 'mismatch');

  fs.rmSync(path.join(dir, 'b.zip'));
  const missing = await verifyChecksumFile(dir);
  assert.equal(missing.ok, false);
  assert.ok(missing.failures.some((f) => f.name === 'b.zip' && f.reason === 'missing'));
});

// ── 4) stage: คัดลอก + เขียน + ตรวจกลับในรอบเดียว ─────────────────────────────
test('stageReleaseArtifacts คัดเฉพาะเวอร์ชัน + เขียน SHA256SUMS ที่ตรวจกลับได้', async (t) => {
  const dist = tmpDir('dist');
  const out = tmpDir('out');
  cleanup(t, dist);
  cleanup(t, out);

  fs.writeFileSync(path.join(dist, 'Sovereign-OS-1.2.1-portable.exe'), 'exe-bytes');
  fs.writeFileSync(path.join(dist, 'Sovereign OS-1.2.1-win.zip'), 'zip-bytes');
  fs.writeFileSync(path.join(dist, 'Sovereign-OS-1.2.0-portable.exe'), 'stale');
  fs.writeFileSync(path.join(dist, 'builder-debug.yml'), 'debug');

  const res = await stageReleaseArtifacts({ distDir: dist, outDir: out, version: '1.2.1' });

  assert.deepEqual(res.files.slice().sort(), [
    'Sovereign-OS-1.2.1-portable.exe',
    'Sovereign.OS-1.2.1-win.zip',
  ]);
  assert.deepEqual(fs.readdirSync(out).sort(), [
    CHECKSUM_FILE,
    'Sovereign.OS-1.2.1-win.zip',
    'Sovereign-OS-1.2.1-portable.exe',
  ].sort());
  assert.equal(fs.existsSync(path.join(out, 'Sovereign-OS-1.2.0-portable.exe')), false);
  assert.equal(fs.readFileSync(path.join(out, 'Sovereign-OS-1.2.1-portable.exe'), 'utf8'), 'exe-bytes');

  const manifest = parseChecksumManifest(fs.readFileSync(path.join(out, CHECKSUM_FILE), 'utf8'));
  assert.equal(manifest.length, 2);
  assert.equal((await verifyChecksumFile(out)).ok, true);
});

test('stageReleaseArtifacts ตายเมื่อไม่มี exe หรือไม่มี zip', async (t) => {
  const out = tmpDir('out-empty');
  cleanup(t, out);

  const exeOnly = tmpDir('dist-exe');
  cleanup(t, exeOnly);
  fs.writeFileSync(path.join(exeOnly, 'Sovereign-OS-1.2.1-portable.exe'), 'only-exe');
  await assert.rejects(
    stageReleaseArtifacts({ distDir: exeOnly, outDir: out, version: '1.2.1' }),
    codeIs('E_NO_ZIP')
  );

  const empty = tmpDir('dist-empty');
  cleanup(t, empty);
  await assert.rejects(
    stageReleaseArtifacts({ distDir: empty, outDir: out, version: '1.2.1' }),
    codeIs('E_NO_EXE')
  );
});

// ── 5) ด่าน tag ↔ version ─────────────────────────────────────────────────────
test('assertTagMatchesVersion รับเฉพาะ tag ที่ตรงกับ version ใน package.json', () => {
  assert.equal(assertTagMatchesVersion('v1.2.1', '1.2.1'), '1.2.1');
  assert.equal(assertTagMatchesVersion('v1.3.0-beta.1', '1.3.0-beta.1'), '1.3.0-beta.1');
  assert.throws(() => assertTagMatchesVersion('v1.2.1', '1.2.0'), codeIs('E_TAG_VERSION'));
  assert.throws(() => assertTagMatchesVersion('1.2.1', '1.2.1'), codeIs('E_TAG_FORMAT'));
  assert.throws(() => assertTagMatchesVersion('v1.2', '1.2.1'), codeIs('E_TAG_FORMAT'));
  assert.throws(() => assertTagMatchesVersion('v1.2.1', ''), codeIs('E_VERSION'));
});

// ── 6) สัญญาของ workflow ──────────────────────────────────────────────────────
test('release.yml ทำงานเมื่อ push tag, build บน Windows, แนบ exe/zip/SHA256SUMS ขึ้น Release', () => {
  const file = path.join(ROOT, '.github', 'workflows', 'release.yml');
  assert.equal(fs.existsSync(file), true, 'ต้องมี .github/workflows/release.yml');

  const raw = fs.readFileSync(file, 'utf8');
  // ตัด comment ออกก่อนตรวจ — กันบรรทัดที่ถูกคอมเมนต์ทำให้เทสต์ผ่านหลอก
  const yml = raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  assert.match(yml, /^on:\s*$/m, 'ต้องมีคีย์ on:');
  assert.match(yml, /^ {2}push:\s*$/m, 'ต้อง trigger จาก push');
  assert.match(yml, /^ {4}tags:\s*$/m, 'ต้อง trigger จาก tag');
  assert.match(yml, /^ {6}- ['"]v\*['"]\s*$/m, 'tag ต้องเป็น v*');

  assert.match(yml, /runs-on:\s*windows-latest/, 'portable .exe ต้อง build บน Windows runner');
  assert.match(yml, /permissions:\s*\n\s*contents:\s*write/, 'ต้องมีสิทธิ์เขียน Release');

  assert.match(yml, /npx prisma generate/, 'ต้อง generate Prisma client ก่อน build sidecar');
  assert.match(yml, /working-directory:\s*sovereign-os\/core-api/, 'ต้อง build core-api (sidecar)');
  assert.match(yml, /npm run build:static/, 'ต้อง build static export');
  assert.match(yml, /electron-builder\s+--win/, 'ต้องแพ็ก portable exe + zip');

  assert.match(yml, /release-build\.mjs\s+--check-tag/, 'ต้องดัก tag ไม่ตรง version ก่อน build');
  assert.match(yml, /release-build\.mjs\s+--stage/, 'ต้อง stage artifact + เขียน SHA256SUMS');
  assert.match(yml, /release-build\.mjs\s+--verify/, 'ต้องตรวจ SHA256SUMS ก่อนปล่อย');
  assert.match(yml, /SHA256SUMS\.txt/, 'ต้องอัปโหลด SHA256SUMS.txt');
  assert.match(yml, /files:\s*release-assets\/\*/, 'ต้องแนบไฟล์จาก staging dir ทั้งชุด');
  assert.match(yml, /softprops\/action-gh-release@(v2|[0-9a-f]{40})|gh release create/, 'ต้องสร้าง GitHub Release');
  assert.match(yml, /fail_on_unmatched_files:\s*true/, 'ไฟล์ไม่ครบต้อง fail ไม่ปล่อย release เปล่า');
  assert.doesNotMatch(yml, /actions\/upload-release-asset/, 'ห้ามใช้ action ที่ถูก deprecate');
});
