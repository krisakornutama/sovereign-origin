// src/lib/log-once.ts
//
// ── log ที่ไม่สแปม ───────────────────────────────────────────────────────────
// ตอน DB ใช้ไม่ได้ (migrate ล้ม/schema drift) ทุกคำขอที่แตะตารางจะ error แล้วเขียน
// stderr ทีละบรรทัด — รอบทดสอบจริงบนแอปที่แพ็กได้ 830 บรรทัดในไม่กี่วินาที ซึ่งกลบ
// สาเหตุจริงที่อยู่บรรทัดบนสุดจนมองไม่เห็น
//
// กติกา:
//   · key เดียวกัน → พิมพ์เต็มครั้งแรก ครั้งต่อ ๆ ไปนับเงียบ
//   · ครบหน้าต่างเวลา (ค่าเริ่มต้น 5 นาที) → พิมพ์สรุปพร้อมจำนวนที่กลืนไป
//   · ข้อความเปลี่ยนแต่ key เดิม ยังถูกกลืน (กันสแปมจาก error ที่มี id/เวลาต่างกัน)
//
// ไฟล์นี้เป็น pure logic — เวลาและ logger ฉีดเข้ามาได้ จึงเทสต์ได้โดยไม่ต้องมี DB

interface LogOnceOptions {
  /** ระยะเวลาก่อนอนุญาตให้พิมพ์สรุปอีกครั้ง (ms) */
  windowMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

export function createLogOnce(options: LogOnceOptions = {}) {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((message: string) => console.error(message));
  const seen = new Map<string, { lastLog: number; suppressed: number }>();

  return function logOnce(key: string, message: string): void {
    const t = now();
    const entry = seen.get(key);
    if (!entry) {
      seen.set(key, { lastLog: t, suppressed: 0 });
      log(message);
      return;
    }
    entry.suppressed += 1;
    if (t - entry.lastLog < windowMs) return;
    // ครั้งนี้คือครั้งที่กำลังรายงาน จึงไม่นับรวมเป็น "ที่กลืนไป"
    const suppressed = entry.suppressed - 1;
    const seconds = Math.max(1, Math.round((t - entry.lastLog) / 1000));
    entry.lastLog = t;
    entry.suppressed = 0;
    log(suppressed > 0 ? `${message} — ซ้ำ ${suppressed} ครั้งใน ${seconds} วิ` : message);
  };
}

/**
 * ครอบ `console.error` ของโปรเซสด้วยตัวกรองกันซ้ำ
 *
 * เหตุผลจากของจริง: ตอน DB ไม่มีตาราง มี worker ~15 ตัวที่ยิง error เองทุก 15–60 วิ
 * (coding queue, agent queue, relay scheduler, vision, power guard, learning …)
 * แก้ทีละจุดไม่ทันและลืมง่าย — ครอบที่เดียวจึงคุมได้ทั้งโปรเซส
 *
 * key = บรรทัดแรกของข้อความ (ตัดที่ 120 ตัวอักษร) — Prisma พิมพ์รายละเอียดหลายบรรทัด
 * แต่บรรทัดแรกบอกชนิดปัญหาเสมอ
 */
export function installErrorDedupe(
  target: { error: (...args: unknown[]) => void } = console,
  options: { windowMs?: number } = {}
): () => void {
  const original = target.error.bind(target) as (...args: unknown[]) => void;
  const logOnce = createLogOnce({
    windowMs: options.windowMs,
    log: (message) => original(message),
  });
  const text = (args: unknown[]) =>
    args
      .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : String(a)))
      .join(' ')
      .trim();
  target.error = (...args: unknown[]) => {
    const full = text(args);
    if (!full) return original();
    logOnce(full.split('\n')[0].slice(0, 120), full);
  };
  return () => {
    target.error = original;
  };
}
