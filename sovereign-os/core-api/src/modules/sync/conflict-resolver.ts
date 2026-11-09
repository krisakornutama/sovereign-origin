// ─────────────────────────────────────────────────────────────────────────────
// conflict-resolver.ts — กติกาการรวมข้อมูลเมื่อ client กลับมาออนไลน์ (Sprint 2 · ระยะ 2)
//
// ปัญหาที่แก้: offline queue เดิม replay เข้า DB ตรง ๆ ⇒ Last-Write-Wins
//   (คิวเก่าที่ถือยอดคงเหลือเก่าทับข้อมูลที่เครื่องอื่นเพิ่งเขียน) ซึ่งทำให้สต็อก/
//   ยอดเงินเพี้ยนแบบย้อนกลับไม่ได้
//
// กติกากลางของทุกโดเมน:
//   1) Telemetry = append-only → replay ได้เสมอ ไม่มี conflict (ห้าม reject)
//   2) Inventory / Finance = delta + business guard → ใช้ "ส่วนต่าง" ไม่ใช่ยอดสัมบูรณ์
//      และให้ store ทำ atomic guard (production = UPDATE ... WHERE quantity >= amount)
//      ถ้าไม่พอ → PENDING_REVIEW + บันทึก SyncConflictLog (ห้ามเขียนทับ/ติดลบ)
//   3) Idempotency: 1 idempotencyKey = 1 งาน → retry ได้ผล SKIPPED ไม่ทำงานซ้ำ
//   4) Batch replay เรียงตาม occurredAt แล้ว tie-break ด้วย mutation id
//      ⇒ 2 คิวเวลาเดียวกันได้ผลลัพธ์เดียวกันทุกเครื่อง (deterministic)
//
// ไฟล์นี้ไม่ import Prisma โดยเจตนา — เทสต์รันได้โดยไม่มี DB
// ส่วน production store อยู่ที่ conflict-resolver.prisma.ts
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';

// ── สถานะผลลัพธ์ ─────────────────────────────────────────────────────────────
export const SYNC_STATUS = {
  /** ทำรายการสำเร็จและบันทึกแล้ว */
  APPLIED: 'APPLIED',
  /** เคยทำแล้ว (idempotent retry) — ไม่บันทึกซ้ำ */
  SKIPPED: 'SKIPPED',
  /** ต้องให้มนุษย์ตรวจก่อน — ข้อมูลถูกเก็บไว้ใน SyncConflictLog */
  PENDING_REVIEW: 'PENDING_REVIEW',
} as const;

export type SyncStatus = (typeof SYNC_STATUS)[keyof typeof SYNC_STATUS];

export const SYNC_DOMAINS = ['telemetry', 'inventory', 'finance'] as const;
export type SyncDomain = (typeof SYNC_DOMAINS)[number];

// ── โครงข้อมูลจาก offline queue ──────────────────────────────────────────────
export interface OfflineMutation {
  /** id ของรายการในคิว (ใช้ tie-break และอ้างอิงใน conflict log) */
  id: string;
  domain: SyncDomain;
  /** การกระทำ เช่น ingest | adjust */
  action: string;
  /** คีย์กันทำซ้ำ — client สร้างต่อ 1 การกระทำ (idem-...) */
  idempotencyKey: string;
  /** เวลาที่เหตุการณ์เกิดฝั่ง client (ISO 8601) */
  occurredAt: string;
  userId: string;
  payload: Record<string, unknown>;
}

export interface SyncResolution {
  mutationId: string;
  idempotencyKey: string;
  status: SyncStatus;
  /** true เมื่อรายการนี้เคยถูกประมวลผลแล้ว (status = SKIPPED) */
  duplicateOf?: SyncStatus | null;
  /** เหตุผลที่ต้องตรวจ (มีเมื่อ status = PENDING_REVIEW) */
  conflictReason?: string;
  /** id ของ SyncConflictLog ที่สร้างให้รายการนี้ */
  conflictLogId?: string;
  data?: unknown;
}

// ── สัญญาของ store (production = Prisma, เทสต์ = in-memory) ──────────────────
export interface TelemetryAppendInput {
  mutationId: string;
  userId: string;
  nodeId: string;
  deviceId: string;
  metric: string;
  value: number;
  /** เวลาที่เซนเซอร์วัด (ใช้ occurredAt ของ mutation) */
  recordedAt: Date;
}

export interface DeltaInput {
  mutationId: string;
  domain: string;
  userId: string;
  resourceId: string;
  /** บวก = เติม, ลบ = ตัด */
  delta: number;
}

export interface DeltaResult {
  applied: boolean;
  /** ยอดคงเหลือหลังทำรายการ (ถ้า applied) หรือยอดปัจจุบัน (ถ้าไม่ผ่าน guard) */
  quantity: number;
  /** store ระบุเหตุผลเองได้ (เช่น RESOURCE_NOT_FOUND) */
  conflictReason?: string;
}

export interface SyncConflictLogInput {
  mutationId: string;
  idempotencyKey: string;
  domain: string;
  action: string;
  userId: string;
  /** ทรัพยากรที่ชนกัน เช่น inventory item id */
  resource: string;
  conflictReason: string;
  payload: unknown;
  occurredAt: Date;
}

export interface SyncConflictLogRecord extends SyncConflictLogInput {
  id: string;
  status: string;
  createdAt: Date;
}

export type ClaimResult =
  | { claimed: true }
  | { claimed: false; previous: SyncResolution | null };

/**
 * boundary เดียวที่ resolver ใช้แตะข้อมูล — ทำให้เทสต์จำลองพฤติกรรม DB ได้
 * และบังคับให้ atomic guard อยู่ฝั่ง store (ไม่ใช่ read-then-write ใน resolver)
 */
export interface ConflictResolverStore {
  appendTelemetry(input: TelemetryAppendInput): Promise<unknown>;
  applyDelta(input: DeltaInput): Promise<DeltaResult>;
  /** จอง idempotency key แบบ atomic — คืน claimed=false ถ้าเคยมีแล้ว */
  tryClaim(scope: string, key: string, fingerprint: string, userId?: string): Promise<ClaimResult>;
  /** เก็บผลลัพธ์ของงานที่ทำเสร็จแล้ว (ใช้ตอบ retry) */
  complete(scope: string, key: string, result: SyncResolution): Promise<void>;
  /** คืน claim ที่ยังไม่เสร็จ (เช่น store เขียนพลาด) เพื่อให้ retry ทำงานได้ */
  release(scope: string, key: string): Promise<void>;
  /** upsert by mutationId — retry ต้องไม่สร้าง log ซ้ำ */
  writeConflictLog(input: SyncConflictLogInput): Promise<SyncConflictLogRecord>;
}

// ── error ที่เกิดจาก caller ผิด (ไม่ใช่ conflict ของข้อมูล) ──────────────────
export class InvalidSyncMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSyncMutationError';
  }
}

// ── conflict reason codes ────────────────────────────────────────────────────
export const CONFLICT_REASONS = {
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  UNSUPPORTED_DOMAIN: 'UNSUPPORTED_DOMAIN',
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!isNonEmptyString(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ลำดับ replay ที่ deterministic: เวลาเกิดเหตุก่อน, เวลาเท่ากันใช้ id เป็นตัวตัดสิน */
export function compareMutations(a: OfflineMutation, b: OfflineMutation): number {
  const ta = Date.parse(a.occurredAt);
  const tb = Date.parse(b.occurredAt);
  const na = Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER;
  const nb = Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** scope ของ idempotency แยกตามโดเมน — คีย์เดียวกันคนละโดเมนต้องไม่ชนกัน */
export function idempotencyScope(domain: string): string {
  return `sync.${domain}`;
}

export function mutationFingerprint(mutation: OfflineMutation): string {
  return createHash('sha256').update(JSON.stringify(mutation)).digest('hex');
}

// ── resolver ─────────────────────────────────────────────────────────────────
export interface ConflictResolverOptions {
  store: ConflictResolverStore;
  /** เวลาปัจจุบัน (เทสต์กำหนดได้) — ใช้ประทับเวลา log ฝั่ง resolver */
  now?: () => Date;
}

export class ConflictResolver {
  private readonly store: ConflictResolverStore;
  private readonly now: () => Date;

  constructor(options: ConflictResolverOptions) {
    this.store = options.store;
    this.now = options.now || (() => new Date());
  }

  /**
   * Replay หลายรายการตามลำดับที่ deterministic
   * - เรียงตาม occurredAt (เวลา client) แล้ว tie-break ด้วย id
   * - ทำทีละรายการเพื่อให้ business guard เห็นยอดล่าสุดเสมอ
   */
  async resolveBatch(mutations: OfflineMutation[]): Promise<SyncResolution[]> {
    const ordered = [...mutations].sort(compareMutations);
    const results: SyncResolution[] = [];
    for (const mutation of ordered) {
      results.push(await this.resolve(mutation));
    }
    return results;
  }

  /** ประมวลผล 1 รายการจาก offline queue */
  async resolve(mutation: OfflineMutation): Promise<SyncResolution> {
    this.assertValidBase(mutation);
    const scope = idempotencyScope(mutation.domain);
    const claim = await this.store.tryClaim(
      scope,
      mutation.idempotencyKey,
      mutationFingerprint(mutation),
      mutation.userId
    );

    if (!claim.claimed) {
      // retry ของงานเดิม — ไม่ประมวลผลซ้ำและไม่สร้าง conflict log ซ้ำ
      const previous = claim.previous;
      return {
        mutationId: mutation.id,
        idempotencyKey: mutation.idempotencyKey,
        status: SYNC_STATUS.SKIPPED,
        duplicateOf: previous?.status ?? null,
        conflictReason: previous?.conflictReason,
        data: previous?.data,
      };
    }

    let result: SyncResolution;
    try {
      result = await this.process(mutation);
    } catch (err) {
      // งานยังไม่สำเร็จ → คืน claim เพื่อให้ retry รอบหน้าเริ่มใหม่ได้
      await this.store.release(scope, mutation.idempotencyKey).catch(() => undefined);
      throw err;
    }

    // เก็บผลไว้ตอบ retry — ถ้าขั้นนี้ล้ม ห้าม release claim (กันงานถูกทำซ้ำ)
    await this.store.complete(scope, mutation.idempotencyKey, result);
    return result;
  }

  // ── ประมวลผลตามโดเมน ──────────────────────────────────────────────────────
  private async process(mutation: OfflineMutation): Promise<SyncResolution> {
    switch (mutation.domain) {
      case 'telemetry':
        return this.applyTelemetry(mutation);
      case 'inventory':
      case 'finance':
        return this.applyGuardedDelta(mutation);
      default:
        return this.pendingReview(
          mutation,
          `${CONFLICT_REASONS.UNSUPPORTED_DOMAIN}: ไม่รู้จักโดเมน "${String(
            (mutation as { domain?: unknown }).domain
          )}"`,
          String((mutation as { domain?: unknown }).domain ?? 'unknown'),
          null
        );
    }
  }

  /** Telemetry = append-only: ตรวจรูปข้อมูลแล้วเขียนลง timeseries ได้เลย */
  private async applyTelemetry(mutation: OfflineMutation): Promise<SyncResolution> {
    const payload = mutation.payload || {};
    const nodeId = payload.nodeId;
    const deviceId = payload.deviceId;
    const metric = payload.metric;
    const value = payload.value;
    const recordedAt = parseDate(mutation.occurredAt);

    if (
      !isNonEmptyString(nodeId) ||
      !UUID_RE.test(nodeId.trim()) ||
      !isNonEmptyString(deviceId) ||
      !isNonEmptyString(metric) ||
      !isFiniteNumber(value) ||
      !recordedAt
    ) {
      return this.pendingReview(
        mutation,
        `${CONFLICT_REASONS.INVALID_PAYLOAD}: telemetry ต้องมี nodeId(uuid)/deviceId/metric/value และ occurredAt ที่ถูกต้อง`,
        isNonEmptyString(nodeId) ? nodeId.trim() : 'telemetry',
        recordedAt
      );
    }

    const data = {
      nodeId: nodeId.trim(),
      deviceId: deviceId.trim(),
      metric: metric.trim(),
      value,
      recordedAt: recordedAt.toISOString(),
    };

    await this.store.appendTelemetry({
      mutationId: mutation.id,
      userId: mutation.userId,
      nodeId: data.nodeId,
      deviceId: data.deviceId,
      metric: data.metric,
      value: data.value,
      recordedAt,
    });

    return {
      mutationId: mutation.id,
      idempotencyKey: mutation.idempotencyKey,
      status: SYNC_STATUS.APPLIED,
      data,
    };
  }

  /** Inventory/Finance = delta + guard: ไม่พอให้เข้าคิวรอตรวจ ไม่เขียนทับ */
  private async applyGuardedDelta(mutation: OfflineMutation): Promise<SyncResolution> {
    const payload = mutation.payload || {};
    const resourceId = payload.resourceId ?? payload.itemId ?? payload.accountId;
    const delta = payload.delta;
    const occurredAt = parseDate(mutation.occurredAt);

    if (
      !isNonEmptyString(resourceId) ||
      !isFiniteNumber(delta) ||
      delta === 0 ||
      !occurredAt
    ) {
      return this.pendingReview(
        mutation,
        `${CONFLICT_REASONS.INVALID_PAYLOAD}: ต้องมี resourceId, delta (ไม่ใช่ 0) และ occurredAt ที่ถูกต้อง`,
        isNonEmptyString(resourceId) ? resourceId.trim() : mutation.domain,
        occurredAt
      );
    }

    const outcome = await this.store.applyDelta({
      mutationId: mutation.id,
      domain: mutation.domain,
      userId: mutation.userId,
      resourceId: resourceId.trim(),
      delta,
    });

    if (!outcome.applied) {
      const code =
        outcome.conflictReason ||
        (mutation.domain === 'finance'
          ? CONFLICT_REASONS.INSUFFICIENT_BALANCE
          : CONFLICT_REASONS.INSUFFICIENT_STOCK);
      return this.pendingReview(
        mutation,
        `${code}: ต้องการปรับ ${delta} แต่คงเหลือ ${outcome.quantity} — ต้องให้ผู้ดูแลตรวจ`,
        resourceId.trim(),
        occurredAt,
        { resourceId: resourceId.trim(), delta, available: outcome.quantity }
      );
    }

    return {
      mutationId: mutation.id,
      idempotencyKey: mutation.idempotencyKey,
      status: SYNC_STATUS.APPLIED,
      data: { resourceId: resourceId.trim(), delta, quantity: outcome.quantity },
    };
  }

  // ── conflict path ──────────────────────────────────────────────────────────
  private async pendingReview(
    mutation: OfflineMutation,
    conflictReason: string,
    resource: string,
    occurredAt: Date | null,
    details?: unknown
  ): Promise<SyncResolution> {
    // บันทึกก่อนคืนผล — ถ้าเขียน log ล้ม ต้อง throw เพื่อให้ retry (audit ต้องไม่หาย)
    const log = await this.store.writeConflictLog({
      mutationId: mutation.id,
      idempotencyKey: mutation.idempotencyKey,
      domain: mutation.domain,
      action: mutation.action,
      userId: mutation.userId,
      resource,
      conflictReason,
      payload: mutation.payload,
      occurredAt: occurredAt || parseDate(mutation.occurredAt) || this.now(),
    });

    return {
      mutationId: mutation.id,
      idempotencyKey: mutation.idempotencyKey,
      status: SYNC_STATUS.PENDING_REVIEW,
      conflictReason,
      conflictLogId: log.id,
      data: details,
    };
  }

  // ── validation ─────────────────────────────────────────────────────────────
  private assertValidBase(mutation: OfflineMutation): void {
    if (!mutation || typeof mutation !== 'object') {
      throw new InvalidSyncMutationError('mutation ต้องเป็น object');
    }
    if (!isNonEmptyString(mutation.id)) {
      throw new InvalidSyncMutationError('mutation.id ว่างไม่ได้');
    }
    if (!isNonEmptyString(mutation.idempotencyKey)) {
      throw new InvalidSyncMutationError('mutation.idempotencyKey ว่างไม่ได้');
    }
    if (!isNonEmptyString(mutation.userId)) {
      throw new InvalidSyncMutationError('mutation.userId ว่างไม่ได้');
    }
    if (!isNonEmptyString(mutation.action)) {
      throw new InvalidSyncMutationError('mutation.action ว่างไม่ได้');
    }
  }
}
