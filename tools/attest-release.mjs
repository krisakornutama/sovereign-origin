#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// attest-release.mjs — เซ็น release artifact ด้วย sovereign-attest + ตรวจได้แบบ offline
//
// ทำไมต้องมี:
//   release.yml แนบ SHA256SUMS.txt ไปกับ exe/zip บนหน้า Release เดียวกัน ⇒ ถ้าบัญชี
//   GitHub ถูกยึด ผู้โจมตีเปลี่ยนไฟล์กับ checksum พร้อมกันได้ checksum จึงกันได้แค่
//   corruption ไม่กันการปลอม ไฟล์นี้เพิ่ม "ใบรับรองที่เซ็นแล้ว" ซึ่งผู้ใช้ตรวจได้โดย
//   ไม่ต้องเชื่อ GitHub, ไม่ต้องมีเน็ต และไม่ต้องมี vault:
//
//     node tools/attest-release.mjs --verify sovereign-attest.json \
//       --fingerprint <fingerprint ที่ประกาศไว้ใน README/หน้า release>
//
//   ลายเซ็นสร้างจากกุญแจ Ed25519 ที่อยู่ใน sovereign-vault (เข้ารหัส at rest) และ
//   chain ข้ามรุ่นได้ด้วย --previous <attestation ของรุ่นก่อน>
//
// ใช้:
//   node tools/attest-release.mjs --revoke --dir=... --tag=v1.3.11 --reason="..." --previous=<เอกสารเดิม>
//   node tools/attest-release.mjs --restore --dir=... --tag=v1.3.11 --previous=<เอกสารที่เพิ่งเพิกถอน>
//   node tools/attest-release.mjs --verify <เอกสาร> --pin-key=docs/keys/attest-release.pub.pem --dir=<โฟลเดอร์ไฟล์ที่ดาวน์โหลด>
//   ATTEST_MASTER_KEY=<base64 32 ไบต์> node tools/attest-release.mjs --sign \
//     --dir=release-assets --tag=v1.3.10 --out=release-assets [--previous=old.json]
//   node tools/attest-release.mjs --verify release-assets/sovereign-attest.json
//
// ตัวตรวจในไฟล์นี้ใช้ node:crypto ล้วน (ไม่ต้องติดตั้งอะไร) แต่รูปแบบเอกสารเป็นของ
// sovereign-attest — เทสต์ cross-check กับตัวจริงเมื่อ sibling repo ถูก build ไว้
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTESTATION_FILE,
  DOC_VERSION,
  bodyOf,
  canonicalJson,
  collectArtifacts,
  describeArtifacts,
  describeBuild,
  manifestDigest,
  publicKeyFingerprint,
  receiptId,
  sha256Hex,
  verifyArtifacts,
  verifyDocument,
  RESTORED_ACTION,
  REVOKED_ACTION,
  SIGNABLE_ACTION,
} from './attest/document.mjs';


export {
  ATTESTATION_FILE,
  DOC_VERSION,
  bodyOf,
  canonicalJson,
  collectArtifacts,
  describeArtifacts,
  describeBuild,
  manifestDigest,
  publicKeyFingerprint,
  receiptId,
  sha256Hex,
  verifyArtifacts,
  verifyDocument,
};

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** error ที่มีรหัสอ่านออก — CLI พิมพ์ "✖ E_XXX: ..." ให้ผู้ใช้รู้ว่าพังขั้นไหน */
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function argOf(argv, name, fallback) {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

/** รับได้ทั้ง ms (ตัวเลข) และ ISO-8601 เช่น 2026-11-01T00:00:00Z */
function parseTimeArg(value) {
  if (value === undefined) return undefined;
  if (/^[0-9]+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw fail('E_ARGS', `--revoked-at ไม่ใช่วันที่: ${value}`);
  return parsed;
}

function flagOf(argv, name) {
  return argv.includes(`--${name}`);
}

/** โหลด sovereign-attest/vault จาก sibling repo (ยังไม่ publish ขึ้น npm) */
async function loadAttestModules() {
  const base =
    process.env.SOVEREIGN_ATTEST_DIR ??
    path.resolve(ROOT, '..', process.env.SOVEREIGN_ATTEST_SIBLING ?? 'sovereign-attest');
  const entry = path.join(base, 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    throw fail(
      'E_MODULES',
      `ไม่พบ ${entry} — build sibling repo ก่อน (cd "${base}" && npm ci && npm run build) หรือตั้ง SOVEREIGN_ATTEST_DIR`
    );
  }
  const attest = await import(new URL(`file://${entry.replace(/\\/g, '/')}`).href);
  const vaultEntry = path.join(base, '..', 'sovereign-vault', 'dist', 'index.js');
  if (!fs.existsSync(vaultEntry)) {
    throw fail('E_MODULES', `ไม่พบ ${vaultEntry} — build sovereign-vault ก่อน`);
  }
  const vault = await import(new URL(`file://${vaultEntry.replace(/\\/g, '/')}`).href);
  return { attest, vault };
}

/**
 * กุญแจเซ็นแบบพกพา: CI ไม่มี state ของ vault ข้ามรอบ จึงต้องมีตัวตนกุญแจที่คงที่
 * — ส่ง PEM ผ่าน secret แล้ว import เข้า vault ของรอบนั้น (vault ยังผูก/enctypt ตามปกติ)
 */
export function readSigningKeyPem(argv) {
  const env = process.env.ATTEST_SIGNING_KEY;
  const file = argOf(argv, 'signing-key-file', process.env.ATTEST_SIGNING_KEY_FILE);
  if (env) {
    const pem = Buffer.from(env, 'base64').toString('utf8');
    if (!pem.includes('PRIVATE KEY')) throw new Error('ATTEST_SIGNING_KEY ต้องเป็น base64 ของ PEM private key');
    return pem;
  }
  if (file) return fs.readFileSync(file, 'utf8');
  return null;
}

/** public key ที่คู่กับ private key — ใช้ทั้งตอน import และตอนประกาศ fingerprint */
export function publicKeyFromPrivate(privatePem) {
  return crypto.createPublicKey({ key: privatePem, format: 'pem' }).export({
    type: 'spki',
    format: 'pem',
  }).toString();
}

export function readMasterKey(argv) {
  const inline = process.env.ATTEST_MASTER_KEY;
  const file = argOf(argv, 'master-key-file', process.env.ATTEST_MASTER_KEY_FILE);
  if (inline) {
    const bytes = Buffer.from(inline, 'base64');
    if (bytes.length !== 32) throw fail('E_KEY', 'ATTEST_MASTER_KEY ต้องเป็น base64 ของ 32 ไบต์');
    return new Uint8Array(bytes);
  }
  if (file) {
    const bytes = Buffer.from(fs.readFileSync(file, 'utf8').trim());
    if (bytes.length !== 32) throw fail('E_KEY', 'ไฟล์ master key ต้องมี 32 ไบต์');
    return new Uint8Array(bytes);
  }
  throw fail('E_KEY', 'ต้องมี ATTEST_MASTER_KEY (base64 32 ไบต์) หรือ --master-key-file');
}

function resolveMasterKey(argv, hasSigningKey) {
  try {
    return readMasterKey(argv);
  } catch (error) {
    if (!hasSigningKey) throw error;
    // CI: vault เป็นของชั่วคราวของรอบนั้น กุญแจถาวรอยู่ใน secret
    return new Uint8Array(crypto.randomBytes(32));
  }
}

function previousDoc(file) {
  if (!file) return null;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(doc.receipts)) throw fail('E_PREVIOUS', `${file} ไม่มี receipts`);
  return doc;
}

function previousReceipts(file) {
  return previousDoc(file)?.receipts ?? [];
}

/**
 * build manifest ที่จะผนึกในใบรับรอง: --build-manifest=<ไฟล์> (ตัวที่ตรวจได้ล่วงหน้า)
 * หรือ --provenance (เก็บสดจาก repo ที่กำลังรัน — ใช้ใน CI ที่ checkout ครบ)
 */
async function readBuildManifestArg(argv, tag) {
  const file = argOf(argv, 'build-manifest', undefined);
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (flagOf(argv, 'provenance')) {
    const { collectBuildManifest } = await import('./attest/build-manifest.mjs');
    return collectBuildManifest({ tag });
  }
  return undefined;
}

/** ใบ rotation ที่ผู้เรียกส่งมา — ฟอร์แมตเป็นของ sovereign-attest (sealRotation) */
function readRotations(files) {
  return files.map((file) => {
    const statement = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!statement || typeof statement !== 'object' || !statement.from || !statement.to) {
      throw fail('E_ROTATION', `${file} ไม่ใช่ rotation statement`);
    }
    return statement;
  });
}

/** เซ็น artifact ทุกไฟล์ในโฟลเดอร์ แล้วเขียนเอกสารที่ผู้ใช้ตรวจเองได้ */
export async function signRelease(options) {
  const { dir, tag, out, keyId, stateDir, now, previousFile, signingKeyPem } = options;
  // build provenance: ถ้าผู้เรียกส่งมา ต้องผนึกได้และผ่านการตรวจรูปก่อนเซ็น
  // (manifest ที่ผิดรูปเมื่อเซ็นแล้วจะตรวจไม่ผ่านตลอดไป — ดักที่ต้นทางดีกว่า)
  // โหลดแบบ dynamic: ตัวตรวจ (--verify) ต้องใช้แค่ 2 ไฟล์เดิม ไม่ต้องโหลดโมดูลนี้
  let buildManifest = null;
  if (options.buildManifest) {
    const { sealBuildManifest, verifyBuildManifest } = await import('./attest/build-manifest.mjs');
    buildManifest = sealBuildManifest(options.buildManifest);
    // dirty ไม่ใช่ "ผิดรูป" — เครื่องนักพัฒนาสกปรกได้ แต่ปลายทางจะเห็นเป็นสัญญาณเตือน
    const check = verifyBuildManifest(buildManifest, { allowDirty: true });
    if (!check.ok) throw fail('E_BUILD', `build manifest ใช้ไม่ได้: ${check.problems.join('; ')}`);
  }
  const masterKey = options.masterKey ?? resolveMasterKey(process.argv.slice(2), Boolean(signingKeyPem));
  const { attest: attestModule, vault: vaultModule } = await loadAttestModules();
  const { Attest, loadSigningKey, saveSigningKey } = attestModule;
  const { BlobAnchorLog, FileBlobStore, Vault } = vaultModule;

  const files = collectArtifacts(dir);
  if (files.length === 0) throw fail('E_NO_ARTIFACTS', `ไม่พบ artifact ใน ${dir}`);

  const vaultDir = path.join(stateDir, 'vault');
  const anchorDir = path.join(stateDir, 'anchors');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(anchorDir, { recursive: true });

  const vault = await Vault.open({ store: new FileBlobStore(vaultDir), masterKey });
  if (signingKeyPem) {
    const existing = await loadSigningKey(vault, keyId);
    if (!existing) {
      await saveSigningKey(vault, {
        keyId,
        privateKey: signingKeyPem,
        publicKey: publicKeyFromPrivate(signingKeyPem),
        createdAt: now(),
      });
    } else if (existing.publicKey !== publicKeyFromPrivate(signingKeyPem)) {
      throw fail('E_KEY', `vault มีกุญแจ "${keyId}" ที่ไม่ใช่กุญแจที่ให้มา — อย่าเซ็นด้วยตัวตนสลับกัน`);
    }
  }
  const attest = await Attest.open({ vault, keyId });
  const anchors = new BlobAnchorLog(new FileBlobStore(anchorDir));

  // chain ข้ามรุ่น: ตั้ง head ของ digest ให้ชี้ใบล่าสุดจากเอกสารก่อนหน้า
  const prior = previousReceipts(previousFile);
  const priorById = new Map(prior.map((receipt) => [receipt.id, receipt]));
  const priorHeadByDigest = new Map();
  for (const receipt of prior) {
    const body = bodyOf(receipt);
    if (!priorHeadByDigest.has(body.artifact?.sha256)) {
      priorHeadByDigest.set(body.artifact?.sha256, receipt.id);
    }
  }
  for (const [digest, headId] of priorHeadByDigest) {
    if (!priorById.has(headId) && priorFile) {
      throw fail('E_PREVIOUS', `หัว chain ${headId} ไม่มีในเอกสารก่อนหน้า`);
    }
    const bytes = Buffer.from(JSON.stringify({ head: headId }), 'utf8');
    await vault.put(`attest/heads/${digest}.json`, new Uint8Array(bytes));
  }

  const artifacts = [];
  const receipts = [];
  for (const artifact of describeArtifacts(dir, files)) {
    const receipt = await attest.record({
      action: SIGNABLE_ACTION,
      actor: `release:${tag}`,
      artifact: { name: artifact.name, sha256: artifact.sha256, size: artifact.size },
      // meta อยู่ใน body ที่ถูกเซ็น ⇒ provenance ผูกกับ artifact ด้วยลายเซ็นเดียวกัน
      // เก็บเป็น string ล้วน (sovereign-attest รับ meta เฉพาะ string/ตัวเลข) — digest ผูกเนื้อหา
      // ทั้งก้อนของ manifest ส่วนตัว manifest ที่อ่านได้อยู่ใน doc.build
      meta: buildManifest
        ? { tag, buildDigest: buildManifest.digest, buildCommit: buildManifest.commit.sha }
        : { tag },
    });
    artifacts.push({ ...artifact, receiptId: receipt.id });
    receipts.push(receipt);
  }

  const anchorEntry = await attest.anchor(anchors);
  const doc = {
    v: DOC_VERSION,
    tag,
    keyId: attest.keyId,
    fingerprint: attestModule.publicKeyFingerprint(attest.publicKey),
    at: anchorEntry.entry?.at ?? now(),
    root: anchorEntry.root,
    anchor: anchorEntry.entry,
    artifacts,
    // สำเนาที่อ่านได้ของผู้ใช้ — ตรวจซ้ำกับที่ผนึกใน receipt ทุกครั้ง (verifyDocument)
    ...(buildManifest ? { build: buildManifest } : {}),
    receipts: [...prior, ...receipts].filter(
      (receipt, index, all) => all.findIndex((item) => item.id === receipt.id) === index
    ),
  };

  const inherited = Array.isArray(previousDoc(previousFile)?.rotations)
    ? previousDoc(previousFile).rotations
    : [];
  const supplied = readRotations(options.rotationFiles ?? []);
  const rotations = [...inherited, ...supplied].filter(
    (statement, index, all) =>
      all.findIndex((item) => item.to?.keyId === statement.to?.keyId) === index
  );
  if (rotations.length > 0) doc.rotations = rotations;

  const outFile = path.join(out ?? dir, ATTESTATION_FILE);
  fs.writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);
  return { file: outFile, doc, signer: { keyId: attest.keyId, fingerprint: doc.fingerprint } };
}

/**
 * เพิกถอน (หรือคืนสถานะ) artifact ที่เคยเซ็นไว้ — ต้องมีเอกสารรุ่นก่อนหน้าเพื่ออ้าง chain
 * การเพิกถอนเป็น receipt ปกติ ⇒ เซ็นด้วยกุญแจเดิม ต่อจากหัว chain ของ digest นั้น และอยู่ใน anchor
 * ผลลัพธ์คือเอกสารใบใหม่ที่ตัวตรวจจะปฏิเสธ เว้นแต่สั่ง --allow-revoked
 */
export async function revokeRelease(options) {
  const { dir, out, keyId, stateDir, now, previousFile, signingKeyPem, action, reason, revokedAt } =
    options;
  const { tag, actor } = options;
  if (!previousFile) {
    throw fail('E_ARGS', 'ต้องระบุ --previous=<เอกสารรุ่นที่เคยเซ็น> เพื่ออ้าง chain เดิม');
  }
  if (action === REVOKED_ACTION && !reason) throw fail('E_ARGS', 'ต้องระบุ --reason=<เหตุผล>');
  const masterKey = options.masterKey ?? resolveMasterKey(process.argv.slice(2), Boolean(signingKeyPem));
  const { attest: attestModule, vault: vaultModule } = await loadAttestModules();
  const { Attest, loadSigningKey, saveSigningKey } = attestModule;
  const { BlobAnchorLog, FileBlobStore, Vault } = vaultModule;

  const files = collectArtifacts(dir);
  if (files.length === 0) throw fail('E_NO_ARTIFACTS', `ไม่พบ artifact ใน ${dir}`);

  const vaultDir = path.join(stateDir, 'vault');
  const anchorDir = path.join(stateDir, 'anchors');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(anchorDir, { recursive: true });

  const vault = await Vault.open({ store: new FileBlobStore(vaultDir), masterKey });
  if (signingKeyPem) {
    const existing = await loadSigningKey(vault, keyId);
    if (!existing) {
      await saveSigningKey(vault, {
        keyId,
        privateKey: signingKeyPem,
        publicKey: publicKeyFromPrivate(signingKeyPem),
        createdAt: now(),
      });
    } else if (existing.publicKey !== publicKeyFromPrivate(signingKeyPem)) {
      throw fail('E_KEY', `vault มีกุญแจ "${keyId}" ที่ไม่ใช่กุญแจที่ให้มา — อย่าเซ็นด้วยตัวตนสลับกัน`);
    }
  }
  const attest = await Attest.open({ vault, keyId });
  const anchors = new BlobAnchorLog(new FileBlobStore(anchorDir));

  // ตั้ง head ของ digest ให้ชี้ใบล่าสุดจากเอกสารรุ่นก่อน เพื่อให้ใบใหม่ต่อท้าย chain เดิมจริง
  const prior = previousReceipts(previousFile);
  const priorHeadByDigest = new Map();
  for (const receipt of prior) {
    const body = bodyOf(receipt);
    if (!priorHeadByDigest.has(body.artifact?.sha256)) {
      priorHeadByDigest.set(body.artifact?.sha256, receipt.id);
    }
  }
  for (const [digest, headId] of priorHeadByDigest) {
    const bytes = Buffer.from(JSON.stringify({ head: headId }), 'utf8');
    await vault.put(`attest/heads/${digest}.json`, new Uint8Array(bytes));
  }

  const artifacts = [];
  const receipts = [];
  for (const artifact of describeArtifacts(dir, files)) {
    const subject = { name: artifact.name, sha256: artifact.sha256, size: artifact.size };
    const receipt =
      action === RESTORED_ACTION
        ? await attest.restore({ actor, artifact: subject, ...(reason ? { reason } : {}) })
        : await attest.revoke({
            actor,
            reason,
            artifact: subject,
            ...(revokedAt === undefined ? {} : { revokedAt }),
          });
    artifacts.push({ ...artifact, receiptId: receipt.id });
    receipts.push(receipt);
  }

  const anchorEntry = await attest.anchor(anchors);
  const doc = {
    v: DOC_VERSION,
    tag,
    keyId: attest.keyId,
    fingerprint: attestModule.publicKeyFingerprint(attest.publicKey),
    at: anchorEntry.entry?.at ?? now(),
    root: anchorEntry.root,
    anchor: anchorEntry.entry,
    artifacts,
    receipts: [...prior, ...receipts].filter(
      (receipt, index, all) => all.findIndex((item) => item.id === receipt.id) === index
    ),
  };
  const priorRotations = previousDoc(previousFile)?.rotations;
  if (Array.isArray(priorRotations)) doc.rotations = priorRotations;
  // ไบต์ไม่ได้เปลี่ยนเพราะการเพิกถอน ⇒ provenance ของไบต์เดิมยังจริงและต้องตามมาด้วย
  const priorBuild = previousDoc(previousFile)?.build;
  if (priorBuild && typeof priorBuild === 'object') doc.build = priorBuild;

  const outFile = path.join(out ?? dir, ATTESTATION_FILE);
  fs.writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);
  return { file: outFile, doc, signer: { keyId: attest.keyId, fingerprint: doc.fingerprint } };
}

/** แสดง public key + fingerprint ของกุญแจใน state dir (หรือกุญแจที่ import) */
export async function keyInfo(options) {
  const { keyId, stateDir, signingKeyPem, now } = options;
  const { attest: attestModule, vault: vaultModule } = await loadAttestModules();
  const { Attest, loadSigningKey, saveSigningKey } = attestModule;
  const { FileBlobStore, Vault } = vaultModule;
  fs.mkdirSync(path.join(stateDir, 'vault'), { recursive: true });
  const vault = await Vault.open({
    store: new FileBlobStore(path.join(stateDir, 'vault')),
    masterKey: options.masterKey ?? resolveMasterKey(process.argv.slice(2), Boolean(signingKeyPem)),
  });
  if (signingKeyPem && !(await loadSigningKey(vault, keyId))) {
    await saveSigningKey(vault, {
      keyId,
      privateKey: signingKeyPem,
      publicKey: publicKeyFromPrivate(signingKeyPem),
      createdAt: now(),
    });
  }
  const attest = await Attest.open({ vault, keyId });
  return {
    keyId: attest.keyId,
    publicKey: attest.publicKey,
    fingerprint: attestModule.publicKeyFingerprint(attest.publicKey),
  };
}

async function main(argv) {
  const mode = flagOf(argv, 'sign')
    ? 'sign'
    : flagOf(argv, 'revoke')
      ? 'revoke'
      : flagOf(argv, 'restore')
        ? 'restore'
        : flagOf(argv, 'verify')
          ? 'verify'
          : flagOf(argv, 'key-info')
            ? 'key-info'
            : null;
  if (mode === 'key-info') {
    const info = await keyInfo({
      keyId: argOf(argv, 'key-id', 'release'),
      stateDir: argOf(argv, 'state-dir', path.join(ROOT, 'data', 'attest')),
      signingKeyPem: readSigningKeyPem(argv),
      masterKey: process.env.ATTEST_MASTER_KEY ? readMasterKey(argv) : undefined,
      now: () => Date.now(),
    });
    console.log(`keyId:       ${info.keyId}`);
    console.log(`fingerprint: ${info.fingerprint}`);
    console.log('public key:');
    console.log(info.publicKey.trim());
    return 0;
  }

  if (mode === 'sign') {
    const dir = argOf(argv, 'dir', 'release-assets');
    const tag = argOf(argv, 'tag', process.env.GITHUB_REF_NAME);
    if (!tag) throw fail('E_ARGS', 'ต้องระบุ --tag (หรือรันใน GitHub Actions)');
    const result = await signRelease({
      dir,
      tag,
      out: argOf(argv, 'out', dir),
      keyId: argOf(argv, 'key-id', 'release'),
      stateDir: argOf(argv, 'state-dir', path.join(ROOT, 'data', 'attest')),
      masterKey: process.env.ATTEST_MASTER_KEY ? readMasterKey(argv) : undefined,
      signingKeyPem: readSigningKeyPem(argv),
      buildManifest: await readBuildManifestArg(argv, tag),
      previousFile: argOf(argv, 'previous', undefined),
      rotationFiles: argv
        .filter((arg) => arg.startsWith('--rotation='))
        .map((arg) => arg.slice('--rotation='.length)),
      now: () => Date.now(),
    });
    const flat = result.doc.artifacts
      .map((artifact) => `  ${artifact.sha256.slice(0, 16)}…  ${artifact.name}`)
      .join('\n');
    console.log(`เซ็น ${result.doc.artifacts.length} artifact สำหรับ ${tag} → ${result.file}`);
    console.log(flat);
    console.log(`fingerprint: ${result.signer.fingerprint}`);
    console.log(`vault root:  ${result.doc.root}`);
    if (result.doc.build) console.log(describeBuild(result.doc.build));
    console.log('ตรวจ: node tools/attest-release.mjs --verify <ไฟล์นี้> --fingerprint <fingerprint>');
    return 0;
  }

  if (mode === 'revoke' || mode === 'restore') {
    const dir = argOf(argv, 'dir', 'release-assets');
    const tag = argOf(argv, 'tag', process.env.GITHUB_REF_NAME);
    if (!tag) throw fail('E_ARGS', 'ต้องระบุ --tag (หรือรันใน GitHub Actions)');
    const action = mode === 'revoke' ? REVOKED_ACTION : RESTORED_ACTION;
    const result = await revokeRelease({
      action,
      dir,
      tag,
      out: argOf(argv, 'out', dir),
      reason: argOf(argv, 'reason', undefined),
      revokedAt: parseTimeArg(argOf(argv, 'revoked-at', undefined)),
      actor: argOf(argv, 'actor', `release:${tag}`),
      keyId: argOf(argv, 'key-id', 'release'),
      stateDir: argOf(argv, 'state-dir', path.join(ROOT, 'data', 'attest')),
      masterKey: process.env.ATTEST_MASTER_KEY ? readMasterKey(argv) : undefined,
      signingKeyPem: readSigningKeyPem(argv),
      previousFile: argOf(argv, 'previous', undefined),
      now: () => Date.now(),
    });
    console.log(
      `${mode === 'revoke' ? 'เพิกถอน' : 'คืนสถานะ'} ${result.doc.artifacts.length} artifact ของ ${tag} → ${result.file}`
    );
    console.log(`fingerprint: ${result.signer.fingerprint}`);
    console.log('ตรวจ: node tools/attest-release.mjs --verify <ไฟล์นี้> --fingerprint <fingerprint>');
    return 0;
  }

  const target = argv.find((arg) => !arg.startsWith('--') && arg !== 'verify');
  const file = argOf(argv, 'file', target);
  if (!file) throw fail('E_ARGS', 'ต้องระบุไฟล์ attestation');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const report = verifyDocument(doc, {
    fingerprint: argOf(argv, 'fingerprint', undefined),
    allowRevoked: flagOf(argv, 'allow-revoked'),
  });
  // --dir=<โฟลเดอร์> ⇒ แฮชไฟล์จริงเทียบกับเอกสาร (ใช้ตอนผู้ใช้ตรวจไฟล์ที่ดาวน์โหลด)
  const checkedDir = argOf(argv, 'dir', undefined);
  const fileReport = checkedDir ? verifyArtifacts(doc, checkedDir) : null;
  const pinFile = argOf(argv, 'pin-key', undefined);
  const pinned = pinFile ? publicKeyFingerprint(fs.readFileSync(pinFile, 'utf8')) : null;
  const problems = report.problems.slice();
  // --build-commit=<sha> ⇒ ยืนยันว่าไบต์ที่เซ็นสร้างจาก commit ที่โหลดมา ไม่ใช่แค่ "มี manifest"
  const expectedCommit = argOf(argv, 'build-commit', undefined);
  if (expectedCommit) {
    if (!report.build) {
      problems.push('สั่ง --build-commit ไว้ แต่เอกสารนี้ไม่มี build manifest ให้เทียบ');
    } else if (report.build.commit.sha !== expectedCommit) {
      problems.push(
        `build manifest มาจาก commit ${String(report.build.commit.sha).slice(0, 12)} ไม่ใช่ ${expectedCommit.slice(0, 12)}`
      );
    }
    if (report.build?.commit.dirty) {
      problems.push('build manifest มาจาก working tree ที่ไม่สะอาด (dirty) — ไบต์อาจไม่ตรงกับ commit นั้น');
    }
  }
  if (fileReport) problems.push(...fileReport.problems);
  if (pinned && pinned !== doc.fingerprint) {
    problems.push(`กุญแจที่ pin ไว้ (${pinned}) ไม่ใช่กุญแจที่เซ็นเอกสาร (${doc.fingerprint})`);
  }
  if (problems.length > 0) {
    console.error(`ตรวจไม่ผ่าน (${problems.length} ข้อ):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(
    `ผ่าน: ${report.artifacts} artifact · ${report.receipts} receipt · กุญแจ ${report.fingerprint}`
  );
  if (fileReport) {
    console.log(`ไฟล์ที่แฮชตรงกับเอกสาร: ${doc.artifacts.length} ไฟล์ (${checkedDir})`);
    if (fileReport.unlisted.length > 0) {
      console.log(`ไม่ถูกเซ็น (ไม่นับรวม): ${fileReport.unlisted.join(', ')}`);
    }
  }
  console.log(report.build ? describeBuild(report.build) : 'ไม่มี build manifest ในใบนี้ (เซ็นก่อนมี provenance)');
  if (report.unusedReceipts > 0) {
    console.log(`  (มี ${report.unusedReceipts} receipt เก่าใน chain ที่ไม่ได้ผูกกับไฟล์รุ่นนี้)`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`✖ ${error.code ?? 'E_UNKNOWN'}: ${error.message}`);
      process.exit(1);
    });
}

