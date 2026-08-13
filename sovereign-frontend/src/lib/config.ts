// src/lib/config.ts
// ค่ากำหนดของผู้ใช้ที่เก็บใน localStorage (ตั้งจากหน้า /settings)
// ค่าเหล่านี้ override ค่า env (NEXT_PUBLIC_*) ตอน runtime โดยไม่ต้อง build ใหม่

const API_URL_KEY = 'sovereign-api-url';
const THEME_KEY = 'sovereign-theme';
const FONT_SCALE_KEY = 'sovereign-font-scale';

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

function getStored(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setStored(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // localStorage อาจไม่พร้อมใช้งาน (privacy mode ฯลฯ) – ignore
  }
}

// ---------- API URL (ใช้กับ WebSocket ด้วย) ----------

export function getApiUrl(): string {
  return getStored(API_URL_KEY)?.trim() || DEFAULT_API_URL;
}

export function getWsUrl(): string {
  return getStored(API_URL_KEY)?.trim() || DEFAULT_WS_URL;
}

export function setApiUrl(url: string | null): void {
  setStored(API_URL_KEY, url);
}

// ---------- ธีม ----------

export type Theme = 'dark' | 'light';

export function getTheme(): Theme {
  return getStored(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
  setStored(THEME_KEY, theme);
}

// ---------- ขนาดตัวอักษร ----------

export type FontScale = 'small' | 'normal' | 'large';

const FONT_SCALE_PX: Record<FontScale, string> = {
  small: '14px',
  normal: '16px',
  large: '18px',
};

export function getFontScale(): FontScale {
  const value = getStored(FONT_SCALE_KEY);
  return value === 'small' || value === 'large' ? value : 'normal';
}

export function setFontScale(scale: FontScale): void {
  setStored(FONT_SCALE_KEY, scale);
}

export function getFontScalePx(scale: FontScale): string {
  return FONT_SCALE_PX[scale];
}

// ---------- ใช้กับ UI ทุกหน้า ----------

export function applyAppearance(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = getTheme();
  document.documentElement.style.fontSize = getFontScalePx(getFontScale());
}

export function resetUserSettings(): void {
  setApiUrl(null);
  setTheme('dark');
  setFontScale('normal');
  applyAppearance();
}
