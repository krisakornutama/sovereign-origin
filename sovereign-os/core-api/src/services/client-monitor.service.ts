// src/services/client-monitor.service.ts
// ── Client Error Monitoring (จุดบอดของ uptime แบบ server-only) ──
// ความยาวเคสจริง: server เขียว 100% แต่ลูกค้าพังที่ WebView/in-app browser เงียบ ๆ
// ตัวนี้รับ error จาก browser ของผู้ใช้ (window.onerror / unhandledrejection /
// fetch fail / SW fail) → log เข้า SecurityEvent + SSE → alert Telegram เมื่อ error เดิม
// โดนซ้ำพอ (dedup ทำใน telegram dispatcher, threshold ทำที่นี่)
//
// Pattern เดียวกับ system-monitor.service.ts: pure functions แยกเทสได้ + fire-and-forget
import { prisma } from '../lib/prisma';
import { securityStream } from './security-stream.service';
import { sendTelegramAlert } from './telegram-alert.service';

// ── ตัวควบคุมสัญญาณกวน (env ปรับได้ ตาม convention ของ repo) ──
const MAX_META_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 1000;
const ALERT_THRESHOLD = parseInt(process.env.CLIENT_ERROR_ALERT_THRESHOLD || '3', 10);
const ALERT_WINDOW_MS = parseInt(process.env.CLIENT_ERROR_ALERT_WINDOW_MS || '300000', 10); // 5 นาที
const MAX_FINGERPRINTS = 200;

export interface ClientErrorPayload {
  message?: unknown;
  stack?: unknown;
  source?: unknown;
  line?: unknown;
  column?: unknown;
  page?: unknown;
  [key: string]: unknown;
}

export interface NormalizedClientError {
  message: string;
  stack: string;
  source: string;
  line: number;
  column: number;
  page: string;
  kind: string; // js | promise | resource | fetch | capability | synthetic | unknown
  ua: string;
  isWebView: boolean;
}

// ── Pure helpers (เทสได้ไม่ต้อง DB) ──

/** ทุก field ต้องเป็น string/number — payload มาจาก internet อย่าเชื่อ */
function boundedString(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  return s.slice(0, max);
}

/** UA เป็น key จัดกลุ่มแบบคร่าว ๆ พอไหว — ไม่ต้องเป๊ะระดับ device atlas */
export function extractBrowser(ua: string): string {
  if (!ua) return 'unknown';
  if (/Line\//i.test(ua)) return 'LINE WebView';
  if (/FBAV|FBIOS/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/CriOS/i.test(ua)) return 'Chrome iOS';
  if (/FxiOS/i.test(ua)) return 'Firefox iOS';
  if (/EdgiOS|Edg\//i.test(ua)) return 'Edge';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/iPhone|iPad/i.test(ua)) return 'iOS Safari';
  if (/Android/i.test(ua)) return 'Android Browser';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Other';
}

/** in-app browser = ที่ที่ bootstrap มักพังแบบเงียบ (localStorage/SW/crypto) */
export function isWebViewUa(ua: string): boolean {
  if (!ua) return false;
  return /Line\/|FBAV|FBIOS|Instagram|wv\)| Snapchat|Twitterbot|TelegramBot/i.test(ua);
}

/** กลุ่ม error ที่ "เดาได้ว่าพังตรงไหน" — ให้ fingerprint นับรวมถูกเคสเดียวกัน */
export function errorFingerprint(message: string, source: string, page: string): string {
  const key = `${message}|${source}|${page}`
    .toLowerCase()
    .replace(/https?:\/\/[^\s|]+/g, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
  return key;
}

/** normalize payload จาก beacon → รูปที่เก็บ/แสดงได้ปลอดภัย */
export function normalizeClientError(payload: ClientErrorPayload, ua = ''): NormalizedClientError {
  return {
    message: boundedString(payload.message, MAX_MESSAGE_LENGTH) || 'unknown client error',
    stack: boundedString(payload.stack, 3000),
    source: boundedString(payload.source, MAX_META_LENGTH),
    line: Number.isFinite(Number(payload.line)) ? Number(payload.line) : 0,
    column: Number.isFinite(Number(payload.column)) ? Number(payload.column) : 0,
    page: boundedString(payload.page, MAX_META_LENGTH) || '/',
    kind: boundedString(payload.kind, 20) || 'unknown',
    ua: boundedString(ua, 300),
    isWebView: isWebViewUa(ua),
  };
}

/** นับต่อ fingerprint ใน window — คืน "ขึ้น threshold พอดีครั้งนี้" เพื่อยิง alert รอบเดียว */
export function shouldAlert(
  counts: Map<string, number[]>,
  fingerprint: string,
  now = Date.now(),
  threshold = ALERT_THRESHOLD,
  windowMs = ALERT_WINDOW_MS
): boolean {
  const cutoff = now - windowMs;
  const list = (counts.get(fingerprint) || []).filter((t) => t >= cutoff);
  list.push(now);
  counts.set(fingerprint, list);
  if (counts.size > MAX_FINGERPRINTS) {
    // เก็บ fingerprint ที่พึ่งเห็นล่าสุดไว้ 200 กลุ่มพอ — ตัวเก่า drop (เรียงตาม timestamp ล่าสุด)
    const oldest = [...counts.entries()]
      .sort((a, b) => a[1][a[1].length - 1] - b[1][b[1].length - 1])
      .slice(0, counts.size - MAX_FINGERPRINTS);
    for (const [k] of oldest) counts.delete(k);
  }
  return list.length === threshold;
}

// ── Singleton + IO (เทส mock ผ่าน route ไม่ได้ — ทดสอบที่ pure functions) ──
export interface ClientErrorReport {
  stored: boolean;
  alerted: boolean;
}

class ClientMonitor {
  private counters = new Map<string, number[]>();

  async report(payload: ClientErrorPayload, ua = ''): Promise<ClientErrorReport> {
    const normalized = normalizeClientError(payload, ua);
    const fingerprint = errorFingerprint(normalized.message, normalized.source, normalized.page);

    // 1) log กลาง — SecurityEvent (ตารางเดียวกับที่ system-monitor ใช้) + SSE ให้ dashboard เห็นทันที
    let stored = false;
    try {
      await prisma.securityEvent.create({
        data: {
          event_type: 'CLIENT_ERROR',
          severity: 'warning',
          description: `[client] ${normalized.message}`,
          raw_data: {
            source: 'client-monitor',
            page: normalized.page,
            browser: extractBrowser(normalized.ua),
            isWebView: normalized.isWebView,
            errorSource: normalized.source,
            kind: normalized.kind,
            line: normalized.line,
            column: normalized.column,
            stack: normalized.stack || undefined,
          },
        },
      });
      stored = true;
    } catch {
      // DB พัง = ยังต้อง alert ถ้าถึงเกณฑ์ (นี่คือเคสที่ต้องรู้กันเป๊ะ ๆ)
    }

    // 2) alert เมื่อ error เดิมโดนซ้ำพอใน window (threshold ป้องกัน bot/noise ยิงเตือนรัว)
    const shouldAlertNow = shouldAlert(this.counters, fingerprint);
    if (shouldAlertNow) {
      const count = (this.counters.get(fingerprint) || []).length;
      const browser = extractBrowser(normalized.ua);
      const where = normalized.isWebView ? `${browser} (in-app/WebView)` : browser;
      securityStream.push('SYSTEM', {
        event: 'CLIENT_ERROR',
        severity: 'warning',
        text: `[client] ${normalized.message}`,
        at: new Date().toISOString(),
      });
      sendTelegramAlert({
        text:
          `🌐 ลูกค้าเจอ error ซ้ำ ${count} ครั้งใน 5 นาที\n` +
          `หน้า: ${normalized.page}\n` +
          `เบราว์เซอร์: ${where}\n` +
          `ผิดพลาด: ${normalized.message}`,
        severity: 'warn',
        eventKey: `client-error:${fingerprint}`,
      }).catch(() => {});
    }

    return { stored, alerted: shouldAlertNow };
  }

  /** เทสต์เรียกเคลียร์ state ระหว่างชุดเทส */
  resetCounters(): void {
    this.counters.clear();
  }
}

export const clientMonitor = new ClientMonitor();

// ── Client Health Summary — สำหรับแผง Client Health (หน้า /system) ──

export interface ClientHealthEventRow {
  timestamp: Date;
  description: string;
  raw_data: unknown;
}

export interface ClientHealthSummary {
  days: number;
  total: number;
  webviewCount: number;
  byBrowser: Array<{ key: string; count: number }>;
  byPage: Array<{ key: string; count: number }>;
  byKind: Array<{ key: string; count: number }>;
  topErrors: Array<{ message: string; count: number; lastAt: string }>;
  daily: Array<{ date: string; count: number }>;
}

/** นับกลุ่ม → เรียงมากไปน้อย */
export function tally(entries: Array<[string, number]>): Array<{ key: string; count: number }> {
  return [...entries]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * รวม SecurityEvent (event_type=CLIENT_ERROR) เป็นสรุปตาม browser/หน้า/ชนิด + กราฟต่อวัน
 * pure function — เทสได้ไม่ต้อง DB (วันที่กรอกเป็น UTC YYYY-MM-DD)
 */
export function aggregateClientHealth(events: ClientHealthEventRow[], days = 7): ClientHealthSummary {
  const browserCounts = new Map<string, number>();
  const pageCounts = new Map<string, number>();
  const kindCounts = new Map<string, number>();
  const errorCounts = new Map<string, { count: number; lastAt: Date | string }>();
  const dayCounts = new Map<string, number>();
  let webviewCount = 0;

  for (const e of events) {
    const raw = (typeof e.raw_data === 'object' && e.raw_data !== null ? e.raw_data : {}) as Record<string, unknown>;
    const browser = boundedString(raw.browser, 40) || 'unknown';
    const page = boundedString(raw.page, MAX_META_LENGTH) || '/';
    const kind = boundedString(raw.kind, 20) || 'unknown';
    browserCounts.set(browser, (browserCounts.get(browser) || 0) + 1);
    pageCounts.set(page, (pageCounts.get(page) || 0) + 1);
    kindCounts.set(kind, (kindCounts.get(kind) || 0) + 1);
    if (raw.isWebView === true) webviewCount++;

    const message = e.description.replace(/^\[client\]\s*/, '').slice(0, 120) || 'unknown';
    const prev = errorCounts.get(message);
    errorCounts.set(message, {
      count: (prev?.count || 0) + 1,
      lastAt: new Date(prev?.lastAt || 0) > new Date(e.timestamp) ? prev?.lastAt || e.timestamp : e.timestamp,
    });

    const ts = e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp);
    const day = Number.isNaN(ts.getTime()) ? 'unknown' : ts.toISOString().slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }

  // กราฟ: ครบทุกวัน (วันไหนไม่มี error = 0) เรียงเก่า → ใหม่
  const daily: Array<{ date: string; count: number }> = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    daily.push({ date: d, count: dayCounts.get(d) || 0 });
  }

  return {
    days,
    total: events.length,
    webviewCount,
    byBrowser: tally([...browserCounts.entries()]),
    byPage: tally([...pageCounts.entries()]).slice(0, 10),
    byKind: tally([...kindCounts.entries()]),
    topErrors: [...errorCounts.entries()]
      .map(([message, v]) => {
        const d = new Date(v.lastAt);
        return { message, count: v.count, lastAt: Number.isNaN(d.getTime()) ? '' : d.toISOString() };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    daily,
  };
}

/** ดึงสรุปจาก DB — ใช้โดย GET /api/system/client-health */
export async function getClientHealthSummary(days = 7): Promise<ClientHealthSummary> {
  const since = new Date(Date.now() - days * 86400000);
  const events = await prisma.securityEvent.findMany({
    where: { event_type: 'CLIENT_ERROR', timestamp: { gte: since } },
    select: { timestamp: true, description: true, raw_data: true },
    orderBy: { timestamp: 'desc' },
    take: 5000,
  });
  return aggregateClientHealth(events as ClientHealthEventRow[], days);
}
