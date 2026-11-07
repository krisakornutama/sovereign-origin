// src/lib/offline/read-cache.test.ts — red-first test ของ Offline Read Cache
// รันด้วย: npx --prefix ../sovereign-os/core-api tsx src/lib/offline/read-cache.test.ts
//
// กติกาที่ล็อกไว้:
//   1) network ล่ม + มีแคช → คืนข้อมูลเก่าทันที ไม่ throw (ผู้ใช้ยังอ่านหน้าเดิมได้)
//   2) network ล่ม + ไม่มีแคช → throw OfflineReadUnavailableError (ให้ hook แสดง empty state)
//   3) TTL หมดอายุ → ลอง network ก่อน, ล้มค่อยถอยไป stale cache
//   4) stale-while-revalidate → คืนแคชทันที + อัปเดตเบื้องหลังโดยไม่ทำให้ผู้ใช้รอ
//   5) แคชเสีย/เขียนไม่ได้/IndexedDB ใช้ไม่ได้ → ต้องไม่ทำให้การอ่านปกติพัง
//   6) แยกโดเมน (menu/farm/inventory/system) และล้างรายโดเมนได้
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CACHE_DOMAINS,
  IndexedDbReadCacheStore,
  OfflineReadCache,
  OfflineReadUnavailableError,
  cacheKey,
  type CacheRecord,
  type ReadCacheStore,
} from './read-cache';

// ── test doubles ─────────────────────────────────────────────────────────────
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

  seed(domain: string, resource: string, data: unknown, savedAt: number, ttlMs = 60_000): void {
    const key = cacheKey(domain, resource);
    this.records.set(key, { version: 1, key, domain, data, savedAt, ttlMs });
  }
}

let NOW = 1_700_000_000_000;
const clock = () => NOW;
const makeCache = (store: ReadCacheStore, extra: Partial<ConstructorParameters<typeof OfflineReadCache>[0]> = {}) =>
  new OfflineReadCache({
    store,
    now: clock,
    defaultTtlMs: 60_000,
    isOnline: () => true,
    ...extra,
  });

const isOfflineError = (key: string) => (err: unknown) => {
  assert.ok(err instanceof OfflineReadUnavailableError, 'ต้องเป็น OfflineReadUnavailableError');
  assert.equal(err.code, 'OFFLINE_READ_UNAVAILABLE');
  assert.equal(err.key, key);
  return true;
};

// ── 1) network ปกติ + cache hit ───────────────────────────────────────────────
test('network สำเร็จ → เขียนแคช และอ่านซ้ำได้โดยไม่ยิง network', async () => {
  const store = new MemoryStore();
  const cache = makeCache(store, { staleWhileRevalidate: false });
  let calls = 0;

  const first = await cache.read(CACHE_DOMAINS.FARM, 'plots', async () => {
    calls++;
    return { plots: [{ id: 1 }, { id: 2 }] };
  });
  assert.equal(first.source, 'network');
  assert.equal(first.stale, false);
  assert.deepEqual(first.data, { plots: [{ id: 1 }, { id: 2 }] });
  assert.equal(calls, 1);

  const second = await cache.read(CACHE_DOMAINS.FARM, 'plots', async () => {
    calls++;
    return { plots: [{ id: 99 }] };
  });
  assert.equal(second.source, 'cache');
  assert.equal(second.stale, false);
  assert.deepEqual(second.data, { plots: [{ id: 1 }, { id: 2 }] });
  assert.equal(calls, 1, 'แคชยังสด → ห้ามยิง network ซ้ำ');
});

// ── 2) network error + cache ────────────────────────────────────────────────
test('network ล่ม + มีแคชเก่า → คืนแคชพร้อม stale=true ไม่ crash', async () => {
  const store = new MemoryStore();
  store.seed(CACHE_DOMAINS.FARM, 'plots', { plots: [{ id: 7 }] }, NOW - 120_000);
  const cache = makeCache(store);

  const res = await cache.read(CACHE_DOMAINS.FARM, 'plots', async () => {
    throw new Error('ENOTFOUND api.local');
  });
  assert.equal(res.source, 'cache');
  assert.equal(res.stale, true);
  assert.deepEqual(res.data, { plots: [{ id: 7 }] });
  assert.equal(res.savedAt, NOW - 120_000);
});

test('network ล่ม + ไม่มีแคช → throw OfflineReadUnavailableError พร้อม key/cause', async () => {
  const cache = makeCache(new MemoryStore());
  await assert.rejects(
    () =>
      cache.read(CACHE_DOMAINS.INVENTORY, 'items', async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:3001');
      }),
    (err: unknown) => {
      isOfflineError(cacheKey(CACHE_DOMAINS.INVENTORY, 'items'))(err);
      assert.match(String((err as Error).cause ?? ''), /ECONNREFUSED/);
      return true;
    }
  );
});

// ── 3) TTL ───────────────────────────────────────────────────────────────────
test('TTL หมดอายุ → ใช้ network เมื่อสำเร็จ และเขียนแคชใหม่', async () => {
  const store = new MemoryStore();
  store.seed(CACHE_DOMAINS.INVENTORY, 'items', { items: ['old'] }, NOW - 120_000);
  const cache = makeCache(store, { staleWhileRevalidate: false });

  const res = await cache.read(CACHE_DOMAINS.INVENTORY, 'items', async () => ({ items: ['new'] }));
  assert.equal(res.source, 'network');
  assert.deepEqual(res.data, { items: ['new'] });

  const rec = await store.get(cacheKey(CACHE_DOMAINS.INVENTORY, 'items'));
  assert.deepEqual(rec?.data, { items: ['new'] });
  assert.equal(rec?.savedAt, NOW);
});

test('TTL ต่อคำขอ (ttlMs override) ใช้แทนค่า default ได้', async () => {
  const store = new MemoryStore();
  store.seed(CACHE_DOMAINS.SYSTEM, 'menu', { menu: ['a'] }, NOW - 30_000);
  const cache = makeCache(store, { staleWhileRevalidate: false });
  let calls = 0;

  const res = await cache.read(
    CACHE_DOMAINS.SYSTEM,
    'menu',
    async () => {
      calls++;
      return { menu: ['b'] };
    },
    { ttlMs: 10_000 }
  );
  assert.equal(calls, 1, 'อายุ 30s > ttl 10s → ต้องถือว่าหมดอายุ');
  assert.equal(res.source, 'network');
});

// ── 4) stale-while-revalidate ───────────────────────────────────────────────
test('SWR → คืนแคชทันที แล้วอัปเดตเบื้องหลังผ่าน revalidated', async () => {
  const store = new MemoryStore();
  store.seed(CACHE_DOMAINS.SYSTEM, 'menu', { version: 1 }, NOW - 5_000);
  const cache = makeCache(store);

  let release: ((value: unknown) => void) | null = null;
  const pending = new Promise((resolve) => {
    release = resolve;
  });

  const first = await cache.read(CACHE_DOMAINS.SYSTEM, 'menu', () => pending);
  assert.equal(first.source, 'cache');
  assert.deepEqual(first.data, { version: 1 });
  assert.ok(first.revalidated, 'ต้องมี promise ของงานเบื้องหลัง');

  (release as ((value: unknown) => void) | null)!({ version: 2 });
  const updated = await first.revalidated!;
  assert.equal(updated?.source, 'network');
  assert.deepEqual(updated?.data, { version: 2 });

  const rec = await store.get(cacheKey(CACHE_DOMAINS.SYSTEM, 'menu'));
  assert.deepEqual(rec?.data, { version: 2 }, 'แคชต้องถูกอัปเดตหลัง revalidate');
});

test('SWR ที่ network ล่ม → revalidated resolve null ไม่ทำให้ unhandled rejection', async () => {
  const store = new MemoryStore();
  store.seed(CACHE_DOMAINS.MENU, 'nav', { items: [1] }, NOW - 1_000);
  const cache = makeCache(store);

  const res = await cache.read(CACHE_DOMAINS.MENU, 'nav', async () => {
    throw new Error('offline');
  });
  assert.equal(res.source, 'cache');
  assert.equal(await res.revalidated, null);
});

// ── 5) offline short-circuit ────────────────────────────────────────────────
test('navigator offline → ไม่ยิง network, คืนแคชทันที', async () => {
  const store = new MemoryStore();
  store.seed(CACHE_DOMAINS.FARM, 'livestock', { animals: 3 }, NOW - 90_000);
  const cache = makeCache(store, { isOnline: () => false });
  let calls = 0;

  const res = await cache.read(CACHE_DOMAINS.FARM, 'livestock', async () => {
    calls++;
    return { animals: 99 };
  });
  assert.equal(calls, 0);
  assert.equal(res.source, 'cache');
  assert.equal(res.stale, true);
  assert.deepEqual(res.data, { animals: 3 });
  assert.equal(res.revalidated, null);
});

test('offline + ไม่มีแคช → throw แบบควบคุมได้', async () => {
  const cache = makeCache(new MemoryStore(), { isOnline: () => false });
  await assert.rejects(
    () => cache.read(CACHE_DOMAINS.FARM, 'livestock', async () => ({ animals: 0 })),
    isOfflineError(cacheKey(CACHE_DOMAINS.FARM, 'livestock'))
  );
});

// ── 6) cache เสีย / เขียนไม่ได้ / IndexedDB ไม่พร้อม ─────────────────────────
test('แคชเสียรูป → ถือเป็น cache miss แล้วใช้ network ต่อได้', async () => {
  const store = new MemoryStore();
  const key = cacheKey(CACHE_DOMAINS.FARM, 'plots');
  await store.put({ version: 1, key, domain: CACHE_DOMAINS.FARM, data: undefined, savedAt: NaN, ttlMs: -1 });

  const cache = makeCache(store, { staleWhileRevalidate: false });
  const res = await cache.read(CACHE_DOMAINS.FARM, 'plots', async () => ({ ok: true }));
  assert.equal(res.source, 'network');
  assert.deepEqual(res.data, { ok: true });
});

test('เขียนแคชไม่ได้ (quota) → การอ่านยังสำเร็จ ไม่ throw', async () => {
  const store = new MemoryStore();
  store.failWrites = true;
  const cache = makeCache(store, { staleWhileRevalidate: false });

  const res = await cache.read(CACHE_DOMAINS.INVENTORY, 'items', async () => ({ items: [1] }));
  assert.equal(res.source, 'network');
  assert.deepEqual(res.data, { items: [1] });
  assert.deepEqual(await store.keys(), [], 'เขียนไม่ได้ = ไม่มีของใน cache แต่ห้ามล้มการอ่าน');
});

test('IndexedDB ใช้ไม่ได้ (Node/WebView เก่า) → ยังอ่าน network ได้', async () => {
  const store = new IndexedDbReadCacheStore({ dbName: `sovereign-read-cache-test-${Date.now()}` });
  const cache = makeCache(store, { staleWhileRevalidate: false });

  const res = await cache.read(CACHE_DOMAINS.SYSTEM, 'bootstrap', async () => ({ ok: true }));
  assert.equal(res.source, 'network');
  assert.deepEqual(res.data, { ok: true });
  await cache.invalidateDomain(CACHE_DOMAINS.SYSTEM); // ต้องไม่ throw แม้ IndexedDB ไม่มี
});

// ── 7) แยกโดเมน + ล้างรายโดเมน ──────────────────────────────────────────────
test('แคชแยกโดเมน และ invalidateDomain ไม่ลบโดเมนอื่น', async () => {
  const store = new MemoryStore();
  const cache = makeCache(store, { staleWhileRevalidate: false });

  await cache.read(CACHE_DOMAINS.FARM, 'plots', async () => ({ farm: true }));
  await cache.read(CACHE_DOMAINS.INVENTORY, 'items', async () => ({ stock: 10 }));

  await cache.invalidateDomain(CACHE_DOMAINS.FARM);
  assert.deepEqual(await store.keys(CACHE_DOMAINS.FARM), []);
  assert.deepEqual(await store.keys(CACHE_DOMAINS.INVENTORY), [cacheKey(CACHE_DOMAINS.INVENTORY, 'items')]);

  await cache.invalidate(CACHE_DOMAINS.INVENTORY, 'items');
  assert.deepEqual(await store.keys(), []);
});
