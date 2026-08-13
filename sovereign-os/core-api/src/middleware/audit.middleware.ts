// middleware/audit.middleware.ts
import { Request, Response, NextFunction } from 'express';

export function auditStateChange(req: Request, res: Response, next: NextFunction) {
  // For now, just pass through (will add real audit logic later)
  next();
}