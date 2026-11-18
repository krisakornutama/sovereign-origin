// เทสต์ของ tools/attest-release.mjs
//
// ตัวตรวจ (verifyDocument) ต้องเชื่อถือได้ด้วย node:crypto ล้วน ⇒ เทสต์จึงสร้าง
// receipt เองแบบอิสระจาก sovereign-attest แล้วยืนยันว่าเครื่องตรวจยอมรับ/ปฏิเสธ
// ถูกใบ — ถ้าวันหนึ่ง attest เปลี่ยนรูปแบบ เทสต์ integration ด้านล่างจะจับได้
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ATTESTATION_FILE,
  canonicalJson,
  collectArtifacts,
  describeArtifacts,
  publicKeyFingerprint,
  receiptId,
  verifyDocument,
} from '../attest-release.mjs';

const ATTEST_DIST = path.resolve(import.meta.dirname, '..', '..', '..', 'sovereign-attest', 'dist', 'index.js');
const VAULT_DIST = path.resolve(import.meta.dirname, '..', '..', '..', 'sovereign-vault', 'dist', 'index.js');
const hasSiblings = fs.existsSync(ATTEST_DIST) && fs.existsSync(VAULT_DIST);

// ── ตัวช่วย: เซ็น receipt แบบเดียวกับ sovereign-attest แต่ทำในเทสต์ ──
function signer() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signBody = (body) =>
    crypto.sign(null, Buffer.from(canonicalJson(body), 'utf8'), privateKey).toString('base64');
  return { publicKey: publicPem, signBody };
}

function makeReceipt(key, body) {
  return {
    v: 1,
    id: receiptId(body),
    keyId: 'release',
    publicKey: key.publicKey,
    body,
    sig: key.signBody(body),
  };
}

function bodyFor({ action = 'artifact.shipped', name, digest, prev = null, at = 1_700_000_000_000 }) {
  return {
    v: 1,
    action,
    actor: 'release:v9.9.9',
    artifact: { name, sha256: digest, size: 3 },
    at,
    prev,
    meta: { tag: 'v9.9.9' },
  };
}

function makeDoc({ chain = false } = {}) {
  const key = signer();
  const digest = crypto.createHash('sha256').update('abc').digest('hex');
  const first = makeReceipt(key, bodyFor({ name: 'app.exe', digest }));
  const second = chain
    ? makeReceipt(key, bodyFor({ name: 'app.exe', digest, prev: first.id, at: 1_700_000_001_000 }))
    : null;
  return {
    doc: {
      v: 1,
      tag: 'v9.9.9',
      keyId: 'release',
      fingerprint: publicKeyFingerprint(key.publicKey),
      at: 1_700_000_002_000,
      root: 'a'.repeat(64),
      anchor: { seq: 1 },
      artifacts: [{ name: 'app.exe', sha256: digest, size: 3, receiptId: (second ?? first).id }],
      receipts: second ? [first, second] : [first],
    },
    digest,
  };
}

function expectProblem(doc, pattern, options) {
  const report = verifyDocument(doc, options);
  assert.equal(report.ok, false, 'ควรตรวจไม่ผ่าน');
  assert.match(report.problems.join('\n'), pattern);
}

// ── canonical form / helper ──
test('canonicalJson เรียง key และ normalize ค่าแบบเดียวกับ sovereign-attest', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, -0] }), '{"a":[2,0],"b":1}');
  assert.throws(() => canonicalJson({ a: Number.NaN }), /จำกัด/);
  assert.throws(() => canonicalJson({ a: 1n }), /ใช้ในเอกสารไม่ได้/);
});

test('collectArtifacts ข้ามไฟล์ attestation กับ checksum และเรียงชื่อ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-rel-'));
  try {
    for (const name of ['b.zip', 'SHA256SUMS.txt', 'a.exe', ATTESTATION_FILE]) {
      fs.writeFileSync(path.join(dir, name), 'x');
    }
    assert.deepEqual(collectArtifacts(dir), ['a.exe', 'b.zip']);
    const described = describeArtifacts(dir, ['a.exe']);
    assert.equal(described[0].size, 1);
    assert.equal(described[0].sha256, crypto.createHash('sha256').update('x').digest('hex'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('publicKeyFingerprint ปฏิเสธกุญแจที่ไม่ใช่ ed25519', () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(
    () => publicKeyFingerprint(publicKey.export({ type: 'spki', format: 'pem' }).toString()),
    /ed25519/
  );
});


// ── rotation: ใบที่กุญแจเก่า endorse กุญแจใหม่ ──
function rotationStatement(oldPair, newPair, at = 1_700_000_050_000) {
  const body = {
    v: 1,
    from: { keyId: 'release', publicKey: oldPair.publicKey },
    to: { keyId: 'release-2', publicKey: newPair.publicKey },
    at,
  };
  return {
    ...body,
    sig: crypto.sign(null, Buffer.from(canonicalJson(body), 'utf8'), oldPair.privateKey).toString('base64'),
  };
}

function makeDocWithRotation({ withRotation = true, forged = false } = {}) {
  const oldPair = crypto.generateKeyPairSync('ed25519');
  const newPair = crypto.generateKeyPairSync('ed25519');
  const oldPem = oldPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const newPem = newPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const digest = crypto.createHash('sha256').update('abc').digest('hex');

  const oldKey = {
    publicKey: oldPem,
    signBody: (body) =>
      crypto.sign(null, Buffer.from(canonicalJson(body), 'utf8'), oldPair.privateKey).toString('base64'),
  };
  const newKey = {
    publicKey: newPem,
    signBody: (body) =>
      crypto.sign(null, Buffer.from(canonicalJson(body), 'utf8'), newPair.privateKey).toString('base64'),
  };

  const first = { ...makeReceipt(oldKey, bodyFor({ name: 'app.exe', digest })), keyId: 'release' };
  const second = {
    ...makeReceipt(newKey, bodyFor({ name: 'app.exe', digest, prev: first.id, at: 1_700_000_100_000 })),
    keyId: 'release-2',
  };
  const statement = rotationStatement(
    { publicKey: oldPem, privateKey: oldPair.privateKey },
    { publicKey: newPem, privateKey: newPair.privateKey }
  );
  const doc = {
    v: 1,
    tag: 'v9.9.9',
    keyId: 'release-2',
    fingerprint: publicKeyFingerprint(newPem),
    at: 1_700_000_200_000,
    root: 'a'.repeat(64),
    anchor: { seq: 1 },
    artifacts: [{ name: 'app.exe', sha256: digest, size: 3, receiptId: second.id }],
    receipts: [first, second],
  };
  if (withRotation) {
    doc.rotations = [
      forged
        ? {
            ...statement,
            sig: crypto
              .sign(null, Buffer.from(canonicalJson({ ...statement, sig: undefined }).replace(/,?"sig":null/, ''), 'utf8'), crypto.generateKeyPairSync('ed25519').privateKey)
              .toString('base64'),
          }
        : statement,
    ];
  }
  return doc;
}

// ── ตัวตรวจ ──
test('เอกสารที่เซ็นถูกต้องผ่าน และรายงานจำนวน artifact/receipt', () => {
  const { doc } = makeDoc({ chain: true });
  const report = verifyDocument(doc, { fingerprint: doc.fingerprint });
  assert.equal(report.ok, true, report.problems.join('; '));
  assert.equal(report.artifacts, 1);
  assert.equal(report.receipts, 2);
});

test('เอกสารที่ไม่มี fingerprint ของกุญแจถูกปฏิเสธ (pin ไม่ได้)', () => {
  const { doc } = makeDoc();
  delete doc.fingerprint;
  expectProblem(doc, /pin ไม่ได้/);
});

test('fingerprint ที่ pin ไว้ไม่ตรงถูกปฏิเสธ', () => {
  const { doc } = makeDoc();
  expectProblem(doc, /fingerprint ไม่ตรงกับที่ pin/, { fingerprint: 'b'.repeat(32) });
});

test('fingerprint ในเอกสารที่ไม่ตรงกับ public key ถูกปฏิเสธ', () => {
  const { doc } = makeDoc();
  doc.fingerprint = 'c'.repeat(32);
  expectProblem(doc, /ไม่ตรงกับ public key/);
});

test('body ที่ถูกแก้ทำให้ id ไม่ตรง', () => {
  const { doc } = makeDoc();
  doc.receipts[0].body.action = 'artifact.shipped-but-different';
  expectProblem(doc, /ไม่ตรง hash ของ body/);
});

test('ลายเซ็นของกุญแจอื่นถูกปฏิเสธ', () => {
  const { doc } = makeDoc();
  const other = signer();
  doc.receipts[0].sig = other.signBody(doc.receipts[0].body);
  expectProblem(doc, /ลายเซ็นไม่ผ่าน/);
});

test('receipt ที่เซ็นด้วย keyId อื่นถูกปฏิเสธเมื่อไม่มี rotation รองรับ', () => {
  const { doc } = makeDoc();
  doc.receipts[0].keyId = 'other';
  expectProblem(doc, /ไม่ใช่ "release"/);
});

test('chain ที่ขาดใบกลางถูกปฏิเสธ', () => {
  const { doc } = makeDoc({ chain: true });
  doc.receipts = [doc.receipts[1]];
  expectProblem(doc, /ขาด receipt/);
});

test('receipt ที่พูดถึง digest อื่นถูกปฏิเสธ', () => {
  const { doc } = makeDoc();
  doc.receipts[0].body.artifact.sha256 = 'd'.repeat(64);
  doc.receipts[0].id = receiptId(doc.receipts[0].body);
  doc.receipts[0].sig = signer().signBody(doc.receipts[0].body);
  expectProblem(doc, /ไม่ได้พูดถึง digest|ลายเซ็นไม่ผ่าน/);
});

test('artifact ที่ชี้ receipt ที่ไม่มีในเอกสารถูกปฏิเสธ', () => {
  const { doc } = makeDoc();
  doc.artifacts[0].receiptId = 'e'.repeat(64);
  expectProblem(doc, /ชี้ receipt ที่ไม่มีในเอกสาร/);
});

test('เอกสารว่างหรือผิดเวอร์ชันถูกปฏิเสธ', () => {
  expectProblem({ v: 2, artifacts: [], receipts: [] }, /เวอร์ชันเอกสารไม่รองรับ/);
  expectProblem({ v: 1, artifacts: [], receipts: [] }, /ไม่มี artifact/);
  assert.throws(() => verifyDocument(null), /อ่านไม่ได้/);
});


test('เอกสารข้ามรอยต่อกุญแจผ่านได้เมื่อมี rotation ที่กุญแจเก่า endorse', () => {
  const doc = makeDocWithRotation();
  const report = verifyDocument(doc, { fingerprint: doc.fingerprint });
  assert.equal(report.ok, true, report.problems.join('; '));
  assert.equal(report.receipts, 2);
});

test('ไม่มีใบ rotation ⇒ receipt ของกุญแจใหม่ถูกปฏิเสธ', () => {
  const doc = makeDocWithRotation({ withRotation: false });
  expectProblem(doc, /ไม่ได้อยู่ในความเชื่อของเอกสาร/);
});

test('ใบ rotation ที่ลายเซ็นไม่ผ่านถูกปฏิเสธ', () => {
  const doc = makeDocWithRotation();
  doc.rotations[0].at = doc.rotations[0].at + 1;
  expectProblem(doc, /ลายเซ็นไม่ผ่าน/);
});


test('artifact ที่มี receipt เพิกถอนใน chain ถูกปฏิเสธ (และผ่านเมื่อสั่ง allowRevoked)', () => {
  const key = signer();
  const digest = crypto.createHash('sha256').update('abc').digest('hex');
  const shipped = makeReceipt(key, bodyFor({ name: 'app.exe', digest }));
  const revoked = makeReceipt(
    key,
    bodyFor({ name: 'app.exe', digest, prev: shipped.id, action: 'artifact.revoked', at: 1_700_000_002_000 })
  );
  const doc = {
    v: 1,
    tag: 'v9.9.9',
    keyId: 'release',
    fingerprint: publicKeyFingerprint(key.publicKey),
    at: 1_700_000_003_000,
    root: 'a'.repeat(64),
    anchor: { seq: 1 },
    artifacts: [{ name: 'app.exe', sha256: digest, size: 3, receiptId: revoked.id }],
    receipts: [shipped, revoked],
  };
  const report = verifyDocument(doc);
  assert.equal(report.ok, false);
  assert.match(report.problems.join(String.fromCharCode(10)), /ถูกเพิกถอน/);

  const allowed = verifyDocument(doc, { allowRevoked: true });
  assert.equal(allowed.ok, true, allowed.problems.join('; '));
});

test('restore หลัง revoke ทำให้ตรวจผ่านได้ตามปกติ', () => {
  const key = signer();
  const digest = crypto.createHash('sha256').update('abc').digest('hex');
  const shipped = makeReceipt(key, bodyFor({ name: 'app.exe', digest }));
  const revoked = makeReceipt(
    key,
    bodyFor({ name: 'app.exe', digest, prev: shipped.id, action: 'artifact.revoked', at: 1_700_000_002_000 })
  );
  const restored = makeReceipt(
    key,
    bodyFor({ name: 'app.exe', digest, prev: revoked.id, action: 'artifact.restored', at: 1_700_000_004_000 })
  );
  const doc = {
    v: 1,
    tag: 'v9.9.9',
    keyId: 'release',
    fingerprint: publicKeyFingerprint(key.publicKey),
    at: 1_700_000_005_000,
    root: 'a'.repeat(64),
    anchor: { seq: 1 },
    artifacts: [{ name: 'app.exe', sha256: digest, size: 3, receiptId: restored.id }],
    receipts: [shipped, revoked, restored],
  };
  const report = verifyDocument(doc);
  assert.equal(report.ok, true, report.problems.join('; '));
});

// ── กุญแจแบบพกพา (CI: secret → import เข้า vault ของรอบนั้น) ──
test(
  'signing key ที่ import ให้ fingerprint เดิมทุกครั้ง แม้ state dir ใหม่',
  { skip: hasSiblings ? false : 'sibling repos ยังไม่ถูก build' },
  async () => {
    const { keyInfo } = await import('../attest-release.mjs');
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'attest-k1-'))];
    dirs.push(fs.mkdtempSync(path.join(os.tmpdir(), 'attest-k2-')));
    try {
      const first = await keyInfo({ keyId: 'release', stateDir: dirs[0], signingKeyPem: pem, now: () => 1 });
      const second = await keyInfo({ keyId: 'release', stateDir: dirs[1], signingKeyPem: pem, now: () => 2 });
      assert.equal(first.fingerprint, second.fingerprint);
      assert.equal(first.publicKey, second.publicKey);
    } finally {
      for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// ── integration กับของจริง (ข้ามเมื่อ sibling repo ยังไม่ถูก build) ──
test(
  'เซ็นด้วย sovereign-attest จริงแล้วตรวจกลับด้วยตัวตรวจของ tool ได้',
  { skip: hasSiblings ? false : 'sibling repos ยังไม่ถูก build' },
  async () => {
    const { signRelease } = await import('../attest-release.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-sign-'));
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-state-'));
    try {
      fs.writeFileSync(path.join(dir, 'app-1.3.10.exe'), 'portable');
      fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), 'sums');

      const first = await signRelease({
        dir,
        tag: 'v1.3.10',
        out: dir,
        keyId: 'release',
        stateDir,
        masterKey: new Uint8Array(32).fill(5),
        now: () => 1_700_000_000_000,
      });
      assert.equal(first.doc.artifacts.length, 1);
      assert.equal(first.doc.artifacts[0].name, 'app-1.3.10.exe');
      const verified = verifyDocument(first.doc, { fingerprint: first.doc.fingerprint });
      assert.equal(verified.ok, true, verified.problems.join('; '));

      // รุ่นถัดไป: chain ต้องต่อจากใบเดิม แม้ vault จะเป็นตัวใหม่
      const nextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-sign2-'));
      try {
        fs.writeFileSync(path.join(nextDir, 'app-1.3.10.exe'), 'portable');
        const second = await signRelease({
          dir: nextDir,
          tag: 'v1.3.11',
          out: nextDir,
          keyId: 'release',
          stateDir,
          masterKey: new Uint8Array(32).fill(5),
          previousFile: first.file,
          now: () => 1_700_000_500_000,
        });
        const head = second.doc.receipts.find((receipt) => receipt.id === second.doc.artifacts[0].receiptId);
        assert.equal(head.body.prev, first.doc.artifacts[0].receiptId);
        const chainReport = verifyDocument(second.doc, { fingerprint: second.doc.fingerprint });
        assert.equal(chainReport.ok, true, chainReport.problems.join('; '));
        assert.ok(chainReport.receipts >= 2);
      } finally {
        fs.rmSync(nextDir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
);

test(
  'เพิกถอนด้วยกุญแจจริงแล้วตัวตรวจปฏิเสธ และ restore คืนสถานะได้',
  { skip: hasSiblings ? false : 'sibling repos ยังไม่ถูก build' },
  async () => {
    const { signRelease, revokeRelease } = await import('../attest-release.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-rev-'));
    const revokedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-rev2-'));
    const restoredDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-rev3-'));
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-revstate-'));
    try {
      fs.writeFileSync(path.join(dir, 'app-1.3.10.exe'), 'portable');
      const masterKey = new Uint8Array(32).fill(9);
      const signed = await signRelease({
        dir,
        tag: 'v1.3.10',
        out: dir,
        keyId: 'release',
        stateDir,
        masterKey,
        now: () => 1_700_000_000_000,
      });

      for (const sub of [revokedDir, restoredDir]) {
        fs.writeFileSync(path.join(sub, 'app-1.3.10.exe'), 'portable');
      }

      const revoked = await revokeRelease({
        action: 'artifact.revoked',
        dir: revokedDir,
        tag: 'v1.3.10',
        out: revokedDir,
        reason: 'บิลด์นี้ถูกลบออกจากช่องทางดาวน์โหลด',
        actor: 'security:release',
        keyId: 'release',
        stateDir,
        masterKey,
        previousFile: signed.file,
        now: () => 1_700_000_100_000,
      });
      // ใบเพิกถอนต้องต่อจากใบที่เซ็นไปแล้ว ไม่ใช่เริ่ม chain ใหม่
      assert.equal(revoked.doc.receipts.find((r) => r.id === revoked.doc.artifacts[0].receiptId).body.prev,
        signed.doc.artifacts[0].receiptId);
      const rejected = verifyDocument(revoked.doc, { fingerprint: signed.doc.fingerprint });
      assert.equal(rejected.ok, false);
      assert.match(rejected.problems.join(String.fromCharCode(10)), /ถูกเพิกถอน/);
      assert.equal(
        verifyDocument(revoked.doc, { fingerprint: signed.doc.fingerprint, allowRevoked: true }).ok,
        true
      );

      const restored = await revokeRelease({
        action: 'artifact.restored',
        dir: restoredDir,
        tag: 'v1.3.10',
        out: restoredDir,
        reason: 'ตรวจแล้วปล่อยใช้งานต่อ',
        actor: 'security:release',
        keyId: 'release',
        stateDir,
        masterKey,
        previousFile: revoked.file,
        now: () => 1_700_000_200_000,
      });
      const backToNormal = verifyDocument(restored.doc, { fingerprint: signed.doc.fingerprint });
      assert.equal(backToNormal.ok, true, backToNormal.problems.join('; '));
    } finally {
      for (const target of [dir, revokedDir, restoredDir, stateDir]) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
  }
);
