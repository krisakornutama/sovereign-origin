// src/lib/offline/queue-retention.ts
// ─────────────────────────────────────────────────────────────────────────────
// Retention sweep ของ offline queue — ขาอายุที่ P0 ยังไม่มี
//
// ปัญหาที่แก้: คิวที่ flush ไม่เคยสำเร็จจะถูก retry ตลอดกาล และคิว legacy (ก่อน P0)
// อยู่ในสถานะ Dormant ที่ไม่มีใครเห็น → ข้อมูลโตไม่มีขอบเขต
//
// กติกาที่โมดูลนี้ยึด (docs/OFFLINE-QUEUE-RETENTION-PLAN.md §5 R1-R7):
//   R1  ตัดสินจาก queuedAt เท่านั้น · เกิน 30 วันเข้ม (== 30 วัน = เก็บ)
//   R2  ทุกกลุ่มใช้เกณฑ์เดียวกัน (ตัวเอง/คนอื่น/legacy)
//   R3  เขียน audit สำเร็จก่อน แล้วจึงลบ (write-ahead) — เขียนล้ม = ไม่ลบ
//   R4  1 บันทึก/รอบ · removedCount ตรง · รายชื่อ id ตามลำดับอายุ
//   R5  ชุดตัดว่าง = ไม่เขียนบันทึกเปล่า
//   R6  audit cap 50 · เก็บใหม่→เก่า
//   R7  คิวที่เหลือ FIFO เดิมไม่พลิก
//
// โมดูลนี้ **pure ล้วน** — ห้ามแตะ IndexedDB/window (IDB อยู่ที่ offlineQueue.ts)
// ทำให้เทสต์รันบน Node ได้โดยไม่ต้องมี browser
// ─────────────────────────────────────────────────────────────────────────────

import type { QueuedAction } from '../offlineQueue';

export const QUEUE_MAX_AGE_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const QUEUE_MAX_AGE_MS = QUEUE_MAX_AGE_DAYS * DAY_MS;
/** เพดานบันทึก audit (รายการล่าสุด) — เกินแล้วตัดท้าย ไม่กระทบคิว */
export const AUDIT_CAP = 50;

/** ข้อมูลขั้นต่ำของ action ที่เก็บไว้ในบันทึก — ไม่ลาก body/headers ลงไป */
export interface ActionRef {
  id: number;
  userId: string | null;
  url: string;
  queuedAt: string;
}

export interface RetentionAuditRecord {
  id?: number;
  /** เวลาที่ sweep (ISO) */
  at: string;
  removedCount: number;
  removedRange: { oldestQueuedAt: string; newestQueuedAt: string } | null;
  removed: ActionRef[];
}

/** ที่เก็บบันทึก — injection เพื่อให้เทสต์ใช้ memory double ได้ */
export interface AuditStore {
  put(record: RetentionAuditRecord): Promise<void>;
  list(): Promise<RetentionAuditRecord[]>;
}

/**
 * แบ่งคิวตามอายุ — ตัดสินจาก queuedAt เท่านั้น
 * - queuedAt อ่านไม่ได้ หรือไม่มี id (ลบไม่ได้) → เก็บไว้ (ตัดสิน/ลบไม่ได้ = ห้ามลบ)
 * - removables เรียงเก่า → ใหม่ · kept รักษาลำดับเดิม (FIFO)
 */
export function splitByAge(
  all: QueuedAction[],
  now: number,
  maxAgeMs: number = QUEUE_MAX_AGE_MS
): { removables: QueuedAction[]; kept: QueuedAction[] } {
  const kept: QueuedAction[] = [];
  const stale: Array<{ action: QueuedAction; at: number }> = [];

  for (const action of all) {
    const at = Date.parse(action.queuedAt);
    const deletable = typeof action.id === 'number' && Number.isFinite(action.id);
    if (!deletable || !Number.isFinite(at) || now - at <= maxAgeMs) {
      kept.push(action);
      continue;
    }
    stale.push({ action, at });
  }

  stale.sort((a, b) => a.at - b.at);
  return { removables: stale.map((s) => s.action), kept };
}

export function toActionRef(action: QueuedAction): ActionRef {
  return {
    id: action.id as number,
    userId: action.userId ?? null,
    url: action.url,
    queuedAt: action.queuedAt,
  };
}

/** สร้างบันทึกของรอบหนึ่ง — refs เรียงตามลำดับที่รับมา (เก่า → ใหม่) */
export function buildAuditRecord(
  removables: QueuedAction[],
  now: number | Date = Date.now()
): Omit<RetentionAuditRecord, 'id'> {
  const stamp = typeof now === 'number' ? now : now.getTime();
  const times = removables.map((a) => Date.parse(a.queuedAt)).filter((t) => Number.isFinite(t));

  return {
    at: new Date(stamp).toISOString(),
    removedCount: removables.length,
    removedRange:
      removables.length === 0 || times.length === 0
        ? null
        : {
            oldestQueuedAt: new Date(Math.min(...times)).toISOString(),
            newestQueuedAt: new Date(Math.max(...times)).toISOString(),
          },
    removed: removables.map(toActionRef),
  };
}

/**
 * เขียนบันทึกก่อน แล้วจึงลบ (write-ahead, R3)
 * - put ล้ม → throw ทันทีโดยยังไม่เรียก removeOne แม้แต่ครั้งเดียว
 * - removableIds ว่าง → คืน 0 โดยไม่เขียนบันทึก (R5)
 */
export async function recordAuditThenRemove(
  removableIds: number[],
  record: Omit<RetentionAuditRecord, 'id'>,
  auditStore: AuditStore,
  removeOne: (id: number) => Promise<void>
): Promise<number> {
  if (removableIds.length === 0) return 0;

  await auditStore.put({ ...record, removedCount: removableIds.length });

  let removed = 0;
  for (const id of removableIds) {
    await removeOne(id);
    removed += 1;
  }
  return removed;
}

/** เรียงบันทึกใหม่ → เก่า (id มาก = ใหม่กว่า · ไม่มี id ใช้ at) */
export function sortAuditNewestFirst(records: RetentionAuditRecord[]): RetentionAuditRecord[] {
  return [...records].sort((a, b) => {
    const ai = typeof a.id === 'number' ? a.id : 0;
    const bi = typeof b.id === 'number' ? b.id : 0;
    if (bi !== ai) return bi - ai;
    return Date.parse(b.at) - Date.parse(a.at);
  });
}

/** ตัดให้เหลือ cap รายการล่าสุด (R6) */
export function applyAuditCap(
  records: RetentionAuditRecord[],
  cap: number = AUDIT_CAP
): RetentionAuditRecord[] {
  return sortAuditNewestFirst(records).slice(0, Math.max(0, cap));
}

/** id ของบันทึกที่เกินเพดาน (ต้องลบออกจาก store) */
export function trimIds(records: RetentionAuditRecord[], cap: number = AUDIT_CAP): number[] {
  return sortAuditNewestFirst(records)
    .slice(Math.max(0, cap))
    .map((r) => r.id)
    .filter((id): id is number => typeof id === 'number');
}

/** บันทึกล่าสุดสำหรับแสดงผลในหน้า settings */
export function latestAudit(records: RetentionAuditRecord[]): RetentionAuditRecord | null {
  return applyAuditCap(records, 1)[0] ?? null;
}
