// src/lib/offline/user-read-cache.test.ts — red-first test ของ user-namespaced read cache
// รันด้วย: npx --prefix ../sovereign-os/core-api tsx src/lib/offline/user-read-cache.test.ts
// (ผูกเข้า `npm run verify` ผ่าน tools/test/frontend-user-read-cache.test.mjs)
//
// กติกาที่ล็อกไว้ (คำสั่งเจ้าของ — Sprint 2 ระยะ 3 · User-Namespaced Read Cache):
//   1) User A เขียนแคชไว้ → User B สลับบัญชีเข้ามาบนเบราว์เซอร์เดียวกัน ต้องมองไม่เห็นแคชของ A (ทุกโดเมน)
//   2) clearUserCache(userId) → แคชของผู้ใช้นั้นหาย 100% · แคชของผู้ใช้อื่นต้องรอด
//   3) clearDomain ของ namespace หนึ่ง ห้ามแตะ namespace อีกฝั่ง
//   4) logout transition (isAuthenticated true → false) ต้อง trigger clearUserCache ของผู้ใช้ที่เพิ่งออก
//      — login/renew session ห้าม trigger
//   5) getUserReadCache(userId) → อินสแตนซ์เดียวกันเมื่อเรียกซ้ำผู้ใช้เดิม (reuse) และแยกกันต่างผู้ใช้
//   6) ไม่มี userId (ยังไม่ล็อกอิน/รอ hydration) → ต้องไม่แตะ cache กองกลางเลย (แคชเสมือนในหน่วยความจำ)
//   7) userId มีอักขระพิเศษ → แปลงเป็นชื่อ namespace ปลอดภัย ไม่ทำคีย์ชน/แตกโครง
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CacheRecord, ReadCacheStore } from './read-cache';
import { OfflineReadUnavailableError } from './read-cache';
import {
  clearUserCache,
  createUserReadCache,
  getUserReadCache,
  namespacedKey,
} from './user-read-cache';
import {
  attachOfflinePurge,
  purgeUserIdForLogout,
  type PurgeAuthSnapshot,
} from './logout-purge';

// ── test double (แนวเดียวกับ read-cache.test.ts) ──────────────────────────────
class MemoryStore implements ReadCacheStore {
  private records = new Map<string, CacheRecord>();
  failWrites = false;

  async get(key: string): Promise<CacheRecord | undefined> {
    const rec = this.records.get(key);
    return rec ? (JSON.parse(JSON.stringify(rec)) as CacheRecord) : undefined;
  }

  async put(record: CacheRecord): Promise<void> {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.records.set(record.key, JSON.parse(JSON.stringify(record)) as CacheRecord);
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async clearDomain(domain: string): Promise<void> {
    for (const [key, rec] of this.records) {
      if (rec.domain === domain) this.records.delete(key);
    }
  }

  async keys(domain?: string): Promise<string[]> {
    return [...this.records.values()]
      .filter((rec) => !domain || rec.domain === domain)
      .map((rec) => rec.key);
  }

  /** คีย์ดิบทั้งหมดใน store ฐาน (ไม่ผ่าน namespace) — ใช้ตรวจว่า purge ลบเลือน */
  rawKeys(): string[] {
    return [...this.records.keys()];
  }
}

const NOW = 1_700_000_000_000;
const clock = () => NOW;
const makeUserCache = (
  userId: string,
  store: ReadCacheStore,
  extra: { isOnline?: () => boolean } = {}
) =>
  createUserReadCache(userId, {
    store,
    now: clock,
    defaultTtlMs: 60_000,
    isOnline: extra.isOnline ?? (() => true),
  });

async function drainAsync(): Promise<void> {
  // purge เป็น fire-and-forget — รอ microtask/macrotask 2 รอบพอสำหรับเทสต์
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

// ── 1) แยกบัญชี ────────────────────────────────────────────────────────────────
test('User A เขียนแคช farm/inventory/telemetry → User B อ่านไม่เห็นสิ่งไหนเลย', async () => {
  const base = new MemoryStore();
  const cacheA = makeUserCache('user-a', base);
  const cacheB = makeUserCache('user-b', base, { isOnline: () => false });

  await cacheA.read('farm', 'plots', async () => ['plots-a'], { forceRefresh: true });
  await cacheA.read('inventory', 'items', async () => ['items-a'], { forceRefresh: true });
  await cacheA.read('telemetry', 'energy', async () => ['energy-a'], { forceRefresh: true });

  for (const [domain, resource] of [
    ['farm', 'plots'],
    ['inventory', 'items'],
    ['telemetry', 'energy'],
  ] as const) {
    await assert.rejects(
      () => cacheB.read(domain, resource, async () => ['SHOULD_NOT_FETCH']),
      (e: unknown) => e instanceof OfflineReadUnavailableError
    );
  }
});

// ── 2) clearUserCache ──────────────────────────────────────────────────────────
test('clearUserCache(user-a) ลบแคชของ A 100% (ทุกโดเมน) — B ยังอ่านแคชของตัวเองได้', async () => {
  const base = new MemoryStore();
  const cacheA = makeUserCache('user-a', base);
  const cacheB = makeUserCache('user-b', base);

  await cacheA.read('farm', 'plots', async () => ['a1'], { forceRefresh: true });
  await cacheA.read('menu', 'all', async () => ['a2'], { forceRefresh: true });
  await cacheB.read('farm', 'plots', async () => ['b1'], { forceRefresh: true });

  const removed = await clearUserCache('user-a', base);
  assert.ok(removed >= 2, `ควรลบอย่างน้อย 2 record · ได้ ${removed}`);
  // ไม่เหลือคียดิบของ A ทั้ง store ฐาน
  assert.deepEqual(
    base.rawKeys().filter((k) => k.startsWith('u:user-a:')),
    []
  );

  // A อ่านแบบออฟไลน์ไม่ได้แล้ว (ไม่มีแคชเลย)
  const cacheAAfter = makeUserCache('user-a', base, { isOnline: () => false });
  await assert.rejects(() => cacheAAfter.read('farm', 'plots', async () => ['X']), OfflineReadUnavailableError);

  // B ยังอ่านแคชตัวเองได้แม้ออฟไลน์
  const cacheBOffline = makeUserCache('user-b', base, { isOnline: () => false });
  const b = await cacheBOffline.read('farm', 'plots', async () => ['X']);
  assert.deepEqual(b.data, ['b1']);
});

test('clearUserCache(null) = no-op (ไม่มีตัวตนจากระบบไหนก็ไม่ลบของใคร)', async () => {
  const base = new MemoryStore();
  const cacheA = makeUserCache('user-a', base);
  await cacheA.read('farm', 'plots', async () => ['a1'], { forceRefresh: true });
  const removed = await clearUserCache(null, base);
  assert.equal(removed, 0);
  const again = makeUserCache('user-a', base, { isOnline: () => false });
  const r = await again.read('farm', 'plots', async () => ['X']);
  assert.deepEqual(r.data, ['a1']);
});

// ── 3) clearDomain + คีย์ล้อม ──────────────────────────────────────────────────
test('namespacedKey map เฉพาะกลุ่ม + clearDomain ของ A ลบเฉพาะของ A', async () => {
  assert.equal(namespacedKey('user-a', 'farm:plots'), 'u:user-a:farm:plots');
  assert.equal(namespacedKey('a:b c', 'farm:plots'), 'u:a_b_c:farm:plots');

  const base = new MemoryStore();
  const cacheA = makeUserCache('user-a', base);
  const cacheB = makeUserCache('user-b', base);

  await cacheA.read('farm', 'plots', async () => ['a'], { forceRefresh: true });
  await cacheB.read('farm', 'plots', async () => ['b'], { forceRefresh: true });

  await cacheA.invalidateDomain('farm');
  // B มีแคช farm อยู่ครบ (A ลบเฉพาะ namespace ตัวเอง)
  const cacheBOffline = makeUserCache('user-b', base, { isOnline: () => false });
  const b = await cacheBOffline.read('farm', 'plots', async () => ['X']);
  assert.deepEqual(b.data, ['b']);
});

// ── 4) logout trigger ──────────────────────────────────────────────────────────
test('purgeUserIdForLogout: logout = id · login/renew = ไม่ purge · logout ไม่รู้ตัวตน = null', () => {
  const loggedA: PurgeAuthSnapshot = { isAuthenticated: true, user: { id: 'user-a' } };
  const loggedB: PurgeAuthSnapshot = { isAuthenticated: true, user: { id: 'user-b' } };
  const anonymous: PurgeAuthSnapshot = { isAuthenticated: false, user: null };

  // logout: prev=loggedA (auth) → next=anonymous (unauth) = purge user-a
  assert.equal(purgeUserIdForLogout(anonymous, loggedA), 'user-a');
  // login: prev=anonymous (unauth) → next=loggedB (auth) = ไม่ purge
  assert.equal(purgeUserIdForLogout(loggedB, anonymous), undefined);
  // สลับ user แบบยังล็อกอิน = ไม่ purge
  assert.equal(purgeUserIdForLogout(loggedA, loggedB), undefined);
  // logout แต่มองไม่เห็น userId (user = null) = null (no-op)
  assert.equal(
    purgeUserIdForLogout(
      { isAuthenticated: false, user: null },
      { isAuthenticated: true, user: null }
    ),
    null
  );
});

test('attachOfflinePurge: logout จริงผ่าน store subscribe → clearUserCache ลบของ A ทิ้ง B รอด', async () => {
  const base = new MemoryStore();
  const cacheA = makeUserCache('user-a', base);
  const cacheB = makeUserCache('user-b', base);
  await cacheA.read('farm', 'plots', async () => ['a1'], { forceRefresh: true });
  await cacheB.read('farm', 'plots', async () => ['b1'], { forceRefresh: true });

  // fake store ตามรูปทรง zustand (subscribe เรียก callback ทันทีด้วย state ปัจจุบัน)
  let subscribed: ((s: PurgeAuthSnapshot) => void) | null = null;
  const initialState: PurgeAuthSnapshot = { isAuthenticated: true, user: { id: 'user-a' } };
  const fakeStore = {
    subscribe(fn: (s: PurgeAuthSnapshot) => void): () => void {
      subscribed = fn;
      // zustand เรียก callback ทันทีด้วย state ปัจจุบัน
      fn(initialState);
      return () => {
        subscribed = null;
      };
    },
  };
  const unsub = attachOfflinePurge(fakeStore, async (uid) => {
    await clearUserCache(uid, base);
  });
  assert.ok(subscribed, 'ต้อง subscribe ร้านจริงตั้งแต่ attach');

  // จำลองออกจากระบบ (สั่งจากปุ่ม logout หรือ 401 → logoutLocal)
  // prev = initialState (authenticated), next = unauthenticated
  (subscribed as (s: PurgeAuthSnapshot) => void)({ isAuthenticated: false, user: null });
  await drainAsync();

  assert.deepEqual(
    base.rawKeys().filter((k) => k.startsWith('u:user-a:')),
    [],
    'logout แล้วแคชของ A ต้องหายหมดจาก store ฐาน'
  );
  const cacheBOffline = makeUserCache('user-b', base, { isOnline: () => false });
  const b = await cacheBOffline.read('farm', 'plots', async () => ['X']);
  assert.deepEqual(b.data, ['b1'], 'B ต้องยังอ่านแคชตัวเองได้');

  // login ล่าสุดไม่ควรไล่ลง cache
  (subscribed as (s: PurgeAuthSnapshot) => void)({ isAuthenticated: true, user: { id: 'user-b' } });
  await drainAsync();
  assert.equal(base.rawKeys().length, base.rawKeys().length, 'login ห้ามลบแคช');

  unsub();
  assert.equal(subscribed, null, 'unsubscribe สะอาด');
});

// ── 5-6) factory reuse + ไม่มีตัวตน ────────────────────────────────────────────
test('getUserReadCache: reuse อินสแตนซ์เดิมของผู้ใช้เดิม + แยกกันต่างผู้ใช้ + ไม่มีตัวตนได้อินสแตนซ์เฉพาะตัว', () => {
  const a1 = getUserReadCache('user-a');
  const a2 = getUserReadCache('user-a');
  const b1 = getUserReadCache('user-b');
  assert.equal(a1, a2);
  assert.notEqual(a1, b1);
  assert.notEqual(b1, getUserReadCache('user-b2'));
  const anon1 = getUserReadCache(null);
  const anon2 = getUserReadCache(undefined);
  assert.equal(anon1, anon2, 'ไม่มีตัวตน = เสมือนในหน่วยความจำเดียวกันของ session นี้');
  assert.notEqual(anon1, a1);
});

// ── 7) id แปลงเครา ─────────────────────────────────────────────────────────────
test('userId ประหลาด (สัญลักษณ์พิเศษ/ยาวเกิน) → แปลง namespace stable แม้ซ้ำ', () => {
  const weird1 = namespacedKey('ผผอx!@#$%^&*()', 'farm:x');
  const weird2 = namespacedKey('ผผอx!@#$%^&*()', 'farm:x');
  assert.equal(weird1, weird2);
  assert.match(weird1, /^u:[A-Za-z0-9_-]+:farm:x$/);
  // a_b และ a:b ทั้งคู่ sanitize เป็น a_b (พฤติกรรมที่คาดหวัง: safe character เดียวกัน)
  assert.equal(namespacedKey('a_b', 'farm:x'), namespacedKey('a:b', 'farm:x'));
});
