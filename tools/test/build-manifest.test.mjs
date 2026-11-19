// เทสต์ของ build provenance (tools/attest/build-manifest.mjs + ผลใน verifyDocument)
//
// สิ่งที่ต้องพิสูจน์:
//   · manifest ผนึกได้ด้วย digest ที่คำนวณซ้ำได้จากเนื้อหา (แก้แล้วจับได้)
//   · manifest ที่ผนึกใน receipt คือใบเดียวกับที่เอกสารโชว์ ⇒ ตัวตรวจรายงาน commit ได้
//   · ถ้าเอกสารกับลายเซ็นไม่ตรงกัน (แก้ commit / แก้ manifest / ไม่มีสำเนา) ต้องปฏิเสธ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalJson,
  manifestDigest,
  publicKeyFingerprint,
  receiptId,
  verifyDocument,
} from '../attest-release.mjs';
import {
  BUILD_INPUT_PATHS,
  collectBuildManifest,
  describeBuild,
  sealBuildManifest,
  verifyBuildManifest,
} from '../attest/build-manifest.mjs';

const COMMIT = 'c60773a00bf7bb69abc9c973da0722b919b6d606';

function sampleManifest(overrides = {}) {
  return sealBuildManifest({
    v: 1,
    tag: 'v9.9.9',
    commit: { sha: COMMIT, ref: 'main', dirty: false },
    toolchain: { node: 'v22.11.0', npm: '10.9.0', platform: 'linux-x64' },
    inputs: [
      { path: 'sovereign-frontend/package-lock.json', sha256: 'a'.repeat(64), size: 120 },
      { path: 'tools/build-desktop.mjs', sha256: 'b'.repeat(64), size: 40 },
    ],
    missing: [],
    ...overrides,
  });
}

// ── helpers: เซ็น receipt เองเหมือนเทสต์ของ attest-release ──
function signer() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signBody = (body) =>
    crypto.sign(null, Buffer.from(canonicalJson(body), 'utf8'), privateKey).toString('base64');
  return { publicKey: publicPem, signBody };
}

function makeReceipt(key, body) {
  return { v: 1, id: receiptId(body), keyId: 'release', publicKey: key.publicKey, body, sig: key.signBody(body) };
}

// sealed = manifest ที่ "อยู่ในลายเซ็น" (ใน meta เป็น digest+commit ล้วน),
// declared = สำเนาที่อ่านได้ในเอกสาร — ปกติเป็นตัวเดียวกัน
function docWith({ build = sampleManifest(), sealed = build, declared = build } = {}) {
  const key = signer();
  const digest = crypto.createHash('sha256').update('abc').digest('hex');
  const body = {
    v: 1,
    action: 'artifact.shipped',
    actor: 'release:v9.9.9',
    artifact: { name: 'app.exe', sha256: digest, size: 3 },
    at: 1_700_000_000_000,
    prev: null,
    meta: sealed
      ? { tag: 'v9.9.9', buildDigest: sealed.digest, buildCommit: sealed.commit.sha }
      : { tag: 'v9.9.9' },
  };
  const receipt = makeReceipt(key, body);
  const doc = {
    v: 1,
    tag: 'v9.9.9',
    keyId: 'release',
    fingerprint: publicKeyFingerprint(key.publicKey),
    at: 1_700_000_002_000,
    root: 'a'.repeat(64),
    anchor: { seq: 1 },
    artifacts: [{ name: 'app.exe', sha256: digest, size: 3, receiptId: receipt.id }],
    receipts: [receipt],
  };
  if (declared) doc.build = declared;
  return doc;
}

const problemsOf = (doc) => verifyDocument(doc).problems.join('\n');

// ── manifest: ผนึก / ตรวจรูป ──
test('sealBuildManifest: digest คำนวณซ้ำได้ และไม่นับฟิลด์ digest เดิม', () => {
  const manifest = sampleManifest();
  assert.match(manifest.digest, /^[0-9a-f]{64}$/);
  assert.equal(manifestDigest(manifest), manifest.digest);
  // ผนึกซ้ำจาก manifest ที่มี digest ติดมาแล้ว = digest เดิม (ไม่กลายเป็น hash ของ hash)
  assert.equal(sealBuildManifest(manifest).digest, manifest.digest);
  // ลำดับ key ไม่มีผล (canonical) แต่เนื้อหาเปลี่ยน = digest เปลี่ยน
  const reordered = { inputs: manifest.inputs, missing: [], tag: manifest.tag, v: 1, toolchain: manifest.toolchain, commit: manifest.commit };
  assert.equal(manifestDigest(reordered), manifest.digest);
  const otherCommit = sampleManifest({ commit: { sha: 'd'.repeat(40), ref: 'main', dirty: false } });
  assert.notEqual(otherCommit.digest, manifest.digest);
});

test('verifyBuildManifest: ผ่านเมื่อครบ และจับ dirty / digest เพี้ยน / ไม่มี input', () => {
  const good = verifyBuildManifest(sampleManifest());
  assert.equal(good.ok, true, good.problems?.join('; '));

  const dirty = verifyBuildManifest(sampleManifest({ commit: { sha: COMMIT, ref: 'main', dirty: true } }));
  assert.equal(dirty.ok, false);
  assert.match(dirty.problems.join('\n'), /ไม่สะอาด/);
  // ตัวเซ็นยอมรับ dirty ได้ (เครื่องนักพัฒนา) แต่ผู้ตรวจปลายทางต้องเห็น
  assert.equal(verifyBuildManifest(sampleManifest({ commit: { sha: COMMIT, ref: 'main', dirty: true } }), { allowDirty: true }).ok, true);

  const tampered = { ...sampleManifest() };
  tampered.commit = { ...tampered.commit, sha: 'e'.repeat(40) };
  assert.match(verifyBuildManifest(tampered).problems.join('\n'), /ถูกแก้หลังผนึก/);

  const noInputs = sampleManifest({ inputs: [] });
  assert.match(verifyBuildManifest(noInputs).problems.join('\n'), /ไม่มี input/);

  const badSha = sampleManifest({ commit: { sha: 'abc', ref: 'main', dirty: false } });
  assert.match(verifyBuildManifest(badSha).problems.join('\n'), /sha ผิดรูป/);
});

// ── เก็บ manifest จาก repo ──
function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-manifest-'));
  for (const rel of BUILD_INPUT_PATHS.slice(0, 3)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `bytes-of-${rel}`);
  }
  return root;
}

test('collectBuildManifest: commit/ref/dirty จาก git, input แฮชจริง, ไฟล์ที่หายถูกบันทึก', () => {
  const root = tempRoot();
  try {
    const calls = [];
    const runGit = (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return COMMIT;
      if (args[0] === 'rev-parse') return 'main';
      if (args[0] === 'status') return '';
      throw new Error(`คำสั่ง git ที่ไม่คาดคิด: ${args.join(' ')}`);
    };
    const manifest = collectBuildManifest({
      root,
      tag: 'v9.9.9',
      runGit,
      env: { npm_config_user_agent: 'npm/10.9.0 node/v22.11.0 linux x64' },
      nodeVersion: 'v22.11.0',
    });

    assert.equal(manifest.commit.sha, COMMIT);
    assert.equal(manifest.commit.ref, 'main');
    assert.equal(manifest.commit.dirty, false);
    assert.equal(manifest.toolchain.npm, '10.9.0');
    assert.equal(manifest.inputs.length, 3);
    assert.equal(manifest.missing.length, BUILD_INPUT_PATHS.length - 3);
    assert.ok(manifest.missing.includes('.github/workflows/release.yml'));
    // แฮชที่บันทึกคือแฮชของไฟล์จริง
    const first = manifest.inputs[0];
    const bytes = fs.readFileSync(path.join(root, first.path));
    assert.equal(first.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(first.size, bytes.length);
    assert.equal(verifyBuildManifest(manifest).ok, true, verifyBuildManifest(manifest).problems.join('; '));
    assert.ok(calls.includes('rev-parse HEAD'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collectBuildManifest: working tree ไม่สะอาด ⇒ dirty และผู้ตรวจเตือน', () => {
  const root = tempRoot();
  try {
    const manifest = collectBuildManifest({
      root,
      tag: 'v9.9.9',
      runGit: (args) => (args[0] === 'rev-parse' && args[1] === 'HEAD' ? COMMIT : args[0] === 'status' ? ' M tools/x.mjs' : 'main'),
    });
    assert.equal(manifest.commit.dirty, true);
    assert.match(verifyBuildManifest(manifest).problems.join('\n'), /ไม่สะอาด/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collectBuildManifest: ไม่มี git ⇒ ล้มด้วย E_NO_GIT ไม่ปล่อย manifest ปลอม', () => {
  const root = tempRoot();
  try {
    assert.throws(
      () => collectBuildManifest({ root, tag: 'v9.9.9', runGit: () => { throw new Error('not a git repository'); } }),
      (error) => error.code === 'E_NO_GIT'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── ตัวตรวจ: รายงาน commit และจับการแก้เอกสาร ──
test('verifyDocument: manifest ที่ผนึกในลายเซ็น ⇒ รายงาน commit/toolchain/digest ได้', () => {
  const doc = docWith();
  const report = verifyDocument(doc);
  assert.equal(report.ok, true, report.problems?.join('; '));
  assert.equal(report.build.commit.sha, COMMIT);
  assert.equal(report.build.commit.dirty, false);
  assert.equal(report.build.digest, doc.build.digest);
  assert.equal(report.build.inputs, 2);
  assert.match(describeBuild(report.build), new RegExp(COMMIT.slice(0, 12)));
  assert.match(describeBuild(report.build), /input 2 ไฟล์/);
});

test('verifyDocument: แก้ commit/manifest ในเอกสารหลังเซ็น ⇒ ปฏิเสธ', () => {
  const tamperedCommit = docWith();
  tamperedCommit.build = { ...tamperedCommit.build, commit: { ...tamperedCommit.build.commit, sha: 'f'.repeat(40) } };
  assert.match(problemsOf(tamperedCommit), /ถูกแก้หลังเซ็น/);

  // digest ถูกแก้ให้ตรงกับเนื้อหาใหม่ แต่ลายเซ็นยังผนึก manifest เก่า ⇒ ยังจับได้
  const forged = sealBuildManifest(sampleManifest({ commit: { sha: 'f'.repeat(40), ref: 'main', dirty: false } }));
  assert.match(problemsOf(docWith({ declared: forged })), /ไม่ตรงกับที่ผนึกไว้ในใบที่เซ็น/);

  // manifest เดียวกันแต่ commit ถูกสลับ ⇒ จับได้ที่ commit ที่ผนึกไว้
  const swapped = { ...sampleManifest(), commit: { sha: '9'.repeat(40), ref: 'main', dirty: false } };
  const reSealed = sealBuildManifest(swapped);
  assert.match(problemsOf(docWith({ declared: reSealed })), /ไม่ตรงกับที่ผนึกไว้ในใบที่เซ็น|commit ใน build manifest/);
});

test('verifyDocument: เอกสารมี manifest แต่ใบที่เซ็นไม่ได้ผนึก (หรือกลับกัน) ⇒ ปฏิเสธ', () => {
  const unsigned = docWith({ sealed: null });
  assert.match(problemsOf(unsigned), /ไม่มีใบที่เซ็นแล้วผนึกมันไว้/);

  const sealedOnly = docWith({ declared: null });
  assert.match(problemsOf(sealedOnly), /ไม่มีสำเนาให้อ่าน/);

  const wrongDigest = docWith();
  wrongDigest.build = { ...wrongDigest.build, digest: 'c'.repeat(64) };
  assert.match(problemsOf(wrongDigest), /ถูกแก้หลังเซ็น/);

  const noSha = docWith();
  noSha.build = { ...noSha.build, commit: { ...noSha.build.commit, sha: 'nope' } };
  assert.match(problemsOf(noSha), /ถูกแก้หลังเซ็น|commit sha/);
});

test('verifyDocument: เอกสารเก่าที่ไม่มี provenance ยังตรวจผ่าน (ไม่ทำให้ release เดิมใช้ไม่ได้)', () => {
  const doc = docWith({ declared: null, sealed: null });
  const report = verifyDocument(doc);
  assert.equal(report.ok, true, report.problems?.join('; '));
  assert.equal(report.build, null);
});
