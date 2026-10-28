// ─────────────────────────────────────────────────────────────────────────────
// actionableError — แปลง error ดิบ ๆ ให้เป็น "เกิดอะไร" + "ต้องทำอะไรต่อ"
//
// ปัญหาที่แก้: แต่ละหน้าเคยโชว์ error ดิบ ("Failed to fetch", "Unauthorized",
// "P2021") แล้วจบ — คนในบ้านอ่านแล้วไม่รู้ว่าต้องไปทำอะไร
//
// หลักการ: ข้อความ "fix" ต้องมีคำกริยาที่ลงมือทำได้ และต้องบอกช่องทางจริง
// (docker ps / docker logs / prisma:migrate / ล็อกอินใหม่ / โหลดใหม่)
//
// ไฟล์นี้ต้องไม่ import อะไรเลย เพื่อให้เทสต์เรียกได้ตรง ๆ ด้วย node --test
// (Node 24 รัน .ts ได้ด้วย type stripping) — ไม่ต้องมี React/store/เบราว์เซอร์
// ─────────────────────────────────────────────────────────────────────────────

export type Lang = 'th' | 'en';

export type ErrorKind =
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'rateLimited'
  | 'server'
  | 'dbNotReady'
  | 'badId'
  | 'badRequest'
  | 'unknown';

export interface ErrorHelp {
  kind: ErrorKind;
  /** เกิดอะไรขึ้น (สั้น อ่านรู้เรื่อง) */
  what: string;
  /** ต้องทำอะไรต่อ (ต้องมีขั้นตอน/คำกริยา) */
  fix: string;
  /** กด "ลองอีกครั้ง" เฉย ๆ มีโอกาสสำเร็จไหม */
  retryable: boolean;
}

const RETRYABLE: Record<ErrorKind, boolean> = {
  offline: true,
  unauthorized: false,
  forbidden: false,
  notFound: false,
  conflict: true,
  rateLimited: true,
  server: true,
  dbNotReady: false,
  badId: false,
  badRequest: false,
  unknown: true,
};

const MESSAGES: Record<ErrorKind, Record<Lang, { what: string; fix: string }>> = {
  offline: {
    th: {
      what: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้',
      fix: 'ตรวจว่า Docker รันอยู่ (docker ps) แล้วเปิด sovereign-core-api — ระบบจะลองใหม่เอง หรือกด "ลองอีกครั้ง"',
    },
    en: {
      what: 'Cannot reach the server',
      fix: 'Check that Docker is running (docker ps) and start sovereign-core-api — it retries automatically, or press "Try again"',
    },
  },
  unauthorized: {
    th: {
      what: 'เซสชันหมดอายุ',
      fix: 'ล็อกอินใหม่ด้วยบัญชีเดิม แล้วกลับมาทำรายการนี้ต่อ',
    },
    en: {
      what: 'Your session has expired',
      fix: 'Log in again with the same account, then continue what you were doing',
    },
  },
  forbidden: {
    th: {
      what: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
      fix: 'ใช้บัญชี ADMIN หรือขอสิทธิ์จากผู้ดูแลระบบที่เมนู "ผู้ใช้"',
    },
    en: {
      what: 'This account is not allowed to do that',
      fix: 'Use an ADMIN account or ask an administrator to grant access in the Users menu',
    },
  },
  notFound: {
    th: {
      what: 'ไม่พบข้อมูลที่เรียก',
      fix: 'ตรวจรหัส/ลิงก์ที่ใช้ แล้วโหลดหน้านี้ใหม่',
    },
    en: {
      what: 'The requested item was not found',
      fix: 'Check the code/link you used, then reload this page',
    },
  },
  conflict: {
    th: {
      what: 'ข้อมูลชนกันกับที่มีอยู่',
      fix: 'โหลดใหม่ (กดรีเฟรช) แล้วทำรายการอีกครั้ง',
    },
    en: {
      what: 'This conflicts with existing data',
      fix: 'Reload the latest data, then try again',
    },
  },
  rateLimited: {
    th: {
      what: 'ทำรายการถี่เกินไป',
      fix: 'รอตามเวลาที่ระบบแจ้ง (ราว 1 นาที) แล้วลองใหม่',
    },
    en: {
      what: 'Too many requests',
      fix: 'Wait for the time shown (about 1 minute), then try again',
    },
  },
  server: {
    th: {
      what: 'เซิร์ฟเวอร์ขัดข้อง',
      fix: 'ลองใหม่ในอีกสักครู่ — ถ้ายังไม่หาย ดู log: docker logs --tail 50 sovereign-core-api',
    },
    en: {
      what: 'The server hit an error',
      fix: 'Try again in a moment — if it persists, check logs: docker logs --tail 50 sovereign-core-api',
    },
  },
  dbNotReady: {
    th: {
      what: 'ฐานข้อมูลยังไม่พร้อม (ตาราง/โครงสร้างยังไม่มี)',
      fix: 'รัน migration ให้ครบ (npm run prisma:migrate) แล้วรีสตาร์ต sovereign-core-api',
    },
    en: {
      what: 'The database is not ready (missing tables)',
      fix: 'Run the pending migrations (npm run prisma:migrate), then restart sovereign-core-api',
    },
  },
  badId: {
    th: {
      what: 'รหัสอ้างอิงผิดรูปแบบ',
      fix: 'ตรวจ id ที่ส่งมา (ต้องเป็น UUID) แล้วทำรายการใหม่',
    },
    en: {
      what: 'The reference id is malformed',
      fix: 'Check the id you sent (must be a UUID), then submit again',
    },
  },
  badRequest: {
    th: {
      what: 'ข้อมูลที่ส่งไปไม่ถูกต้อง',
      fix: 'ตรวจช่องที่ระบบไฮไลต์/ข้อความเตือน แล้วแก้ให้ครบก่อนบันทึก',
    },
    en: {
      what: 'Some of the submitted data is invalid',
      fix: 'Check the highlighted fields and fix them before saving',
    },
  },
  unknown: {
    th: {
      what: 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
      fix: 'ลองอีกครั้ง — ถ้ายังไม่หาย เปิดเมนู "ตรวจสุขภาพระบบ" เพื่อดูสาเหตุ',
    },
    en: {
      what: 'Something unexpected went wrong',
      fix: 'Try again — if it persists, open System health to see the cause',
    },
  },
};

interface Normalized {
  status: number | null;
  code: string;
  message: string;
  name: string;
}

function normalize(input: unknown): Normalized {
  const out: Normalized = { status: null, code: '', message: '', name: '' };
  if (input == null) return out;
  if (typeof input === 'number' && Number.isFinite(input)) {
    out.status = input;
    return out;
  }
  if (typeof input === 'string') {
    out.message = input;
    return out;
  }
  if (input instanceof Error) {
    out.message = input.message || '';
    out.name = input.name || '';
    const anyErr = input as unknown as { status?: unknown; code?: unknown };
    if (typeof anyErr.status === 'number') out.status = anyErr.status;
    if (typeof anyErr.code === 'string') out.code = anyErr.code;
    return out;
  }
  if (typeof input === 'object') {
    const o = input as { status?: unknown; code?: unknown; message?: unknown; name?: unknown; error?: unknown };
    if (typeof o.status === 'number') out.status = o.status;
    if (typeof o.code === 'string') out.code = o.code;
    if (typeof o.message === 'string') out.message = o.message;
    else if (typeof o.error === 'string') out.message = o.error;
    if (typeof o.name === 'string') out.name = o.name;
  }
  return out;
}

const KIND_BY_STATUS: Record<number, ErrorKind> = {
  400: 'badRequest',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
  429: 'rateLimited',
};

function kindForStatus(status: number): ErrorKind | null {
  if (KIND_BY_STATUS[status]) return KIND_BY_STATUS[status];
  if (status === 0) return 'offline';
  if (status >= 500 && status <= 599) return 'server';
  if (status >= 400 && status <= 499) return 'badRequest';
  return null;
}

const NETWORK_RE = /failed to fetch|fetch failed|networkerror|network error|econnrefused|enotfound|etimedout|load failed/i;
const DB_MISSING_RE = /P2021|does not exist in the current database|relation ["`][^"`]+["`] does not exist/i;
const BAD_ID_RE = /P2023|invalid.*uuid|uuid.*(invalid|malformed)/i;
const UNAUTHORIZED_RE = /unauthorized|jwt expired|invalid token|401/i;
const RATE_RE = /too many requests|rate limit|429/i;
const NOT_FOUND_RE = /not found|404/i;

/**
 * แปลง error (Error / Response-like / status number / string) เป็นข้อความที่บอกทางแก้
 * @param input อะไรก็ได้ที่หน้าเว็บจับได้จาก fetch/try-catch
 * @param lang ภาษาที่จะใช้ ('th' = ค่าเริ่มต้น)
 */
export function explainError(input: unknown, lang: Lang = 'th'): ErrorHelp {
  const n = normalize(input);
  let kind: ErrorKind | null = null;

  // หลายหน้าโยน `new Error(\`HTTP ${res.status}\`)` — ดึงรหัสออกมาใช้ได้ ไม่งั้นจะกลายเป็น unknown
  if (n.status == null) {
    const httpStatus = /^HTTP\s+(\d{3})\b/i.exec(n.message);
    if (httpStatus) n.status = Number(httpStatus[1]);
  }

  // 1) โค้ดฐานข้อมูล — ต้องมาก่อน status เพราะ backend ตอบ 500 ให้ P2021
  if (n.code === 'P2021') kind = 'dbNotReady';
  else if (n.code === 'P2023') kind = 'badId';
  else if (n.code === 'P2002') kind = 'conflict';
  else if (n.code === 'P2003') kind = 'badRequest';

  // 2) ข้อความบอกเหตุที่เฉพาะกว่า status
  if (!kind && DB_MISSING_RE.test(n.message)) kind = 'dbNotReady';
  if (!kind && BAD_ID_RE.test(n.message)) kind = 'badId';

  // 3) status
  if (!kind && n.status != null) kind = kindForStatus(n.status);

  // 4) ข้อความทั่วไป (บางหน้าเก็บแค่ err.message)
  if (!kind && (NETWORK_RE.test(n.message) || n.name === 'TypeError')) kind = 'offline';
  if (!kind && UNAUTHORIZED_RE.test(n.message)) kind = 'unauthorized';
  if (!kind && RATE_RE.test(n.message)) kind = 'rateLimited';
  if (!kind && NOT_FOUND_RE.test(n.message)) kind = 'notFound';

  const resolved: ErrorKind = kind ?? 'unknown';
  const msg = MESSAGES[resolved][lang] ?? MESSAGES[resolved].th;

  // ไม่รู้จัก = เก็บข้อความเดิมไว้ (อย่ากลืนข้อมูลที่ผู้ใช้ต้องใช้ debug)
  // แต่ถ้าข้อความสั้นจนไม่บอกอะไร (เช่น 'x') ให้ใช้คำอธิบายกลางแทน — อ่านรู้เรื่องกว่า
  const raw = n.message.trim();
  const what = resolved === 'unknown' && raw.length >= 4 ? raw : msg.what;

  return { kind: resolved, what, fix: msg.fix, retryable: RETRYABLE[resolved] };
}

/** ใช้กับ <ErrorNotice /> — คืนข้อความสั้น ๆ สำหรับ aria-label ของปุ่ม */
export function retryLabel(lang: Lang = 'th'): string {
  return lang === 'th' ? 'ลองอีกครั้ง' : 'Try again';
}
