#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// release-dry-run.mjs — ซ้อมเส้นทาง provenance ของ release โดยไม่ปล่อยอะไรจริง
//
// ทำไมต้องมี:
//   ขั้นตอนเซ็น/แนบ/ประกาศ fingerprint ใน release.yml ถูกปิดด้วยสวิตช์และทำงานเฉพาะ
//   ตอนออก release จริง ⇒ ถ้าพัง จะรู้ตัวตอนนั้นซึ่งสายเกินไป ตัวนี้จึงรันขั้นตอน
//   เดียวกันด้วย "กุญแจชั่วคราว" (ไม่แตะ secret จริง) แล้วตรวจว่าผลลัพธ์พร้อมแนบ:
//     · เซ็น artifact ด้วยเส้นทางเดียวกับ CI (signRelease) ได้ใบที่ตรวจกลับผ่าน
//     · ใบรับรองอยู่โฟลเดอร์เดียวกับของที่จะอัปโหลด และไม่ถูกนับเป็น artifact
//     · release notes ที่จะประกาศ มี fingerprint + คำสั่งตรวจที่ใช้ได้จริง
//     · สวิตช์ปิด ⇒ notes บอกตรง ๆ ว่าไม่มีใบรับรอง (ไม่เงียบ)
//     · ไฟล์ที่ notes สั่งให้ผู้ใช้โหลด มีอยู่จริงใน repo
//
// ใช้: node tools/release-dry-run.mjs        (exit 0 = พร้อมปล่อย)
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTESTATION_FILE,
  collectArtifacts,
  publicKeyFingerprint,
  verifyArtifacts,
  verifyDocument,
} from './attest/document.mjs';
import { renderReleaseNotes } from './attest/release-notes.mjs';
import {
  collectBuildManifest,
  describeBuild,
  sealBuildManifest,
  verifyBuildManifest,
} from './attest/build-manifest.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAG = 'v0.0.0-dry-run';
const problems = [];
const ok = (label) => console.log(`PASS ${label}`);
const bad = (label, detail) => {
  problems.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};
const expect = (condition, label, detail) => (condition ? ok(label) : bad(label, detail));

/** กุญแจชั่วคราวสำหรับซ้อม — ไม่ใช่กุญแจ release และไม่ถูกเก็บที่ไหน */
function ephemeralKey() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-dry-run-'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-dry-run-state-'));
  try {
    fs.writeFileSync(path.join(dir, 'Sovereign-OS-0.0.0-portable.exe'), 'portable-bytes');
    fs.writeFileSync(path.join(dir, 'Sovereign-OS-0.0.0-win-x64.zip'), 'zip-bytes');
    fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), 'sums');

    // build provenance ของรอบซ้อม: ข้อมูลสังเคราะห์ (ไม่ใช่ commit จริง) เพื่อให้ผลคงที่
    const provenance = sealBuildManifest({
      v: 1,
      tag: TAG,
      commit: { sha: 'a'.repeat(40), ref: 'main', dirty: false },
      toolchain: { node: process.version, npm: '10.0.0', platform: 'linux-x64' },
      inputs: [{ path: 'sovereign-frontend/package-lock.json', sha256: 'b'.repeat(64), size: 3 }],
      missing: [],
    });

    const pem = ephemeralKey();
    const { publicKeyFromPrivate, signRelease } = await import('./attest-release.mjs');
    const signed = await signRelease({
      dir,
      tag: TAG,
      out: dir,
      keyId: 'release',
      stateDir,
      masterKey: new Uint8Array(32).fill(7),
      signingKeyPem: pem,
      buildManifest: provenance,
      now: () => Date.now(),
    });
    ok('เซ็น artifact ด้วยเส้นทางเดียวกับ CI (signRelease)');

    const docFile = path.join(dir, ATTESTATION_FILE);
    expect(fs.existsSync(docFile), 'ใบรับรองอยู่ในโฟลเดอร์ที่จะแนบ release (release-assets/*)');

    const report = verifyDocument(signed.doc, { fingerprint: signed.doc.fingerprint });
    expect(report.ok, 'ตัวตรวจยอมรับใบที่เพิ่งเซ็น', report.problems?.join('; '));
    expect(
      signed.doc.fingerprint === publicKeyFingerprint(publicKeyFromPrivate(pem)),
      'fingerprint ในเอกสารตรงกับกุญแจที่เซ็น'
    );

    const files = verifyArtifacts(signed.doc, dir);
    expect(files.ok, 'แฮชไฟล์จริงตรงกับใบรับรอง', files.problems?.join('; '));

    // build provenance: ตัวตรวจต้องบอกได้ว่าไบต์ที่เซ็นมาจาก commit ไหน
    expect(
      report.build?.commit.sha === provenance.commit.sha,
      'ตัวตรวจรายงาน commit ที่ผนึกไว้ในใบที่เซ็น',
      JSON.stringify(report.build)
    );
    expect(report.build?.digest === provenance.digest, 'manifest ในเอกสารเป็นใบเดียวกับที่ผนึก');
    expect(
      describeBuild(report.build).includes(provenance.commit.sha.slice(0, 12)),
      'สรุป build provenance อ่านออกว่าไบต์มาจาก commit ไหน'
    );

    const tamperedBuild = JSON.parse(JSON.stringify(signed.doc));
    tamperedBuild.build = {
      ...tamperedBuild.build,
      commit: { ...tamperedBuild.build.commit, sha: 'f'.repeat(40) },
    };
    expect(!verifyDocument(tamperedBuild, {}).ok, 'แก้ commit ใน build manifest หลังเซ็น ⇒ ตัวตรวจปฏิเสธ');

    const liveManifest = collectBuildManifest({ root: ROOT, tag: TAG });
    expect(
      /^[0-9a-f]{40}$/.test(liveManifest.commit.sha),
      'เก็บ manifest จาก repo จริงได้ commit SHA',
      liveManifest.commit.sha
    );
    expect(
      liveManifest.inputs.length >= 5,
      `manifest จาก repo จริงมี input ที่แฮชแล้ว ≥ 5 ไฟล์ (ได้ ${liveManifest.inputs.length})`
    );
    const liveCheck = verifyBuildManifest(liveManifest, { allowDirty: true });
    expect(liveCheck.ok, 'manifest จาก repo จริงตรวจรูปผ่าน', liveCheck.problems.join('; '));
    expect(
      !collectArtifacts(dir).includes(ATTESTATION_FILE),
      'ใบรับรองไม่ถูกนับเป็น artifact ที่ต้องเซ็น (กันการเซ็นใบของตัวเอง)'
    );

    const notes = renderReleaseNotes({
      tag: TAG,
      fingerprint: signed.doc.fingerprint,
      verifierUrl: 'https://example.invalid/release-verify.html',
    });
    expect(notes.includes(signed.doc.fingerprint), 'release notes ประกาศ fingerprint');
    expect(notes.includes(`--fingerprint=${signed.doc.fingerprint}`), 'notes มีคำสั่งตรวจที่คัดลอกได้');
    expect(
      notes.includes('--dir=.') && notes.includes(ATTESTATION_FILE),
      'คำสั่งใน notes ตรวจไฟล์จริง (--dir) ไม่ใช่แค่อ่านเอกสาร'
    );

    const off = renderReleaseNotes({ tag: TAG, fingerprint: null, verifierUrl: 'x' });
    expect(off.includes('ไม่มี'), 'สวิตช์ปิด ⇒ notes บอกว่าไม่มีใบรับรอง');
    expect(!/[0-9a-f]{32}/.test(off), 'notes ตอนปิดสวิตช์ไม่มี fingerprint หลงเหลือ');

    for (const rel of ['tools/attest-release.mjs', 'tools/attest/document.mjs']) {
      expect(fs.existsSync(path.join(ROOT, rel)), `ไฟล์ที่ notes สั่งให้ผู้ใช้โหลดมีจริง: ${rel}`);
    }

    const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(workflow.includes('--pin-key'), 'release.yml ตรวจใบรับรองด้วยกุญแจที่ pin ไว้');
    expect(workflow.includes('release-notes.md'), 'release.yml เขียน release notes จาก fingerprint');
    expect(
      workflow.includes("files: release-assets/*"),
      'release.yml แนบทุกไฟล์ใน release-assets (รวมใบรับรอง)'
    );
    expect(workflow.includes('build-manifest'), 'release.yml ผนึก build manifest ก่อนเซ็น');
    expect(/--build-manifest=|--provenance/.test(workflow), 'release.yml ส่ง manifest ให้ขั้นเซ็น');
    expect(workflow.includes('--build-commit'), 'release.yml ยืนยันว่าไบต์มาจาก commit ที่โหลดมา');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    console.error(`\n✖ dry-run ไม่ผ่าน ${problems.length} ข้อ — ห้ามออก release จนแก้ให้ผ่าน`);
    process.exit(1);
  }
  console.log('\n✅ dry-run ผ่าน: เส้นทางเซ็น → แนบ → ประกาศ fingerprint พร้อมใช้งาน');
}

main().catch((error) => {
  console.error(`✖ ${error.code ?? 'E_DRY_RUN'}: ${error.message}`);
  process.exit(1);
});
