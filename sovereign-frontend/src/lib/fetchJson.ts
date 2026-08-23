import { authFetch } from './apiFetch';

// ────────────────────────────────────────────────────────────────────────────
// fetchJson — ดึงข้อมูลจาก API พร้อมการันตีรูปร่างก่อนเข้า state
//
// ปัญหาที่แก้: หน้าจำนวนมากเคยยัด `await res.json()` เข้า state ตรงๆ เมื่อ backend
// ตอบ 500/403 กลับมาเป็น `{error: ...}` แทน array → state กลายเป็น object →
// หน้าพังตอน render (`xxx.map is not a function` — เคยเกิดจริงที่หน้า OTA)
//
// ใช้: `setItems(await fetchJsonArray(url))` — ไม่ว่า backend จะตอบอะไร
// ได้กลับมาแค่ array เสมอ (ผิดปกติ = []) เช่นเดียวกับ object ที่ได้แค่ object หรือ null
// ────────────────────────────────────────────────────────────────────────────

/** GET ที่คาดผลลัพธ์เป็น array — ตอบ [] เสมอเมื่อ request ล้มหรือได้ค่าผิดรูป */
export async function fetchJsonArray<T = any>(url: string): Promise<T[]> {
  try {
    const res = await authFetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** GET ที่คาดผลลัพธ์เป็น object เดี่ยว — ตอบ null เมื่อ request ล้มหรือได้ค่าผิดรูป */
export async function fetchJsonObject<T = any>(url: string): Promise<T | null> {
  try {
    const res = await authFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** ครอบค่าที่เพิ่ง `res.json()` มาแล้วจะเข้า state ที่ render ด้วย .map — กัน array ปลอม */
export function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

/** ครอบค่า object ที่เพิ่ง `res.json()` มา — ไม่ใช่ object = null */
export function asObject<T = any>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
}
