// src/lib/capabilityGuard.ts
// ── Capability Guard — เช็กว่า browser นี้ "ใช้แอปได้จริงไหม" ตั้งแต่ตอนโหลด ──
// บทเรียนเคส LINE WebView: หน้าพังเงียบ ๆ ทั้งที่ server เขียว เพราะ environment
// ฝั่งลูกค้าขาดของที่แอปถือว่า "มีอยู่เสมอ" (localStorage ที่เขียนไม่ได้ใน private mode,
// crypto.subtle ที่หายไปนอก secure context, Service Worker ที่ WebView เก่าบล็อก)
// ตัวนี้ตรวจจริง (ไม่ใช่แค่ typeof) แล้ว:
//   1) รายงานเข้า /api/client-monitor/error ผ่าน sendClientErrorReport (kind: "capability")
//   2) คืนผลให้ CapabilityBanner แสดงคำแนะนำ "เปิดใน Chrome/Safari" เมื่อจำเป็น
// ห้าม throw ทุกกรณี — ตัวมันเองต้องรอดบน browser ที่พังที่สุดเท่าที่เจอ
import { sendClientErrorReport } from './clientErrorReporter';

export type CapabilityIssueKey = 'localStorage' | 'cryptoSubtle' | 'serviceWorker' | 'fetch';

export interface CapabilityIssue {
  key: CapabilityIssueKey;
  detail: string;
}

export interface CapabilityReport {
  ua: string;
  browser: string; // จำแนกคร่าว ๆ ฝั่ง client
  isWebView: boolean;
  ok: boolean; // ไม่มี issue ระดับบล็อกการใช้งาน
  issues: CapabilityIssue[];
}

/** จำแนก in-app browser ฝั่ง client (รูปแบบเดียวกับ extractBrowser ใน core-api) */
export function detectBrowserKind(ua: string): { browser: string; isWebView: boolean } {
  if (/Line\//i.test(ua)) return { browser: 'LINE WebView', isWebView: true };
  if (/FBAV|FBIOS/i.test(ua)) return { browser: 'Facebook', isWebView: true };
  if (/Instagram/i.test(ua)) return { browser: 'Instagram', isWebView: true };
  if (/CriOS/i.test(ua)) return { browser: 'Chrome iOS', isWebView: false };
  if (/FxiOS/i.test(ua)) return { browser: 'Firefox iOS', isWebView: false };
  if (/EdgiOS|Edg\//i.test(ua)) return { browser: 'Edge', isWebView: false };
  if (/SamsungBrowser/i.test(ua)) return { browser: 'Samsung Internet', isWebView: false };
  if (/Chrome/i.test(ua)) return { browser: 'Chrome', isWebView: false };
  if (/Firefox/i.test(ua)) return { browser: 'Firefox', isWebView: false };
  if (/iPhone|iPad/i.test(ua)) return { browser: 'iOS Safari', isWebView: false };
  if (/Android/i.test(ua)) return { browser: 'Android Browser', isWebView: false };
  if (/Safari/i.test(ua)) return { browser: 'Safari', isWebView: false };
  return { browser: 'Other', isWebView: false };
}

/** เขียนจริง + ลบจริง = ผ่าน (typeof check เดาไม่ได้กับ private mode/quota) */
function probeLocalStorage(): CapabilityIssue | null {
  try {
    const store = window.localStorage;
    if (!store || typeof store.setItem !== 'function' || typeof store.removeItem !== 'function') {
      return { key: 'localStorage', detail: 'API ไม่พร้อมใช้' };
    }
    store.setItem('sovereign-capability-probe', '1');
    const readBack = store.getItem('sovereign-capability-probe');
    store.removeItem('sovereign-capability-probe');
    if (readBack !== '1') return { key: 'localStorage', detail: 'เขียนแล้วอ่านกลับไม่ได้' };
    return null;
  } catch (err) {
    return { key: 'localStorage', detail: `throw: ${err instanceof Error ? err.name : 'unknown'}` };
  }
}

export function checkCapabilities(): CapabilityReport {
  const issues: CapabilityIssue[] = [];
  let ua = '';
  try {
    ua = navigator.userAgent || '';
  } catch {
    // ไม่มี UA ก็ยังเช็กของอื่นต่อได้
  }

  // 1) localStorage — Zustand persist ทั้งแอปพึ่งอยู่ (พัง = หน้าค้าง Loading ตลอดกาล)
  const lsIssue = probeLocalStorage();
  if (lsIssue) issues.push(lsIssue);

  // 2) crypto.subtle — ต้องมี secure context (https/localhost) — หาย = หน้า auth พังทั้งหน้า
  try {
    const subtle = (window as any).crypto?.subtle;
    if (!subtle || typeof subtle.digest !== 'function') {
      const secure = typeof window.isSecureContext === 'boolean' ? window.isSecureContext : null;
      issues.push({
        key: 'cryptoSubtle',
        detail: secure === false ? 'ไม่มี secure context (http ผ่าน IP/domain ตรง?)' : 'WebCrypto API ไม่พร้อมใช้',
      });
    }
  } catch {
    issues.push({ key: 'cryptoSubtle', detail: 'เรียก crypto.subtle แล้ว throw' });
  }

  // 3) Service Worker — ไม่มี = PWA/offline ใช้ไม่ได้ (เตือนระดับเตือน ไม่ใช่บล็อกหน้า)
  try {
    if (!('serviceWorker' in navigator)) {
      issues.push({ key: 'serviceWorker', detail: 'เบราว์เซอร์/WebView ไม่รองรับ' });
    }
  } catch {
    issues.push({ key: 'serviceWorker', detail: 'ตรวจ navigator.serviceWorker แล้ว throw' });
  }

  // 4) fetch — พื้นฐานสุดของการคุยกับ API
  try {
    if (typeof window.fetch !== 'function') {
      issues.push({ key: 'fetch', detail: 'ไม่มี window.fetch (WebView เก่ามาก)' });
    }
  } catch {
    issues.push({ key: 'fetch', detail: 'ตรวจ fetch แล้ว throw' });
  }

  const { browser, isWebView } = detectBrowserKind(ua);
  // บล็อก = ของที่แอปใช้ตอน bootstrap (localStorage/crypto/fetch) — SW ขาดแค่เสียฟีเจอร์ย่อย
  const blockingKeys: CapabilityIssueKey[] = ['localStorage', 'cryptoSubtle', 'fetch'];
  const ok = !issues.some((i) => blockingKeys.includes(i.key));

  return { ua, browser, isWebView, ok, issues };
}

/** รายงานเข้า API (beacon ผ่าน clientErrorReporter) — เครื่องปกติไม่ต้องรบกวน server */
export function reportCapabilities(report: CapabilityReport): void {
  try {
    if (report.issues.length === 0) return;
    sendClientErrorReport('capability', `capability issues: ${report.issues.map((i) => `${i.key}(${i.detail})`).join(', ')}`, {
      source: report.browser,
      ua: report.ua,
    });
  } catch {
    // รายงานไม่ได้ = ปล่อยผ่าน — banner ยังโชว์อยู่แล้ว
  }
}
