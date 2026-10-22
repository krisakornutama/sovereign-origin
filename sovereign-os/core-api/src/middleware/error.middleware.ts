import type { NextFunction, Request, Response } from 'express';

/**
 * Final error middleware.
 *
 * Body-parser errors (malformed JSON, payload too large) already carry a 4xx
 * status. Returning 500 for them hides the real cause and makes clients retry
 * a body they can never send. Everything else stays a generic 500.
 */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  const status = Number(err?.status || err?.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const code = err?.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
    const error = err?.type === 'entity.too.large' ? 'Payload too large' : 'Bad request';
    if (!res.headersSent) {
      res.status(status).json({ error, code });
    } else {
      res.end();
    }
    return;
  }

  console.error('❌ Unhandled route error:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  } else {
    res.end();
  }
}
