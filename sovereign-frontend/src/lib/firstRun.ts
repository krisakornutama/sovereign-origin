// ─────────────────────────────────────────────────────────────────────────────
// firstRun — ความจำว่า "ผู้ใช้คนนี้เห็นหน้าเริ่มใช้งานแล้วหรือยัง"
//
// ทำไมต้องมี: คนในบ้านล็อกอินครั้งแรกแล้วเจอ dashboard ที่มีเมนูเต็มไปหมด
// ไม่รู้จะเริ่มตรงไหน ⇒ ครั้งแรกพาไปหน้า /start (เช็กลิสต์ 5 ขั้น) ครั้งต่อไปพา /dashboard
//
// ไฟล์นี้ต้องไม่ import React/store เพื่อให้เทสต์เรียก nextPathAfterLogin() ได้ตรง ๆ
// ─────────────────────────────────────────────────────────────────────────────

/** ตั้งเป็น '1' เมื่อผู้ใช้เห็นหน้าเริ่มใช้งานแล้ว (ครั้งต่อไปไม่ต้องพาไปอีก) */
export const FIRST_RUN_KEY = 'sovereign.firstRunSeen';

/** เก็บ id ของขั้นตอนที่ทำแล้ว (JSON array) */
export const FIRST_RUN_STEPS_KEY = 'sovereign.firstRunSteps';

export interface LandingInput {
  mustChangePassword?: boolean;
  firstRunSeen?: boolean;
}

/**
 * ตัดสินใจว่าจะพาผู้ใช้ไปไหนหลังล็อกอินสำเร็จ
 * ลำดับความสำคัญ: เปลี่ยนรหัสก่อน (บังคับ) → หน้าเริ่มใช้งาน (ครั้งแรก) → dashboard
 */
export function nextPathAfterLogin(input: LandingInput): string {
  if (input.mustChangePassword) return '/change-password';
  if (!input.firstRunSeen) return '/start';
  return '/dashboard';
}

/** อ่านธง "เห็นแล้ว" จาก localStorage — SSR/ปิด storage = ถือว่าเห็นแล้ว (ไม่พาไปหน้าเริ่มใช้งาน) */
export function hasSeenFirstRun(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true;
    return window.localStorage.getItem(FIRST_RUN_KEY) === '1';
  } catch {
    return true;
  }
}

/** จำว่าเห็นแล้ว (เรียกเมื่อผู้ใช้ข้าม/ทำครบ/กดเริ่มขั้นแรก) */
export function markFirstRunSeen(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(FIRST_RUN_KEY, '1');
  } catch {
    /* storage ถูกปิด (private mode) — ไม่เป็นไร แค่จะเห็นหน้าเริ่มใช้งานอีกครั้ง */
  }
}

/** ทางไปต่อหลังล็อกอิน (อ่าน storage จริง) — ใช้จาก LoginForm/MfaInput */
export function loginLandingPath(mustChangePassword: boolean): string {
  return nextPathAfterLogin({ mustChangePassword, firstRunSeen: hasSeenFirstRun() });
}

/** ขั้นตอนที่ทำแล้ว (ใช้ในหน้า /start) */
export function readDoneSteps(): string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(FIRST_RUN_STEPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** บันทึกขั้นตอนที่ทำแล้ว (ใช้ในหน้า /start) */
export function writeDoneSteps(ids: string[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(FIRST_RUN_STEPS_KEY, JSON.stringify(ids));
  } catch {
    /* ไม่เป็นไร — แค่ไม่จำความคืบหน้า */
  }
}
