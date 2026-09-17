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
import type { Options } from 'multer';
import type { RequestHandler } from 'express';

/** ชื่อไฟล์สำหรับ "แสดงผล" เท่านั้น — ตัดทั้ง / และ \ (platform-agnostic — path.basename บน POSIX ไม่ตัด \) + ตัด control chars + จำกัดความยาว */
export function safeDisplayName(originalname: unknown): string {
  const raw = String(originalname ?? 'file');
  const parts = raw.split(/[/\\]+/); // ตัดทุกชั้นของทั้ง / และ \\ ก่อน basename ปกติ
  const base = (parts[parts.length - 1] ?? '').replace(/[.\s]+$/, '');
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'file').slice(0, 120);
}

/** resolve path ที่ต้องอยู่ใต้ root เท่านั้น — นอก root (เช่น ..\..\ หรือ absolute อื่น) ทำให้ throw ก่อนแตะดิสก์
    ใช้คู่ fs.unlinkSync/sendFile ทุกจุดที่ป้อน path จากข้อมูลภายนอก */
export function resolveInsideRoot(root: string, ...segments: string[]): string {
  // backslash = อันตรายเสมอ: บน Windows เป็น separator (path.resolve จัดการอยู่แล้ว) แต่บน POSIX
  // เป็นแค่ตัวอักษร — แบนทุกแพลตฟอร์มเพื่อให้สัญญาเหมือนกันทั้ง Linux/Windows (ผู้เรียกใช้ path.join ของ OS จริง)
  if (segments.some((s) => s.includes('\\'))) {
    throw new RangeError(`path มี backslash (ไม่อนุญาต): ${segments.join('/')}`);
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const rel = path.relative(resolvedRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new RangeError(`path อยู่นอก root ที่อนุญาต: ${segments.join('/')}`);
  }
  return target;
}

/** middleware ครอบ upload.single(field): error ของ multer (นามสกุล/MIME/ขนาดเกิน) → 400/413 เสมอ
 *  ไม่ปล่อย next(err) — เดิม Express default handler ตอบ 500 ให้ client ที่ส่งไฟล์ไม่ผ่าน whitelist */
export function handledUpload(upload: multer.Multer, field: string): RequestHandler {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      const status = (err as NodeJS.ErrnoException).code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ error: err.message || 'อัปโหลดไม่ถูกต้อง' });
    });
  };
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

/** whitelist MIME รูปภาพที่หลายโมดูลใช้ร่วมกัน (documents/vision/treasury) */
export const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']);

/** นามสกุลรูปภาพคู่กับ IMAGE_MIME */
export const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'];

export interface HardenUploadOptions {
  /** whitelist นามสกุล (ตัวพิมพ์เล็ก พร้อมจุด) — บังคับ ห้ามว่าง */
  allowedExtensions: string[];
  /** โฟลเดอร์ปลายทาง (ดีฟอลต์ = os.tmpdir()) */
  destination?: string;
  /** ขนาดไฟล์สูงสุด (MB) — ดีฟอลต์ 25 */
  maxSizeMB?: number;
  /** เก็บใน RAM (buffer) แทนดิสก์ — สำหรับโมดูลที่อ่านทันทีแล้วทิ้ง (security/vision ฯลฯ)
   *  สัญญาเดียวกันทุกข้อ — เพียงไม่มีอะไรลงดิสก์ (มี destination ไม่ได้) */
  mode?: 'disk' | 'memory';
  /** whitelist MIME (magic-byte sniff ฝั่ง AV จะตรวจเนื้อหาจริงตามหลัง — ชั้นนี้กันหยาบก่อน) */
  mimeAllow?: Set<string>;
}

/** สร้าง multer instance ที่ harden ครบทั้ง 3 สัญญาข้างบน (disk mode หรือ memory mode) */
export function hardenUpload({ allowedExtensions, destination, maxSizeMB = 25, mode = 'disk', mimeAllow }: HardenUploadOptions): multer.Multer {
  const allow = new Set(
    (allowedExtensions ?? []).map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)),
  );
  if (allow.size === 0) {
    // fail-fast ตอนสตาร์ทเซิร์ฟเวอร์ — ไม่ยอมให้มีจุดรับไฟล์แบบ "รับทุกนามสกุล" เกิดขึ้นโดยไม่ตั้งใจ
    throw new Error('hardenUpload: ต้องระบุ allowedExtensions เป็น whitelist อย่างน้อย 1 นามสกุล');
  }
  if (mode === 'memory' && destination) {
    throw new Error('hardenUpload: mode memory ไม่ใช้ destination (ไม่มีอะไรลงดิสก์)');
  }
  /* fileFilter รวม 2 ชั้นในฟังก์ชันเดียว: MIME (ถ้ากำหนด) → นามสกุล (whitelist เสมอ)
     — ห้ามยอมให้ชั้นใดชั้นหนึ่งหายไป (เทส route เคยจับตอน refactor ว่า filter นามสกุลหลุด) */
  const fileFilter: Options['fileFilter'] = (_req, file, cb) => {
    if (mimeAllow && !mimeAllow.has(file.mimetype)) {
      return cb(new Error(`MIME type ไม่ได้รับอนุญาต (${[...mimeAllow].join(' ')})`));
    }
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allow.has(ext)) cb(null, true);
    else cb(new Error(`นามสกุลไฟล์ไม่ได้รับอนุญาต (รองรับ: ${[...allow].join(' ')})`));
  };
  const base: Options = {
    limits: { fileSize: maxSizeMB * 1024 * 1024, files: 1 },
    fileFilter,
  };
  if (mode === 'memory') {
    return multer({ ...base, storage: multer.memoryStorage() });
  }
  return multer({
    ...base,
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destination ?? os.tmpdir()),
      filename: (_req, file, cb) => cb(null, randomDiskName(file.originalname || '')),
    }),
  });
}
