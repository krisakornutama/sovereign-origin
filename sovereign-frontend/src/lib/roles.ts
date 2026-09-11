/**
 * Role helpers — แหล่งเดียวของกฎ "ใครเป็นแอดมิน"
 * เดิม `user?.role === 'SUPERADMIN'` กระจาย ~30 จุด — พอ role เพี้ยน (เคยเกิดจริง:
 * admin ค้าง SYSTEM_AI) ทั้งแอปกลายเป็น NoAccessScreen ทันทีต่อให้รหัสผ่านถูก
 * → จับ string เดียวไว้ที่นี่ เปลี่ยนที่เดียวมีผลทั้งแอป
 */
import { useAuthStore } from '../stores/useAuthStore';

const SUPERADMIN_ROLE = 'SUPERADMIN';

/** ใช้กับค่า role ดิบ (เช่น user จาก list/map ที่ไม่ใช่ user ปัจจุบัน) */
export function roleIsSuperadmin(role: string | null | undefined): boolean {
  return role === SUPERADMIN_ROLE;
}

/** ผู้ใช้ปัจจุบันเป็น SUPERADMIN หรือไม่ — hook แบบ reactive ใช้ใน component/page */
export function useIsSuperadmin(): boolean {
  return useAuthStore((s) => s.user?.role === SUPERADMIN_ROLE);
}

/** เขียนโมดูลปฏิบัติการ (farm/inventory/livestock/lifestyle) — แอดมินหรือผู้ดูแลโหนด */
export function useCanWriteModules(): boolean {
  return useAuthStore((s) => {
    const role = s.user?.role;
    return role === SUPERADMIN_ROLE || role === 'NODE_ADMIN' || role === 'OPERATOR';
  });
}
