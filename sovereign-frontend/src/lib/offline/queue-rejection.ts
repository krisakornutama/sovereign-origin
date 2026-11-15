// src/lib/offline/queue-rejection.ts
// ─────────────────────────────────────────────────────────────────────────────
// ขาของ "คำขอที่ถูกปฏิเสธถาวร" ของ offline queue (P1② จาก
// docs/OFFLINE-QUEUE-RETENTION-PLAN.md §"อยู่รอ")
//
// ปัญหาที่แก้: flushQueue retry ทุกอย่างที่ไม่ใช่ 2xx ทุกครั้งที่กลับ online —
// คำขอที่ server ปฏิเสธเพราะตัวคำขอเองผิด (400/404/409/422 …) จะถูกยิงซ้ำตลอดกาล
// badge ค้างตลอด, คิวไม่เคยว่าง, และ log ปลายทางเต็มไปด้วยคำขอเดิม
//
// กติกาที่โมดูลนี้ยึด (สำคัญกว่าการทำให้คิวว่าง):
//   1) **ห้ามลบข้อมูลของผู้ใช้เพื่อให้คิวสวย** — 4xx ที่ตัดสินว่าถาวรจะถูก "พัก"
//      (quiesce) ไม่ใช่ลบ: record ยังอยู่ใน IDB พร้อมเหตุผล ผู้ใช้ยังเห็นและกู้ได้
//      การลบต้องเป็นการตัดสินใจของคนเท่านั้น (ปุ่มลบในหน้า settings)
//   2) ตัดสินจาก HTTP status เท่านั้น — ไม่เดาจาก body/ข้อความ (server เปลี่ยนคำได้)
//   3) 4xx ที่ยังมีโอกาสสำเร็จ (408 timeout, 425 too early, 429 rate limit) = retry
//      · 401/403 = พัก (token ที่ฝังอยู่ใน headers เก่าแล้ว — retry ด้วยของเดิมไม่มีทางผ่าน
//        และการยิงซ้ำทุกครั้งที่ online คือ retry storm) ผู้ใช้ล็อกอินใหม่แล้วกดลองเองได้
//   4) 5xx/เครือข่ายล่ม = retry (ฝั่ง server อาจฟื้น)
//
// โมดูลนี้ **pure ล้วน** — ห้ามแตะ IndexedDB/window/fetch (IDB อยู่ที่ offlineQueue.ts)
// ─────────────────────────────────────────────────────────────────────────────

import type { QueuedAction } from '../offlineQueue';

/** สิ่งที่ควรทำกับ action หลังจากเห็น HTTP status ของการส่ง */
export type FlushVerdict = 'ok' | 'retry' | 'rejected';

/** 4xx ที่ "ยังมีโอกาสสำเร็จ" — ต้องลองใหม่ ไม่ใช่พัก */
export const RETRYABLE_4XX = new Set([408, 425, 429]);

/** ข้อมูลการถูกปฏิเสธที่เก็บคู่กับ action (structured-clone ได้) */
export interface QueueRejection {
  /** HTTP status ที่ได้รับ */
  status: number;
  /** เวลาที่ถูกปฏิเสธ (ISO) */
  at: string;
}

/**
 * แปลง HTTP status เป็นการตัดสิน:
 *  - 2xx → ok (ลบออกจากคิวได้)
 *  - 4xx ที่ไม่ใช่ 408/425/429 → rejected (พักไว้ ห้ามลบเอง ห้าม retry อัตโนมัติ)
 *  - ที่เหลือ (5xx, 0, network error) → retry
 */
export function classifyFlushStatus(status: number): FlushVerdict {
  if (!Number.isFinite(status)) return 'retry';
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 400 && status < 500) return RETRYABLE_4XX.has(status) ? 'retry' : 'rejected';
  return 'retry';
}

/** action นี้ถูกพักอยู่หรือไม่ (จะถูกข้ามในการ flush อัตโนมัติ) */
export function isQuiesced(action: QueuedAction): boolean {
  const rejection = action.lastRejection;
  return !!rejection && typeof rejection === 'object' && typeof rejection.status === 'number';
}

/**
 * ติดป้าย "ถูกปฏิเสธ" โดยไม่แก้ object เดิม — เก็บ field อื่นครบ (body/headers/userId)
 * เพื่อให้กด "ลองใหม่" ด้วย payload เดิมได้เสมอ
 */
export function withRejection(action: QueuedAction, status: number, now: number | Date = Date.now()): QueuedAction {
  const stamp = typeof now === 'number' ? now : now.getTime();
  return { ...action, lastRejection: { status, at: new Date(stamp).toISOString() } };
}

/** ถอดป้ายออก (ใช้เมื่อผู้ใช้สั่งลองใหม่แบบสะอาด) — ไม่แตะ field อื่น */
export function withoutRejection(action: QueuedAction): QueuedAction {
  const copy = { ...action };
  delete copy.lastRejection;
  return copy;
}

/** action ที่ควรถูกส่งอัตโนมัติ (ไม่ถูกพักไว้) */
export function shouldAttempt(action: QueuedAction): boolean {
  return !isQuiesced(action);
}
