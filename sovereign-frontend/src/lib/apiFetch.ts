import { useAuthStore } from '../stores/useAuthStore';
import { getApiUrl } from './config';
import { newRequestId } from './requestId';

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
  // ทุกคำขอมีเลขประจำตัว → backend log เลขเดียวกัน (trace ข้าม frontend → API)
  // อย่าทับของที่ caller ตั้งมาเอง (เผื่อส่งต่อ id จากคำขอเดิม)
  const requestId = headers['x-request-id'] || headers['X-Request-Id'] || newRequestId();
  headers['x-request-id'] = requestId;

  // แทนที่ origin ของ url ด้วย API URL ที่ผู้ใช้ตั้งค่า (ถ้ามี override)
  const apiUrl = getApiUrl();
  const finalUrl = /^https?:\/\//.test(url) ? url.replace(/^https?:\/\/[^/]+/, apiUrl) : url;

  const res = await fetch(finalUrl, { ...options, headers });

  if (res.status === 401) {
    const hadToken = Boolean(token);
    // token หมดอายุ หรือถูก logout ไปแล้ว → ล้าง session และกลับหน้า login (/)
    // ใช้ logoutLocal: token นี้ถูกปฏิเสธแล้ว ไม่ต้องยิง /logout ซ้ำ
    useAuthStore.getState().logoutLocal();
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