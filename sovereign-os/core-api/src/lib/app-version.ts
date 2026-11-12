// src/lib/app-version.ts
// ─────────────────────────────────────────────────────────────────────────────
// รุ่นของโค้ดที่โปรเซสนี้กำลังรัน — ใช้ตอบใน GET /api/health
//
// ทำไมต้องมี: fingerprint บอกได้ว่าไฟล์ชุดเดิมหรือไม่ แต่เทียบข้ามรุ่นไม่ได้
// เคสจริง 12/11/69: พอร์ต 3001 ถูกคอนเทนเนอร์ด้วย image เก่ายึดไว้ ⇒ แอปที่ติดตั้ง
// v1.3.2 คุยกับ API รุ่นเก่า และ endpoint ใหม่ตอบ 404 โดยไม่มีใครรู้ว่าผิดที่รุ่นไหน
// การมี version ใน health ทำให้เทียบกับ tag ที่ปล่อยได้ตรง ๆ
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';

/** อ่าน version จากข้อความ package.json — เพี้ยน/ไม่มี = null (ไม่โยน) */
export function readVersionFromPackageJson(text: string): string | null {
  try {
    const parsed = JSON.parse(String(text ?? ''));
    const value = parsed?.version;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * หา package.json ของ core-api ที่โปรเซสนี้โหลดอยู่
 * - รันจาก dist: __dirname = core-api/dist/lib → ../../package.json
 * - รันจาก tsx: __dirname = core-api/src/lib → ../../package.json (เท่ากัน)
 * - cwd เป็นทางสำรองสำหรับรันแบบอื่น
 */
function candidatePaths(): string[] {
  return [
    path.join(__dirname, '../../package.json'),
    path.join(__dirname, '../package.json'),
    path.join(process.cwd(), 'package.json'),
  ];
}

export function appVersion(): string | null {
  const fromEnv = String(process.env.APP_VERSION ?? '').trim();
  if (fromEnv) return fromEnv;

  for (const file of candidatePaths()) {
    try {
      const version = readVersionFromPackageJson(fs.readFileSync(file, 'utf8'));
      if (version) return version;
    } catch {
      // ไฟล์ถัดไป
    }
  }
  return null;
}
