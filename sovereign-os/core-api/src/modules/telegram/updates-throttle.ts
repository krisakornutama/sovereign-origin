// src/modules/telegram/updates-throttle.ts — กันกด "ดึง Chat ID อัตโนมัติ" รัว ๆ
//
// ทำไมต้องมี: ปุ่มนี้ทำให้ server เรียก api.telegram.org/getUpdates ทุกครั้ง
//   กดรัว (หรือผู้ใช้หลายแท็บ) = ใช้โควตา getUpdates ของบอทจนอาจโดน 429/แบนชั่วคราว
//   และ Telegram ไม่ได้ให้เร่งความถี่นี้อยู่แล้ว — 3 วิต่อครั้งเกินพอสำหรับ UX
//
// ทำไมต้องเก็บใน DB (10 พ.ย. 69): เดิมเป็น Map ในหน่วยความจำ ⇒ กันได้เฉพาะ process เดียว
//   และหายทุกครั้งที่รีสตาร์ท · ย้ายไปตาราง telegram_updates_slot (1 แถว/ผู้ใช้) เพื่อให้
//   ทุก instance ที่ต่อ DB เดียวกันเห็นสถานะร่วมกัน โดยใช้ ON CONFLICT … WHERE … RETURNING
//   ตัดสิน "ให้ผ่านหรือไม่" ในคำสั่งเดียว (atomic — ไม่มี read-modify-write ให้แข่งกัน)
//   เลือก DB แทน Redis เพราะ DB มีอยู่แล้วในทุก deployment (ไม่มี infra ใหม่ให้ดูแล)

import { prisma } from '../../lib/prisma';

const DEFAULT_MIN_INTERVAL_MS = 3000;

export interface UpdatesSlot {
  allowed: boolean;
  /** วินาทีที่ต้องรอ (ปัดขึ้น ขั้นต่ำ 1) — 0 เมื่อ allowed */
  retryAfter: number;
}

export interface UpdatesSlotStore {
  /** จองสิทธิ์เรียก getUpdates หนึ่งครั้งสำหรับคีย์นี้ (atomic) */
  claim(key: string, now: number, windowMs: number): Promise<UpdatesSlot>;
  /** ล้างสถานะทั้งหมด — เทสต์ใช้ */
  clear(): Promise<void>;
}

/**
 * อ่าน env ตอนเรียกใช้ (ไม่ capture ตอน module load) — เทสต์จึงกำหนดช่วงเองได้
 * ค่า <= 0 = ปิด throttle (ใช้เมื่อตั้งใจทดสอบเส้นทางจริง)
 */
export function minIntervalMs(): number {
  const raw = Number(process.env.TELEGRAM_UPDATES_MIN_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_MIN_INTERVAL_MS;
}

/** เวลาที่เหลือต้องรอ (วินาที) จากครั้งล่าสุดที่ผ่าน */
export function retryAfterSeconds(lastHit: number, now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((windowMs - (now - lastHit)) / 1000));
}

/** เก็บในหน่วยความจำ — ใช้ในเทสต์/การรัน process เดียว (ไม่แชร์ข้าม instance) */
export function createMemorySlotStore(): UpdatesSlotStore {
  const lastHit = new Map<string, number>();
  return {
    async claim(key, now, windowMs) {
      const prev = lastHit.get(key);
      if (prev !== undefined && now - prev < windowMs) {
        return { allowed: false, retryAfter: retryAfterSeconds(prev, now, windowMs) };
      }
      lastHit.set(key, now);
      return { allowed: true, retryAfter: 0 };
    },
    async clear() {
      lastHit.clear();
    },
  };
}

type SlotRow = { last_hit_at: Date };

/**
 * เก็บใน DB — ตัวจริงที่ route ใช้
 *
 * คำสั่งแรกจบในตัว: ถ้าแถวเดิมยังใหม่กว่า cutoff (now - window) เงื่อนไข WHERE ของ DO UPDATE
 * ไม่จริง ⇒ ไม่มีแถวถูกอัปเดต ⇒ RETURNING ว่าง = "ไม่ให้ผ่าน" (ผู้แพ้การแข่งไม่กินสิทธิ์ของคนชนะ)
 * ถ้าได้แถวกลับมา = เราคือคนที่เขียนล่าสุด จึงได้ผ่าน
 */
export const prismaSlotStore: UpdatesSlotStore = {
  async claim(key, now, windowMs) {
    const rows = await prisma.$queryRaw<SlotRow[]>`
      INSERT INTO telegram_updates_slot (user_key, last_hit_at)
      VALUES (${key}, ${new Date(now)})
      ON CONFLICT (user_key) DO UPDATE
        SET last_hit_at = EXCLUDED.last_hit_at
        WHERE telegram_updates_slot.last_hit_at <= ${new Date(now - windowMs)}
      RETURNING last_hit_at
    `;
    if (rows.length > 0) return { allowed: true, retryAfter: 0 };

    // โดนบล็อก: อ่านค่าเดิมเพื่อบอกว่าต้องรออีกกี่วินาที (คำสั่งที่สอง เฉพาะทางที่ถูกบล็อก)
    const prev = await prisma.$queryRaw<SlotRow[]>`
      SELECT last_hit_at FROM telegram_updates_slot WHERE user_key = ${key} LIMIT 1
    `;
    // แถวหายไประหว่างสองคำสั่ง (ถูกล้าง/หมดอายุ) — ปล่อยผ่าน ไม่ทำให้ผู้ใช้ติดค้าง
    if (prev.length === 0) return { allowed: true, retryAfter: 0 };
    return {
      allowed: false,
      retryAfter: retryAfterSeconds(new Date(prev[0].last_hit_at).getTime(), now, windowMs),
    };
  },
  async clear() {
    await prisma.$executeRaw`DELETE FROM telegram_updates_slot`;
  },
};

let activeStore: UpdatesSlotStore = prismaSlotStore;

/**
 * ขอสิทธิ์เรียก getUpdates หนึ่งครั้งสำหรับคีย์นี้ (ปกติ = user id)
 * @returns allowed=false พร้อม retryAfter (วินาที, ปัดขึ้น ขั้นต่ำ 1) เมื่อยังไม่พ้นช่วงขั้นต่ำ
 */
export async function takeUpdatesSlot(key: string, now = Date.now()): Promise<UpdatesSlot> {
  const windowMs = minIntervalMs();
  if (windowMs <= 0) return { allowed: true, retryAfter: 0 };
  return activeStore.claim(key, now, windowMs);
}

/** สลับ store (เฉพาะเทสต์) — ส่ง null เพื่อกลับไปใช้ DB */
export function __setUpdatesSlotStore(store: UpdatesSlotStore | null): void {
  activeStore = store ?? prismaSlotStore;
}

/** ล้างสถานะ — เทสต์ใช้กันค่าค้างจากเคสก่อนหน้า */
export async function __resetUpdatesThrottle(): Promise<void> {
  await activeStore.clear();
}
