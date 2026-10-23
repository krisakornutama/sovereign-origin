// src/services/update-manifest-trust.service.ts — ตรวจลายเซ็น manifest ของ runner (Phase 3A)
//
// ตัวแพ็ก (tools/agent-pack/pack.mjs) เซ็น manifest ด้วย Ed25519 private key
// ฝั่ง HUB ตรวจซ้ำก่อนส่งออกทุกครั้ง — manifest ที่ไม่ได้เซ็น/ลายเซ็นไม่ตรงจะไม่ถึงเครื่องลูก
//
// canonical payload ต้องตรงกับ sovereign-os/agent-runner/src/updateTrust.mjs เป๊ะ:
//   JSON.stringify({ version, generatedAt, files: [{ path, sha256, size }] })
// (field เสริม channel/rolloutPercent ถูกเติมหลังลายเซ็นและไม่ถูกใช้ตัดสิน trust)
import crypto from 'node:crypto';
import { readUpdateManifest, UPDATE_ROOT, type UpdateManifest } from './agent-update.service';

export const UPDATE_SIGNING_ALG = 'ed25519';
export const UPDATE_SIGNING_KEY_ID = 'fleet-update-v1';

export interface TrustedUpdateKey {
  keyId: string;
  publicKeyPem: string;
}

/**
 * Public key เดียวกับที่ฝังใน runner — ต้องแก้ทั้งสองฝั่งพร้อมกันเมื่อ rotate
 * (มี static test เทียบ PEM ระหว่างสองไฟล์)
 */
export const DEFAULT_UPDATE_TRUSTED_KEYS: TrustedUpdateKey[] = [
  {
    keyId: UPDATE_SIGNING_KEY_ID,
    publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8hAp7uYEbqWlvNSJ/qZ+YGCGeE3vervQnuOjaJ7w5lo=
-----END PUBLIC KEY-----
`,
  },
];

function normalizePem(pem: string): string {
  return String(pem).replace(/\\n/g, '\n');
}

/** env ใช้สำหรับ test/rotate ฉุกเฉิน; ค่าปกติใช้ key ที่ฝังในโค้ด */
export function trustedUpdateKeys(): TrustedUpdateKey[] {
  const pem = process.env.AGENT_UPDATE_PUBLIC_KEY;
  if (pem && pem.trim()) {
    return [
      {
        keyId: String(process.env.AGENT_UPDATE_PUBLIC_KEY_ID || 'env').trim() || 'env',
        publicKeyPem: normalizePem(pem),
      },
    ];
  }
  return DEFAULT_UPDATE_TRUSTED_KEYS;
}

export function canonicalUpdateManifestPayload(manifest: UpdateManifest): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      files: Array.isArray(manifest.files)
        ? manifest.files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.size }))
        : [],
    }),
    'utf8',
  );
}

function isSafeManifestPath(rel: unknown): rel is string {
  if (typeof rel !== 'string' || !rel.trim()) return false;
  const norm = rel.replace(/\\/g, '/');
  if (norm.includes('..') || norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return false;
  return norm.split('/').every((seg) => seg.length > 0 && /^[A-Za-z0-9._-]+$/.test(seg));
}

export type UpdateTrustResult =
  | { ok: true; keyId: string }
  | { ok: false; code: 'bad-manifest' | 'unsigned' | 'unknown-key' | 'bad-key' | 'bad-signature'; reason: string };

/** ตรวจโครงสร้าง + ลายเซ็นของ manifest (ไม่ throw) */
export function verifyUpdateManifestSignature(
  manifest: UpdateManifest,
  trustedKeys: TrustedUpdateKey[] = trustedUpdateKeys(),
): UpdateTrustResult {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, code: 'bad-manifest', reason: 'manifest ไม่ใช่วัตถุ' };
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    return { ok: false, code: 'bad-manifest', reason: 'ไม่มี version' };
  }
  if (typeof manifest.generatedAt !== 'string' || !manifest.generatedAt.trim()) {
    return { ok: false, code: 'bad-manifest', reason: 'ไม่มี generatedAt' };
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return { ok: false, code: 'bad-manifest', reason: 'ไม่มีไฟล์ใน manifest' };
  }

  const seen = new Set<string>();
  for (const f of manifest.files) {
    if (!f || typeof f !== 'object') return { ok: false, code: 'bad-manifest', reason: 'รายการไฟล์ไม่ถูกต้อง' };
    if (!isSafeManifestPath(f.path)) return { ok: false, code: 'bad-manifest', reason: `path ไม่ปลอดภัย: ${String(f.path)}` };
    if (seen.has(f.path)) return { ok: false, code: 'bad-manifest', reason: `path ซ้ำ: ${f.path}` };
    seen.add(f.path);
    if (typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(f.sha256)) {
      return { ok: false, code: 'bad-manifest', reason: `sha256 ไม่ถูกต้อง: ${f.path}` };
    }
    if (!Number.isSafeInteger(f.size) || f.size < 0) {
      return { ok: false, code: 'bad-manifest', reason: `size ไม่ถูกต้อง: ${f.path}` };
    }
  }

  const sig = manifest.signature;
  if (!sig || typeof sig !== 'object' || sig.alg !== UPDATE_SIGNING_ALG) {
    return { ok: false, code: 'unsigned', reason: 'manifest ยังไม่ลงนาม Ed25519' };
  }
  if (typeof sig.keyId !== 'string' || !sig.keyId) return { ok: false, code: 'unsigned', reason: 'ไม่มี keyId ของผู้เซ็น' };
  if (typeof sig.value !== 'string' || !sig.value) return { ok: false, code: 'unsigned', reason: 'ไม่มีลายเซ็น' };

  const trusted = (Array.isArray(trustedKeys) ? trustedKeys : []).find((k) => k?.keyId === sig.keyId);
  if (!trusted?.publicKeyPem) return { ok: false, code: 'unknown-key', reason: `ไม่รู้จัก keyId: ${sig.keyId}` };

  let publicKey: import('node:crypto').KeyObject;
  try {
    publicKey = crypto.createPublicKey(trusted.publicKeyPem);
  } catch {
    return { ok: false, code: 'bad-key', reason: `public key ของ ${sig.keyId} อ่านไม่ได้` };
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    return { ok: false, code: 'bad-key', reason: `public key ของ ${sig.keyId} ไม่ใช่ Ed25519` };
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(sig.value, 'base64');
  } catch {
    return { ok: false, code: 'bad-signature', reason: 'ลายเซ็นไม่ใช่ base64' };
  }
  if (signature.length !== 64) return { ok: false, code: 'bad-signature', reason: 'ลายเซ็น Ed25519 ต้องยาว 64 ไบต์' };

  try {
    if (!crypto.verify(null, canonicalUpdateManifestPayload(manifest), publicKey, signature)) {
      return { ok: false, code: 'bad-signature', reason: 'ลายเซ็นไม่ตรงกับ manifest' };
    }
  } catch {
    return { ok: false, code: 'bad-signature', reason: 'ตรวจลายเซ็นไม่สำเร็จ' };
  }
  return { ok: true, keyId: sig.keyId };
}

export type VerifiedUpdateManifest =
  | { ok: true; manifest: UpdateManifest; keyId: string }
  | { ok: false; code: 'no-bundle' | 'bad-manifest' | 'unsigned' | 'unknown-key' | 'bad-key' | 'bad-signature'; reason: string };

/** อ่าน manifest จากดิสก์แล้วตรวจลายเซ็น — ใช้ใน route ก่อนส่งให้ runner */
export function readVerifiedUpdateManifest(root: string = UPDATE_ROOT): VerifiedUpdateManifest {
  const manifest = readUpdateManifest(root);
  if (!manifest) return { ok: false, code: 'no-bundle', reason: 'ยังไม่มีชุดอัปเดตที่เผยแพร่' };
  const trust = verifyUpdateManifestSignature(manifest);
  if (!trust.ok) return trust;
  return { ok: true, manifest, keyId: trust.keyId };
}
