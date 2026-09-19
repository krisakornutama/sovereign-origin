// src/lib/clientErrorReporter.ts
// ── Client Error Reporter — ปิดจุดบอด "server เขียวแต่ลูกค้าพัง" ──
// เคสจริง: ลูกค้ากดลิงก์จาก LINE เข้า WebView แล้วหน้าค้าง — server monitoring ไม่เห็นอะไรเลย
// เพราะ error เกิดใน browser ก่อน request จะถึง API เสมอ ตัวนี้ติดตั้งครั้งเดียวตอน app mount
// แล้วจับ error ทุกประเภท (JS throw / promise reject / resource โหลดพัง / fetch fail)
// ส่งเข้า API ด้วย navigator.sendBeacon (ยิงแล้วไม่รอ — รอดทั้งตอนหน้ากำลังตาย/unload)
//
// ปลอดภัยกับ environment พัง ๆ: ตัว reporter เองต้องไม่มีวัน throw ไม่ว่า localStorage/
// sendBeacon/API จะใช้ไม่ได้ (WebView เก่า ๆ มักปิดของพวกนี้ — นั่นแหละเคสที่ต้องจับ)
// ทุกอย่าง fire-and-forget + dedup ข้ามหน้า + ล้างตอนนำทาง เพื่อไม่ราวกัน error เดิม
// ตามกด F5 ก็เตือนซ้ำรัว ๆ (ฝั่ง server มี dedup/rate-limit อีกชั้น)
import { getApiUrl } from './config';

const REPORT_PATH = '/api/client-monitor/error';
const MAX_QUEUE = 10; // กัน storm: ส่งได้ไม่เกิน 10 error ต่อ 1 หน้า (เกินแล้ว drop เงียบ ๆ)
const MAX_BODY_BYTES = 8000; // กัน payload ยักษ์ (beacon หลาย UA จำกัดตัวเองที่ ~64KB อยู่แล้ว)

interface ErrorReport {
  message: string;
  stack: string;
  source: string;
  line: number;
  column: number;
  page: string;
  kind: string; // js | promise | resource | fetch
}

let sentCount = 0;
let sentKeys = new Set<string>();
let installed = false;

/** string ที่ปลอดภัยแม้เรียกจาก context พัง ๆ */
function safeString(v: unknown, max = 1000): string {
  try {
    if (v == null) return '';
    if (typeof v === 'string') return v.slice(0, max);
    if (v instanceof Error) return `${v.name}: ${v.message}`.slice(0, max);
    return String(v).slice(0, max);
  } catch {
    return '';
  }
}

function currentPage(): string {
  try {
    return window.location.pathname || '/';
  } catch {
    return '/';
  }
}

/** key กันส่งซ้ำ — ตัดเลข/uuid ออกให้ error เดิม (ต่าง line นิดเดียว) นับเป็นอันเดียวกัน */
function dedupeKey(r: ErrorReport): string {
  return `${r.kind}|${r.message}|${r.source}`.replace(/\d+/g, 'N');
}

function send(report: ErrorReport): void {
  try {
    if (sentCount >= MAX_QUEUE) return;
    const key = dedupeKey(report);
    if (sentKeys.has(key)) return;
    sentKeys.add(key);
    sentCount++;

    const body = JSON.stringify({
      ...report,
      message: safeString(report.message),
      stack: safeString(report.stack, 2500),
      page: currentPage(),
      ts: Date.now(),
    }).slice(0, MAX_BODY_BYTES);

    // sendBeacon ก่อนเสมอ (fire-and-forget, รอดตอน page unload) — ไม่มีค่อย fallback XHR
    const url = endpoint();
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(body);
    }
  } catch {
    // ห้ามมีวัน throw — เรากำลังจัดการกับ browser ที่พังอยู่แล้ว
  }
}

function endpoint(): string {
  try {
    return `${getApiUrl().replace(/\/$/, '')}${REPORT_PATH}`;
  } catch {
    return REPORT_PATH; // สัมพัทธ์ — ถ้า frontend โดมาจาก domain เดียวกับ API ก็ยังเข้า
  }
}

/** ติดตั้ง global listeners — เรียก 1 ครั้งจาก _app.tsx (idempotent) */
export function installClientErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  try {
    window.addEventListener('error', (e) => {
      // resource โหลดพัง (js/css/img) ไม่มี message — จับแยกเพราะ "chunk โหลดไม่ได้"
      // คือเคส SW ค้างหลัง deploy ใหม่ที่เจอบ่อยใน WebView ที่ไม่เคยปิด
      const target = e.target as HTMLElement | null;
      if (target && target !== (e.currentTarget as any) && (target as any).src !== undefined) {
        const el = target as HTMLImageElement & { src: string };
        send({ message: `resource load failed: ${el.tagName} ${el.src}`.slice(0, 300), stack: '', source: (target as any).src || '', line: 0, column: 0, page: currentPage(), kind: 'resource' });
        return;
      }
      send({
        message: safeString(e.message) || safeString((e.error as Error | undefined)?.message) || 'unknown error event',
        stack: safeString((e.error as Error | undefined)?.stack, 2500),
        source: safeString(e.filename, 300),
        line: typeof e.lineno === 'number' ? e.lineno : 0,
        column: typeof e.colno === 'number' ? e.colno : 0,
        page: currentPage(),
        kind: 'js',
      });
    }, true); // capture = จับ resource error ที่ bubble ถึง window ด้วย

    window.addEventListener('unhandledrejection', (e) => {
      const reason = (e as PromiseRejectionEvent).reason;
      send({
        message: `Unhandled promise rejection: ${safeString(reason, 800)}`,
        stack: reason instanceof Error ? safeString(reason.stack, 2500) : '',
        source: '',
        line: 0,
        column: 0,
        page: currentPage(),
        kind: 'promise',
      });
    });

    // SPA navigation = error เก่าควรล้าง (คนเริ่มกิจกรรมใหม่) — กัน dedup กลืน error จริง
    try {
      const router = (window as any).next?.router;
      if (router) {
        const clear = () => {
          sentKeys = new Set();
          sentCount = 0;
        };
        router.events?.on?.('routeChangeComplete', clear);
      }
    } catch {
      // ไม่มี router events = หน้า static อยู่ยาว — ที่จริง MAX_QUEUE ก็ป้องกันแล้ว
    }
  } catch {
    // แม้แต่ addEventListener พังก็ไม่ต้องทำอะไร — ปล่อยให้หน้าเว็บทำงานต่อ
  }
}

/** ต่อยอดให้ fetch ทุกตัวรายงานความล้มเหลว — เรียกครั้งเดียวพร้อม installClientErrorReporter */
export function installFetchFailureReporter(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  try {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      try {
        return await originalFetch(...args);
      } catch (err) {
        const url = safeString(args[0] instanceof Request ? args[0].url : args[0], 300);
        // เว้น beacon ตัวเอง — ไม่งั้น error วนกันตายไม่รู้จบ
        if (!url.includes('/api/client-monitor/')) {
          send({
            message: `fetch failed: ${safeString(err instanceof Error ? err.message : err, 300)} ${url}`.trim(),
            stack: err instanceof Error ? safeString(err.stack, 2500) : '',
            source: url,
            line: 0,
            column: 0,
            page: currentPage(),
            kind: 'fetch',
          });
        }
        throw err;
      }
    };
  } catch {
    // ห้ามทำ fetch ปกติพังตาม — ถ้า wrap ไม่ได้ก็ปล่อยผ่าน
  }
}

// ให้ route ที่ beacon ชี้ถูกต้องเวลา build ใช้ API URL กลาง (ประกาศจุดเดียว)
export const CLIENT_MONITOR_ENDPOINT = endpoint();
