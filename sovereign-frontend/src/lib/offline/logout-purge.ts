// src/lib/offline/logout-purge.ts — ตรรกะตัดสินว่าต้อง purge แคชเมื่อไหร่ (logout จริงเท่านั้น)
//
// กติกา (คำสั่งเจ้าของ Sprint 2 ระยะ 3 · Logout Cache Purge):
//   - logout จริง: isAuthenticated true → false (ไม่ว่าจะรู้ userId หรือไม่) = purge
//   - login: false → true = ไม่ purge
//   - สลับ user แบบยังล็อกอิน (true → true, userId เปลี่ยน) = ไม่ purge (แค่เปลี่ยน namespace ต่อไป)
//   - 401 → logoutLocal: true → false (userId null) = purge (clearUserCache(null) = no-op, ปลอดภัย)
//   - ระหว่าง hydration (isHydrated: false) = ยังไม่อ่าน store
export interface PurgeAuthSnapshot {
  isAuthenticated: boolean;
  user: { id: string } | null;
}

/** ตัดสิน userId ที่ต้อง purge จาก state transition
 *  @returns userId string = purge คนนี้ · undefined = ไม่ purge · null = logout แต่มองไม่เห็น userId (no-op) */
export function purgeUserIdForLogout(
  next: PurgeAuthSnapshot,
  prev: PurgeAuthSnapshot
): string | null | undefined {
  // login (false → true) = ไม่ purge
  if (!prev.isAuthenticated && next.isAuthenticated) return undefined;

  // สลับ user แบบยังล็อกอิน = ไม่ purge (namespace จะเปลี่ยนเองจาก userId ใหม่)
  if (prev.isAuthenticated && next.isAuthenticated) {
    const prevId = prev.user?.id ?? null;
    const nextId = next.user?.id ?? null;
    if (prevId !== nextId) return undefined; // จะใช้ getUserReadCache(nextId) เอง
    return undefined; // user เดียวกัน = ไม่ต้องทำอะไร
  }

  // logout (true → false)
  if (prev.isAuthenticated && !next.isAuthenticated) {
    const prevId = prev.user?.id ?? null;
    // รู้ userId → purge คนนั้น
    if (prevId) return prevId;
    // ไม่รู้ userId (401 logoutLocal) → null = no-op (ปลอดภัยกว่าลบผิด)
    return null;
  }

  // ไม่มีการเปลี่ยนสถานะที่เกี่ยวข้อง
  return undefined;
}

/** ผูกกับ zustand store (auth store) เพื่อทำ purge อัตโนมัติตอน logout
 *  @param store zustand store ที่มี subscribe(fn(nextState)) — callback จะถูกเรียกทันทีด้วย state ปัจจุบัน
 *  @param onPurge callback เมื่อตัดสินว่าต้อง purge (async) — รับ userId
 *  @returns unsubscribe function */
export function attachOfflinePurge(
  store: { subscribe: (fn: (next: PurgeAuthSnapshot) => void) => () => void },
  onPurge: (userId: string | null) => Promise<void>
): () => void {
  let isFirst = true;
  let prevState: PurgeAuthSnapshot = {
    isAuthenticated: false,
    user: null,
  };

  const unsub = store.subscribe((nextState) => {
    if (isFirst) {
      // ครั้งแรก = initial state, ไม่ตัดสิน purge
      prevState = nextState;
      isFirst = false;
      return;
    }
    const userId = purgeUserIdForLogout(nextState, prevState);
    if (userId !== undefined) {
      // fire-and-forget — ระบบต้องไม่รอ purge
      void onPurge(userId).catch(console.error);
    }
    prevState = nextState;
  });

  return unsub;
}