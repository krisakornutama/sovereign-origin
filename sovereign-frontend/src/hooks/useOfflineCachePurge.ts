// src/hooks/useOfflineCachePurge.ts — hook ผูก logout purge เข้ากับ auth store (mount ที่ Sidebar)
//
// กติกา (คำสั่งเจ้าของ Sprint 2 ระยะ 3 · Logout Cache Purge):
//   - logout จริง (isAuthenticated true → false) → clearUserCache(userId) ล้างแคชของคนนั้น 100%
//   - login / renew session → ห้าม purge
//   - 1309 เข้าใหม่หลัง logout → namespace ของ user ใหม่ต่างออกไปอยู่แล้ว (u:{uid}:)
//   - รอ isHydrated ก่อน attach (hydration ครึ่งทางไม่ควรตัดสินการลับ)
//   - Sidebar mount ทุกหน้า (53/56 ตามคอมเมนต์ในตัวมันเอง) → listener มีอยู่ตลอดเวลาที่ใช้งานแอป
import { useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { purgeUserIdForLogout, type PurgeAuthSnapshot } from '../lib/offline/logout-purge';
import { clearUserCache } from '../lib/offline/user-read-cache';
import { offlineReadCacheStore } from '../lib/offline/cache';

/** แปลง snapshot ที่ตัวตัดสิน purge ต้องกิน (ไม่แตะไฟล์ห้ามแก้ — อ่านอย่างเดียว) */
function snapshot(s: { isAuthenticated: boolean; user: { id: string } | null }): PurgeAuthSnapshot {
  return { isAuthenticated: s.isAuthenticated, user: s.user };
}

/** เรียกใน Sidebar เพื่อติดตั้ง purge listener ครั้งเดียวต่อหน้า */
export function useOfflineCachePurge(): void {
  const isHydrated = useAuthStore((s) => s.isHydrated);

  useEffect(() => {
    if (!isHydrated) return;

    // zustand subscribe ส่ง (state, prevState) — ตัดสินจาก transition จริง ไม่ต้องจำเอง
    const unsub = useAuthStore.subscribe((state, prevState) => {
      const userId = purgeUserIdForLogout(snapshot(state), snapshot(prevState));
      if (userId === undefined) return; // login/สลับบัญชี/ไม่เกี่ยว = ไม่แตะแคช
      if (userId === null) return; // logout แต่มองไม่เห็นตัวตน (401/logoutLocal) = no-op ปลอดภัย
      // fire-and-forget — purge ต้องไม่ให้ UI รอ
      void clearUserCache(userId, offlineReadCacheStore).catch(console.error);
    });

    return unsub;
  }, [isHydrated]);
}
