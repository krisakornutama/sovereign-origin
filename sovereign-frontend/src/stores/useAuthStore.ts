import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { JwtPayload, UserProfile } from '../types';
import { decodeJwt } from '../lib/jwt';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  user: UserProfile | null;
  mfaRequired: boolean;
  isHydrated: boolean;
  login: (token: string) => void;
  logout: () => void;
  setMfaRequired: (required: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      isAuthenticated: false,
      user: null,
      mfaRequired: false,
      isHydrated: false,

      login: (token: string) => {
        const payload: JwtPayload = decodeJwt(token);
        if (!payload || Date.now() >= payload.exp * 1000) {
          set({ token: null, isAuthenticated: false, user: null, mfaRequired: false });
          return;
        }

        if (!payload.mfa_verified) {
          set({
            token,
            isAuthenticated: false,
            user: null,
            mfaRequired: true,
          });
          return;
        }

        set({
          token,
          isAuthenticated: true,
          user: {
            id: payload.userId,
            role: payload.role,
            assigned_node_id: payload.assigned_node_id,
            username: '',
          },
          mfaRequired: false,
        });
      },

      logout: () => {
        set({ token: null, isAuthenticated: false, user: null, mfaRequired: false });
        // เคลียร์ localStorage ทันที เพื่อให้แน่ใจว่าไม่เหลือ token ค้าง
        if (typeof window !== 'undefined') {
          localStorage.removeItem('sovereign-auth');
        }
      },

      setMfaRequired: (required: boolean) => set({ mfaRequired: required }),
    }),
    {
      name: 'sovereign-auth',
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        // อย่า mutate state ตรง ๆ แล้วเงียบ — zustand v4 persist เรียก callback นี้
        // หลัง set() แล้ว การ mutate ตรง ๆ ไม่ notify subscriber → หน้าแรกอาจค้าง
        // "Loading..."/"Unauthorized" ตลอดไป (โดยเฉพาะเครื่องช้า/คอมไพล์ช้า)
        // ต้อง setState จริงเพื่อให้ทุกหน้าที่ subscribe รีเรนเดอร์ตามสถานะใหม่
        const next: Partial<AuthState> = { isHydrated: true, token: state?.token ?? null };
        if (next.token) {
          const payload = decodeJwt(next.token);
          if (payload && Date.now() < payload.exp * 1000) {
            if (!payload.mfa_verified) {
              next.isAuthenticated = false;
              next.user = null;
              next.mfaRequired = true;
            } else {
              next.isAuthenticated = true;
              next.user = {
                id: payload.userId,
                role: payload.role,
                assigned_node_id: payload.assigned_node_id,
                username: '',
              };
              next.mfaRequired = false;
            }
          } else {
            next.token = null;
          }
        }
        useAuthStore.setState(next);
      },
    }
  )
);