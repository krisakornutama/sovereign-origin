// src/lib/offline/user-read-cache.ts — user-namespaced read cache
//
// กติกา (คำสั่งเจ้าของ Sprint 2 ระยะ 3):
//   - ทุกคีย์แคชถูก prefix ด้วย namespace ต่อผู้ใช้: `u:{sanitized_userId}:{domain}:{resource}`
//   - ไม่มี userId (ยังไม่ล็อกอิน/รอ hydration) → ใช้ MemoryStore ซิงเกิลตันสำหรับ session นี้
//   - logout → ลบแคชของ user นั้นทิ้ง 100% (clearUserCache) โดยไม่แตะแคชของ user อื่น
//   - login/renew session → ห้ามลบแคช
//   - getUserReadCache(userId) คืนอินสแตนซ์เดียวกันต่อ userId เดิม (reuse) และแยกกันต่าง userId
import type { OfflineReadCacheOptions, ReadCacheStore } from './read-cache';
import { OfflineReadCache } from './read-cache';

// ── namespace helpers ──────────────────────────────────────────────────────────
const SANITIZE_RE = /[^A-Za-z0-9_-]/g;
const TRUNCATE = 48; // กันคีย์ยาวเกินขีดจำกัด IndexedDB

/** สร้างคีย์ namespace ที่ปลอดภัย: `u:{sanitized_userId}:{domain}:{resource}` */
export function namespacedKey(userId: string | null | undefined, domainResourceKey: string): string {
  if (!userId) return `u:anon:${domainResourceKey}`; // anonymous session
  const safe = String(userId)
    .replace(SANITIZE_RE, '_')
    .slice(0, TRUNCATE);
  return `u:${safe}:${domainResourceKey}`;
}

/** MemoryStore สำหรับ anonymous session (ไม่มี userId) — ไม่แตะ IndexedDB */
class AnonymousMemoryStore implements ReadCacheStore {
  private records = new Map<string, import('./read-cache').CacheRecord>();

  async get(key: string) {
    const rec = this.records.get(key);
    return rec ? (JSON.parse(JSON.stringify(rec)) as import('./read-cache').CacheRecord) : undefined;
  }
  async put(record: import('./read-cache').CacheRecord) {
    this.records.set(record.key, JSON.parse(JSON.stringify(record)) as import('./read-cache').CacheRecord);
  }
  async delete(key: string) {
    this.records.delete(key);
  }
  async clearDomain(domain: string) {
    for (const [key, rec] of this.records) {
      if (rec.domain === domain) this.records.delete(key);
    }
  }
  async keys(domain?: string) {
    return [...this.records.values()]
      .filter((rec) => !domain || rec.domain === domain)
      .map((rec) => rec.key);
  }
}

// ── factory / registry ─────────────────────────────────────────────────────────
const userCacheRegistry = new Map<string, OfflineReadCache>();

/** store ฐานตัวจริง (IndexedDB) — null จนกว่า setUserCacheStore จะถูกเรียก (ตอน import cache.ts) */
let baseStoreRef: ReadCacheStore | null = null;

/** คืน/สร้าง OfflineReadCache สำหรับ userId นั้น — ใช้ store เดียวกัน แต่แยก namespace ด้วย namespacedKey */
export function createUserReadCache(
  userId: string | null | undefined,
  options: OfflineReadCacheOptions
): OfflineReadCache {
  const baseStore = options.store;
  const nsStore: ReadCacheStore = {
    async get(key) {
      const namespaced = namespacedKey(userId, key);
      const record = await baseStore.get(namespaced);
      if (record) {
        // คืน record ด้วย key ต้นฉบับ เพื่อให้ isValidRecord ผ่าน (มันเช็ค record.key === key)
        return { ...record, key };
      }
      return undefined;
    },
    async put(record) {
      await baseStore.put({ ...record, key: namespacedKey(userId, record.key) });
    },
    async delete(key) {
      await baseStore.delete(namespacedKey(userId, key));
    },
    async clearDomain(domain) {
      // ลบเฉพาะคีย์ที่มี prefix ของ user นี้ใน domain นั้น
      const allKeys = await baseStore.keys(domain);
      const prefix = `${namespacedKey(userId, `${domain}:`)}`;
      for (const key of allKeys) {
        if (key.startsWith(prefix)) await baseStore.delete(key);
      }
    },
    async keys(domain) {
      const allKeys = await baseStore.keys(domain);
      // กรองเฉพาะคีย์ของ user นี้ (prefix `u:{uid}:` ครอบทั้งโดเมนและ resource)
      const prefix = namespacedKey(userId, '');
      return allKeys.filter((k) => k.startsWith(prefix));
    },
  };

  return new OfflineReadCache({ ...options, store: nsStore });
}

/** registry กลางแอป — reuse ต่อ userId เดิม · ไม่มี userId = เสมือนในหน่วยความจำ (Ephemeral ปลอดภัยจาก IDB) */
export function getUserReadCache(userId: string | null | undefined): OfflineReadCache {
  const key = userId ?? 'anon';
  let cache = userCacheRegistry.get(key);
  if (!cache) {
    // store จริงเมื่อ boot เสร็จ (cache.ts import setUserCacheStore) · ยังไม่ถึงเวลาใช้ MemoryStore ชั่วคราว
    const store = baseStoreRef ?? new AnonymousMemoryStore();
    cache = createUserReadCache(userId, { store });
    userCacheRegistry.set(key, cache);
  }
  return cache;
}

/** ลบแคชของ user นั้นทั้งหมดจาก store ฐาน (indexedDB) — คืนจำนวนที่ลบ */
export async function clearUserCache(
  userId: string | null | undefined,
  baseStore: ReadCacheStore
): Promise<number> {
  if (!userId) return 0;
  const prefix = namespacedKey(userId, '');
  const allKeys = await baseStore.keys();
  let removed = 0;
  for (const key of allKeys) {
    if (key.startsWith(prefix)) {
      await baseStore.delete(key);
      removed++;
    }
  }
  // ลบ registry cache ออกด้วย (ครั้งหน้า login เข้าใหม่สร้างใหม่จาก store ปัจจุบัน)
  userCacheRegistry.delete(userId);
  return removed;
}

/** เซ็ต store จริง (IndexedDB) — เรียกตอน import cache.ts ครั้งเดียว · รายการ registry เดิมถูกสร้างใหม่ให้จ่อ store ปัจจุบัน */
export function setUserCacheStore(baseStore: ReadCacheStore): void {
  baseStoreRef = baseStore;
  for (const userId of userCacheRegistry.keys()) {
    const cache = createUserReadCache(userId === 'anon' ? null : userId, { store: baseStore });
    userCacheRegistry.set(userId, cache);
  }
}