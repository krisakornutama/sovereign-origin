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
