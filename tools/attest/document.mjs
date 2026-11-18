// ─────────────────────────────────────────────────────────────────────────────
// document.mjs — ชั้น "เอกสาร attestation": canonical JSON, แฮช, ลายเซ็น, chain
//
// แยกออกมาจาก attest-release.mjs เพราะด่าน file-budget จำกัดไฟล์ที่แก้ไว้ 800 บรรทัด
// และเพราะสองหน้าที่ต่างกัน: ที่นี่คือการอ่าน/ตรวจ (รันได้ทุกที่ ไม่พึ่ง vault)
// ส่วน attest-release.mjs คือ CLI ที่เซ็น/เพิกถอน (ต้องมีกุญแจกับ vault)
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ATTESTATION_FILE = 'sovereign-attest.json';
export const DOC_VERSION = 1;
export const SIGNABLE_ACTION = 'artifact.shipped';
export const REVOKED_ACTION = 'artifact.revoked';
export const RESTORED_ACTION = 'artifact.restored';
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

/**
 * ตรวจไฟล์จริงในโฟลเดอร์กับเอกสาร — เอกสารบอกว่า "ไบต์ชุดนี้คือของจริง"
 * ถ้าไม่แฮชไฟล์ที่เพิ่งดาวน์โหลดมาเทียบ การตรวจก็เป็นเพียงการอ่าน JSON ที่เขาเขียนเอง
 */
export function verifyArtifacts(doc, dir) {
  const problems = [];
  const present = new Set(fs.readdirSync(dir));
  const wanted = new Set(doc.artifacts.map((artifact) => artifact.name));
  for (const artifact of doc.artifacts) {
    const file = path.join(dir, artifact.name);
    if (!present.has(artifact.name)) {
      problems.push(`ไม่พบไฟล์ ${artifact.name} ใน ${dir}`);
      continue;
    }
    const bytes = fs.readFileSync(file);
    if (bytes.length !== artifact.size) {
      problems.push(`${artifact.name} ขนาดไม่ตรง (ได้ ${bytes.length} ไบต์ คาด ${artifact.size})`);
      continue;
    }
    if (sha256Hex(bytes) !== artifact.sha256) {
      problems.push(`${artifact.name} แฮชไม่ตรงกับที่เซ็นไว้`);
    }
  }
  const unlisted = [...present].filter(
    (name) => !wanted.has(name) && !NOT_ARTIFACTS.has(name) && !name.startsWith('.')
  );
  return { ok: problems.length === 0, problems, unlisted: unlisted.sort() };
}

export function bodyOf(receipt) {
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
    let revokedBy = null;
    let stateSeen = false;
    const seen = new Set();
    let revokedAt = null;
    let condemned = false;
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
      // เดินจากใหม่ไปเก่า ⇒ ใบแรกที่บอกสถานะคือสถานะปัจจุบัน (restore ใหม่สุดชนะ revoke เก่า)
      if (!stateSeen && (body.action === REVOKED_ACTION || body.action === RESTORED_ACTION)) {
        stateSeen = true;
        if (body.action === REVOKED_ACTION) {
          revokedBy = cursor.id;
          // มีผลตั้งแต่ meta.revokedAt ถ้าระบุมา ไม่งั้นถือว่ามีผล ณ เวลาที่เพิกถอน
          const declared = body.meta && typeof body.meta === 'object' ? body.meta.revokedAt : undefined;
          revokedAt =
            typeof declared === 'number' ? declared : typeof body.at === 'number' ? body.at : null;
        }
      }
      // ไบต์ชุดเดียวกันที่เคยถูกปล่อยก่อนวันที่มีผล = บิลด์ที่ถูกเพิกถอน
      if (
        revokedAt !== null &&
        body.action === SIGNABLE_ACTION &&
        typeof body.at === 'number' &&
        body.at <= revokedAt
      ) {
        condemned = true;
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
    if (revokedBy && !options.allowRevoked) {
      // เพิกถอนมีผลย้อนหลังถึง revokedAt: เฉพาะ receipt ที่เซ็นก่อน/เท่ากับวันที่มีผล
      if (revokedAt === null || condemned) {
        const since = revokedAt === null ? 'ไม่ระบุเวลา' : new Date(revokedAt).toISOString();
        pushed(
          `artifact ${artifact.name} ถูกเพิกถอน (receipt ${revokedBy.slice(0, 12)}) มีผลตั้งแต่ ${since} ` +
            `และมี receipt ที่เซ็นก่อนเวลานั้น — อย่าใช้งานนอกจากสั่ง --allow-revoked`
        );
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

