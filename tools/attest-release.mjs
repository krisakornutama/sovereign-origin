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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ATTESTATION_FILE = 'sovereign-attest.json';
export const DOC_VERSION = 1;
const SIGNABLE_ACTION = 'artifact.shipped';
const SHA256_RE = /^[0-9a-f]{64}$/;
// ไฟล์ที่ไม่ได้เป็นของที่ผู้ใช้ดาวน์โหลด — ไม่ต้องเซ็น
const NOT_ARTIFACTS = new Set([ATTESTATION_FILE, 'SHA256SUMS.txt']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** JSON แบบ canonical เดียวกับ sovereign-attest: เรียง key, ไม่มีช่องว่าง */
export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw fail('E_CANONICAL', 'ตัวเลขในเอกสารต้องเป็นค่าจำกัด');
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw fail('E_CANONICAL', `ค่าแบบ ${typeof value} ใช้ในเอกสารไม่ได้`);
}

export function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** ไฟล์ที่ต้องเซ็นในโฟลเดอร์ release (เรียงชื่อเพื่อให้ผลซ้ำได้) */
export function collectArtifacts(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !NOT_ARTIFACTS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function describeArtifacts(dir, names) {
  return names.map((name) => {
    const file = path.join(dir, name);
    const bytes = fs.readFileSync(file);
    return { name, sha256: sha256Hex(bytes), size: bytes.length };
  });
}

/** fingerprint ของ public key (SPKI DER → sha256, 32 hex แรก) — ใช้ pin ข้ามช่องทาง */
export function publicKeyFingerprint(publicKeyPem) {
  const key = crypto.createPublicKey({ key: publicKeyPem, format: 'pem' });
  if (key.asymmetricKeyType !== 'ed25519') {
    throw fail('E_KEY', `กุญแจต้องเป็น ed25519 ไม่ใช่ ${key.asymmetricKeyType}`);
  }
  return sha256Hex(new Uint8Array(key.export({ type: 'spki', format: 'der' }))).slice(0, 32);
}

export function receiptId(body) {
  return sha256Hex(Buffer.from(canonicalJson(body), 'utf8'));
}

function bodyOf(receipt) {
  if (!receipt || typeof receipt !== 'object' || typeof receipt.body !== 'object' || !receipt.body) {
    throw fail('E_SHAPE', 'receipt ไม่มี body');
  }
  return receipt.body;
}

/**
 * ตรวจเอกสาร attestation ทั้งใบ: hash/ลายเซ็นของทุกใบ, การ chain ต่อ artifact,
 * digest ของไฟล์ที่อ้างถึง และ fingerprint ที่ pin (ถ้ามี)
 * ไม่พึ่ง vault หรือเน็ต — นี่คือด่านที่ผู้ใช้ดาวน์โหลดปลายทางรันได้จริง
 */
export function verifyDocument(doc, options = {}) {
  const problems = [];
  const pushed = (message) => problems.push(message);

  if (!doc || typeof doc !== 'object') throw fail('E_SHAPE', 'ไฟล์ attestation อ่านไม่ได้');
  if (doc.v !== DOC_VERSION) pushed(`เวอร์ชันเอกสารไม่รองรับ: ${doc.v}`);
  if (!Array.isArray(doc.artifacts) || doc.artifacts.length === 0) {
    pushed('เอกสารไม่มี artifact');
  }
  if (!Array.isArray(doc.receipts) || doc.receipts.length === 0) {
    pushed('เอกสารไม่มี receipt');
  }
  if (problems.length > 0) return { ok: false, problems };

  // กุญแจที่เชื่อถือได้ของเอกสารนี้: เริ่มจากรุ่นปัจจุบัน + ใบ rotation ที่กุญแจนั้น endorse
  const trusted = new Map();
  if (typeof doc.fingerprint === 'string') {
    const newest = [...doc.receipts].sort((a, b) => (bodyOf(b).at ?? 0) - (bodyOf(a).at ?? 0))[0];
    try {
      const fingerprint = publicKeyFingerprint(newest.publicKey);
      if (fingerprint !== doc.fingerprint) {
        pushed('fingerprint ในเอกสารไม่ตรงกับ public key ของ receipt ใหม่สุด');
      } else {
        if (typeof doc.keyId === 'string' && newest.keyId !== doc.keyId) {
          pushed(`receipt ใหม่สุดเซ็นด้วยกุญแจ "${newest.keyId}" ไม่ใช่ "${doc.keyId}"`);
        }
        trusted.set(newest.keyId, newest.publicKey);
      }
    } catch (error) {
      pushed(`fingerprint ตรวไม่ได้: ${error.message}`);
    }
  } else {
    pushed('เอกสารไม่มี fingerprint ของกุญแจ — pin ไม่ได้');
  }

  const rotations = Array.isArray(doc.rotations) ? doc.rotations : [];
  let expanded = true;
  while (expanded && rotations.length > 0) {
    expanded = false;
    for (const statement of rotations) {
      if (!statement || typeof statement !== 'object') continue;
      // เดินถอยหลัง: เอกสาร pin กุญแจ "รุ่นนี้" ไว้ ⇒ ใบที่รุ่นนี้รับรองย้อนหลัง
      // ทำให้ receipt ของกุญแจก่อนหน้ายังเชื่อได้ (ทิศเดียวกับเวลาที่ผู้ตรวจ pin กุญแจเก่า)
      if (trusted.get(statement.to?.keyId) !== statement.to?.publicKey) continue;
      const endorser = statement.from?.publicKey;
      if (typeof endorser !== 'string' || trusted.has(statement.from?.keyId)) continue;
      if (statement.v !== 1 || typeof statement.at !== 'number' || typeof statement.sig !== 'string') {
        pushed('rotation statement มีรูปแบบไม่ถูกต้อง');
        continue;
      }
      const body = {
        v: 1,
        from: { keyId: statement.from.keyId, publicKey: statement.from.publicKey },
        to: { keyId: statement.to?.keyId, publicKey: statement.to?.publicKey },
        at: statement.at,
      };
      let endorsed = false;
      try {
        const key = crypto.createPublicKey({ key: endorser, format: 'pem' });
        endorsed = crypto.verify(
          null,
          Buffer.from(canonicalJson(body), 'utf8'),
          key,
          Buffer.from(statement.sig, 'base64')
        );
      } catch (error) {
        pushed(`rotation ตรวจไม่ได้: ${error.message}`);
      }
      if (!endorsed) {
        pushed(`rotation ${statement.from.keyId} → ${statement.to?.keyId} ลายเซ็นไม่ผ่าน`);
        continue;
      }
      trusted.set(statement.from.keyId, statement.from.publicKey);
      expanded = true;
    }
  }

  const byId = new Map();
  for (const receipt of doc.receipts) {
    let id;
    try {
      id = receiptId(bodyOf(receipt));
    } catch (error) {
      pushed(`receipt อ่านไม่ได้: ${error.message}`);
      continue;
    }
    if (id !== receipt.id) {
      pushed(`receipt ${String(receipt.id).slice(0, 12)} ไม่ตรง hash ของ body (${id.slice(0, 12)})`);
      continue;
    }
    const pinned = trusted.get(receipt.keyId);
    if (pinned === undefined) {
      pushed(
        `receipt ${id.slice(0, 12)} เซ็นด้วยกุญแจ "${receipt.keyId}" ที่ไม่ได้อยู่ในความเชื่อของเอกสาร (ต้องมี rotation ที่ endorse)`
      );
    } else if (pinned !== receipt.publicKey) {
      pushed(`receipt ${id.slice(0, 12)} public key ไม่ตรงกับกุญแจ "${receipt.keyId}" ที่ endorse ไว้`);
    }
    let valid = false;
    try {
      const key = crypto.createPublicKey({ key: receipt.publicKey, format: 'pem' });
      valid = crypto.verify(
        null,
        Buffer.from(canonicalJson(receipt.body), 'utf8'),
        key,
        Buffer.from(receipt.sig, 'base64')
      );
    } catch (error) {
      pushed(`receipt ${id.slice(0, 12)} ตรวจลายเซ็นไม่ได้: ${error.message}`);
    }
    if (!valid) pushed(`receipt ${id.slice(0, 12)} ลายเซ็นไม่ผ่าน`);
    byId.set(id, receipt);
  }

  const used = new Set();
  for (const artifact of doc.artifacts) {
    if (!SHA256_RE.test(String(artifact.sha256))) {
      pushed(`artifact ${artifact.name} มี digest ผิดรูป`);
      continue;
    }
    const head = byId.get(artifact.receiptId);
    if (!head) {
      pushed(`artifact ${artifact.name} ชี้ receipt ที่ไม่มีในเอกสาร`);
      continue;
    }
    // เดินย้อน chain: prev ต้องเป็น receipt ของ digest เดียวกัน และต้องมีอยู่จริงในเอกสาร
    let cursor = head;
    let steps = 0;
    const seen = new Set();
    while (cursor) {
      if (seen.has(cursor.id)) {
        pushed(`chain ของ ${artifact.name} วนซ้ำที่ ${cursor.id.slice(0, 12)}`);
        break;
      }
      seen.add(cursor.id);
      used.add(cursor.id);
      const body = bodyOf(cursor);
      if (body.artifact?.sha256 !== artifact.sha256) {
        pushed(`receipt ${cursor.id.slice(0, 12)} ไม่ได้พูดถึง digest ของ ${artifact.name}`);
        break;
      }
      if (!body.prev) break;
      const prev = byId.get(body.prev);
      if (!prev) {
        pushed(`chain ของ ${artifact.name} ขาด receipt ${body.prev.slice(0, 12)}`);
        break;
      }
      cursor = prev;
      if (++steps > doc.receipts.length + 1) {
        pushed(`chain ของ ${artifact.name} ยาวผิดปกติ`);
        break;
      }
    }
  }

  if (options.fingerprint) {
    if (doc.fingerprint !== options.fingerprint) {
      pushed(`fingerprint ไม่ตรงกับที่ pin ไว้ (${options.fingerprint})`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    fingerprint: doc.fingerprint ?? null,
    artifacts: doc.artifacts.length,
    receipts: doc.receipts.length,
    unusedReceipts: doc.receipts.filter((receipt) => !used.has(receipt.id)).length,
  };
}

function argOf(argv, name, fallback) {
  const found = argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
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
      meta: { tag },
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
    console.log('ตรวจ: node tools/attest-release.mjs --verify <ไฟล์นี้> --fingerprint <fingerprint>');
    return 0;
  }

  const target = argv.find((arg) => !arg.startsWith('--') && arg !== 'verify');
  const file = argOf(argv, 'file', target);
  if (!file) throw fail('E_ARGS', 'ต้องระบุไฟล์ attestation');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const report = verifyDocument(doc, { fingerprint: argOf(argv, 'fingerprint', undefined) });
  if (!report.ok) {
    console.error(`ตรวจไม่ผ่าน (${report.problems.length} ข้อ):`);
    for (const problem of report.problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(
    `ผ่าน: ${report.artifacts} artifact · ${report.receipts} receipt · กุญแจ ${report.fingerprint}`
  );
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

export { bodyOf };
