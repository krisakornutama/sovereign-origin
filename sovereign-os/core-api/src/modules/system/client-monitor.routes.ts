// src/modules/system/client-monitor.routes.ts
// ── Client Error Monitoring — จุดรับ error จาก browser ของผู้ใช้ ──
// สาธารณะโดยจำเป็น: error ที่สำคัญที่สุดคือ error ที่เกิด "ก่อน login" และจากหน้า /shop
// (ลูกค้าที่ยังไม่มี token) จึงไม่ใช้ authenticate — แต่ปิดปากด้วย rate limit + payload
// ที่ normalize แบบเข้ม (ไม่เชื่อทุก field) + เก็บเป็น SecurityEvent ทั้งหมด
// (ตารางเดียวกับ system-monitor) — ปิดได้ผ่าน env (CLIENT_ERROR_ENABLED=false)
import express, { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import { clientMonitor, type ClientErrorPayload } from '../../services/client-monitor.service';

const router = Router();

// beacon ยิงครั้งเดียวต่อ error — 30 ครั้ง/นาที/IP คือเพดานกัน spam ที่ยังโอบอุ่มหน้าพังจริง
const errorLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: 'client-monitor: ยิง beacon ถี่เกินไป',
});

// beacon จาก reporter มาเป็น text/plain (safelisted — ข้าม origin ไม่ต้อง preflight)
// ซึ่ง express.json ตั้งรวมทั้งแอปไม่ parse → เพิ่ม text parser จำกัดเฉพาะ route นี้
const textParser = express.text({ limit: '16kb', type: 'text/plain' });

router.post('/error', errorLimiter, textParser, (req, res) => {
  // beacon จาก reporter มาเป็น text/plain (safelisted — ข้าม origin ไม่ต้อง preflight)
  // ซึ่ง express.json ไม่ parse → ได้ body เป็น string; application/json มาเป็น object แล้ว
  let payload: ClientErrorPayload = {};
  if (typeof req.body === 'string') {
    try { payload = JSON.parse(req.body); } catch { payload = {}; }
  } else if (typeof req.body === 'object' && req.body !== null) {
    payload = req.body;
  }
  // fire-and-forget: beacon ไม่ควรรอ DB — ตอบ 204 ทันที (204 = navigator.sendBeacon ถือว่า success)
  clientMonitor.report(payload, req.headers['user-agent'] || '').catch(() => {});
  res.status(204).end();
});

export default router;
