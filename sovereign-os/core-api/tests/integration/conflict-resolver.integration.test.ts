// ── INTEGRATION TEST: ต้องมี Postgres จริง ──
// รัน:  RUN_INTEGRATION=1 DATABASE_URL=postgresql://... npm run test:integration
// ไม่ import tests/setup-env — ใช้ env จริงจาก process
//
// ครอบเฉพาะส่วนที่ in-memory store จำลองแทนไม่ได้:
//   1) atomic stock guard — UPDATE ... WHERE quantity >= amount ต้องกันสต็อกติดลบ
//      แม้สองคิว replay พร้อมกัน (race) ซึ่งเป็นเคสที่ read-then-write ฝั่ง resolver พลาด
//   2) claim TTL — claim ที่ค้างเกิน STALE_CLAIM_MS ต้องถูกยึดคืนได้ แต่ claim สดต้องกันงานซ้ำ
//   3) SyncConflictLog จริง — PENDING_REVIEW ต้องมีแถวใน DB (unique mutation_id) และ retry ไม่เพิ่มแถว
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { ConflictResolver, type OfflineMutation } from '../../src/modules/sync/conflict-resolver';
import {
  PrismaConflictResolverStore,
  STALE_CLAIM_MS,
} from '../../src/modules/sync/conflict-resolver.prisma';

const SKIP = process.env.RUN_INTEGRATION !== '1';
const prisma = new PrismaClient();
const SCOPE = 'sync.inventory';
const stamp = Date.now();
const username = `itest_sync_${stamp}`;
const keyPrefix = `itest-sync-${stamp}`;

let userId = '';
let resolver: ConflictResolver;
let store: PrismaConflictResolverStore;

function inventoryMutation(overrides: Partial<OfflineMutation> = {}): OfflineMutation {
  return {
    id: `${keyPrefix}-m-${Math.random().toString(36).slice(2, 10)}`,
    domain: 'inventory',
    action: 'adjust',
    idempotencyKey: `${keyPrefix}-k-${Math.random().toString(36).slice(2, 10)}`,
    occurredAt: '2026-11-07T10:00:00.000Z',
    userId,
    payload: { resourceId: '', delta: -1 },
    ...overrides,
  };
}

async function createItem(quantity: number): Promise<string> {
  const item = await prisma.inventoryItem.create({
    data: {
      user_id: userId,
      name: `itest item ${Math.random().toString(36).slice(2, 8)}`,
      category: 'WATER',
      quantity,
      unit: 'piece',
      unit_price_usd: 1,
    },
  });
  return item.id;
}

async function quantityOf(itemId: string): Promise<number> {
  const row = await prisma.inventoryItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { quantity: true },
  });
  return Number(row.quantity);
}

async function idempotencyRow(key: string) {
  return prisma.idempotencyKey.findUnique({ where: { scope_key: { scope: SCOPE, key } } });
}

before(async () => {
  if (SKIP) return;
  const user = await prisma.user.create({
    data: { username, password_hash: 'integration-test-only', role: 'OPERATOR' },
  });
  userId = user.id;
  store = new PrismaConflictResolverStore();
  resolver = new ConflictResolver({ store });
});

after(async () => {
  if (SKIP) return;
  try {
    await prisma.syncConflictLog.deleteMany({ where: { userId } });
    await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: keyPrefix } } });
    await prisma.inventoryItem.deleteMany({ where: { user_id: userId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
  } finally {
    await prisma.$disconnect();
  }
});

test('atomic guard: ตัดเกินยอดคงเหลือ → PENDING_REVIEW, สต็อกไม่ติดลบ, มีแถวใน sync_conflict_logs', { skip: SKIP ? 'set RUN_INTEGRATION=1 to enable' : false }, async () => {
  const itemId = await createItem(5);
  const mutation = inventoryMutation({ payload: { resourceId: itemId, delta: -6 } });

  const result = await resolver.resolve(mutation);

  assert.equal(result.status, 'PENDING_REVIEW');
  assert.match(String(result.conflictReason), /INSUFFICIENT_STOCK/);
  assert.equal(await quantityOf(itemId), 5, 'สต็อกต้องคงเดิม ไม่ถูกเขียนทับ/ติดลบ');

  const log = await prisma.syncConflictLog.findUnique({ where: { mutationId: mutation.id } });
  assert.ok(log, 'ต้องมี record ใน SyncConflictLog');
  assert.equal(log.status, 'PENDING_REVIEW');
  assert.equal(log.resource, itemId);
  assert.match(log.conflictReason, /INSUFFICIENT_STOCK/);
  assert.equal(log.domain, 'inventory');

  const claim = await idempotencyRow(mutation.idempotencyKey);
  assert.equal(claim?.status, 'done', 'ต้องเก็บผลไว้ตอบ retry');
  assert.equal((claim?.responseBody as { status?: string } | null)?.status, 'PENDING_REVIEW');
});

test('atomic guard: 2 คิว replay พร้อมกันชิงสต็อก 5 → สำเร็จรายเดียว ที่เหลือ PENDING_REVIEW และเหลือ 1', { skip: SKIP ? 'set RUN_INTEGRATION=1 to enable' : false }, async () => {
  const itemId = await createItem(5);
  const a = inventoryMutation({ payload: { resourceId: itemId, delta: -4 } });
  const b = inventoryMutation({ payload: { resourceId: itemId, delta: -4 } });

  const results = await Promise.all([resolver.resolve(a), resolver.resolve(b)]);
  const statuses = results.map((r) => r.status).sort();

  assert.deepEqual(statuses, ['APPLIED', 'PENDING_REVIEW'], 'ต้องมี APPLIED รายเดียวเท่านั้น');
  assert.equal(await quantityOf(itemId), 1, 'ตัดได้แค่ครั้งเดียว สต็อกต้องไม่ติดลบ');

  const logs = await prisma.syncConflictLog.findMany({
    where: { mutationId: { in: [a.id, b.id] } },
    select: { mutationId: true },
  });
  assert.equal(logs.length, 1, 'คิวที่แพ้ race ต้องได้ conflict log 1 แถว');
});

test('claim TTL: claim สดกันงานซ้ำ (SKIPPED) แต่ claim ค้างเกิน TTL ถูกยึดคืนและทำงานได้', { skip: SKIP ? 'set RUN_INTEGRATION=1 to enable' : false }, async () => {
  const itemId = await createItem(10);

  // claim สด (in_flight, เพิ่งสร้าง) = มี process อื่นกำลังทำ → ต้องไม่ทำซ้ำ
  const freshKey = `${keyPrefix}-fresh`;
  await prisma.idempotencyKey.create({
    data: {
      scope: SCOPE,
      key: freshKey,
      fingerprint: 'itest',
      status: 'in_flight',
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const fresh = await resolver.resolve(
    inventoryMutation({ idempotencyKey: freshKey, payload: { resourceId: itemId, delta: -2 } })
  );
  assert.equal(fresh.status, 'SKIPPED');
  assert.equal(fresh.duplicateOf, null, 'งานที่ยังไม่เสร็จไม่มีผลให้ตอบ');
  assert.equal(await quantityOf(itemId), 10, 'claim สดต้องกันการตัดสต็อกซ้ำ');

  // claim ค้าง (process ตายไปแล้ว) = ต้องยึดคืนได้หลัง STALE_CLAIM_MS
  const staleKey = `${keyPrefix}-stale`;
  await prisma.idempotencyKey.create({
    data: {
      scope: SCOPE,
      key: staleKey,
      fingerprint: 'itest',
      status: 'in_flight',
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(Date.now() - STALE_CLAIM_MS - 60_000),
    },
  });
  const stale = await resolver.resolve(
    inventoryMutation({ idempotencyKey: staleKey, payload: { resourceId: itemId, delta: -3 } })
  );
  assert.equal(stale.status, 'APPLIED', 'claim ที่ค้างเกิน TTL ต้องถูกยึดคืน');
  assert.equal(await quantityOf(itemId), 7);
  assert.equal((await idempotencyRow(staleKey))?.status, 'done');
});
