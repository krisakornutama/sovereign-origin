import { JwtPayload } from '../types';

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    // JWT payload เป็น base64url ที่ไม่เติม padding — atob จะ throw ถ้าความยาว % 4 != 0
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const jsonPayload = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}