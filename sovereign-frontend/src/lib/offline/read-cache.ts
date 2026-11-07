// ─────────────────────────────────────────────────────────────────────────────
// read-cache.ts — Offline-first read cache (IndexedDB) แยกตามโดเมน
//
// ทำไมต้องมี read cache แยกจาก offlineQueue:
//   offlineQueue เก็บ "คำขอเขียน" ที่ยังไม่ส่ง — คนละปัญหา
//   ฝั่งอ่านต้องการ "ข้อมูลล่าสุดที่เคยเห็น" เพื่อเปิดหน้าเดิมได้แม้ network ล่ม
//   โดยไม่ให้หน้าเว็บพัง (state เป็น undefined แล้ว .map() โยน error)
//
// กติกา:
//   - TTL ต่อโดเมน/ต่อคำขอ (default 5 นาที)
//   - stale-while-revalidate: คืนแคชทันที + refresh เบื้องหลัง
//   - network ล่ม + มีแคช → คืนแคชพร้อม stale=true (ไม่ throw)
//   - network ล่ม + ไม่มีแคช → OfflineReadUnavailableError (hook แสดง empty state)
//   - IndexedDB ใช้ไม่ได้/เขียนไม่ได้/แคชเสีย → ถือเป็น cache miss ห้ามล้มการอ่านปกติ
//
// หมายเหตุ: Service Worker ของแอป (**ห้าม cache /api/**) ไม่ถูกแตะ — ชั้นนี้อยู่ฝั่งแอป
//   และใช้ IndexedDB เดียวกันได้ทั้ง window และ SW ในอนาคต
// ─────────────────────────────────────────────────────────────────────────────

export const READ_CACHE_VERSION = 1 as const;

/** โดเมนที่แคชแยกกัน — ล้าง/หมดอายุรายโดเมนได้โดยไม่กระทบโดเมนอื่น */
export const CACHE_DOMAINS = {
  SYSTEM: 'system',
  MENU: 'menu',
  FARM: 'farm',
  INVENTORY: 'inventory',
  TELEMETRY: 'telemetry',
} as const;

export type CacheDomain = (typeof CACHE_DOMAINS)[keyof typeof CACHE_DOMAINS] | (string & {});

export interface CacheRecord<T = unknown> {
  version: typeof READ_CACHE_VERSION;
  key: string;
  domain: string;
  data: T;
  /** epoch ms ที่ข้อมูลนี้ถูกเขียนลงแคช */
  savedAt: number;
  /** TTL ที่ใช้ตอนเขียน — ใช้ตัดสินความสดของ record นี้ */
  ttlMs: number;
}

/** backend ของแคช — production ใช้ IndexedDB, เทสต์/SSR ใช้ตัวอื่นได้ */
export interface ReadCacheStore {
  get(key: string): Promise<CacheRecord | undefined>;
  put(record: CacheRecord): Promise<void>;
  delete(key: string): Promise<void>;
  clearDomain(domain: string): Promise<void>;
  keys(domain?: string): Promise<string[]>;
}

/** คีย์เดียวของทั้งระบบ — กันโดเมนชนกัน (`farm:plots` ≠ `inventory:plots`) */
export function cacheKey(domain: string, resource: string): string {
  const d = String(domain ?? '').trim();
  const r = String(resource ?? '').trim();
  if (!d || !r) throw new Error('cacheKey: ต้องระบุทั้ง domain และ resource');
  return `${d}:${r}`;
}

export class OfflineReadUnavailableError extends Error {
  readonly code = 'OFFLINE_READ_UNAVAILABLE' as const;
  readonly key: string;

  constructor(key: string, cause?: unknown) {
    super(`ไม่มีข้อมูลแคชสำหรับ "${key}" และเชื่อมต่อเครือข่ายไม่ได้`);
    this.name = 'OfflineReadUnavailableError';
    this.key = key;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

// ── IndexedDB store ───────────────────────────────────────────────────────────
export interface IndexedDbReadCacheOptions {
  dbName?: string;
  storeName?: string;
  version?: number;
}

/**
 * IndexedDB-backed store — เปิด DB แบบ lazy (ครั้งแรกที่มีการอ่าน/เขียน)
 * ถ้า IndexedDB ไม่มี (SSR/WebView เก่า/private mode) ทุก operation จะ reject
 * แล้ว OfflineReadCache จะ treat เป็น cache miss ให้เอง
 */
export class IndexedDbReadCacheStore implements ReadCacheStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly version: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbReadCacheOptions = {}) {
    this.dbName = options.dbName || 'sovereign-read-cache';
    this.storeName = options.storeName || 'read-cache';
    this.version = options.version ?? READ_CACHE_VERSION;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    const factory = typeof indexedDB !== 'undefined' ? indexedDB : null;
    if (!factory) {
      const err = new Error('IndexedDB ไม่พร้อมใช้งานในสภาพแวดล้อมนี้') as Error & { code?: string };
      err.code = 'E_INDEXEDDB_UNAVAILABLE';
      return Promise.reject(err);
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(this.dbName, this.version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('domain', 'domain', { unique: false });
          store.createIndex('savedAt', 'savedAt', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // เปิด tab ใหม่ที่ version สูงกว่า = ปิด connection เก่าให้เขา upgrade ได้
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('เปิด IndexedDB ไม่สำเร็จ'));
      request.onblocked = () => reject(request.error || new Error('IndexedDB ถูกบล็อก (มีแท็บอื่นเปิดค้าง)'));
    });

    // open ล้ม → ล้าง promise เพื่อให้ครั้งถัดไปลองใหม่ได้
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });
    return this.dbPromise;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T> | void
  ): Promise<T | undefined> {
    const db = await this.open();
    return new Promise<T | undefined>((resolve, reject) => {
      let value: T | undefined;
      const tx = db.transaction(this.storeName, mode);
      const store = tx.objectStore(this.storeName);
      try {
        const request = fn(store);
        if (request) {
          request.onsuccess = () => {
            value = request.result;
          };
          request.onerror = () => reject(request.error);
        }
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction error'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async get(key: string): Promise<CacheRecord | undefined> {
    return (await this.run('readonly', (store) => store.get(key))) as CacheRecord | undefined;
  }

  async put(record: CacheRecord): Promise<void> {
    await this.run('readwrite', (store) => store.put(record));
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(key));
  }

  async clearDomain(domain: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const index = tx.objectStore(this.storeName).index('domain');
      const request = index.openCursor(IDBKeyRange.only(domain));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction error'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async keys(domain?: string): Promise<string[]> {
    const keys = await this.run('readonly', (store) =>
      domain ? store.index('domain').getAllKeys(domain) : store.getAllKeys()
    );
    return (keys || []).map((k) => String(k));
  }
}

// ── read-through cache ────────────────────────────────────────────────────────
export interface OfflineReadCacheOptions {
  store: ReadCacheStore;
  now?: () => number;
  /** TTL เริ่มต้นของข้อมูลใหม่ (ms) */
  defaultTtlMs?: number;
  /** เปิด background refresh เมื่อ cache ยังสด (default true) */
  staleWhileRevalidate?: boolean;
  isOnline?: () => boolean;
}

export interface ReadOptions {
  /** override TTL สำหรับคำขอนี้ */
  ttlMs?: number;
  /** บังคับยิง network แม้ cache จะสด */
  forceRefresh?: boolean;
  /** override พฤติกรรม SWR สำหรับคำขอนี้ */
  staleWhileRevalidate?: boolean;
}

export interface CachedReadResult<T> {
  data: T;
  source: 'network' | 'cache';
  stale: boolean;
  savedAt: number | null;
  /** promise ของงาน refresh เบื้องหลัง — resolve null เมื่อ refresh ล้ม (ไม่ reject) */
  revalidated: Promise<CachedReadResult<T> | null> | null;
}

function defaultIsOnline(): boolean {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
  } catch {
    /* ignore — ถ้าเช็คไม่ได้ให้ถือว่าออนไลน์ */
  }
  return true;
}

export class OfflineReadCache {
  private readonly store: ReadCacheStore;
  private readonly now: () => number;
  private readonly defaultTtlMs: number;
  private readonly staleWhileRevalidate: boolean;
  private readonly isOnline: () => boolean;

  constructor(options: OfflineReadCacheOptions) {
    this.store = options.store;
    this.now = options.now || (() => Date.now());
    this.defaultTtlMs = Math.max(0, options.defaultTtlMs ?? 5 * 60_000);
    this.staleWhileRevalidate = options.staleWhileRevalidate ?? true;
    this.isOnline = options.isOnline || defaultIsOnline;
  }

  private isValidRecord(record: CacheRecord | undefined, key: string): record is CacheRecord {
    if (!record) return false;
    return (
      record.version === READ_CACHE_VERSION &&
      record.key === key &&
      typeof record.domain === 'string' &&
      record.domain.length > 0 &&
      record.data !== undefined &&
      typeof record.savedAt === 'number' &&
      Number.isFinite(record.savedAt) &&
      typeof record.ttlMs === 'number' &&
      Number.isFinite(record.ttlMs) &&
      record.ttlMs >= 0
    );
  }

  private async safeGet(key: string): Promise<CacheRecord | undefined> {
    try {
      const record = await this.store.get(key);
      if (!this.isValidRecord(record, key)) {
        if (record) this.store.delete(key).catch(() => {});
        return undefined;
      }
      return record;
    } catch {
      return undefined; // IndexedDB ปิด/ไม่มี → cache miss
    }
  }

  private async safePut(record: CacheRecord): Promise<void> {
    try {
      await this.store.put(record);
    } catch {
      // quota/private mode — แคชเขียนไม่ได้แต่การอ่านยังต้องสำเร็จ
    }
  }

  private async safeDelete(key: string): Promise<void> {
    try {
      await this.store.delete(key);
    } catch {
      /* ignore */
    }
  }

  private async fetchAndStore<T>(
    key: string,
    domain: string,
    fetcher: () => Promise<T>,
    ttlMs: number
  ): Promise<CachedReadResult<T>> {
    const data = await fetcher();
    const savedAt = this.now();
    await this.safePut({
      version: READ_CACHE_VERSION,
      key,
      domain,
      data,
      savedAt,
      ttlMs,
    });
    return { data, source: 'network', stale: false, savedAt, revalidated: null };
  }

  /**
   * อ่านแบบ cache-first:
   * - แคชสด → คืนทันที (+ refresh เบื้องหลังถ้าเปิด SWR)
   * - แคชหมดอายุ/ไม่มี → ลอง network; ล้มแล้วถอยไปแคชเก่า; ไม่มีแคชจริง ๆ → throw
   */
  async read<T>(
    domain: CacheDomain,
    resource: string,
    fetcher: () => Promise<T>,
    options: ReadOptions = {}
  ): Promise<CachedReadResult<T>> {
    const key = cacheKey(domain, resource);
    const ttlMs = Math.max(0, options.ttlMs ?? this.defaultTtlMs);
    const record = await this.safeGet(key);
    const online = this.isOnline();
    const now = this.now();
    // TTL ที่ผู้เรียกกำหนดต่อคำขอ = ความสดที่เขาต้องการ (เข้มกว่าหรือหลวมกว่า record เดิมได้)
    const effectiveTtl = options.ttlMs !== undefined ? ttlMs : record ? record.ttlMs : ttlMs;
    const stale = record ? now - record.savedAt >= effectiveTtl : true;

    const fromCache = (isStale: boolean): CachedReadResult<T> => ({
      data: record!.data as T,
      source: 'cache',
      stale: isStale,
      savedAt: record!.savedAt,
      revalidated: null,
    });

    // cache ยังสด
    if (record && !stale && !options.forceRefresh) {
      const wantSwr = options.staleWhileRevalidate ?? this.staleWhileRevalidate;
      if (wantSwr && online) {
        const revalidated = this.fetchAndStore<T>(key, String(domain), fetcher, ttlMs).catch(() => null);
        return { ...fromCache(false), revalidated };
      }
      return fromCache(false);
    }

    if (!online) {
      if (record) return fromCache(stale);
      throw new OfflineReadUnavailableError(key);
    }

    try {
      return await this.fetchAndStore<T>(key, String(domain), fetcher, ttlMs);
    } catch (err) {
      if (record) return fromCache(stale);
      throw new OfflineReadUnavailableError(key, err);
    }
  }

  /** อ่านแคชอย่างเดียว (ไม่ยิง network) — ใช้ hydrate หน้าทันทีตอน mount */
  async peek<T>(domain: CacheDomain, resource: string): Promise<CacheRecord<T> | undefined> {
    const key = cacheKey(domain, resource);
    return (await this.safeGet(key)) as CacheRecord<T> | undefined;
  }

  /** ล้างแคชทั้งโดเมน (เช่น ออกจากระบบ/เปลี่ยนสาขา) */
  async invalidateDomain(domain: CacheDomain): Promise<void> {
    try {
      await this.store.clearDomain(String(domain));
    } catch {
      /* ignore */
    }
  }

  /** ล้างแคชรายการเดียว */
  async invalidate(domain: CacheDomain, resource: string): Promise<void> {
    await this.safeDelete(cacheKey(domain, resource));
  }
}
