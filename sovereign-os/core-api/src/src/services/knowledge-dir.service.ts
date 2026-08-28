// src/services/knowledge-dir.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Resolver หาโฟลเดอร์คลังความรู้จริง — เดิมโครงสร้างเป็นสองแบบ:
//   core-api/knowledge/*.txt        (ในเครื่อง)
//   core-api/knowledge/knowledge/*.txt  (ใน Docker image เก่า)
// เลือกโฟลเดอร์ที่ "มีไฟล์ .txt/.md อยู่จริง" ให้ทุก module ใช้ร่วมกัน
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';

function looksLikeKnowledgeDir(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    // มีไฟล์ .txt/.md ตรง ๆ หรือเป็นโฟลเดอร์ uploads (โฟลเดอร์เก็บไฟล์อัปโหลด)
    const hasFiles = entries.some((f) => /\.(txt|md|pdf)$/i.test(f));
    const hasUploads = entries.includes('uploads');
    return hasFiles || hasUploads;
  } catch {
    return false;
  }
}

/** คืน absolute path ของโฟลเดอร์คลังความรู้ (มีไฟล์จริง) — สร้างให้ถ้าไม่มี */
export function knowledgeDir(): string {
  // __dirname = src/services → ขึ้น 2 ชั้น = core-api root
  const root = path.resolve(__dirname, '..', '..');
  const candidates = [
    path.join(root, 'knowledge', 'knowledge'), // โครงสร้าง Docker เก่า (nested)
    path.join(root, 'knowledge'),              // โครงสร้างปกติ
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && looksLikeKnowledgeDir(c)) {
      return c;
    }
  }
  // ไม่มีเลย → ใช้ knowledge/ และสร้างขึ้น
  const fallback = path.join(root, 'knowledge');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

/** โฟลเดอร์เก็บไฟล์อัปโหลด (PDF/TXT) — อยู่ในโฟลเดอร์ความรู้ */
export function uploadsDir(): string {
  const dir = path.join(knowledgeDir(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
