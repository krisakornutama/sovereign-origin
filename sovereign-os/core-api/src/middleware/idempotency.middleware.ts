import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import {
  beginIdempotent,
  completeIdempotent,
  fingerprintRequest,
  isMissingTableError,
  isValidIdempotencyKey,
  readIdempotencyKey,
  releaseIdempotent,
} from '../services/idempotency.service';

/**
 * idempotent(scope) — middleware กันงานซ้ำสำหรับ POST ที่มีผลข้างเคียง (เงิน/สต็อก)
 *
 * ใช้:
 *   router.post('/:businessId/orders', authenticate, idempotent('business.order'), handler)
 *
 * พฤติกรรม:
 *   · ไม่มี header = ผ่านปกติ (ไคลเอนต์เก่าไม่พัง) — ไม่เขียนตาราง
 *   · คีย์เดิม + payload เดิม + ทำเสร็จแล้ว = ตอบผลเดิม + `Idempotency-Replayed: true`
 *   · คีย์เดิม + payload ต่าง = 409 IDEMPOTENCY_CONFLICT
 *   · คีย์เดิม + คำขอแรกยังไม่จบ = 409 IDEMPOTENCY_IN_PROGRESS + Retry-After
 *   · handler ตอบ 4xx/5xx = ไม่แคช (ปล่อยคีย์) เพื่อให้แก้แล้วลองใหม่ได้
 *   · ตารางยังไม่ถูก migrate (P2021) = ผ่านแบบไม่กันซ้ำ (fail-open) + เตือนครั้งเดียว
 *   · DB ล่มจริง = 503 (ไม่ยอมให้ทำงานเงินซ้ำโดยไม่มีการป้องกัน)
 */

let warnedMissingTable = false;

function userIdOf(req: Request): string | null {
  const user = (req as unknown as { user?: { userId?: string; id?: string } }).user;
  return String(user?.userId ?? user?.id ?? '') || null;
}

function pathOf(req: Request): string {
  const raw = String(req.originalUrl || req.url || '');
  return raw.split('?')[0];
}

export function idempotent(scope: string) {
  return async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!config.idempotency.enabled) return next();

    const key = readIdempotencyKey(req.headers as unknown as Record<string, unknown>);
    if (!key) return next();

    if (!isValidIdempotencyKey(key)) {
      res.status(400).json({
        error: 'Idempotency-Key must be 8-200 characters of A-Z a-z 0-9 . _ : -',
        code: 'IDEMPOTENCY_INVALID_KEY',
        requestId: res.locals?.requestId,
      });
      return;
    }

    const userId = userIdOf(req);
    const fingerprint = fingerprintRequest({ userId, method: req.method, path: pathOf(req), body: req.body });

    let begin;
    try {
      begin = await beginIdempotent({ scope, key, fingerprint, userId });
    } catch (err) {
      if (isMissingTableError(err)) {
        if (!warnedMissingTable) {
          warnedMissingTable = true;
          console.warn('[idempotency] table "idempotency_keys" is missing — running without duplicate protection until the migration is applied');
        }
        return next();
      }
      console.error('[idempotency] store unavailable:', err instanceof Error ? err.message : err);
      res.status(503).json({
        error: 'Idempotency store unavailable — retry shortly',
        code: 'IDEMPOTENCY_UNAVAILABLE',
        requestId: res.locals?.requestId,
      });
      return;
    }

    if (begin.state === 'replay') {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(begin.statusCode).json(begin.body as never);
      return;
    }
    if (begin.state === 'conflict') {
      res.status(409).json({
        error:
          begin.reason === 'owner'
            ? 'Idempotency-Key belongs to another user'
            : 'Idempotency-Key was already used with a different payload',
        code: 'IDEMPOTENCY_CONFLICT',
        requestId: res.locals?.requestId,
      });
      return;
    }
    if (begin.state === 'pending') {
      res.setHeader('Retry-After', String(begin.retryAfterSec));
      res.status(409).json({
        error: 'The same request is still being processed — retry with the same Idempotency-Key',
        code: 'IDEMPOTENCY_IN_PROGRESS',
        retryAfterSec: begin.retryAfterSec,
        requestId: res.locals?.requestId,
      });
      return;
    }

    const id = begin.id;
    let settled = false;
    const originalJson = res.json.bind(res);

    // เก็บผลก่อนส่ง: ถ้า process ตายหลังส่งแต่ก่อนบันทึก ลูกค้าจะ retry แล้วได้ผลซ้ำ
    // (choose at-least-once สำหรับ "การบันทึก" แต่ exactly-once สำหรับ "ผลข้างเคียง")
    res.json = ((body: unknown) => {
      if (settled) return originalJson(body as never);
      settled = true;
      const statusCode = res.statusCode;
      const ok = statusCode >= 200 && statusCode < 300;
      const persist = ok ? completeIdempotent(id, statusCode, body) : releaseIdempotent(id);
      persist
        .catch((err) => {
          console.error('[idempotency] failed to persist result:', err instanceof Error ? err.message : err);
        })
        .finally(() => {
          originalJson(body as never);
        });
      return res;
    }) as Response['json'];

    // handler ที่ไม่ได้ตอบ JSON (เช่นส่งไฟล์) = เก็บผลไม่ได้ ⇒ ปล่อยคีย์ให้ลองใหม่ได้
    res.on('finish', () => {
      if (settled) return;
      settled = true;
      void releaseIdempotent(id).catch(() => {
        /* หมดอายุเองอยู่แล้ว */
      });
    });

    next();
  };
}
