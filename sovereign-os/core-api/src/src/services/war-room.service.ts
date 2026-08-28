// src/services/war-room.service.ts
// War Room Activity Gate — Lean ข้อ 3: Event-Driven Simulation (หลับ-ตื่น)
// งานจำลองหนัก (Governor AI / GovSim) จะ "หลับ" เมื่อไม่มีมนุษย์เปิดหน้า War Room
// - สัญญาณตื่น = มี SSE session เปิดอยู่ (หน้า Dashboard live) หรือมี API activity ล่าสุด
// - หลังปิดหน้าแล้วยังนับ "active" ต่ออีก IDLE_GRACE_MS (กันเปิด-ปิดบ่อย / churn)
// - worker ที่วนรอบหนักควรปรึกษา warRoomActive() ก่อนทำงาน และรันต่อเมื่อ active เท่านั้น

const IDLE_GRACE_MS = 10 * 60 * 1000; // 10 นาที กัน churn หลังมนุษย์ปิดหน้า

const clock: { now: () => number } = { now: () => Date.now() };

let activeSessions = 0;
let lastActivityAt: number = clock.now();

export function warRoomPulse(): void {
  lastActivityAt = clock.now();
}

export function warRoomSessionOpened(): void {
  activeSessions += 1;
  warRoomPulse();
}

export function warRoomSessionClosed(): void {
  if (activeSessions > 0) activeSessions -= 1;
  warRoomPulse();
}

export function warRoomActive(graceMs: number = IDLE_GRACE_MS): boolean {
  return activeSessions > 0 || clock.now() - lastActivityAt < graceMs;
}

export function warRoomStatus() {
  return {
    active: warRoomActive(),
    activeSessions,
    idleGraceMs: IDLE_GRACE_MS,
    lastActivityAt,
    idleSeconds: Math.max(0, Math.round((clock.now() - lastActivityAt) / 1000)),
  };
}

// ── test hooks: inject fake clock ──
export function __setClock(fn: () => number): void {
  clock.now = fn;
}

export function __reset(): void {
  clock.now = () => Date.now();
  activeSessions = 0;
  lastActivityAt = clock.now();
}
