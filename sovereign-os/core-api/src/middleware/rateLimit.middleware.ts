import { Request, Response, NextFunction, RequestHandler } from 'express';

interface Bucket {
  count: number;
  windowStart: number; // เริ่มนับ window (ms)
  blockLevel: number;  // 0 = ไม่โดนบล็อก; เพิ่มทีละ 1 ทุกครั้งที่ retry ขณะถูกบล็อก
  blockedUntil: number; // 0 = ไม่โดนบล็อก; ms ที่ block หมดอายุ
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  /**
   * Exponential backoff: เมื่อเกิน max แล้ว แต่ละครั้งที่ client retry ขณะถูกบล็อก
   * ระยะรอจะเพิ่มเป็น 2 เท่า (windowMs → 2x → 4x …) ถูก cap ด้วย maxBlockMs
   * (default: false = พฤติกรรมเดิม ระยะรอคงที่)
   */
  backoff?: boolean;
  /** Cap ของ backoff cooldown (default 24 ชม.) */
  maxBlockMs?: number;
  /**
   * จัด bucket ด้วย key อื่นแทน IP — เช่น per-account:
   *   keyBy: (req) => String(req.body?.username || '') || req.ip
   * คืนค่าว่าง → ตกไปใช้ IP เหมือนเดิม
   */
  keyBy?: (req: Request) => string;
  /** เรียกทุกครั้งที่ request โดน 429 (เช่น เขียน audit log) — fire-and-forget */
  onBlock?: (key: string, req: Request) => void;
}

export interface RateLimitState {
  count: number;
  windowStart: number;
  windowResetAt: number;
  blockLevel: number;
  blockedUntil: number;
}

export interface RateLimitStore {
  get(ip: string): RateLimitState | undefined;
  all(): Array<{ ip: string; state: RateLimitState }>;
  /** clear หนึ่ง IP หรือทั้งหมด (ไม่ส่ง ip) — คืนรายการ IP ที่ถูกเคลียร์ */
  clear(ip?: string): string[];
}

export type RateLimitMiddleware = RequestHandler & {
  store: RateLimitStore;
};

/**
 * Simple in-memory fixed-window rate limiter keyed by client IP.
 *
 * NOTE: suitable for a single-instance deployment. If the API is scaled
 * horizontally, replace this with a shared store (e.g. express-rate-limit
 * backed by Redis).
 */
export function rateLimit(options: RateLimitOptions): RateLimitMiddleware {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, backoff = false, maxBlockMs = 24 * 60 * 60 * 1000, keyBy, onBlock } = options;
  const message = options.message || 'Too many requests, please try again later';

  // Periodically drop expired buckets so the map cannot grow unbounded.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.windowStart + windowMs <= now && bucket.blockedUntil <= now) {
        buckets.delete(key);
      }
    }
  }, 10 * 60 * 1000);
  cleanup.unref?.();

  const toState = (b: Bucket): RateLimitState => ({
    count: b.count,
    windowStart: b.windowStart,
    windowResetAt: b.windowStart + windowMs,
    blockLevel: b.blockLevel,
    blockedUntil: b.blockedUntil,
  });

  const store: RateLimitStore = {
    get(ip) {
      const b = buckets.get(ip);
      return b ? toState(b) : undefined;
    },
    all() {
      return [...buckets.entries()].map(([ip, b]) => ({ ip, state: toState(b) }));
    },
    clear(ip) {
      if (ip) {
        return buckets.delete(ip) ? [ip] : [];
      }
      const keys = [...buckets.keys()];
      buckets.clear();
      return keys;
    },
  };

  const middleware: RateLimitMiddleware = (req, res, next) => {
    const key = (keyBy?.(req) || req.ip || req.socket.remoteAddress || 'unknown').trim() || 'unknown';
    const now = Date.now();

    let bucket = buckets.get(key);
    // สร้าง bucket ใหม่เมื่อ window หมด และ (ถ้า backoff) block ก็หมดแล้วด้วย
    // — ถ้ายังโดนบล็อกอยู่ ให้ block อยู่ต่อแม้ window จะหมดไปแล้ว
    const windowExpired = bucket ? bucket.windowStart + windowMs <= now : false;
    const blockExpired = bucket ? bucket.blockedUntil <= now : true;
    if (!bucket || (windowExpired && blockExpired)) {
      bucket = { count: 0, windowStart: now, blockLevel: 0, blockedUntil: 0 };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    // ถูกบล็อกอยู่แล้ว → escalate (เฉพาะ backoff) และยืด block ออกไป
    if (bucket.blockedUntil > now) {
      bucket.blockLevel += 1;
      const cooldown = backoff
        ? Math.min(windowMs * Math.pow(2, bucket.blockLevel - 1), maxBlockMs)
        : Math.max(0, bucket.blockedUntil - now);
      bucket.blockedUntil = now + cooldown;
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(cooldown / 1000))));
      onBlock?.(key, req);
      return res.status(429).json({ error: message });
    }

    // เกิน max ใน window → บล็อกครั้งแรก
    if (bucket.count > max) {
      const cooldown = windowMs;
      bucket.blockLevel = 1;
      bucket.blockedUntil = now + cooldown;
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(cooldown / 1000))));
      onBlock?.(key, req);
      return res.status(429).json({ error: message });
    }

    next();
  };

  middleware.store = store;
  return middleware;
}
