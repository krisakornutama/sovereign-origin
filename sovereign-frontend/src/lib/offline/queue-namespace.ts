// src/lib/offline/queue-namespace.ts — ยูทิลิตี pure ของ offline queue namespace
//
// หลักคิด (docs/OFFLINE-QUEUE-NAMESPACE-PLAN.md):
//   - คิว ≠ แคช: คิวคือ data intent ของเจ้าของ — logout ต้องรอดครบทุกชิ้น (I2)
//     ⇒ module นี้มีแต่ "ใส่ตรา" กับ "กรอง" — ไม่มี API ลบ/ล้างเด็ดขาด
//   - record ไม่มี field `userId` = legacy (เก่าก่อน deploy) = Dormant: ไม่ flush / ไม่โชว์ / ไม่ลบ
//     รอ P1 retention นโยบายเดียว — เพราะ undefined === null เป็น false เอง
//     (ตัวกรองจึงคัด legacy ออกแม้ session ปัจจุบันเป็น anonymous)
//   - FIFO ต่อเจ้าของ (I4): ตัวกรองคงลำดับของ array ต้นทางเสมอ ไม่เรียงซ้ำ
//   - import แบบ type-only จาก offlineQueue — กัน runtime cycle ตอนฝั่ง wiring เรียกเข้ามา
import type { QueuedAction } from '../offlineQueue';

/** ตัวตนของเจ้าของคิว — user id จาก session ปัจจุบัน · null = anonymous (session ไร้ตัวตน) */
export type QueueUserId = string | null;

/** ใส่ตราเจ้าของบน action ก่อนลงคิว — คืน object ใหม่ ไม่แก้ของเดิม */
export function stampUserId(action: QueuedAction, userId: QueueUserId): QueuedAction {
  return { ...action, userId };
}

/** เอาเฉพาะ action ของ session ปัจจุบัน — legacy (ไม่มี stamp) ผ่านไม่ได้ทุกกรณี (I5) */
export function ownQueuedActions(actions: QueuedAction[], userId: QueueUserId): QueuedAction[] {
  return actions.filter((a) => a.userId === userId);
}
