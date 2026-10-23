// src/updateTrust.mjs — ความเชื่อถือของ "ชุดอัปเดต runner" (Phase 3A)
//
// ปัญหาเดิม: manifest บอกแค่ sha256 ของแต่ละไฟล์ แต่ไม่มีอะไรยืนยันว่า manifest
// เองมาจาก HUB จริง — ผู้ที่แก้ manifest กลางทาง (หรือแก้ไฟล์บนดิสก์ HUB) สามารถ
// เปลี่ยนรายการไฟล์/แฮชแล้วให้เครื่องลูกติดตั้งโค้ดที่ไม่มีใครรับรองได้
//
// ทางแก้: ตัวแพ็ก (publisher) เซ็น manifest ด้วย Ed25519 private key ที่เก็บไว้นอก
// ชุดอัปเดต; เครื่องลูกถือ public key นี้แบบฝังในโค้ด (trust anchor) แล้วตรวจ
// ลายเซ็นก่อนอ่าน/ติดตั้งไฟล์ทุกครั้ง
//
// กติกาสำคัญ:
//   - canonical payload = JSON ของ {version, generatedAt, files:[{path,sha256,size}]}
//     เรียงคีย์ตามนี้เสมอ (ฝั่ง core-api ต้องเขียนเหมือนกันเป๊ะ)
//   - field เสริมที่ HUB เติมภายหลัง (channel/rolloutPercent) ไม่ถูกเซ็นและไม่ถูกใช้ตัดสิน trust
//   - ตรวจขนาด/รูปแบบ path/hash ก่อนตรวจลายเซ็น เพื่อไม่ให้ path แปลกหลุดเข้า applyUpdate
import crypto from 'node:crypto';

export const UPDATE_SIGNING_ALG = 'ed25519';
export const UPDATE_SIGNING_KEY_ID = 'fleet-update-v1';

/**
 * Public key สำหรับตรวจ manifest ของ runner
 * private key คู่กันอยู่ที่ tools/agent-pack/keys/signing-key.pem (gitignored; อยู่นอก container)
 * — ต้องสำรองไฟล์นั้นแยกจาก repo; ถ้าหายต้องแจก runner ใหม่ทั้งฝูง
 */
export const UPDATE_TRUSTED_KEYS = Object.freeze([
  Object.freeze({
    keyId: UPDATE_SIGNING_KEY_ID,
    publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8hAp7uYEbqWlvNSJ/qZ+YGCGeE3vervQnuOjaJ7w5lo=
-----END PUBLIC KEY-----
`,
  }),
]);

/** JSON ที่ถูกเซ็น — ต้องตรงกับฝั่ง core-api (update-manifest-trust.service.ts) */
export function canonicalManifestPayload(manifest) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  return Buffer.from(
    JSON.stringify({
      version: manifest?.version,
      generatedAt: manifest?.generatedAt,
      files: files.map((f) => ({ path: f?.path, sha256: f?.sha256, size: f?.size })),
    }),
    'utf8',
  );
}

function fail(code, reason) {
  return { ok: false, code, reason };
}

function isSafeManifestPath(rel) {
  if (typeof rel !== 'string' || !rel.trim()) return false;
  const norm = rel.replace(/\\/g, '/');
  if (norm.includes('..') || norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return false;
  return norm.split('/').every((seg) => seg.length > 0 && /^[A-Za-z0-9._-]+$/.test(seg));
}

/**
 * ตรวจว่า manifest สมบูรณ์ + ลงนามด้วย key ที่เชื่อถือได้
 * คืน { ok:true, keyId } หรือ { ok:false, code, reason }
 */
export function verifyUpdateManifest(manifest, trustedKeys = UPDATE_TRUSTED_KEYS) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return fail('bad-manifest', 'manifest ไม่ใช่วัตถุ');
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) return fail('bad-manifest', 'ไม่มี version');
  if (typeof manifest.generatedAt !== 'string' || !manifest.generatedAt.trim()) return fail('bad-manifest', 'ไม่มี generatedAt');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) return fail('bad-manifest', 'ไม่มีไฟล์ใน manifest');

  const seen = new Set();
  for (const f of manifest.files) {
    if (!f || typeof f !== 'object') return fail('bad-manifest', 'รายการไฟล์ไม่ถูกต้อง');
    if (!isSafeManifestPath(f.path)) return fail('bad-manifest', `path ไม่ปลอดภัย: ${String(f.path)}`);
    if (seen.has(f.path)) return fail('bad-manifest', `path ซ้ำ: ${f.path}`);
    seen.add(f.path);
    if (typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(f.sha256)) return fail('bad-manifest', `sha256 ไม่ถูกต้อง: ${f.path}`);
    if (!Number.isSafeInteger(f.size) || f.size < 0) return fail('bad-manifest', `size ไม่ถูกต้อง: ${f.path}`);
  }

  const sig = manifest.signature;
  if (!sig || typeof sig !== 'object' || sig.alg !== UPDATE_SIGNING_ALG) return fail('unsigned', 'manifest ยังไม่ลงนาม Ed25519');
  if (typeof sig.keyId !== 'string' || !sig.keyId) return fail('unsigned', 'ไม่มี keyId ของผู้เซ็น');
  if (typeof sig.value !== 'string' || !sig.value) return fail('unsigned', 'ไม่มีลายเซ็น');

  const trusted = (Array.isArray(trustedKeys) ? trustedKeys : []).find((k) => k?.keyId === sig.keyId);
  if (!trusted?.publicKeyPem) return fail('unknown-key', `ไม่รู้จัก keyId: ${sig.keyId}`);

  let publicKey;
  try {
    publicKey = crypto.createPublicKey(trusted.publicKeyPem);
  } catch {
    return fail('bad-key', `public key ของ ${sig.keyId} อ่านไม่ได้`);
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') return fail('bad-key', `public key ของ ${sig.keyId} ไม่ใช่ Ed25519`);

  let signature;
  try {
    signature = Buffer.from(sig.value, 'base64');
  } catch {
    return fail('bad-signature', 'ลายเซ็นไม่ใช่ base64');
  }
  if (signature.length !== 64) return fail('bad-signature', 'ลายเซ็น Ed25519 ต้องยาว 64 ไบต์');

  try {
    const ok = crypto.verify(null, canonicalManifestPayload(manifest), publicKey, signature);
    if (!ok) return fail('bad-signature', 'ลายเซ็นไม่ตรงกับ manifest');
  } catch {
    return fail('bad-signature', 'ตรวจลายเซ็นไม่สำเร็จ');
  }
  return { ok: true, keyId: sig.keyId };
}
