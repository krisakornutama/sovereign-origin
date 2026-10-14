// components/business/soverien/backup.ts
// ฟังก์ชันสำรอง/ล้างข้อมูล + วัดโควตา localStorage
//
// ⚠ ค่าเริ่มต้นต้องอยู่ที่ store.ts ที่เดียว (14/10/69)
//   เคสจริง: เคยมี DEFAULT_SETTINGS ซ้ำทั้งใน backup.ts และ store.ts
//   พอเพิ่มฟิลด์ใหม่ใน store.ts ไฟล์นี้ไม่ได้อัปเดต → `next build` พัง
//   ทั้งที่ store.ts ผ่านสบายๆ  → ย้ายมา import จากที่เดียวกันจะไม่ drift อีก
import { KEY, DEFAULT_SETTINGS } from './store';

export { KEY, DEFAULT_SETTINGS };

export function wipeAll(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** ขนาดข้อมูลปัจจุบันโดยประมาณ (KB) */
export function usageKb(data: unknown): number {
  try {
    return Math.round(JSON.stringify(data).length / 1024);
  } catch {
    return 0;
  }
}

/**
 * ประมาณพื้นที่ที่เหลือของ localStorage (KB)
 * ไม่ใช้ storage.estimate() เพราะ Electron/Chromium ไม่รับประกันว่าจะมี
 */
export function remainingKb(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const probeKey = `${KEY}__probe`;
    const chunk = 'x'.repeat(64 * 1024);
    let used = 0;
    for (let i = 0; i < 48; i++) {
      try {
        window.localStorage.setItem(probeKey + i, chunk);
        used += chunk.length;
      } catch {
        break;
      }
    }
    for (let i = 0; i < 48; i++) window.localStorage.removeItem(probeKey + i);
    // ค่ามาตรฐาน Chromium คือ ~5 MB ต่อ origin
    return Math.max(0, Math.round((5 * 1024 * 1024 - used) / 1024));
  } catch {
    return 0;
  }
}