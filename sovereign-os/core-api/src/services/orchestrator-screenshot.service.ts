// src/services/orchestrator-screenshot.service.ts
//
// ที่เก็บ "ภาพหน้าจอตอนจบงาน" ของ Agent Orchestration
//
// ปัญหาที่ service นี้แก้: runner จับภาพหน้าจอของเครื่องได้ แต่ก่อนหน้านี้ไม่มีที่ให้ส่ง
// และไม่มีที่เก็บ ⇒ screenshot_url บนงานว่างตลอด ผู้ใช้ไม่เห็นภาพจบงานเลย
//
// หลักการ:
//   · เก็บไฟล์บนดิสก์ใต้โฟลเดอร์เดียว (default = core-api/data/orchestrator-shots)
//     เลือกใช้ดิสก์แทน DB เพราะภาพ PNG ใหญ่และไม่ต้อง query — DB เก็บแค่ path สั้น ๆ
//   · ชื่อไฟล์สุ่ม/อิงเวลาเอง (ไม่ใช้ชื่อจาก client) ⇒ path traversal เข้าไม่ได้ตั้งแต่ชั้นชื่อไฟล์
//   · ตรวจว่า job เป็นของเครื่องที่อัปโหลดจริง ก่อนเขียนไฟล์ (กันเครื่องอื่นปลอมเขียนงานคนอื่น)
//   · เก็บ URL เป็น relative path /api/agent-machines/screenshots/<ไฟล์>
//     เพื่อให้หน้าเว็บเรียกผ่าน authFetch (แนบ JWT) ได้ตรง ๆ — ไม่เปิดสาธารณะ
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { jobMachineId, setJobScreenshotUrl, clearScreenshotUrls } from './agent-machines.service';

/** โฟลเดอร์เก็บภาพ — override ด้วย env เพื่อให้เทสต์ชี้ไปโฟลเดอร์ชั่วคราวได้ */
export function screenshotDir(): string {
  const override = process.env.ORCHESTRATOR_SCREENSHOT_DIR;
  const dir = override || path.resolve(process.cwd(), 'data', 'orchestrator-shots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** นามสกุลที่ยอมรับ (คู่กับ harden-upload IMAGE_EXTS ฝั่ง route) */
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** URL ภายในที่หน้าเว็บใช้เรียกภาพ (relative — authFetch เติม origin ให้เอง) */
export function screenshotUrlFor(filename: string): string {
  return `/api/agent-machines/screenshots/${filename}`;
}

/**
 * บันทึกภาพของงาน + ตั้ง screenshot_url
 *
 * คืน null เมื่อไม่พบงานหรืองานไม่ได้เป็นของเครื่องนี้ (ไม่ throw — ผู้เรียกตอบ 404 เอง)
 */
export async function saveJobScreenshot(
  jobId: string,
  machineId: string,
  buffer: Buffer,
  originalname: string
): Promise<string | null> {
  // ตรวจความเป็นเจ้าของก่อนเขียนไฟล์เสมอ — เครื่องที่อัปโหลดต้องเป็นเครื่องที่งานนั้นสั่งให้ทำ
  if ((await jobMachineId(jobId)) !== machineId) return null;

  const ext = path.extname(originalname || '').toLowerCase();
  const safeExt = ALLOWED_EXT.has(ext) ? ext : '.png';
  // ชื่อไฟล์ไม่รับจาก client — ประกอบเองจาก id งาน + เวลา + uuid
  const filename = `job-${jobId}-${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`;
  const full = path.join(screenshotDir(), filename);
  fs.writeFileSync(full, buffer);

  const url = screenshotUrlFor(filename);
  try {
    await setJobScreenshotUrl(jobId, url);
  } catch (err) {
    // ผูกกับงานไม่ได้ = อย่าปล่อยไฟล์ขยะค้างบนดิสก์
    try {
      fs.unlinkSync(full);
    } catch {
      /* ลบไม่ได้ก็ปล่อย — ไฟล์กำพร้าไม่มีผลกับความถูกต้องของงาน */
    }
    throw err;
  }
  return url;
}

// ── Retention: ภาพ ~2.8 MB/งาน ไม่มีใครล้าง ⇒ disk โตไม่รู้จบ ──

/** อายุเริ่มต้น (วัน) — ถ้าไม่ตั้ง env หรือตั้งผิดรูปแบบจะใช้ค่านี้เสมอ */
export const DEFAULT_RETENTION_DAYS = 14;

/**
 * อายุภาพที่จะเก็บ อ่านจาก `ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS`
 *
 * ค่าพัง (ไม่ใช่ตัวเลข / น้อยกว่า 1 วัน) ตกกลับเป็น 14 —
 * ตั้งผิดห้ามแปลเป็น "ลบหมด" หรือ "ข้าม retention" เพราะนั่นคือ two-way fail ที่อันตรายกว่าค่าเริ่มต้น
 */
export function screenshotRetentionDays(): number {
  const raw = Number(process.env.ORCHESTRATOR_SCREENSHOT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_RETENTION_DAYS;
}

export interface PruneResult {
  /** จำนวนไฟล์ที่ตรวจดูทั้งหมด */
  scanned: number;
  /** ชื่อไฟล์ที่ลบไป (ไม่รวม path) */
  deleted: string[];
  /** จำนวนแถวงานที่ถูกเคลียร์ screenshot_url */
  cleared: number;
}

/**
 * ลบภาพหน้าจอที่หมดอายุ + เคลียร์ `screenshot_url` บนแถวงานที่ชี้อยู่
 *
 * สำคัญ: ลบไฟล์อย่างเดียวไม่พอ — URL ค้างบนแถวงานทำให้ผู้ใช้กด
 * "ดูภาพหน้าจอ" แล้วเจอ 404 งง ๆ · สองอย่างนี้จึงต้องเกิดพร้อมกัน
 * ไม่ throw: worker เรียกทุก 6 ชม. งานล้างไม่มีวันทำให้ระบบล้ม
 */
export async function pruneScreenshots(retentionDays?: number): Promise<PruneResult> {
  const days = retentionDays ?? screenshotRetentionDays();
  const cutoff = Date.now() - days * 86_400_000;
  const dir = screenshotDir();
  const deleted: string[] = [];
  let scanned = 0;

  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      scanned += 1;
      if (st.mtimeMs >= cutoff) continue;
      fs.unlinkSync(full);
      deleted.push(name);
    } catch (err) {
      // ไฟล์ถูกคนอื่นลบไประหว่างทาง / อ่าน stat ไม่ได้ — ข้าม ไม่ทำให้รอบล้างทั้งหมดล้ม
      console.error('[orchestrator-screenshot] prune file failed:', name, err instanceof Error ? err.message : err);
    }
  }

  let cleared = 0;
  if (deleted.length > 0) {
    try {
      cleared = await clearScreenshotUrls(deleted.map(screenshotUrlFor));
    } catch (err) {
      // เคลียร์ URL ไม่ได้ = งานยังชี้ไฟล์ที่หาย — ไม่ crash แต่ต้องเห็นใน log
      console.error('[orchestrator-screenshot] clear screenshot_url failed:', err instanceof Error ? err.message : err);
    }
  }
  return { scanned, deleted, cleared };
}
