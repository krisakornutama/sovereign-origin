#!/usr/bin/env node
/* ── ด่าน integrity ของสคริปต์ host ─────────────────────────────────────────────
   เหตุจริง: เครื่องนี้เคยมี scheduled task ของ malware ที่เขียน `Add-MpPreference`
   (SEC-037) และมีนโยบาย Defender ถูกเขียนกลับหลังบูต (SEC-032) — สคริปต์ที่รัน
   ด้วยสิทธิ์ admin/ถูกเรียกจาก scheduled task จึงเป็นจุดที่ต้องรู้ทันทีว่า "เปลี่ยนไป"

   เทสต์นี้ล็อก 4 เรื่อง:
     1) ตัวเก็บไฟล์ป้องกัน เก็บครบและไม่เก็บเกิน (ไม่รวมตัวด่านเอง/manifest)
     2) ตรวจ drift ได้ครบ: ไฟล์ถูกแก้ · ไฟล์ใหม่ที่ยังไม่อยู่ใน manifest · ไฟล์หาย
     3) `--write` สร้าง manifest ซ้ำได้ไบต์เดิม (idempotent) และไม่ยอมเขียนทับตอนไฟล์ยังไม่ commit
     4) ของจริงในเรโป: สคริปต์ host ทุกตัวมี hash ใน manifest และตรงกับไฟล์ปัจจุบัน
   ────────────────────────────────────────────────────────────────────────────── */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_REL,
  SELF_REL,
  DEFAULT_ROOT,
  collectProtected,
  buildManifest,
  verifyManifest,
  loadManifest,
  writeManifest,
  refuseIfDirty,
  sha256,
} from '../security/host-integrity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP_ROOT = path.join(ROOT, '.freebuff', 'tmp'); // ที่พักชั่วคราวอยู่บนไดรฟ์โปรเจ็ก (AGENTS ข้อ 7)
const TOOL = path.join(ROOT, 'tools', 'security', 'host-integrity.mjs');

let sandbox;
beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  sandbox = fs.mkdtempSync(path.join(TMP_ROOT, 'integrity-'));
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function put(relPath, text) {
  const full = path.join(sandbox, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

/** sandbox มาตรฐาน: 2 สคริปต์ใน tools/security + 2 ตัวที่ tools/root + 1 ไฟล์ที่ไม่เกี่ยว */
function seedSandbox() {
  put('tools/security/a.ps1', "Write-Output 'a'\n");
  put('tools/security/b.cmd', '@echo off\r\necho b\r\n');
  put('tools/run-hidden.vbs', 'WScript.Quit 0\r\n');
  put('tools/repair-shell.cmd', '@echo off\r\n');
  put('tools/notes.txt', 'not a host script\n');
}

describe('เก็บไฟล์ที่ต้องป้องกัน', () => {
  test('เก็บ .ps1/.cmd/.mjs ใน tools/security + ไฟล์ host ที่ tools/root — ไม่เก็บไฟล์อื่น', () => {
    seedSandbox();
    put('tools/security/guard.mjs', 'export const x = 1;\n');
    assert.deepEqual(collectProtected(sandbox), [
      'tools/repair-shell.cmd',
      'tools/run-hidden.vbs',
      'tools/security/a.ps1',
      'tools/security/b.cmd',
      'tools/security/guard.mjs',
    ]);
  });

  test('ไม่เก็บตัวด่านเองและไม่เก็บ manifest (จะ hash ตัวเองไม่ได้)', () => {
    seedSandbox();
    put(SELF_REL, '// self\n');
    put(MANIFEST_REL, '{}\n');
    const files = collectProtected(sandbox);
    assert.ok(!files.includes(SELF_REL), 'ต้องไม่เก็บ ' + SELF_REL);
    assert.ok(!files.includes(MANIFEST_REL), 'ต้องไม่เก็บ ' + MANIFEST_REL);
  });
});

describe('ตรวจ drift', () => {
  test('ไฟล์ตรงกับ manifest = ไม่มี finding', () => {
    seedSandbox();
    const manifest = buildManifest(sandbox);
    assert.equal(manifest.algorithm, 'sha256');
    assert.deepEqual(verifyManifest(manifest, sandbox), []);
  });

  test('ไฟล์ถูกแก้ = finding "modified" พร้อมชื่อไฟล์', () => {
    seedSandbox();
    const manifest = buildManifest(sandbox);
    put('tools/security/a.ps1', "Write-Output 'a' # injected\n");
    const findings = verifyManifest(manifest, sandbox);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'modified');
    assert.equal(findings[0].file, 'tools/security/a.ps1');
    assert.notEqual(findings[0].expected, findings[0].actual);
  });

  test('ไฟล์ใหม่ที่ยังไม่อยู่ใน manifest = finding "unlisted" (กันการเพิ่มสคริปต์เงียบ ๆ)', () => {
    seedSandbox();
    const manifest = buildManifest(sandbox);
    put('tools/security/evil.cmd', '@echo off\r\npowershell -enc AAAA\r\n');
    const findings = verifyManifest(manifest, sandbox);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'unlisted');
    assert.equal(findings[0].file, 'tools/security/evil.cmd');
  });

  test('ไฟล์ใน manifest หายไปจากดิสก์ = finding "missing"', () => {
    seedSandbox();
    const manifest = buildManifest(sandbox);
    fs.rmSync(path.join(sandbox, 'tools/security/b.cmd'));
    const findings = verifyManifest(manifest, sandbox);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'missing');
    assert.equal(findings[0].file, 'tools/security/b.cmd');
  });

  test('manifest ที่ format ผิด = โยน error อ่านไม่ได้ (ไม่เงียบ)', () => {
    seedSandbox();
    const bad = put(MANIFEST_REL, '{ "version": 1, "files": [] }\n');
    assert.throws(() => loadManifest(bad), /files/);
  });
});

describe('--write', () => {
  test('สร้าง manifest แล้วตรวจซ้ำผ่าน และเขียนซ้ำได้ไบต์เดิม', () => {
    seedSandbox();
    const first = writeManifest(sandbox);
    const buf1 = fs.readFileSync(path.join(sandbox, MANIFEST_REL));
    const second = writeManifest(sandbox);
    const buf2 = fs.readFileSync(path.join(sandbox, MANIFEST_REL));
    assert.deepEqual(first.findings, []);
    assert.deepEqual(second.findings, []);
    assert.ok(buf1.equals(buf2), 'เขียนซ้ำต้องได้ไบต์เดิม (idempotent)');
    assert.deepEqual(verifyManifest(loadManifest(path.join(sandbox, MANIFEST_REL)), sandbox), []);
  });

  test('ไม่ยอมเขียนทับตอนสคริปต์ยังไม่ commit (กันล้างร่องรอยในเครื่อง)', () => {
    const files = ['tools/security/a.ps1'];
    assert.throws(
      () => refuseIfDirty(sandbox, files, { runGit: () => 'tools/security/a.ps1\n' }),
      /ยังไม่ commit/
    );
    assert.doesNotThrow(() => refuseIfDirty(sandbox, files, { runGit: () => '' }));
  });

  test('ไม่มี git ในเครื่อง/ไม่ใช่ repo = ไม่บล็อกการเขียน (แต่ยังรายงาน)', () => {
    const files = ['tools/security/a.ps1'];
    const out = refuseIfDirty(sandbox, files, {
      runGit: () => {
        throw new Error('git not found');
      },
    });
    assert.deepEqual(out, []);
  });
});

describe('CLI', () => {
  test('ไม่มี manifest = exit 2 พร้อมบอกให้รัน --write', () => {
    seedSandbox();
    const r = spawnSync(process.execPath, [TOOL, '--root', sandbox], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /--write/);
  });

  test('ตรงกัน = exit 0', () => {
    seedSandbox();
    writeManifest(sandbox);
    const r = spawnSync(process.execPath, [TOOL, '--root', sandbox], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /host-integrity/);
  });

  test('ถูกแก้ = exit 1 และบอกชื่อไฟล์', () => {
    seedSandbox();
    writeManifest(sandbox);
    put('tools/security/a.ps1', 'Write-Output "pwn"\n');
    const r = spawnSync(process.execPath, [TOOL, '--root', sandbox], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /tools\/security\/a\.ps1/);
  });

  test('flag ที่ไม่รู้จัก = exit 2 ไม่เขียนอะไร', () => {
    seedSandbox();
    const r = spawnSync(process.execPath, [TOOL, '--root', sandbox, '--wat'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.equal(fs.existsSync(path.join(sandbox, MANIFEST_REL)), false);
  });
});

describe('ของจริงในเรโป', () => {
  test('สคริปต์ host ทุกตัวที่รันด้วยสิทธิ์สูง/ถูกเรียกจาก scheduled task อยู่ในรายการ', () => {
    const files = collectProtected(DEFAULT_ROOT);
    for (const must of [
      'tools/run-hidden.vbs',
      'tools/security/host-audit.ps1',
      'tools/security/harden-host.ps1',
      'tools/security/repair-defender.ps1',
      'tools/security/repair-host-network.ps1',
      'tools/security/host-network-guard.mjs',
    ]) {
      assert.ok(files.includes(must), 'ขาด ' + must);
    }
    assert.ok(files.length >= 15, 'ควรมีอย่างน้อย 15 ไฟล์ (ได้ ' + files.length + ')');
  });

  test('manifest ที่ commit ไว้ตรงกับไฟล์ปัจจุบัน (ด่านจริงของ CI)', () => {
    const manifest = loadManifest(path.join(DEFAULT_ROOT, MANIFEST_REL));
    const findings = verifyManifest(manifest, DEFAULT_ROOT);
    const detail = findings.map((f) => `[${f.code}] ${f.file}`).join(', ');
    assert.deepEqual(findings, [], 'manifest ไม่ตรงกับดิสก์: ' + detail + ' ⇒ รัน node tools/security/host-integrity.mjs --write');
  });

  test('manifest ไม่มี entry ของตัวเองและ hash เป็น hex 64 ตัวทั้งไฟล์', () => {
    const manifest = loadManifest(path.join(DEFAULT_ROOT, MANIFEST_REL));
    assert.equal(manifest.files[SELF_REL], undefined);
    assert.equal(manifest.files[MANIFEST_REL], undefined);
    for (const [file, hash] of Object.entries(manifest.files)) {
      assert.match(hash, /^[a-f0-9]{64}$/, file + ' hash ผิดรูป');
    }
  });

  test('sha256 ของไบต์ที่รู้จัก = ค่าคงที่ (กันอัลกอริทึมถูกเปลี่ยนเงียบ ๆ)', () => {
    assert.equal(
      sha256(Buffer.from('sovereign', 'utf8')),
      '21aef37bf4ee4959fdbe78951e41403222f6b902e0a6822daa7f0d49468714b8'
    );
  });
});
