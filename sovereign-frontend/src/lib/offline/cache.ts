// cache.ts — singleton ของ read cache สำหรับใช้ทั้งแอป (user-namespaced)
//
// Sprint 2 ระยะ 3: แยกแคชต่อ userId ผ่าน user-read-cache
// - getUserReadCache(userId) คืน OfflineReadCache ที่ namespace แยกต่อ user
// - setUserCacheStore เรียกตอน boot เพื่อส่ง IndexedDB store จริงเข้า registry
// - ไม่มี userId (ยังไม่ล็อกอิน/รอ hydration) → ใช้ anonymous singleton
import { IndexedDbReadCacheStore } from './read-cache';
import { getUserReadCache, setUserCacheStore } from './user-read-cache';

/** store ฐาน IndexedDB — lazy open จนกว่าจะมีการอ่านครั้งแรก */
const baseStore = new IndexedDbReadCacheStore();

// ส่ง store จริงเข้า registry (ทำครั้งเดียวตอน import แรก)
setUserCacheStore(baseStore);

// export: ฟังก์ชันคืน cache ต่อ userId (container ใช้ user.id จาก auth store)
export function getOfflineReadCache(userId: string | null | undefined) {
  return getUserReadCache(userId);
}

// backward compatibility: default anonymous cache
export const offlineReadCache = getUserReadCache(null);

// export store สำหรับ purge ใช้ตรง
export { baseStore as offlineReadCacheStore };
