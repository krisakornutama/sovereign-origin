// ─────────────────────────────────────────────────────────────
//  useLanguageStore — ภาษาไทย/อังกฤษ (ค่าเริ่มต้น: ไทย)
//  ใช้ t(path, fallback?, vars?) แทนข้อความฮาร์ดโค้ด:
//    t('common.save')                              → "บันทึก" / "Save"
//    t('energy.daysLeft', 'อีก 3 วัน', { n: 3 })   → "อีก 3 วัน" / "3 days left"
//  fallback: en → th → fallback param → ชื่อ key สุดท้าย
//
//  ⚠️ Hydration: server เรนเดอร์ไทยเสมอ (store default) — client ต้อง
//  เรนเดอร์ไทยในรอบแรกให้ตรงกัน ภาษา 'en' ที่อ่านจาก localStorage
//  จะถูกใช้หลัง document.documentElement.dataset.langReady='1'
//  (ตั้งที่ _app หลัง mount) เท่านั้น กัน React hydration error
// ─────────────────────────────────────────────────────────────
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import th from '../i18n/th';
import en from '../i18n/en';

export type Lang = 'th' | 'en';

type Dict = Record<string, unknown>;

/** คีย์ที่เคยเตือนแล้ว (dev เท่านั้น) — กันสแปม console */
const warnedKeys = new Set<string>();

function lookup(dict: Dict, path: string): string | null {
  let cur: unknown = dict;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Dict)[part];
  }
  return typeof cur === 'string' ? cur : null;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** จริงเฉพาะหลัง React mount เสร็จ (ดู _app.tsx) — กัน hydration mismatch */
function langReady(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.dataset.langReady === '1'
  );
}

interface LanguageState {
  lang: Lang;
  isHydrated: boolean;
  setLang: (lang: Lang) => void;
  t: (path: string, fallback?: string, vars?: Record<string, string | number>) => string;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set, get) => ({
      lang: 'th',
      isHydrated: false,
      setLang: (lang: Lang) => {
        set({ lang });
        if (typeof document !== 'undefined') {
          document.documentElement.lang = lang === 'th' ? 'th' : 'en';
        }
      },
      t: (path, fallback, vars) => {
        const { lang, isHydrated } = get();
        // ยังไม่ mount เสร็จ (รวม SSR) → ใช้ไทยเสมอ ให้ตรงกับ HTML ที่ server ส่งมา
        const effective: Lang = langReady() && isHydrated ? lang : 'th';
        const dict: Dict = effective === 'th' ? th : en;
        const otherDict: Dict = dict === th ? en : th;
        const primary = lookup(dict, path);
        const secondary = lookup(otherDict, path);
        const str = primary ?? secondary ?? fallback ?? path.split('.').pop() ?? path;
        // dev: เตือนเมื่อคีย์ไม่พบในพจนานุกรมทั้ง 2 ภาษา (ทีละคีย์ กันสแปม console)
        if (process.env.NODE_ENV !== 'production' && !primary && !secondary && !warnedKeys.has(path)) {
          warnedKeys.add(path);
          console.warn(`[i18n] Missing key "${path}"${fallback ? ' — กำลังใช้ fallback' : ''}`);
        }
        return interpolate(str, vars);
      },
    }),
    {
      name: 'sovereign-lang',
      partialize: (s) => ({ lang: s.lang }),
      // กัน store ค้างจากค่าใน localStorage ตอน module init (เหมือน auth store)
      // → ต้อง rehydrate เอง (_app หลัง mount + timeout ต่อสำเนา) ภาษา 'en'
      // จึงจะเริ่มใช้หลัง langReady เป็นจริงเท่านั้น
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        useLanguageStore.setState({
          lang: state?.lang === 'en' ? 'en' : 'th',
          isHydrated: true,
        });
      },
    }
  )
);

// แต่ละ bundle/page (Turbopack dev) ได้สำเนา store ตัวเอง — ต้อง rehydrate
// ทุกสำเนา ไม่งั้นบางหน้าติดภาษาไทยแม้ตั้งค่าเป็นอังกฤษไว้
if (typeof window !== 'undefined') {
  setTimeout(() => {
    Promise.resolve(useLanguageStore.persist.rehydrate()).catch(() => {
      /* ไม่มี state ให้ hydrate — ไม่เป็นไร */
    });
  }, 0);
}