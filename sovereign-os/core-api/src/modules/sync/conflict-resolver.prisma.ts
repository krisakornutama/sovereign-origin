// ─────────────────────────────────────────────────────────────────────────────
// conflict-resolver.prisma.ts — production store ของ ConflictResolver
//
// แยกจาก conflict-resolver.ts (pure) เพื่อให้เทสต์รันได้โดยไม่มี DB
// และเพื่อให้ arch-gate เห็นว่า sync ไม่แตะตารางของโมดูลอื่นโดยตรง:
//   - inventory_items → ผ่าน applyStockDelta() ของ inventory service (เจ้าของตาราง)
//   - sensor_telemetry → ผ่าน appendTelemetryRow() ของ telemetry-buffer service (เจ้าของตาราง)
//   - idempotency_keys → shared table
//   - sync_conflict_logs → ตารางของ sync เอง
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../../lib/prisma';
import { applyStockDelta } from '../../services/inventory.service';
import { appendTelemetryRow } from '../../services/telemetry-buffer.service';
import {
  CONFLICT_REASONS,
  type ClaimResult,
  type ConflictResolverStore,
  type DeltaInput,
  type DeltaResult,
  type SyncConflictLogInput,
  type SyncConflictLogRecord,
  type SyncResolution,
  type TelemetryAppendInput,
} from './conflict-resolver';

/** เก็บผลของงานที่ทำแล้ว 30 วัน — พอสำหรับคิวออฟไลน์ที่ replay ช้า */
export const SYNC_IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** claim ที่ค้างเกิน 10 นาทีถือว่า process ตาย → ให้ retry ยึดงานได้ */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

export class PrismaConflictResolverStore implements ConflictResolverStore {
  async appendTelemetry(input: TelemetryAppendInput): Promise<unknown> {
    await appendTelemetryRow(prisma, {
      time: input.recordedAt,
      nodeId: input.nodeId,
      deviceId: input.deviceId,
      metric: input.metric,
      value: input.value,
    });
    return { nodeId: input.nodeId, metric: input.metric, value: input.value };
  }

  async applyDelta(input: DeltaInput): Promise<DeltaResult> {
    // ยังไม่มีบัญชีกลางที่รองรับ delta สำหรับ finance — ห้ามเดาตาราง/เขียนทับ
    // ⇒ เข้าคิว PENDING_REVIEW ไว้ก่อนจนกว่าจะมี treasury ledger service
    if (input.domain !== 'inventory') {
      return {
        applied: false,
        quantity: 0,
        conflictReason: CONFLICT_REASONS.UNSUPPORTED_DOMAIN,
      };
    }

    const result = await applyStockDelta(prisma, {
      userId: input.userId,
      itemId: input.resourceId,
      delta: input.delta,
    });
    return {
      applied: result.applied,
      quantity: result.quantity,
      conflictReason: result.reason,
    };
  }

  async tryClaim(
    scope: string,
    key: string,
    fingerprint: string,
    userId?: string
  ): Promise<ClaimResult> {
    const now = Date.now();

    // claim ที่ค้างเพราะ process ตาย (ไม่ได้ release) → ปล่อยให้ retry ยึดได้
    await prisma.idempotencyKey
      .deleteMany({
        where: {
          scope,
          key,
          status: 'in_flight',
          createdAt: { lt: new Date(now - STALE_CLAIM_MS) },
        },
      })
      .catch(() => undefined);

    try {
      await prisma.idempotencyKey.create({
        data: {
          scope,
          key,
          fingerprint,
          status: 'in_flight',
          userId: userId ?? null,
          expiresAt: new Date(now + SYNC_IDEMPOTENCY_TTL_MS),
        },
      });
      return { claimed: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }

    const row = await prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
    });
    const previous =
      row?.status === 'done' && row.responseBody && typeof row.responseBody === 'object'
        ? (row.responseBody as unknown as SyncResolution)
        : null;
    return { claimed: false, previous };
  }

  async complete(scope: string, key: string, result: SyncResolution): Promise<void> {
    await prisma.idempotencyKey.update({
      where: { scope_key: { scope, key } },
      data: {
        status: 'done',
        responseCode: 200,
        responseBody: result as unknown as object,
      },
    });
  }

  async release(scope: string, key: string): Promise<void> {
    // ลบเฉพาะ claim ที่ยังไม่เสร็จ — ห้ามลบผลของงานที่ complete แล้ว
    await prisma.idempotencyKey.deleteMany({
      where: { scope, key, status: 'in_flight' },
    });
  }

  async writeConflictLog(input: SyncConflictLogInput): Promise<SyncConflictLogRecord> {
    const payload = input.payload as unknown as object;
    const row = await prisma.syncConflictLog.upsert({
      where: { mutationId: input.mutationId },
      create: {
        mutationId: input.mutationId,
        idempotencyKey: input.idempotencyKey,
        domain: input.domain,
        action: input.action,
        userId: input.userId,
        resource: input.resource,
        conflictReason: input.conflictReason,
        payload,
        occurredAt: input.occurredAt,
      },
      // retry: อัปเดตเฉพาะบริบทล่าสุด ไม่แตะ status/การตัดสินของ admin
      update: {
        conflictReason: input.conflictReason,
        payload,
        occurredAt: input.occurredAt,
      },
    });

    return {
      id: row.id,
      mutationId: row.mutationId,
      idempotencyKey: row.idempotencyKey,
      domain: row.domain,
      action: row.action,
      userId: row.userId,
      resource: row.resource,
      conflictReason: row.conflictReason,
      payload: row.payload as unknown,
      occurredAt: row.occurredAt,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}
