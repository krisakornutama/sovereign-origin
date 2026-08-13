import { useAuthStore } from '../stores/useAuthStore';
import { getApiUrl } from './config';

/**
 * authFetch – fetch wrapper ที่แนบ token และ handle 401 โดย logout
 * ใช้ API URL จากหน้า Settings (override) ถ้ามีการตั้งค่าไว้
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers: any = { ...options.headers };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // แทนที่ origin ของ url ด้วย API URL ที่ผู้ใช้ตั้งค่า (ถ้ามี override)
  const apiUrl = getApiUrl();
  const finalUrl = /^https?:\/\//.test(url) ? url.replace(/^https?:\/\/[^/]+/, apiUrl) : url;

  const res = await fetch(finalUrl, { ...options, headers });

  if (res.status === 401) {
    const hadToken = Boolean(token);
    // token หมดอายุ หรือถูก logout ไปแล้ว → ล้าง session และกลับหน้า login (/)
    useAuthStore.getState().logout();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/';
    }
    // ถ้ามี token แล้วโดน 401 = session หมดอายุจริง — บอก caller (ไม่ redirect ซ้ำ)
    // ถ้าไม่มี token = เพิ่ง logout ไปเอง — 401 ที่หลงเหลือเป็นเรื่องปกติ อย่า throw
    // (ไม่ให้หน้าเด้ง "Unauthorized" แดง ๆ ตอน logout)
    if (hadToken) throw new Error('Unauthorized');
    return res;
  }

  return res;
}