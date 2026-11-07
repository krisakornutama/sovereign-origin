// cache.ts — singleton ของ read cache สำหรับใช้ทั้งแอป
// สร้าง IndexedDbReadCacheStore แบบ lazy: ยังไม่แตะ indexedDB จนกว่าจะมีการอ่านครั้งแรก
// → import จาก SSR/หน้า _app ได้โดยไม่พัง
import { IndexedDbReadCacheStore, OfflineReadCache } from './read-cache';

export const offlineReadCache = new OfflineReadCache({
  store: new IndexedDbReadCacheStore(),
});
