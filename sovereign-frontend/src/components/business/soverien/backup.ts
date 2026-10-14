// components/business/soverien/backup.ts
// ค่าคงที่เริ่มต้นของเครื่องมือ + ฟังก์ชันสำรอง/ล้างข้อมูล + วัดโควตา localStorage
// แยกจาก store เพื่อไม่ให้ไฟล์ UI ต้องดึง store ทั้งก้อนมาแค่เรียก wipeAll
import type { Settings } from './types';

export const KEY = 'soverien.tools.v1';

export const DEFAULT_SETTINGS: Settings = {
  models: [
    { id: 'temp-01', name: 'Soverien Temp v1 (ESP8266 + DS18B20)', prefix: 'Soverign-Temp', price: 990, active: true, lastNo: -1 },
  ],
  nearExpiryDays: 30,
  shippingDays: 14,
  warrantyDays: 365,
  sticker: {
    widthMm: 40, heightMm: 20, dpi: 300,
    serialX: 0.06, serialY: 0.38, serialSize: 26, serialColor: '#111827',
    showQr: true, qrX: 0.76, qrY: 0.18, qrSize: 64,
  },
};

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