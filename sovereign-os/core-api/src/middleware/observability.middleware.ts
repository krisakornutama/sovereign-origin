// src/middleware/observability.middleware.ts
//
// ── middleware "มองเห็นได้": request-id + access log + /metrics ──────────────────────
// ต่อตัวนี้เป็นตัวแรก ๆ ของ stack (ก่อน body parser) เพื่อให้ log ครอบทุกคำขอ
// รวมถึงคำขอที่ถูกปฏิเสธตั้งแต่ต้น (401/413/429) ซึ่งมักเป็นคำขอที่เราอยากเห็นที่สุด
//
// สิ่งที่ไม่ทำโดยเจตนา:
//   · ไม่บันทึก body/header/cookie (ข้อมูลส่วนบุคคล + ความลับ)
//   · ไม่ใช้ URL จริงเป็น label ของ metrics (cardinality ระเบิด)
//   · ไม่เปิด /metrics เมื่อไม่ได้ตั้ง token (fail-closed)
import type { Request, Response, RequestHandler } from 'express';
import {
  MetricsRegistry,
  accessLogRecord,
  isMetricsAuthorized,
  normalizeRequestId,
  stripQuery,
} from '../lib/observability';

/** path ที่ไม่ต้องเขียน access log (ถูกยิงถี่มาก แต่ไม่ให้ข้อมูลอะไรเพิ่ม) */
const DEFAULT_QUIET_PATHS = ['/healthz', '/api/health', '/favicon.ico'];

export interface ObservabilityOptions {
  /** ปลายทางของ log 1 บรรทัด (default: stdout) — เทสต์ส่ง array เข้ามาได้ */
  sink?: (line: string) => void;
  /** ชื่อผู้เช่า (multi-tenant) — ใส่เป็น label/field ไว้แยกข้อมูลลูกค้าแต่ละราย */
  tenant?: string;
  /** อ่าน token ของ /metrics ตอนเรียก (ไม่เก็บค่าไว้ใน closure เพื่อให้ rotate ได้) */
  getToken?: () => string | undefined;
  quietPaths?: string[];
  enabled?: boolean;
  registry?: MetricsRegistry;
}

export interface Observability {
  requestContext: RequestHandler;
  metricsHandler: RequestHandler;
  registry: MetricsRegistry;
}

interface TrackedRequest extends Request {
  requestId?: string;
}

const defaultSink = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** route pattern ของ Express เช่น /api/users/:id (ไม่ใช่ /api/users/abc123) */
function routePattern(req: Request): string {
  const route = (req as any).route;
  const path = route && typeof route.path === 'string' ? route.path : '';
  if (!path) {
    const base = typeof (req as any).baseUrl === 'string' ? (req as any).baseUrl : '';
    // ไม่มี route = 404 (หรือ middleware ที่ตอบเอง) → ใช้ค่าเดียวร่วมกัน ไม่ผูกกับ URL จริง
    return base ? `${base}/*` : 'unmatched';
  }
  const base = typeof (req as any).baseUrl === 'string' ? (req as any).baseUrl : '';
  return `${base}${path}` || path;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function createObservability(options: ObservabilityOptions = {}): Observability {
  const registry = options.registry ?? new MetricsRegistry();
  const sink = options.sink ?? defaultSink;
  const quiet = new Set(options.quietPaths ?? DEFAULT_QUIET_PATHS);
  const enabled = options.enabled !== false;

  const requestContext: RequestHandler = (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const requestId = normalizeRequestId(headerValue(req.headers['x-request-id']));
    (req as TrackedRequest).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    // ให้ error handler อ้างถึงได้ด้วย (client แจ้งเลขนี้มา = ไล่ log ได้ทันที)
    res.locals.requestId = requestId;

    let recorded = false;
    const record = (status: number): void => {
      if (recorded) return;
      recorded = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const route = routePattern(req);
      const tenant = options.tenant ?? null;

      // metrics ก่อน — ต้องนับแม้ path จะอยู่ใน quiet list
      try {
        registry.inc('sovereign_http_requests_total', {
          method: String(req.method || '').toUpperCase(),
          route,
          status: String(status),
        });
        registry.observe(
          'sovereign_http_request_duration_ms',
          durationMs,
          { method: String(req.method || '').toUpperCase(), route },
        );
      } catch {
        // metrics ต้องไม่ทำให้คำขอจริงพัง
      }

      const path = stripQuery(req.originalUrl || req.url || '');
      if (!enabled || quiet.has(path)) return;

      try {
        sink(
          JSON.stringify(
            accessLogRecord({
              requestId,
              method: req.method,
              path,
              route,
              status,
              durationMs,
              tenant,
              userId: (req as any).user?.id ?? null,
            }),
          ),
        );
      } catch {
        // log ต้องไม่ทำให้คำขอจริงพัง
      }
    };

    res.on('finish', () => record(res.statusCode));
    // client ตัดการเชื่อมต่อก่อนตอบเสร็จ — นับเป็น 499 เพื่อให้เห็นว่าเกิดจริง
    res.on('close', () => record(res.writableFinished ? res.statusCode : 499));

    next();
  };

  const metricsHandler: RequestHandler = (req, res) => {
    const token = options.getToken ? options.getToken() : undefined;
    const bearer = headerValue(req.headers.authorization);
    const provided =
      headerValue(req.headers['x-metrics-token']) ??
      (typeof bearer === 'string' && /^bearer\s+/i.test(bearer) ? bearer.replace(/^bearer\s+/i, '') : undefined);

    if (!isMetricsAuthorized(provided, token)) {
      res.status(401).json({ error: 'metrics disabled' });
      return;
    }

    const rss = process.memoryUsage().rss;
    const extra = [
      '# TYPE sovereign_up gauge',
      `sovereign_up{tenant="${String(options.tenant ?? 'default').replace(/"/g, '\\"')}"} 1`,
      '# TYPE sovereign_process_resident_memory_bytes gauge',
      `sovereign_process_resident_memory_bytes ${Math.round(rss)}`,
      '# TYPE sovereign_process_uptime_seconds gauge',
      `sovereign_process_uptime_seconds ${Math.round(process.uptime())}`,
      '',
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(`${registry.render()}${extra}`);
  };

  return { requestContext, metricsHandler, registry };
}

// ── instance ที่ production ใช้ร่วมกัน (server.ts + routes.ts อ้างตัวเดียวกัน) ──
// อ่าน token/tenant จาก config ตอนเรียกทุกครั้ง → เปลี่ยน env แล้วมีผลโดยไม่ต้องสร้างใหม่
let shared: Observability | null = null;

export function getObservability(): Observability {
  if (shared) return shared;
  // require แบบ lazy เพื่อไม่ให้ไฟล์นี้ผูกกับ config ในเทสต์ที่ไม่ได้โหลด env
  const { config } = require('../config') as typeof import('../config');
  shared = createObservability({
    tenant: config.observability.tenantId,
    getToken: () => config.observability.metricsToken,
    enabled: config.observability.accessLog,
  });
  return shared;
}
