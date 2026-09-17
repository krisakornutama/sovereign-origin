/* harden-upload — util กลางสำหรับ multer ทุกโมดูล (งาน hardening รอบ 2026-09-17)
   จุดเกิด: whisper ไม่มี fileFilter ชนิดไฟล์เลย, knowledge สะท้อนชื่อไฟล์กลับหา client
   สัญญา:
     1. ชื่อไฟล์บนดิสก์สุ่มเสมอ (Date.now + UUID) — originalname ไม่มีวันถูกใช้ตั้งชื่อไฟล์
        → path traversal (..\..\, ..\..\x.exe) เข้าไม่ได้ตั้งแต่ชั้น storage
     2. fileFilter เป็น whitelist นามสกุลที่ส่งมาตอนสร้าง — ไม่ผ่าน = ไม่ถูกเขียนลงดิสก์เลย
     3. สิ่งที่สะท้อนกลับหา client ต้องผ่าน safeDisplayName() เสมอ (basename + ตัด control char + จำกัดความยาว)
   ใช้: const upload = hardenUpload({ allowedExtensions: ['.pdf', '.txt'], maxSizeMB: 25 })
        const upload = hardenUpload({ destination: UPLOAD_DIR, allowedExtensions: ['.wav'] }) */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import multer from 'multer';

/** ชื่อไฟล์สำหรับ "แสดงผล" เท่านั้น — basename + ตัด control chars + จำกัดความยาว (ไม่ใช้ตั้งชื่อไฟล์บนดิสก์) */
export function safeDisplayName(originalname: unknown): string {
  const base = path.basename(String(originalname ?? 'file')).replace(/[.\s]+$/, '');
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'file').slice(0, 120);
}

/** นามสกุลที่ผ่านการล้างสำหรับใช้ต่อท้ายชื่อไฟล์สุ่ม — ไม่ตรง whitelist ใด ๆ = เป็น '' ได้ */
function sanitizedExtension(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ext.length <= 10 ? ext : '';
}

/** ชื่อไฟล์บนดิสก์ — สุ่มเสมอ: prefix เวลา + UUID + นามสกุลที่ล้างแล้ว */
export function randomDiskName(originalname: string): string {
  return `${Date.now()}-${randomUUID()}${sanitizedExtension(originalname)}`;
}

export interface HardenUploadOptions {
  /** whitelist นามสกุล (ตัวพิมพ์เล็ก พร้อมจุด) — บังคับ ห้ามว่าง */
  allowedExtensions: string[];
  /** โฟลเดอร์ปลายทาง (ดีฟอลต์ = os.tmpdir()) */
  destination?: string;
  /** ขนาดไฟล์สูงสุด (MB) — ดีฟอลต์ 25 */
  maxSizeMB?: number;
}

/** สร้าง multer instance ที่ harden ครบทั้ง 3 สัญญาข้างบน */
export function hardenUpload({ allowedExtensions, destination, maxSizeMB = 25 }: HardenUploadOptions): multer.Multer {
  const allow = new Set(
    (allowedExtensions ?? []).map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)),
  );
  if (allow.size === 0) {
    // fail-fast ตอนสตาร์ทเซิร์ฟเวอร์ — ไม่ยอมให้มีจุดรับไฟล์แบบ "รับทุกนามสกุล" เกิดขึ้นโดยไม่ตั้งใจ
    throw new Error('hardenUpload: ต้องระบุ allowedExtensions เป็น whitelist อย่างน้อย 1 นามสกุล');
  }
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destination ?? os.tmpdir()),
      filename: (_req, file, cb) => cb(null, randomDiskName(file.originalname || '')),
    }),
    limits: { fileSize: maxSizeMB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (allow.has(ext)) cb(null, true);
      else cb(new Error(`นามสกุลไฟล์ไม่ได้รับอนุญาต (รองรับ: ${[...allow].join(' ')})`));
    },
  });
}
