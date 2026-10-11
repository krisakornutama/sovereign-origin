// src/realtime/io-registry.ts
//
// ที่เก็บ Socket.IO instance ที่เดียว
//
// ทำไมต้องมี: route ฝั่ง HTTP (runner ส่งภาพหน้าจอ/ผลคำสั่งเข้ามา) ต้อง relay ต่อ
// ไปหา browser ที่กำลังดูเครื่องนั้นอยู่ แต่ `mountRoutes(app)` **ไม่ได้รับ `io`**
// ⇒ server.ts สร้าง io ก่อน mountRoutes จึงไม่มีทางส่งต่อให้ route ได้เลย
//
// ทางเลือกอื่นคือแก้ signature ของ mountRoutes(app) → mountRoutes(app, io)
// ซึ่งกระทบ routes.ts + server.ts + เทสต์ที่เรียก mountRoutes — เกินความจำเป็น
// ⇒ ใช้ registry: createSocketServer เป็นคน set, route เป็นคน get
//
// เก็บเป็น null ได้ (เทสต์ที่ไม่ได้สร้าง socket server ต้องเรียก route ได้โดยไม่พัง)
import type { Server as SocketIOServer } from 'socket.io';

let current: SocketIOServer | null = null;

/** เรียกครั้งเดียวตอน boot (จาก createSocketServer) */
export function setIo(io: SocketIOServer): void {
  current = io;
}

/** คืน io ถ้าถูกสร้างแล้ว — null = ยังไม่มี socket server (เทสต์/โหมดพิเศษ) */
export function getIo(): SocketIOServer | null {
  return current;
}

/** สำหรับเทสต์: ล้างค่า ไม่ให้ instance รั่วข้ามเคส */
export function resetIo(): void {
  current = null;
}
