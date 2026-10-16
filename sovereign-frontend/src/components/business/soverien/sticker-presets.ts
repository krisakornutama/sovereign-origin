// components/business/soverien/sticker-presets.ts
// สร้างแม่แบบป้าย — แยกเป็น .ts ธรรมดา (ไม่มี JSX) เพื่อให้เทสต์ Node เรียกใช้ได้จริง
//
// ⚠ ทำไมต้องแยก (16/10/69): เดิมสร้าง id ด้วย `Date.now().toString(36)` อยู่ใน StickerStudio.tsx
//   เทสต์จึงต้อง "grep โค้ด" เพื่อพิสูจน์ว่า id ไม่ซ้ำ ซึ่งพิสูจน์อะไรไม่ได้จริง ๆ
//   ย้ายมาที่นี่แล้วเทสต์เรียกฟังก์ชันจริง → กดสร้าง 100 ชั่วโมงในลม แล้วเช็คว่า id ไม่ซ้ำจริง
import type { StickerConfig, StickerPreset } from './types';

// ── ชนิดป้ายที่มีอยู่จริง 16/10/69 ────────────────────────────────────────
// เจ้าของส่งภาพป้ายจริงมา พบว่าช่อง "Serial No." อยู่บน **แถบสีน้ำเงินเข้ม** ขอบล่าง
//   ค่าเริ่มต้นเดิมเป็นสีดำ → ตัวเลขจะมองไม่เห็นบนป้ายนี้ (ต้นเหตุที่ต้องแก้)
//   และมี QR พิมพ์ไว้แล้วมุมขวาล่าง → ห้ามวาง QR ทับ และบรรทัดวันสิ้นประกันจะไปชนกับมัน
export type LabelProfile = {
  key: string;
  label: string;
  hint: string;
  patch: Partial<StickerConfig>;
};

export const LABEL_PROFILES: LabelProfile[] = [
  {
    key: 'sovereign-os',
    label: 'ป้าย Sovereign OS',
    hint: 'พื้นแถบล่างเป็นสีเข้ม → ตัวเลขต้องเป็นสีขาว · QR พิมพ์ไว้แล้ว',
    patch: {
      showQr: false,
      showWarranty: false,
      serialColor: '#ffffff',
      serialPlate: false,
      serialAlign: 'left',
      serialX: 0.23,
      serialY: 0.83,
      serialSize: 40,
    },
  },
  {
    key: 'blank-light',
    label: 'ป้ายเปล่า (พื้นสว่าง)',
    hint: 'ตัวเลขสีเข้มบนพื้นขาว · ให้ระบบวาง QR ให้เอง',
    patch: {
      showQr: true,
      showWarranty: true,
      serialColor: '#111827',
      serialPlate: true,
      serialPlateColor: '#ffffff',
      serialX: 0.06,
      serialY: 0.38,
    },
  },
];

export function labelProfile(key: string): LabelProfile | undefined {
  return LABEL_PROFILES.find((p) => p.key === key);
}

/** ค่าที่ต้อง patch เวลาเลือกชนิดป้าย — รวมขนาดตัวอักษรให้เข้ากับขนาดป้ายปัจจุบันเสมอ */
export function profilePatch(key: string, cfg: StickerConfig): Partial<StickerConfig> | null {
  const p = labelProfile(key);
  return p ? { ...p.patch } : null;
}

/** สร้าง id ที่ไม่ซ้ำภายในรอบเดียวกัน (Date.now() คืนค่าเดิมถ้าเรียกถี่ ๆ ในมิลลิวินาทีเดียว) */
let seq = 0;
export function newPresetId(): string {
  seq = (seq + 1) % 1_000_000;
  return `p-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** สร้างแม่แบบป้าย 1 ชุด (คัดลอก cfg ไปใหม่ ไม่ใช่อ้างอิงของเดิม) */
export function makePreset(name: string, cfg: StickerConfig): StickerPreset {
  return { id: newPresetId(), name, cfg: { ...cfg } };
}
