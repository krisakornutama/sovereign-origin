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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import multer from 'multer';
import type { Options } from 'multer';
import type { Request, RequestHandler } from 'express';

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

export interface UploadedFileLike {
  originalname?: string;
  buffer?: Buffer;
  path?: string;
}

/** อ่านหัวไฟล์พอสำหรับ magic-byte check (ไม่โหลดทั้งไฟล์เข้า RAM) */
function readHead(file: UploadedFileLike): Buffer {
  if (file.buffer) return file.buffer.subarray(0, 8192);
  if (!file.path) return Buffer.alloc(0);
  let fd: number | undefined;
  try {
    fd = fs.openSync(file.path, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function startsWithBytes(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function ascii(buf: Buffer, start: number, length: number): string {
  return buf.subarray(start, start + length).toString('latin1');
}

/**
 * ตรวจเนื้อหาไฟล์จริงหลัง multer อ่านเสร็จ (fileFilter เห็นแค่ชื่อ/MIME ที่ client อ้าง)
 * - executable magic (MZ/ELF) = ปฏิเสธทุกนามสกุล
 * - รูป/PDF/เสียงที่รู้จัก = magic bytes ต้องตรงนามสกุล
 * - ข้อความ = ต้องไม่มี NUL
 */
export function verifyUploadedContent(file: UploadedFileLike): void {
  const head = readHead(file);
  if (startsWithBytes(head, [0x4d, 0x5a]) || startsWithBytes(head, [0x7f, 0x45, 0x4c, 0x46])) {
    throw new Error('เนื้อหาไฟล์เป็น executable (magic bytes) — ปฏิเสธ');
  }

  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  const mismatch = () => {
    throw new Error(`เนื้อหาไฟล์ไม่ตรงกับนามสกุล ${ext || '(ไม่มี)'} (magic bytes ไม่ตรง) — ปฏิเสธ`);
  };

  switch (ext) {
    case '.jpg':
    case '.jpeg':
      if (!startsWithBytes(head, [0xff, 0xd8, 0xff])) mismatch();
      return;
    case '.png':
      if (!startsWithBytes(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) mismatch();
      return;
    case '.gif':
      if (ascii(head, 0, 6) !== 'GIF87a' && ascii(head, 0, 6) !== 'GIF89a') mismatch();
      return;
    case '.webp':
      if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 4) !== 'WEBP') mismatch();
      return;
    case '.bmp':
      if (ascii(head, 0, 2) !== 'BM') mismatch();
      return;
    case '.tiff':
    case '.tif':
      if (!startsWithBytes(head, [0x49, 0x49, 0x2a, 0x00]) && !startsWithBytes(head, [0x4d, 0x4d, 0x00, 0x2a])) mismatch();
      return;
    case '.pdf':
      if (!head.subarray(0, 1024).includes(Buffer.from('%PDF-'))) mismatch();
      return;
    case '.wav':
      if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 4) !== 'WAVE') mismatch();
      return;
    case '.mp3':
      if (ascii(head, 0, 3) !== 'ID3' && !(head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) mismatch();
      return;
    case '.m4a':
      if (ascii(head, 4, 4) !== 'ftyp') mismatch();
      return;
    case '.ogg':
      if (ascii(head, 0, 4) !== 'OggS') mismatch();
      return;
    case '.webm':
      if (!startsWithBytes(head, [0x1a, 0x45, 0xdf, 0xa3])) mismatch();
      return;
    case '.txt':
    case '.md':
    case '.markdown':
    case '.csv':
      if (head.includes(0)) mismatch();
      return;
    default:
      return; // นามสกุลอื่นถูก whitelist เองแล้ว — ยังกัน executable ข้างบนไว้
  }
}

/** middleware ครอบ upload.single(field): error ของ multer (นามสกุล/MIME/ขนาดเกิน) → 400/413 เสมอ
 *  ไม่ปล่อย next(err) — เดิม Express default handler ตอบ 500 ให้ client ที่ส่งไฟล์ไม่ผ่าน whitelist
 *  + ตรวจ magic bytes หลังอ่านไฟล์ (multer fileFilter มองไม่เห็นเนื้อหา) */
export function handledUpload(upload: multer.Multer, field: string): RequestHandler {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        const status = (err as NodeJS.ErrnoException).code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: err.message || 'อัปโหลดไม่ถูกต้อง' });
      }
      const file = (req as Request & { file?: UploadedFileLike }).file;
      if (file) {
        try {
          verifyUploadedContent(file);
        } catch (verifyErr: any) {
          // disk mode: multer เขียนไฟล์ก่อนตรวจ — ต้องลบทิ้ง ไม่ให้ไฟล์อันตรายค้าง
          if (file.path) {
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
          }
          return res.status(400).json({ error: verifyErr?.message || 'เนื้อหาไฟล์ไม่ถูกต้อง' });
        }
      }
      return next();
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
