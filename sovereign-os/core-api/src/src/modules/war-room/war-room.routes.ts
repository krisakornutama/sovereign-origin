// src/modules/war-room/war-room.routes.ts
// GET /api/war-room/status — สถานะ War Room Activity Gate (หลับ/ตื่น, ใช้ดูว่า simulation กำลังรันอยู่ไหม)
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { warRoomStatus } from '../../services/war-room.service';

const router = Router();

router.get('/status', authenticate, (_req, res) => {
  res.json(warRoomStatus());
});

export default router;
