// src/modules/telegram/updates-throttle.ts — กันกด "ดึง Chat ID อัตโนมัติ" รัว ๆ
//
// ทำไมต้องมี: ปุ่มนี้ทำให้ server เรียก api.telegram.org/getUpdates ทุกครั้ง
//   กดรัว (หรือผู้ใช้หลายแท็บ) = ใช้โควตา getUpdates ของบอทจนอาจโดน 429/แบนชั่วคราว
//   และ Telegram ไม่ได้ให้เร่งความถี่นี้อยู่แล้ว — 3 วิต่อครั้งเกินพอสำหรับ UX
//
// เป็น state ในหน่วยความจำ: ข้อจำกัดคือรีเซ็ตเมื่อ process รีสตาร์ท และไม่แชร์ข้าม instance
//   (ยอมรับได้ เพราะเป็นเพียงการกันกดรัวจากหน้าจอเดียว ไม่ใช่ quota ระดับระบบ)

const DEFAULT_MIN_INTERVAL_MS = 3000;

/**
 * อ่าน env ตอนเรียกใช้ (ไม่ capture ตอน module load) — เทสต์จึงกำหนดช่วงเองได้
 * ค่า <= 0 = ปิด throttle (ใช้เมื่อตั้งใจทดสอบเส้นทางจริง)
 */
function minIntervalMs(): number {
  const raw = Number(process.env.TELEGRAM_UPDATES_MIN_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_MIN_INTERVAL_MS;
}

const lastHit = new Map<string, number>();

/**
 * ขอสิทธิ์เรียก getUpdates หนึ่งครั้งสำหรับคีย์นี้ (ปกติ = user id)
 * @returns allowed=false พร้อม retryAfter (วินาที, ปัดขึ้น ขั้นต่ำ 1) เมื่อยังไม่พ้นช่วงขั้นต่ำ
 */
export function takeUpdatesSlot(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
  const window = minIntervalMs();
  const prev = lastHit.get(key);
  if (prev !== undefined && now - prev < window) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((window - (now - prev)) / 1000)) };
  }
  lastHit.set(key, now);
  return { allowed: true, retryAfter: 0 };
}

/** ล้าง state — เทสต์ใช้กันค่าค้างจากเคสก่อนหน้า */
export function __resetUpdatesThrottle(): void {
  lastHit.clear();
}
