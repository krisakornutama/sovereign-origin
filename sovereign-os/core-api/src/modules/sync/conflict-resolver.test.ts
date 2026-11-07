// ─────────────────────────────────────────────────────────────────────────────
// conflict-resolver.test.ts — Red-first test ของ Conflict Resolution (Sprint 2 · ระยะ 2)
// รัน: npx tsx --test src/modules/sync/conflict-resolver.test.ts
//
// กติกาที่ล็อกไว้ (ห้ามเปลี่ยนโดยไม่มีเทสต์รองรับ):
//   Case 1  Telemetry เป็น append-only → replay ตามลำดับได้ APPLIED ทั้งคู่
//   Case 2  idempotencyKey ซ้ำ → SKIPPED และต้องไม่เขียนข้อมูลซ้ำ
//   Case 3  สต็อกพอและไม่มีใครแทรก → ตัดจริง APPLIED
//   Case 4  สต็อกหมดระหว่างออฟไลน์ → PENDING_REVIEW (ห้าม Last-Write-Wins) + conflictReason
//   Case 5  2 คิว timestamp เดียวกัน → รายการแรก APPLIED รายการที่สอง PENDING_REVIEW
//   Case 6  ทุก PENDING_REVIEW ต้องมี record ใน SyncConflictLog (และ replay ซ้ำต้องไม่เพิ่ม log)
// ─────────────────────────────────────────────────────────────────────────────
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConflictResolver,
  type ClaimResult,
  type ConflictResolverStore,
  type DeltaInput,
  type DeltaResult,
  type OfflineMutation,
  type SyncConflictLogInput,
  type SyncConflictLogRecord,
  type SyncResolution,
  type TelemetryAppendInput,
} from './conflict-resolver';

// ── in-memory store: จำลอง DB จริงโดยไม่ต้องมี Postgres ───────────────────────
// สัญญาที่สำคัญ: applyDelta ต้องเป็น atomic guard ฝั่ง store (production = updateMany
// ที่มีเงื่อนไข quantity >= amount) ไม่ใช่ read-then-write ใน resolver
class MemoryStore implements ConflictResolverStore {
  telemetry: TelemetryAppendInput[] = [];
  conflictLogs: SyncConflictLogRecord[] = [];
  private balances = new Map<string, number>();
  private claims = new Map<string, SyncResolution | null>();
  private seq = 0;

  private balanceKey(domain: string, userId: string, resourceId: string): string {
    return `${domain}:${userId}:${resourceId}`;
  }

  seedBalance(domain: string, userId: string, resourceId: string, quantity: number): void {
    this.balances.set(this.balanceKey(domain, userId, resourceId), quantity);
  }

  balance(domain: string, userId: string, resourceId: string): number {
    return this.balances.get(this.balanceKey(domain, userId, resourceId)) ?? 0;
  }

  async appendTelemetry(input: TelemetryAppendInput): Promise<unknown> {
    this.telemetry.push({ ...input });
    return input;
  }

  async tryClaim(scope: string, key: string): Promise<ClaimResult> {
    const claimKey = `${scope}|${key}`;
    if (this.claims.has(claimKey)) {
      return { claimed: false, previous: this.claims.get(claimKey) ?? null };
    }
    this.claims.set(claimKey, null); // in_flight
    return { claimed: true };
  }

  async complete(scope: string, key: string, result: SyncResolution): Promise<void> {
    this.claims.set(`${scope}|${key}`, { ...result });
  }

  async release(scope: string, key: string): Promise<void> {
    this.claims.delete(`${scope}|${key}`);
  }

  async applyDelta(input: DeltaInput): Promise<DeltaResult> {
    const key = this.balanceKey(input.domain, input.userId, input.resourceId);
    const current = this.balances.get(key) ?? 0;
    const next = current + input.delta;
    // atomic guard: ยอดติดลบไม่ได้ — ไม่มีการเขียนทับแบบ Last-Write-Wins
    if (input.delta < 0 && next < 0) {
      return { applied: false, quantity: current };
    }
    this.balances.set(key, next);
    return { applied: true, quantity: next };
  }

  async writeConflictLog(input: SyncConflictLogInput): Promise<SyncConflictLogRecord> {
    // upsert by mutationId — retry ต้องไม่สร้าง log ซ้ำ (ตารางจริงมี unique(mutation_id))
    const existing = this.conflictLogs.find((log) => log.mutationId === input.mutationId);
    if (existing) return existing;
    const record: SyncConflictLogRecord = {
      ...input,
      id: `cl-${++this.seq}`,
      status: 'PENDING_REVIEW',
      createdAt: new Date('2026-11-07T10:10:00.000Z'),
    };
    this.conflictLogs.push(record);
    return record;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
let mutationSeq = 0;

function telemetryMutation(overrides: Partial<OfflineMutation> = {}): OfflineMutation {
  const n = ++mutationSeq;
  return {
    id: `m-telemetry-${n}`,
    domain: 'telemetry',
    action: 'ingest',
    idempotencyKey: `idem-telemetry-${n}`,
    occurredAt: '2026-11-07T10:00:00.000Z',
    userId: 'user-1',
    payload: {
      nodeId: '11111111-1111-1111-1111-111111111111',
      deviceId: 'sensor-battery-1',
      metric: 'battery_soc',
      value: 88.5,
    },
    ...overrides,
  };
}

function inventoryMutation(overrides: Partial<OfflineMutation> = {}): OfflineMutation {
  const n = ++mutationSeq;
  return {
    id: `m-inventory-${n}`,
    domain: 'inventory',
    action: 'adjust',
    idempotencyKey: `idem-inventory-${n}`,
    occurredAt: '2026-11-07T10:00:00.000Z',
    userId: 'user-1',
    payload: { resourceId: 'item-water', delta: -1 },
    ...overrides,
  };
}

function makeResolver(store: MemoryStore): ConflictResolver {
  return new ConflictResolver({
    store,
    now: () => new Date('2026-11-07T10:10:00.000Z'),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// กลุ่มที่ 1: Append-Only & Telemetry — ห้าม reject เพราะแก้ไขย้อนหลังไม่ได้
// ─────────────────────────────────────────────────────────────────────────────

test('Case 1: telemetry ออฟไลน์ 2 ชุดตามลำดับ → APPLIED ทั้งคู่ และเรียงตาม occurredAt', async () => {
  const store = new MemoryStore();
  const resolver = makeResolver(store);

  const first = telemetryMutation({
    id: 'm-telemetry-first',
    idempotencyKey: 'idem-telemetry-first',
    occurredAt: '2026-11-07T09:58:00.000Z',
    payload: {
      nodeId: '11111111-1111-1111-1111-111111111111',
      deviceId: 'sensor-battery-1',
      metric: 'battery_soc',
      value: 81,
    },
  });
  const second = telemetryMutation({
    id: 'm-telemetry-second',
    idempotencyKey: 'idem-telemetry-second',
    occurredAt: '2026-11-07T09:59:00.000Z',
    payload: {
      nodeId: '11111111-1111-1111-1111-111111111111',
      deviceId: 'sensor-battery-1',
      metric: 'battery_soc',
      value: 82,
    },
  });

  // ส่งกลับลำดับ (second มาก่อน) — resolver ต้องเรียงตาม occurredAt ให้
  const results = await resolver.resolveBatch([second, first]);

  assert.deepEqual(
    results.map((r) => r.status),
    ['APPLIED', 'APPLIED'],
    'telemetry เป็น append-only → ต้องบันทึกได้ทั้งคู่'
  );
  assert.deepEqual(
    results.map((r) => r.mutationId),
    ['m-telemetry-first', 'm-telemetry-second'],
    'ต้อง replay ตามเวลาที่เกิดเหตุ'
  );
  assert.equal(store.telemetry.length, 2);
  assert.deepEqual(
    store.telemetry.map((t) => t.value),
    [81, 82]
  );
  assert.equal(store.conflictLogs.length, 0, 'telemetry ปกติต้องไม่สร้าง conflict log');
});

test('Case 2: replay queue เดิมด้วย idempotencyKey เดียวกัน → SKIPPED และไม่บันทึกซ้ำ', async () => {
  const store = new MemoryStore();
  const resolver = makeResolver(store);

  const original = telemetryMutation({
    id: 'm-telemetry-original',
    idempotencyKey: 'idem-telemetry-duplicate',
  });

  const first = await resolver.resolve(original);
  assert.equal(first.status, 'APPLIED');
  assert.equal(store.telemetry.length, 1);

  // retry จากคิว: คนละ mutation id แต่คีย์เดิม = งานเดียวกัน
  const replay = await resolver.resolve({ ...original, id: 'm-telemetry-retry' });
  assert.equal(replay.status, 'SKIPPED');
  assert.equal(replay.duplicateOf, 'APPLIED');
  assert.equal(replay.mutationId, 'm-telemetry-retry');
  assert.equal(store.telemetry.length, 1, 'ห้ามเขียน telemetry ซ้ำ');
  assert.equal(store.conflictLogs.length, 0, 'งานซ้ำไม่ใช่ conflict');
});

// ─────────────────────────────────────────────────────────────────────────────
// กลุ่มที่ 2: Master Data / Stock / Finance — Business Rule Guard
// ─────────────────────────────────────────────────────────────────────────────

test('Case 3: สต็อกพอและไม่มีใครแทรก → ตัดสต็อกจริงและคืน APPLIED', async () => {
  const store = new MemoryStore();
  const resolver = makeResolver(store);
  store.seedBalance('inventory', 'user-1', 'item-water', 10);

  const result = await resolver.resolve(
    inventoryMutation({
      id: 'm-stock-ok',
      idempotencyKey: 'idem-stock-ok',
      payload: { resourceId: 'item-water', delta: -3 },
    })
  );

  assert.equal(result.status, 'APPLIED');
  assert.equal(store.balance('inventory', 'user-1', 'item-water'), 7);
  assert.equal(store.conflictLogs.length, 0);
  assert.deepEqual(
    (result.data as { quantity?: number } | undefined)?.quantity,
    7,
    'ผลลัพธ์ต้องบอกยอดคงเหลือจริงหลังทำรายการ'
  );
});

test('Case 4: สต็อกหมดระหว่างออฟไลน์ → PENDING_REVIEW + conflictReason (ห้าม Last-Write-Wins)', async () => {
  const store = new MemoryStore();
  const resolver = makeResolver(store);
  store.seedBalance('inventory', 'user-1', 'item-water', 10);

  // เครื่อง B ออนไลน์ตัดจนหมดก่อน (เกิดทีหลังแต่มาถึงก่อน)
  const onlineB = inventoryMutation({
    id: 'm-online-b',
    idempotencyKey: 'idem-online-b',
    occurredAt: '2026-11-07T10:05:00.000Z',
    payload: { resourceId: 'item-water', delta: -10 },
  });
  assert.equal((await resolver.resolve(onlineB)).status, 'APPLIED');
  assert.equal(store.balance('inventory', 'user-1', 'item-water'), 0);

  // เครื่อง A ฝากคิวไว้ตั้งแต่ 10:00 (timestamp เก่ากว่า) แล้วเพิ่งได้ replay
  const offlineA = inventoryMutation({
    id: 'm-offline-a',
    idempotencyKey: 'idem-offline-a',
    occurredAt: '2026-11-07T10:00:00.000Z',
    payload: { resourceId: 'item-water', delta: -6 },
  });
  const result = await resolver.resolve(offlineA);

  assert.equal(result.status, 'PENDING_REVIEW', 'ห้ามใช้ timestamp เก่ากว่าเพื่อเขียนทับ');
  assert.match(
    String(result.conflictReason),
    /INSUFFICIENT_STOCK/,
    'ต้องมี conflictReason ให้ UI/ผู้ดูแลเห็น'
  );
  assert.equal(
    store.balance('inventory', 'user-1', 'item-water'),
    0,
    'สต็อกต้องไม่ติดลบและไม่ถูกเขียนทับ'
  );
  assert.equal(store.conflictLogs.length, 1);
  assert.equal(store.conflictLogs[0].mutationId, 'm-offline-a');
  assert.equal(store.conflictLogs[0].resource, 'item-water');
});

test('Case 5: 2 คิว timestamp เดียวกัน ชิงทรัพยากรเดียวกัน → แรก APPLIED ที่สอง PENDING_REVIEW', async () => {
  const store = new MemoryStore();
  const resolver = makeResolver(store);
  store.seedBalance('inventory', 'user-1', 'item-water', 5);

  const sameTime = '2026-11-07T10:00:00.000Z';
  const queueA: OfflineMutation = inventoryMutation({
    id: 'm-queue-a',
    idempotencyKey: 'idem-queue-a',
    occurredAt: sameTime,
    payload: { resourceId: 'item-water', delta: -4 },
  });
  const queueB: OfflineMutation = inventoryMutation({
    id: 'm-queue-b',
    idempotencyKey: 'idem-queue-b',
    occurredAt: sameTime,
    payload: { resourceId: 'item-water', delta: -4 },
  });

  // ส่ง B มาก่อนใน array — tie-break ต้อง deterministic (id น้อยก่อน) ไม่ใช่ตามลำดับสุ่มของ network
  const results = await resolver.resolveBatch([queueB, queueA]);

  assert.deepEqual(
    results.map((r) => r.mutationId),
    ['m-queue-a', 'm-queue-b']
  );
  assert.equal(results[0].status, 'APPLIED');
  assert.equal(results[1].status, 'PENDING_REVIEW');
  assert.match(String(results[1].conflictReason), /INSUFFICIENT_STOCK/);
  assert.equal(store.balance('inventory', 'user-1', 'item-water'), 1, 'เหลือ 1 หลังรายการแรก');
  assert.equal(store.conflictLogs.length, 1);
  assert.equal(store.conflictLogs[0].mutationId, 'm-queue-b');
});

// ─────────────────────────────────────────────────────────────────────────────
// กลุ่มที่ 3: Audit & Observability
// ─────────────────────────────────────────────────────────────────────────────

test('Case 6: ทุก PENDING_REVIEW มี record ใน SyncConflictLog และ replay ซ้ำไม่เพิ่ม log', async () => {
  const store = new MemoryStore();
  const resolver = makeResolver(store);
  store.seedBalance('inventory', 'user-1', 'item-water', 5);

  const batch: OfflineMutation[] = [
    inventoryMutation({
      id: 'm-conflict-1',
      idempotencyKey: 'idem-conflict-1',
      occurredAt: '2026-11-07T10:00:00.000Z',
      payload: { resourceId: 'item-water', delta: -6 }, // เกินยอด → conflict
    }),
    inventoryMutation({
      id: 'm-apply-1',
      idempotencyKey: 'idem-apply-1',
      occurredAt: '2026-11-07T10:01:00.000Z',
      payload: { resourceId: 'item-water', delta: -2 }, // พอ → apply (เหลือ 3)
    }),
    inventoryMutation({
      id: 'm-conflict-2',
      idempotencyKey: 'idem-conflict-2',
      occurredAt: '2026-11-07T10:02:00.000Z',
      payload: { resourceId: 'item-water', delta: -6 }, // เกินยอดอีก → conflict
    }),
  ];

  const results = await resolver.resolveBatch(batch);
  const pending = results.filter((r) => r.status === 'PENDING_REVIEW');

  assert.equal(pending.length, 2);
  assert.equal(
    store.conflictLogs.length,
    pending.length,
    'ทุก PENDING_REVIEW ต้องมี record ไว้รอผู้ดูแลตรวจ'
  );
  assert.deepEqual(
    new Set(store.conflictLogs.map((log) => log.mutationId)),
    new Set(['m-conflict-1', 'm-conflict-2'])
  );
  for (const log of store.conflictLogs) {
    assert.equal(log.status, 'PENDING_REVIEW');
    assert.equal(log.domain, 'inventory');
    assert.equal(log.resource, 'item-water');
    assert.match(log.conflictReason, /INSUFFICIENT_STOCK/);
    assert.ok(log.occurredAt instanceof Date);
    assert.equal(log.payload && typeof log.payload, 'object');
  }
  assert.equal(store.balance('inventory', 'user-1', 'item-water'), 3);

  // replay ทั้งชุดอีกครั้ง (เช่น client ไม่ได้รับ response) → SKIPPED ทั้งหมด ไม่มี log เพิ่ม
  const replay = await resolver.resolveBatch(batch);
  assert.deepEqual(
    replay.map((r) => r.status),
    ['SKIPPED', 'SKIPPED', 'SKIPPED']
  );
  assert.equal(store.conflictLogs.length, 2, 'retry ต้องไม่สร้าง conflict log ซ้ำ');
  assert.equal(store.balance('inventory', 'user-1', 'item-water'), 3, 'retry ต้องไม่ตัดสต็อกซ้ำ');
});
