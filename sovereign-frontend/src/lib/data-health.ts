// data-health — ติดตามผลการโหลดข้อมูล "แยกต่อ endpoint"
//
// ทำไมต้องมี: เดิม dashboard ใช้ error ก้อนเดียวร่วมกันระหว่าง /api/dashboard/stats
// กับ /api/devices/status ⇒ คำขอที่สำเร็จตัวหนึ่งล้าง error ของอีกตัวที่ยังพังอยู่
// และเพราะ poll ทุก 5 วิ แบนเนอร์จึงกะพริบ (ล้ม → ขึ้น → สำเร็จ → หาย) ตอนเน็ตขาด
//
// กติกา: error แยกต่อ key · แจ้งเมื่อล้มติดกัน >= FAILURES_BEFORE_NOTICE รอบ
// (blip รอบเดียวไม่แจ้ง) · สำเร็จแล้วเคลียร์เฉพาะ key ของตัวเอง

export const FAILURES_BEFORE_NOTICE = 2;

export interface EndpointHealth {
  /** จำนวนครั้งที่ล้มติดกันต่อ key (รีเซ็ตเมื่อสำเร็จ) */
  streaks: Record<string, number>;
  /** error ล่าสุดของ key ที่ล้มติดกันจนถึงเกณฑ์แล้วเท่านั้น */
  errors: Record<string, unknown>;
}

export function initialHealth(): EndpointHealth {
  return { streaks: {}, errors: {} };
}

/** สำเร็จ → รีเซ็ต streak และเคลียร์ error ของ key นั้น (คืน state เดิมถ้าไม่มีอะไรเปลี่ยน) */
export function recordSuccess(health: EndpointHealth, key: string): EndpointHealth {
  if (!health.streaks[key] && health.errors[key] === undefined) return health;
  const errors = { ...health.errors };
  delete errors[key];
  return { streaks: { ...health.streaks, [key]: 0 }, errors };
}

/** ล้ม → เพิ่ม streak และเริ่มแจ้งเมื่อถึงเกณฑ์ (ไม่แตะ key อื่น) */
export function recordFailure(health: EndpointHealth, key: string, error: unknown): EndpointHealth {
  const streak = (health.streaks[key] ?? 0) + 1;
  const streaks = { ...health.streaks, [key]: streak };
  if (streak < FAILURES_BEFORE_NOTICE) return { ...health, streaks };
  return { streaks, errors: { ...health.errors, [key]: error } };
}

/** key ที่ควรแจ้งผู้ใช้ตอนนี้ (เฉพาะที่ล้มติดกันจนถึงเกณฑ์) */
export function degradedKeys(health: EndpointHealth): string[] {
  return Object.keys(health.errors).filter((k) => health.errors[k] !== undefined);
}
