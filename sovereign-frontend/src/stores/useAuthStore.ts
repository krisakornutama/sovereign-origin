import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { JwtPayload, UserProfile } from '../types';
import { decodeJwt } from '../lib/jwt';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  user: UserProfile | null;
  mfaRequired: boolean;
  // true = ต้องเปลี่ยนรหัสผ่านก่อนเข้าใช้งาน (สมาชิกใหม่หลัง login ครั้งแรก / admin สั่ง)
  mustChangePassword: boolean;
  isHydrated: boolean;
  login: (token: string) => void;
  logout: () => void;
  setMfaRequired: (required: boolean) => void;
  setMustChangePassword: (required: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      isAuthenticated: false,
      user: null,
      mfaRequired: false,
      mustChangePassword: false,
      isHydrated: false,

      login: (token: string) => {
        const payload: JwtPayload = decodeJwt(token);
        if (!payload || Date.now() >= payload.exp * 1000) {
          set({ token: null, isAuthenticated: false, user: null, mfaRequired: false, mustChangePassword: false });
          return;
        }

        if (!payload.mfa_verified) {
          set({
            token,
            isAuthenticated: false,
            user: null,
            mfaRequired: true,
            mustChangePassword: false,
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
          mustChangePassword: !!payload.must_change_password,
        });
      },

      logout: () => {
        set({ token: null, isAuthenticated: false, user: null, mfaRequired: false, mustChangePassword: false });
        // เคลียร์ localStorage ทันที เพื่อให้แน่ใจว่าไม่เหลือ token ค้าง
        if (typeof window !== 'undefined') {
          localStorage.removeItem('sovereign-auth');
        }
      },

      setMfaRequired: (required: boolean) => set({ mfaRequired: required }),

      setMustChangePassword: (required: boolean) => set({ mustChangePassword: required }),
    }),
    {
      name: 'sovereign-auth',
      partialize: (state) => ({ token: state.token }),
      // ปิด auto-hydrate ตอน module init — บางโหลด (dev บนเครื่องช้า) มันค้างไม่จบ
      // → หน้าแรกติด "⏳ Loading..." ถาวร เราเรียก rehydrate() เองตอน _app mount แทน
      // (ดู sovereign-frontend/src/pages/_app.tsx) ซึ่งทำงานเสมอและแน่นอนกว่า
      skipHydration: true,
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
              next.mustChangePassword = false;
            } else {
              next.isAuthenticated = true;
              next.user = {
                id: payload.userId,
                role: payload.role,
                assigned_node_id: payload.assigned_node_id,
                username: '',
              };
              next.mfaRequired = false;
              next.mustChangePassword = !!payload.must_change_password;
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

// แต่ละ bundle/page ที่ import store นี้จะได้สำเนาของตัวเอง (Turbopack dev)
// → ต้องสั่ง rehydrate เองทุกสำเนา ไม่งั้นบางหน้ายังติด "⏳ Loading..."
// (ใช้ setTimeout เพื่อให้รันหลัง module eval จบ — auto-hydrate ตอน init เคยค้าง)
if (typeof window !== 'undefined') {
  setTimeout(() => {
    Promise.resolve(useAuthStore.persist.rehydrate()).catch(() => {
      /* ไม่มี state ให้ hydrate — ไม่เป็นไร */
    });
  }, 0);
}