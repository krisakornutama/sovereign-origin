// เทสต์ของ anti-downgrade (minVersion) — พิสูจน์ว่า "ไบต์ที่เซ็นถูกต้องแต่เก่ากว่า" ถูกจับได้
//
// หลักคิด: ลายเซ็นที่ถูกต้องไม่ได้แปลว่าเป็นเวอร์ชันที่ควรใช้ — ผู้โจมตีที่ยึดบัญชี
// (หรือ mirror) เอา release เก่าที่ยังเซ็นถูกกลับมาเสิร์ฟได้ เกณฑ์ minVersion ที่ผนึกใน
// ใบรับรอง + ที่ผู้ตรวจ pin เองจึงเป็นสิ่งที่ทำให้ rollback มองเห็นได้
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  canonicalJson,
  compareVersions,
  parseVersion,
  publicKeyFingerprint,
  receiptId,
  verifyDocument,
} from '../attest-release.mjs';

const COMMIT = 'c60773a00bf7bb69abc9c973da0722b919b6d606';
const DIGEST = crypto.createHash('sha256').update('abc').digest('hex');

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

function shippedBody({ tag, signedMin, prev = null, at = 1_700_000_000_000, buildDigest }) {
  return {
    v: 1,
    action: 'artifact.shipped',
    actor: `release:${tag}`,
    artifact: { name: 'app.exe', sha256: DIGEST, size: 3 },
    at,
    prev,
    meta: {
      tag,
      ...(signedMin ? { minVersion: signedMin } : {}),
      ...(buildDigest ? { buildDigest, buildCommit: COMMIT } : {}),
    },
  };
}

/**
 * เอกสารที่ "เซ็นถูกต้องทุกバイต์" — ใช้เป็นฐานของทุกเทสต์
 * signedMin = ค่าที่อยู่ในลายเซ็น, declaredMin = ค่าที่โชว์ในเอกสาร (ปกติเท่ากัน)
 */
function docFor({ tag = 'v1.3.11', signedMin, declaredMin = signedMin, previous = null, declaredTag } = {}) {
  const key = signer();
  const receipts = previous ?? [];
  const receipt = makeReceipt(key, shippedBody({ tag, signedMin, prev: receipts.at(-1)?.id ?? null }));
  receipts.push(receipt);
  const doc = {
    v: 1,
    tag: declaredTag ?? tag,
    keyId: 'release',
    fingerprint: publicKeyFingerprint(key.publicKey),
    at: 1_700_000_002_000,
    root: 'a'.repeat(64),
    anchor: { seq: 1 },
    artifacts: [{ name: 'app.exe', sha256: DIGEST, size: 3, receiptId: receipt.id }],
    receipts,
  };
  if (declaredMin !== undefined) doc.minVersion = declaredMin;
  return doc;
}

const problemsOf = (doc, options) => verifyDocument(doc, options).problems.join('\n');

// ── ตัวเทียบเวอร์ชัน ──
test('compareVersions: เทียบเชิงตัวเลข ไม่ใช่สตริง และ prerelease มาก่อนรุ่นจริง', () => {
  assert.equal(compareVersions('1.3.9', '1.3.11'), -1); // สตริงจะบอกตรงข้าม
  assert.equal(compareVersions('1.3.11', '1.3.9'), 1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v1.3.11', '1.3.11'), 0);
  assert.equal(compareVersions('1.3.11-rc.1', '1.3.11'), -1);
  assert.equal(compareVersions('1.4.0', '1.3.99'), 1);
  assert.equal(compareVersions('ไม่ใช่เวอร์ชัน', '1.3.11'), null);
  assert.deepEqual(parseVersion('v1.3.11'), { major: 1, minor: 3, patch: 11, pre: null });
  assert.equal(parseVersion('1.3'), null);
});

// ── ใบรับรองปกติ ──
test('เอกสารที่ประกาศ minVersion ตรงกับตัวเอง ตรวจผ่าน และรายงานเวอร์ชันได้', () => {
  const report = verifyDocument(docFor({ tag: 'v1.3.11', signedMin: '1.3.11' }));
  assert.equal(report.ok, true, report.problems?.join('; '));
  assert.equal(report.version, 'v1.3.11');
  assert.equal(report.minVersion, '1.3.11');
});

// ── หัวใจของงานนี้: rollback ──
test('rollback ถูกจับ: บิลด์ v1.3.10 ที่เซ็นถูกต้อง ถูกปฏิเสธเมื่อ pin minVersion 1.3.11', () => {
  const old = docFor({ tag: 'v1.3.10', signedMin: '1.3.10' });

  // 1) ไม่มีเกณฑ์ ⇒ ใบเก่ายังตรวจผ่าน (ลายเซ็นไม่ได้ผิด)
  assert.equal(verifyDocument(old).ok, true);

  // 2) มีเกณฑ์ ⇒ ต้องปฏิเสธ พร้อมบอกว่าเป็น rollback
  const pinned = verifyDocument(old, { minVersion: '1.3.11' });
  assert.equal(pinned.ok, false, 'ต้องไม่ผ่านเมื่อเวอร์ชันเก่ากว่าเกณฑ์');
  assert.match(pinned.problems.join('\n'), /เก่ากว่าเกณฑ์ที่ pin ไว้ 1\.3\.11/);
  assert.match(pinned.problems.join('\n'), /rollback/);

  // 3) เกณฑ์เท่ากับเวอร์ชันของไบต์ ⇒ ผ่าน
  assert.equal(verifyDocument(old, { minVersion: '1.3.10' }).ok, true);
  // 4) เกณฑ์ต่ำกว่า ⇒ ผ่าน
  assert.equal(verifyDocument(old, { minVersion: '1.3.9' }).ok, true);
});

test('ใบรับรองที่ประกาศ minVersion สูงกว่าตัวเอง (v1.3.10 แต่ minVersion 1.3.11) ⇒ ปฏิเสธ', () => {
  const inconsistent = docFor({ tag: 'v1.3.10', signedMin: '1.3.11' });
  assert.match(problemsOf(inconsistent), /เก่ากว่า minVersion ที่ใบรับรองประกาศ.*rollback/);
});

test('แก้ minVersion ในเอกสารหลังเซ็น ⇒ ปฏิเสธ (ลายเซ็นผนึกค่าเดิม)', () => {
  const doc = docFor({ tag: 'v1.3.11', signedMin: '1.3.11' });
  doc.minVersion = '1.3.0';
  assert.match(problemsOf(doc), /ต่ำกว่าที่ผนึกไว้ในใบที่เซ็น/);

  // ลบฟิลด์ออกจากเอกสารก็ไม่ได้ — ใบที่เซ็นประกาศไว้แล้ว
  const dropped = docFor({ tag: 'v1.3.11', signedMin: '1.3.11' });
  delete dropped.minVersion;
  assert.match(problemsOf(dropped), /ไม่มีสำเนาให้อ่าน \(doc\.minVersion\)/);
});

test('เอกสารอ้าง minVersion แต่ลายเซ็นไม่เคยประกาศ ⇒ ปฏิเสธ', () => {
  const unsigned = docFor({ tag: 'v1.3.11', signedMin: undefined, declaredMin: '1.3.11' });
  assert.match(problemsOf(unsigned), /ไม่มีใบที่เซ็นแล้วประกาศมัน/);
});

test('เกณฑ์ถอยหลังใน chain: ใบก่อนหน้าประกาศ 1.3.11 แต่ใบใหม่ลดเป็น 1.3.9 ⇒ ปฏิเสธ', () => {
  const key = signer();
  const first = makeReceipt(
    key,
    shippedBody({ tag: 'v1.3.11', signedMin: '1.3.11', at: 1_700_000_000_000 })
  );
  const second = makeReceipt(
    key,
    shippedBody({ tag: 'v1.3.12', signedMin: '1.3.9', prev: first.id, at: 1_700_000_001_000 })
  );
  const lowered = {
    v: 1,
    tag: 'v1.3.12',
    keyId: 'release',
    fingerprint: publicKeyFingerprint(key.publicKey),
    at: 1_700_000_002_000,
    root: 'a'.repeat(64),
    anchor: { seq: 1 },
    artifacts: [{ name: 'app.exe', sha256: DIGEST, size: 3, receiptId: second.id }],
    receipts: [first, second],
    minVersion: '1.3.9',
  };
  assert.match(problemsOf(lowered), /ลดเกณฑ์/);
});

test('pin ที่ผิดรูป / เอกสารไม่มี tag ที่เซ็นแล้ว ⇒ บอกตรง ๆ ไม่ผ่านแบบเงียบ', () => {
  assert.match(problemsOf(docFor({ tag: 'v1.3.11', signedMin: '1.3.11' }), { minVersion: 'latest' }), /ผิดรูป/);
});

// ── ไบต์เดิมถูกปล่อยซ้ำใต้ tag ใหม่ (chain มีหลาย tag) ──
function chainedDoc({ entries, declaredMin }) {
  const key = signer();
  const receipts = [];
  for (const entry of entries) {
    const previous = receipts.at(-1);
    receipts.push(makeReceipt(key, shippedBody({ ...entry, prev: previous?.id ?? null })));
  }
  const doc = {
    v: 1,
    tag: entries.at(-1).tag,
    keyId: 'release',
    fingerprint: publicKeyFingerprint(key.publicKey),
    at: 1_700_000_002_000,
    root: 'a'.repeat(64),
    anchor: { seq: 1 },
    artifacts: [{ name: 'app.exe', sha256: DIGEST, size: 3, receiptId: receipts.at(-1).id }],
    receipts,
  };
  if (declaredMin !== undefined) doc.minVersion = declaredMin;
  return doc;
}

test('ไบต์เดิมปล่อยซ้ำใต้ tag ใหม่: ใช้ tag ของใบที่ใหม่ที่สุดเป็นเวอร์ชัน', () => {
  const doc = chainedDoc({
    entries: [
      { tag: 'v1.3.11', signedMin: '1.3.11', at: 1_700_000_000_000 },
      { tag: 'v1.3.12', signedMin: '1.3.12', at: 1_700_000_100_000 },
    ],
    declaredMin: '1.3.12',
  });

  // ไม่ใช่ "ไม่มี tag ให้เทียบ" อีกต่อไป — ต้องรู้ว่าไบต์นี้คือ v1.3.12
  const report = verifyDocument(doc, { minVersion: '1.3.12' });
  assert.equal(report.ok, true, report.problems?.join('; '));
  assert.equal(report.version, 'v1.3.12');

  // เกณฑ์สูงกว่า tag ใหม่สุด ⇒ ปฏิเสธ และต้องอ้าง v1.3.12 (ไม่ใช่ v1.3.11/ค่าว่าง)
  const pinned = verifyDocument(doc, { minVersion: '1.3.13' });
  assert.equal(pinned.ok, false);
  assert.match(pinned.problems.join('\n'), /เวอร์ชัน v1\.3\.12 เก่ากว่าเกณฑ์ที่ pin ไว้ 1\.3\.13/);
  assert.doesNotMatch(pinned.problems.join('\n'), /ไม่มี tag ที่เซ็นแล้ว/);
});

test('chain ที่หัวเป็นใบเพิกถอน: ยังใช้ tag จากใบปล่อยล่าสุด ไม่ใช่หัว chain', () => {
  const key = signer();
  const shipped = makeReceipt(key, shippedBody({ tag: 'v1.3.12', signedMin: '1.3.12' }));
  const revoked = makeReceipt(key, {
    v: 1,
    action: 'artifact.revoked',
    actor: 'release:v1.3.12',
    artifact: { name: 'app.exe', sha256: DIGEST, size: 3 },
    at: 1_700_000_100_000,
    prev: shipped.id,
    meta: { revokedAt: 1_700_000_100_000 },
  });
  const doc = {
    v: 1,
    tag: 'v1.3.12',
    keyId: 'release',
    fingerprint: publicKeyFingerprint(key.publicKey),
    at: 1_700_000_200_000,
    root: 'a'.repeat(64),
    anchor: { seq: 1 },
    artifacts: [{ name: 'app.exe', sha256: DIGEST, size: 3, receiptId: revoked.id }],
    receipts: [shipped, revoked],
    minVersion: '1.3.12',
  };
  const report = verifyDocument(doc, { minVersion: '1.3.12', allowRevoked: true });
  assert.equal(report.ok, true, report.problems?.join('; '));
  assert.equal(report.version, 'v1.3.12');
  // ใบที่เพิกถอนไม่ได้พา tag มาด้วย และต้องไม่กลบเวอร์ชันของใบปล่อย
  const rollback = verifyDocument(doc, { minVersion: '1.3.13', allowRevoked: true });
  assert.match(rollback.problems.join('\n'), /เวอร์ชัน v1\.3\.12 เก่ากว่าเกณฑ์ที่ pin ไว้/);
});
