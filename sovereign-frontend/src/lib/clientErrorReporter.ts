// src/lib/clientErrorReporter.ts
// ── Client Error Reporter — ปิดจุดบอด "server เขียวแต่ลูกค้าพัง" ──
// เคสจริง: ลูกค้ากดลิงก์จาก LINE เข้า WebView แล้วหน้าค้าง — server monitoring ไม่เห็นอะไรเลย
// เพราะ error เกิดใน browser ก่อน request จะถึง API เสมอ ตัวนี้ติดตั้งครั้งเดียวตอน app mount
// จับ error ทุกประเภท (JS throw / promise reject / resource โหลดพัง / fetch fail / capability
// ที่มาจาก capabilityGuard) แล้วส่งเข้า API ด้วย navigator.sendBeacon (รอดทั้งตอนหน้ากำลังตาย)
//
// ปลอดภัยกับ environment พัง ๆ: ตัว reporter เองห้าม throw (WebView เก่า ๆ มักปิดของพวกนี้ —
// นั่นแหละเคสที่ต้องจับ) ทุกอย่าง fire-and-forget + dedup ในหน้า (ฝั่ง server มี dedup/rate-limit อีกชั้น)
import { getApiUrl } from './config';

const REPORT_PATH = '/api/client-monitor/error';
const MAX_SENDS_PER_PAGE = 10; // กัน storm: ส่งได้ไม่เกิน 10 ครั้งต่อ 1 หน้า (เกินแล้ว drop เงียบ ๆ)
const MAX_BODY_BYTES = 8000; // กัน payload ยักษ์ (beacon หลาย UA จำกัดตัวเองที่ ~64KB อยู่แล้ว)

let sentCount = 0;
const sentKeys = new Set<string>();
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

function endpoint(): string {
  try {
    return `${getApiUrl().replace(/\/$/, '')}${REPORT_PATH}`;
  } catch {
    return REPORT_PATH; // สัมพัทธ์ — ถ้า frontend โดมาจาก domain เดียวกับ API ก็ยังเข้า
  }
}

/** key กันส่งซ้ำ — ตัดเลขออกให้ error เดิม (ต่าง line นิดเดียว) นับเป็นอันเดียวกัน */
function dedupeKey(kind: string, message: string, source: string): string {
  return `${kind}|${message}|${source}`.replace(/\d+/g, 'N');
}

interface SendOptions {
  stack?: unknown;
  source?: unknown;
  line?: number;
  column?: number;
  ua?: string;
}

/** จุดส่งเดียวของทั้งแอป — beacon (fire-and-forget) + dedup + cap ต่อหน้า */
export function sendClientErrorReport(kind: string, message: string, opts: SendOptions = {}): void {
  try {
    if (sentCount >= MAX_SENDS_PER_PAGE) return;
    const msg = safeString(message);
    const source = safeString(opts.source, 300);
    const key = dedupeKey(kind, msg, source);
    if (sentKeys.has(key)) return;
    sentKeys.add(key);
    sentCount++;

    const body = JSON.stringify({
      kind,
      message: msg,
      stack: safeString(opts.stack, 2500),
      source,
      line: typeof opts.line === 'number' ? opts.line : 0,
      column: typeof opts.column === 'number' ? opts.column : 0,
      page: currentPage(),
      ua: safeString(opts.ua, 300),
      ts: Date.now(),
    }).slice(0, MAX_BODY_BYTES);

    // sendBeacon ก่อนเสมอ (รอดตอน page unload) — ไม่มีค่อย fallback XHR
    // ห้ามใช้ Blob type application/json: beacon ข้าม origin ทำ CORS-preflight ไม่ได้
    // → browser ทิ้งเงียบ ๆ (เจอจากการทดสอบ UI จริง) — text/plain เป็น safelisted จึงส่งได้เสมอ
    const url = endpoint();
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
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

/** ติดตั้ง global listeners ทั้งหมด — เรียก 1 ครั้งจาก _app.tsx (idempotent) */
export function installClientErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  try {
    window.addEventListener('error', (e) => {
      // resource โหลดพัง (js/css/img) ไม่มี message — จับแยกเพราะ "chunk โหลดไม่ได้"
      // คือเคส SW ค้างหลัง deploy ใหม่ที่เจอบ่อยใน WebView ที่ไม่เคยปิด
      const target = e.target as (HTMLElement & { src?: string }) | null;
      if (target && target !== e.currentTarget && typeof target.src === 'string') {
        sendClientErrorReport('resource', `resource load failed: ${target.tagName} ${target.src}`.slice(0, 300), { source: target.src });
        return;
      }
      const err = e.error as Error | undefined;
      sendClientErrorReport('js', safeString(e.message) || safeString(err?.message) || 'unknown error event', {
        stack: err?.stack,
        source: e.filename,
        line: typeof e.lineno === 'number' ? e.lineno : 0,
        column: typeof e.colno === 'number' ? e.colno : 0,
      });
    }, true); // capture = จับ resource error ที่ bubble ถึง window ด้วย

    window.addEventListener('unhandledrejection', (e) => {
      const reason = (e as PromiseRejectionEvent).reason;
      sendClientErrorReport('promise', `Unhandled promise rejection: ${safeString(reason, 800)}`, {
        stack: reason instanceof Error ? reason.stack : '',
      });
    });

    // fetch fail ทุกตัวรายงานด้วย (wrap แล้ว throw ต่อเหมือนเดิม ไม่เปลี่ยนพฤติกรรม app)
    if (typeof window.fetch === 'function') {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        try {
          return await originalFetch(...args);
        } catch (err) {
          const url = safeString(args[0] instanceof Request ? args[0].url : args[0], 300);
          // เว้น beacon ตัวเอง — ไม่งั้น error วนกันตายไม่รู้จบ
          if (!url.includes(REPORT_PATH)) {
            sendClientErrorReport('fetch', `fetch failed: ${safeString(err instanceof Error ? err.message : err, 300)} ${url}`.trim(), {
              stack: err instanceof Error ? err.stack : '',
              source: url,
            });
          }
          throw err;
        }
      };
    }
  } catch {
    // แม้แต่ addEventListener พังก็ไม่ต้องทำอะไร — ปล่อยให้หน้าเว็บทำงานต่อ
  }
}
