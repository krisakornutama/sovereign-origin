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
import { jobMachineId, setJobScreenshotUrl } from './agent-machines.service';

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
