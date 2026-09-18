import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';

// ────────────────────────────────────────────────────────────────────────────
// Socket.IO — realtime push ไปหา frontend
// (แยกออกจาก server.ts เพื่อให้จุดสร้าง/ตั้งค่า websocket อยู่ที่เดียว)
//
// ความปลอดภัย (ปิดช่องตามรายงานความเสี่ยง):
//   1) ทุก handshake ต้องส่ง JWT ที่ verify ผ่าน + MFA แล้ว — client ฝั่ง
//      useSocket.ts ส่ง auth.token มาให้อยู่แล้ว เซิร์ฟเวอร์เดิมแค่ไม่เคยตรวจ
//   2) CORS ใช้ config.corsOrigin เดียวกับ Express (เดิมเปิด origin: '*')
//   3) ทุก broadcast ผ่าน sanitizeSocketEvent — ส่งออกได้เฉพาะฟิลด์ใน allowlist
//      ต่อ event (กันข้อมูลทั้งอ็อบเจ็กต์ เช่น audit/telegram context หลุดออก socket)
// ────────────────────────────────────────────────────────────────────────────

// ฟิลด์ที่หน้าเว็บใช้จริงต่อ event (อ้างอิงจากตัวส่งใน workers/start.ts + hook useSocket.ts)
const EVENT_FIELD_ALLOWLIST: Record<string, string[]> = {
  telemetry_update: [
    'node_id', 'node_name', 'battery_soc', 'power_kw', 'voltage', 'water_level_cm', 'status',
    'fridge_temp', 'kitchen_temp', 'kitchen_humidity', 'pantry_door', 'kitchen_weight', 'solar_radiation',
  ],
  threat_update: ['overall', 'categories', 'summary'],
  defcon_update: ['level', 'direction', 'overall', 'from'],
  wealth_update: ['users', 'totalUsd', 'inventoryUsd', 'grandTotalUsd', 'timestamp'],
  new_alert: ['id', 'type', 'severity', 'message', 'metric', 'value', 'threshold', 'ruleId', 'timestamp'],
  critical_alert: ['id', 'type', 'severity', 'message', 'nodeId', 'deviceId', 'battery_soc', 'level', 'timestamp'],
  security_alert: ['id', 'type', 'severity', 'message', 'timestamp'],
  risk_error: ['lastError', 'lastErrorAt'],
};

/** คืน payload ที่ตัดเหลือเฉพาะฟิลด์อนุญาตของ event นั้น (event ไม่อยู่ใน allowlist = ผ่านตามเดิม) */
export function sanitizeSocketEvent(event: string, payload: unknown): unknown {
  const allow = EVENT_FIELD_ALLOWLIST[event];
  if (!allow || !payload || typeof payload !== 'object') return payload;
  const src = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of allow) {
    if (key in src) out[key] = src[key];
  }
  return out;
}

export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      // ที่มาเดียวกับ app.use(cors(...)) ใน server.ts — '*' = ยอมรับทุก origin (dev only)
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
    },
  });

  // ด่าน 1: ตรวจ JWT (+MFA) ตอน handshake — ไม่ผ่านตัดการเชื่อมต่อทันที
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    try {
      const decoded = jwt.verify(String(token || ''), config.jwtSecret) as { mfa_verified?: boolean };
      if (!decoded.mfa_verified) return next(new Error('MFA verification required'));
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });

  // ด่าน 2: บังคับให้ broadcast ทุกครั้งผ่าน sanitize — จุดเดียวครอบ io.emit ทุก call site
  const rawEmit = io.emit.bind(io) as (event: string, ...args: unknown[]) => boolean;
  io.emit = ((event: string, ...args: unknown[]) =>
    rawEmit(event, ...args.map((arg, i) => (i === 0 ? sanitizeSocketEvent(event, arg) : arg)))) as typeof io.emit;

  return io;
}
