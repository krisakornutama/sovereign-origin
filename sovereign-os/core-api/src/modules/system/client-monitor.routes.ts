// src/modules/system/client-monitor.routes.ts
// ── Client Error Monitoring — จุดรับ error จาก browser ของผู้ใช้ ──
// สาธารณะโดยจำเป็น: error ที่สำคัญที่สุดคือ error ที่เกิด "ก่อน login" และจากหน้า /shop
// (ลูกค้าที่ยังไม่มี token) จึงไม่ใช้ authenticate — แต่ปิดปากด้วย rate limit + payload
// ที่ normalize แบบเข้ม (ไม่เชื่อทุก field) + เก็บเป็น SecurityEvent ทั้งหมด
// (ตารางเดียวกับ system-monitor) — ปิดได้ผ่าน env (CLIENT_ERROR_ENABLED=false)
import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import { clientMonitor, type ClientErrorPayload } from '../../services/client-monitor.service';

const router = Router();

// beacon ยิงครั้งเดียวต่อ error — 30 ครั้ง/นาที/IP คือเพดานกัน spam ที่ยังโอบอุ่มหน้าพังจริง
const errorLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: 'client-monitor: ยิง beacon ถี่เกินไป',
});

router.post('/error', errorLimiter, (req, res) => {
  const payload: ClientErrorPayload = typeof req.body === 'object' && req.body !== null ? req.body : {};
  // fire-and-forget: beacon ไม่ควรรอ DB — ตอบ 204 ทันที (204 = navigator.sendBeacon ถือว่า success)
  clientMonitor.report(payload, req.headers['user-agent'] || '').catch(() => {});
  res.status(204).end();
});

export default router;
