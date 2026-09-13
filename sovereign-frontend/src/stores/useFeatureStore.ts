"use client";
// ─────────────────────────────────────────────────────────────
//  สิทธิ์ฟังก์ชั่นต่อคน — feature ที่ผู้ใช้ปัจจุบันเห็นได้
//  ใช้กรองเมนู (Sidebar / MobileNav / CommandPalette) + กันเปิดหน้า
//  SUPERADMIN เห็นทุกอย่างเสมอ (backend คืนทั้งหมดอยู่แล้ว)
// ─────────────────────────────────────────────────────────────
import { create } from 'zustand';
import { authFetch } from '../lib/apiFetch';

// หน้าแรก (landing) — ทุกคนเห็นได้เสมอ (widget ในหน้าแสดงตามสิทธิ์อีกที)
// /shop — หน้าร้านสาธารณะ (ไม่ต้อง login) — สมาชิกที่ login แล้วก็ต้องเข้าได้ ไม่โดน NoAccessScreen
const ALWAYS_VISIBLE = ['/dashboard', '/change-password', '/shop'];

// ฟีเจอร์ทดแทน (alias) — เมนูย้ายที่แล้วแต่สิทธิ์กลุ่มเดิมยังใช้ได้
// เช่น /treasury ย้ายมาจาก /portfolio — คนที่ได้สิทธิ์ /portfolio เก่าต้องเข้าได้ทั้งคู่
const FEATURE_ALIASES: Record<string, string[]> = {
  '/treasury': ['/portfolio'],
};

// สิทธิ์ผ่านไหม — ตรงเป๊ะ หรือผ่าน alias ของฟีเจอร์นั้น
function grantedFor(granted: string[], feature: string): boolean {
  if (granted.includes(feature)) return true;
  return (FEATURE_ALIASES[feature] || []).some((alias) => granted.includes(alias));
}

interface FeatureState {
  // key ของหน้าที่เห็น เช่น "/portfolio" | "/health" (null = ยังโหลดไม่เสร็จ)
  granted: string[] | null;
  loading: boolean;
  load: (force?: boolean) => Promise<void>;
  has: (feature: string) => boolean;
  isBlocked: (pathname: string) => boolean;
}

export const useFeatureStore = create<FeatureState>((set, get) => ({
  granted: null,
  loading: false,

  load: async (force?: boolean) => {
    // กันเรียกซ้ำพร้อมกัน — ถ้าเคยโหลดแล้วให้ข้ามเว้นแต่ force=true (grant เปลี่ยน)
    if (get().loading || (!force && get().granted !== null)) return;
    set({ loading: true });
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/features/me`);
      if (!res.ok) {
        set({ granted: [], loading: false });
        return;
      }
      const data = await res.json();
      set({ granted: Array.isArray(data.features) ? data.features : [], loading: false });
    } catch {
      // offline — คืนว่างไว้ก่อน (เมนูจะถูกกรองหาย แต่หน้า backend ยังกันอยู่)
      set({ granted: [], loading: false });
    }
  },

  has: (feature: string) => {
    const granted = get().granted;
    if (granted === null) return true; // ยังไม่รู้สิทธิ์ — อย่าซ่อนทันที กันกะพริบ
    if (ALWAYS_VISIBLE.includes(feature)) return true;
    // หน้าลูก (เช่น /health-export) — ถือว่ามีสิทธิ์เมื่อพ่อเปิดหน้าแม่ให้ (/health)
    if (granted.some((g) => feature.startsWith(g + '/'))) return true;
    return grantedFor(granted, feature);
  },

  /** หน้าไหนถูกบล็อก (สำหรับ route guard ใน _app) */
  isBlocked: (pathname: string) => {
    const granted = get().granted;
    if (granted === null) return false; // ยังไม่รู้สิทธิ์ — อย่าบล็อกทันที
    if (ALWAYS_VISIBLE.includes(pathname)) return false;
    if (granted.includes(pathname)) return false;
    if (granted.some((g) => pathname.startsWith(g + '/'))) return false;
    return !grantedFor(granted, pathname);
  },
}));
