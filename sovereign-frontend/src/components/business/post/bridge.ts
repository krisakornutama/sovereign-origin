// components/business/post/bridge.ts
// ────────────────────────────────────────────────────────────────────────────
// สะพานจากหน้าเว็บไป Electron shell (เปิดลิงก์ · เลือกวิดีโอ · เปิดโฟลเดอร์)
//
// ⚠ ทำไมรับ `win` เป็นพารามิเตอร์ ไม่เรียก window ตรง ๆ:
//   - เทสต์ Node เรียกไฟล์นี้ตรงได้ (ไม่มี window) → พฤติกรรมถูกตรึงด้วยเทสต์จริง
//   - แอปที่ติดตั้งไว้อาจเป็นเวอร์ชันเก่าที่ยังไม่มี pickVideo/showItemInFolder
//     ถ้าเรียกฟังก์ชันที่ไม่มีจะโยน TypeError แล้ว "ทั้งหน้าโพสต์พัง"
//     → ที่นี่กันไว้ทุกทางและคืนข้อความให้ UI บอกผู้ใช้ได้
//
// ⚠ pure logic ล้วน: import ได้แค่ `import type` (ดูเหตุผลใน post-model.ts)
// ────────────────────────────────────────────────────────────────────────────

export interface BridgeResult {
  ok: boolean;
  message?: string;
}

export interface PickedVideo {
  path: string;
  name: string;
  size: number;
}

export interface PostBridge {
  /** แอปนี้มีปุ่มเลือกวิดีโอในตัวหรือไม่ — แอปเวอร์ชันเก่าอาจไม่มี ต้องถอยไปใช้ <input type="file"> */
  hasPickVideo: boolean;
  openExternal: (url: string) => Promise<BridgeResult>;
  pickVideo: () => Promise<PickedVideo | null>;
  showItemInFolder: (path: string) => Promise<BridgeResult>;
}

export const NO_OPEN_EXTERNAL = 'แอปเวอร์ชันนี้ยังเปิดลิงก์ไม่ได้ — กรุณาเปิดลิงก์ด้วยเบราว์เซอร์เอง';
export const NO_REVEAL_FOLDER = 'แอปเวอร์ชันนี้ยังเปิดโฟลเดอร์ไม่ได้';

/**
 * หยิบสะพานจาก `window` — คืน null เมื่อไม่ใช่แอปเดสก์ท็อป (เว็บเพลน ๆ)
 * ผู้เรียกต้องรับมือ null เสมอ (ในเว็บยังใช้ปุ่ม "คัดลอกข้อความ" ได้อยู่)
 */
export function postBridge(win: unknown): PostBridge | null {
  const src = (win as { sovereign?: Record<string, unknown> } | null | undefined)?.sovereign;
  if (!src || typeof src !== 'object') return null;

  const invoke = (name: string, arg?: unknown): Promise<unknown> => {
    const fn = src[name];
    if (typeof fn !== 'function') return Promise.resolve(null);
    try {
      // ⚠ ต้อง .catch() ที่นี่ด้วย ไม่ใช่แค่ try/catch
      //   เพราะ IPC ที่ reject จะไม่ถูกจับด้วย try (มัน async) แล้วจะกลายเป็น rejection ลอย
      //   ที่ไปถึงผู้เรียก → หน้าโพสต์พังทั้งหน้า (เทสต์จับได้จริงตอนเขียน)
      return Promise.resolve((fn as (a?: unknown) => unknown).call(src, arg)).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };

  const asResult = (v: unknown, fallback: string): BridgeResult => {
    if (v && typeof v === 'object' && 'ok' in (v as object)) {
      const o = v as { ok?: unknown; message?: unknown };
      return { ok: o.ok === true, message: typeof o.message === 'string' ? o.message : undefined };
    }
    return { ok: false, message: fallback };
  };

  return {
    hasPickVideo: typeof src.pickVideo === 'function',
    openExternal: (url) => invoke('openExternal', url).then((v) => asResult(v, NO_OPEN_EXTERNAL)),
    showItemInFolder: (p) => invoke('showItemInFolder', p).then((v) => asResult(v, NO_REVEAL_FOLDER)),
    pickVideo: async () => {
      const v = await invoke('pickVideo');
      if (!v || typeof v !== 'object') return null;
      const o = v as { path?: unknown; name?: unknown; size?: unknown };
      if (typeof o.path !== 'string' || !o.path) return null;
      const size = Number(o.size);
      return {
        path: o.path,
        // ชื่อไฟล์ที่ส่งมาว่าง/ไม่ใช่สตริง → อนุมานจากพาธเอง ดีกว่าปล่อยให้ UI โชว์ช่องว่าง
        name: typeof o.name === 'string' && o.name ? o.name : o.path.split(/[\\/]/).pop() || o.path,
        size: Number.isFinite(size) && size > 0 ? size : 0,
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// สะพาน YouTube (อัปโหลดอัตโนมัติ)
//
// ⚠ แยกจาก postBridge โดยตั้งใจ — ของเดิมมีเทสต์คุมรูปร่างอยู่ การเติมคีย์เข้าไป
//   เสี่ยงทำให้เทสต์เดิมพังโดยไม่จำเป็น
// ⚠ ทุกฟังก์ชันต้อง "มีอยู่จริง" ก่อนถึงจะเรียก — แอปที่ติดตั้งไว้ก่อนอัปเดตจะไม่มีคีย์เหล่านี้
//   ถ้าเรียกตรง ๆ จะได้ TypeError แล้วหน้าโพสต์พังทั้งหน้า (บทเรียนเดิมจาก pickVideo)
// ⚠ ความลับ (client secret / token) ไม่เคยผ่านสะพานนี้ — main เก็บและใช้เองทั้งหมด
//   ที่นี่เห็นได้แค่ "มี/ไม่มี" กับชื่อช่อง
// ────────────────────────────────────────────────────────────────────────────

export interface YoutubeStatus {
  secure: boolean;
  hasClient: boolean;
  connected: boolean;
  channelTitle: string;
  clientHint: string;
  freePerDay: number;
}

export interface YoutubeUploadOpts {
  filePath: string;
  title: string;
  description: string;
  privacy: string;
}

export interface YoutubeResult {
  ok: boolean;
  message?: string;
  code?: string;
  videoId?: string | null;
}

export interface YoutubeProgress {
  sent?: number;
  total?: number;
  done?: boolean;
  ok?: boolean;
}

export interface YoutubeBridge {
  /** แอปนี้รองรับการอัปโหลดอัตโนมัติหรือยัง (แอปเวอร์ชันเก่า = false → UI ต้องซ่อนการ์ดทิ้ง) */
  available: boolean;
  status: () => Promise<YoutubeStatus | null>;
  importDialog: () => Promise<YoutubeResult & { cancelled?: boolean }>;
  importText: (text: string) => Promise<YoutubeResult>;
  connect: () => Promise<YoutubeResult & { channelTitle?: string }>;
  disconnect: () => Promise<YoutubeResult>;
  cancel: () => Promise<YoutubeResult>;
  upload: (o: YoutubeUploadOpts) => Promise<YoutubeResult>;
  /** สมัครรับความคืบหน้า — คืนฟังก์ชันถอนการสมัคร (ไม่รองรับ = คืน no-op) */
  onProgress: (cb: (p: YoutubeProgress) => void) => () => void;
}

export const NO_YOUTUBE = 'แอปเวอร์ชันนี้ยังไม่มีปุ่มอัปโหลดอัตโนมัติ — กรุณาอัปเดตแอป Sovereign OS ก่อน';

/** คืน null เมื่อไม่ใช่แอปเดสก์ท็อป — คืนอ็อบเจ็กต์ที่ available=false เมื่อเป็นแอปเวอร์ชันเก่า */
export function youtubeBridge(win: unknown): YoutubeBridge | null {
  const src = (win as { sovereign?: Record<string, unknown> } | null | undefined)?.sovereign;
  if (!src || typeof src !== 'object') return null;

  const call = (name: string, arg?: unknown): Promise<YoutubeResult | null> => {
    const fn = src[name];
    if (typeof fn !== 'function') return Promise.resolve(null);
    try {
      return Promise.resolve((fn as (a?: unknown) => unknown).call(src, arg))
        .then((v) => (v && typeof v === 'object' ? (v as YoutubeResult) : null))
        .catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };

  const need = (name: string) => typeof src[name] === 'function';
  const available = need('youtubeStatus') && need('youtubeUpload') && need('youtubeConnect');

  return {
    available,
    status: async () => {
      const v = await call('youtubeStatus');
      if (!v) return null;
      const o = v as unknown as Record<string, unknown>;
      return {
        secure: o.secure === true,
        hasClient: o.hasClient === true,
        connected: o.connected === true,
        channelTitle: typeof o.channelTitle === 'string' ? o.channelTitle : '',
        clientHint: typeof o.clientHint === 'string' ? o.clientHint : '',
        freePerDay: Number.isFinite(Number(o.freePerDay)) && Number(o.freePerDay) > 0 ? Number(o.freePerDay) : 6,
      };
    },
    importDialog: async () => {
      const v = await call('youtubeImportDialog');
      if (!v) return { ok: false, message: NO_YOUTUBE };
      const o = v as unknown as { cancelled?: unknown };
      return { ...v, cancelled: o.cancelled === true };
    },
    importText: async (text) => (await call('youtubeImportText', text)) || { ok: false, message: NO_YOUTUBE },
    connect: async () => (await call('youtubeConnect')) || { ok: false, message: NO_YOUTUBE },
    disconnect: async () => (await call('youtubeDisconnect')) || { ok: false, message: NO_YOUTUBE },
    cancel: async () => (await call('youtubeCancel')) || { ok: false },
    upload: async (o) => (await call('youtubeUpload', o)) || { ok: false, message: NO_YOUTUBE },
    onProgress: (cb) => {
      const fn = src.onYoutubeProgress;
      if (typeof fn !== 'function') return () => {};
      try {
        const off = (fn as (c: (p: YoutubeProgress) => void) => unknown).call(src, (p: unknown) => {
          // UI ที่ throw ต้องไม่ลามเข้า IPC ของ main
          try { if (p && typeof p === 'object') cb(p as YoutubeProgress); } catch { /* ไม่มีอะไรต้องทำ */ }
        });
        // แอปเวอร์ชันใหม่คืนฟังก์ชันถอนการสมัครกลับมา — เก็บไว้ใช้ตอน unmount
        return typeof off === 'function' ? (off as () => void) : () => {};
      } catch { return () => {}; }
    },
  };
}
