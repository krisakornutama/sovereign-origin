// src/modules/dms/dms.routes.ts
// Series 🔴 — External Dead-Man Switch: POST /ping (HMAC-only, ไม่ผ่าน featureGuard/Bearer)
// + GET /status (SUPERADMIN) — สเปก: docs/SERIES_RED_DMS_BLUEPRINT.md §3.1/§7
// หมายเหตุ: ไม่ mount featureGuard — DMS ต้องส่ง ping ได้แม้โมดูลอื่นปิด (auth คือ HMAC เอง)
import { Router, type RequestHandler } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { dmsService, type DmsService } from '../../services/dms.service';

// POST /ping — heartbeat จากอุปกรณ์ DMS (public, ตรวจ HMAC แทน Bearer)
// Headers: X-DMS-Device, X-DMS-Timestamp (unix วินาที), X-DMS-Signature (hex hmac_sha256)
// Body: { seq, uptime?, bat_pct? } — sig = HMAC(KEY(t), ts|deviceId|seq)
function pingHandler(service: DmsService): RequestHandler {
  return async (req, res) => {
    if (!service.isEnabled()) {
      return res.status(503).json({ ok: false, reason: 'disabled' });
    }
    const deviceId = String(req.headers['x-dms-device'] || '');
    const ts = Number(req.headers['x-dms-timestamp']);
    const sig = String(req.headers['x-dms-signature'] || '');
    const seq = Number(req.body?.seq);
    const uptime = typeof req.body?.uptime === 'number' ? req.body.uptime : undefined;
    const batPct = typeof req.body?.bat_pct === 'number' ? req.body.bat_pct : undefined;
    const result = await service.handlePing({ deviceId, ts, seq, sig }, { uptime, batPct });
    if (!result.ok) {
      return res.status(401).json({ ok: false, reason: result.reason });
    }
    res.json({ ok: true, now: Math.floor(Date.now() / 1000) });
  };
}

function statusHandler(service: DmsService): RequestHandler {
  return (_req, res) => {
    res.json(service.status());
  };
}

/** factory — เทสต์สร้าง router ของตัวเองกับ service ที่ inject dep ได้ */
export function createDmsRouter(service: DmsService): Router {
  const router = Router();
  router.post('/ping', pingHandler(service));
  router.get('/status', authenticate, requireRole('SUPERADMIN'), statusHandler(service));
  return router;
}

export default createDmsRouter(dmsService);