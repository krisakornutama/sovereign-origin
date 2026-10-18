// components/business/post/post-validate.ts
// ────────────────────────────────────────────────────────────────────────────
// ตรวจไฟล์วิดีโอก่อนส่งไปแพลตฟอร์ม + จัดรูปแบบจำนวนไบต์ให้อ่านรู้เรื่อง
//
// ⚠ ทำไมต้องตรวจก่อนอัปโหลด ไม่ปล่อยให้แพลตฟอร์มบอกเอง:
//   เจ้าของอัปโหลดคลิป 6 GB ไป TikTok แล้วรอครึ่งชั่วโมงเพื่อพบว่าไม่ผ่าน
//   → ตรวจให้เสร็จในเครื่องก่อน แล้วบอกทันทีว่า "เกินเพดานของแพลตฟอร์มไหน เท่าไร"
//
// ⚠ pure logic ล้วน: import ได้แค่ `import type` (ดูเหตุผลใน post-model.ts)
//   ไฟล์นี้เทสต์ Node เรียกตรง ๆ
// ────────────────────────────────────────────────────────────────────────────
import type { PlatformSpec } from './post-model';

/** นามสกุลที่แพลตฟอร์มทั้งสามรับจากหน้าเว็บอัปโหลด */
export const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];

/** นามสกุลท้ายชื่อไฟล์ ('a.MP4' → 'mp4') · ไม่มีนามสกุล → '' */
export function videoExt(name: string): string {
  const m = /\.([a-z0-9]+)\s*$/i.exec(String(name ?? '').trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * ไฟล์นี้เป็นวิดีโอที่อัปโหลดได้ไหม
 * ⚠ ใช้ "นามสกุลท้ายสุด" เท่านั้น — a.mp4.exe ต้องไม่ผ่าน
 *   (ถ้าใช้ includes('.mp4') จะโดนกับดักนี้ทันที)
 */
export function isVideoFile(name: string): boolean {
  return VIDEO_EXTS.includes(videoExt(name));
}

/** 512 → '512 B' · 1048576 → '1 MB' · 1572864 → '1.5 MB' (ไม่โชว์ทศนิยมเฟ้อ) */
export function formatBytes(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  const rounded = i === 0 ? Math.round(x) : Math.round(x * 10) / 10;
  return `${rounded} ${units[i]}`;
}

export interface VideoCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * ตรวจไฟล์วิดีโอกับเพดานของแพลตฟอร์มที่เลือก
 * คืนเหตุผลเป็นภาษาไทยที่เจ้าของอ่านแล้วรู้ว่าต้องทำอะไรต่อ (ไม่ใช่ "invalid file")
 */
export function videoCheck(name: string, size: number, spec: PlatformSpec): VideoCheckResult {
  if (!isVideoFile(name)) {
    const ext = videoExt(name);
    const allow = VIDEO_EXTS.join(', ');
    return {
      ok: false,
      reason: ext
        ? `ไฟล์ .${ext} ไม่ใช่วิดีโอที่อัปโหลดได้ (รับเฉพาะ ${allow})`
        : `ไฟล์นี้ไม่มีนามสกุลวิดีโอ (รับเฉพาะ ${allow})`,
    };
  }

  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, reason: 'ไฟล์วิดีโอยังว่างอยู่ (0 ไบต์) — เลือกไฟล์อีกครั้ง' };
  }

  const cap = Number(spec?.fileMaxBytes ?? 0);
  if (cap > 0 && bytes > cap) {
    return {
      ok: false,
      reason: `ไฟล์ใหญ่เกินเพดาน ${spec.label} (${formatBytes(cap)}) — ไฟล์นี้ ${formatBytes(bytes)}`,
    };
  }

  return { ok: true };
}
