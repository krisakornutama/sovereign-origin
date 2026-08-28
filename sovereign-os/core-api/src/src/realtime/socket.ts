import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

// ────────────────────────────────────────────────────────────────────────────
// Socket.IO — realtime push ไปหา frontend
// (แยกออกจาก server.ts เพื่อให้จุดสร้าง/ตั้งค่า websocket อยู่ที่เดียว)
// ────────────────────────────────────────────────────────────────────────────
export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  return new SocketIOServer(httpServer, { cors: { origin: '*' } });
}
