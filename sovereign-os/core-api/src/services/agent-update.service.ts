// src/services/agent-update.service.ts
//
// ── ชุดอัปเดตโค้ด runner สำหรับเครื่องลูก ──────────────────────────────────────
// เครื่องลูก (runner) เป็นฝ่ายเปิดขาออกมาถามเองว่า "มีเวอร์ชันใหม่ไหม" แล้วดาวน์โหลดชุดใหม่
// ⇒ HUB ไม่ต้องรู้ที่อยู่เครื่องลูกเลย และไม่ต้องมีพอร์ตเปิดเข้าที่เครื่องลูก
//
// ที่เก็บ: core-api/data/agent-updates/ (มาจาก volume ที่ mount ไว้ในคอนเทนเนอร์แล้ว
//          ⇒ ไม่ต้องแก้ docker-compose / ไม่ต้อง rebuild image)
//   manifest.json      { version, generatedAt, files: [{ path, sha256, size }] }
//   files/<path>       เนื้อไฟล์จริง (ให้บริการผ่าน route เท่านั้น)
//
// ตัวเขียนชุด = tools/agent-pack/pack.mjs (รันที่ HUB หลังแก้โค้ด)
// ⚠️ ชื่อไฟล์ที่ให้บริการถูกจำกัดสองชั้น: ต้องอยู่ใน manifest เท่านั้น + ต้องไม่มีทางลัด
//    ออกจากโฟลเดอร์ (ชื่อไฟล์มาจากแพ็ก แต่ route นี้เป็นทางสาธารณะถึง HUB — อย่าไว้ใจ input)
import fs from 'node:fs';
import path from 'node:path';

export const UPDATE_ROOT = process.env.AGENT_UPDATE_DIR || path.join(__dirname, '..', '..', 'data', 'agent-updates');

export interface UpdateFileEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface UpdateManifest {
  version: string;
  generatedAt: string;
  files: UpdateFileEntry[];
  /** Phase 3A: Ed25519 signature over {version, generatedAt, files} */
  signature?: {
    alg: 'ed25519';
    keyId: string;
    value: string;
  };
}

/** อ่าน manifest ที่ตัวแพ็กเขียนไว้ — คืน null เมื่อยังไม่มีชุดอัปเดต/ไฟล์เสีย */
export function readUpdateManifest(root: string = UPDATE_ROOT): UpdateManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as UpdateManifest;
    if (!raw?.version || !Array.isArray(raw.files) || raw.files.length === 0) return null;
    return raw;
  } catch {
    return null;
  }
}

/** ชื่อไฟล์ที่ปลอดภัยพอจะอ่านจากดิสก์ (ห้าม absolute ห้าม ..) */
export function isSafeRelPath(rel: unknown): rel is string {
  if (typeof rel !== 'string' || !rel.trim()) return false;
  const norm = rel.replace(/\\/g, '/');
  if (norm.includes('..') || path.isAbsolute(norm) || /^[A-Za-z]:/.test(norm)) return false;
  return norm.split('/').every((seg) => seg.length > 0 && /^[A-Za-z0-9._-]+$/.test(seg));
}

/**
 * หาไฟล์จริงของชุดอัปเดตจากชื่อแบบ relative
 * คืน null ถ้าไม่อยู่ใน manifest หรือชื่อไม่ปลอดภัย (ผู้เรียกตอบ 404/400 เอง)
 */
export function resolveUpdateFile(
  rel: string,
  root: string = UPDATE_ROOT,
  manifest: UpdateManifest | null = readUpdateManifest(root),
): { abs: string; entry: UpdateFileEntry } | null {
  if (!manifest || !isSafeRelPath(rel)) return null;
  const entry = manifest.files.find((f) => f.path === rel);
  if (!entry) return null;
  const abs = path.join(root, 'files', rel);
  if (!fs.existsSync(abs)) return null;
  return { abs, entry };
}

/** สรุปสั้น ๆ ให้หน้าเว็บ/หน้า diagnose ใช้ (ไม่คืนเนื้อไฟล์) */
export function updateSummary(root: string = UPDATE_ROOT) {
  const manifest = readUpdateManifest(root);
  if (!manifest) return { published: false as const, root, hint: 'รัน node tools/agent-pack/pack.mjs ที่ HUB เพื่อเผยแพร่ชุดอัปเดต' };
  return {
    published: true as const,
    root,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((sum, f) => sum + (f.size || 0), 0),
  };
}
