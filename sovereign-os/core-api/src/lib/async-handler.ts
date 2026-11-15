import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * ตัวห่อ async route handler สำหรับ Express 4
 *
 * Express 4 **ไม่ดัก promise ที่ reject** — handler ที่ `await` แล้วโยน error จะทำให้คำขอ
 * ค้างอยู่จน client timeout (ไม่ใช่ 500) ⇒ ผู้ใช้เห็น "โหลดไม่รู้จบ" และ connection ถูกจับไว้
 * จนหมด (คำขอที่ทำให้ DB โยน เช่น id ผิดรูป/P2023 จึงยิงซ้ำได้เรื่อย ๆ)
 *
 * ใช้: `router.get('/x', authenticate, asyncRoute(async (req, res) => { ... }))`
 * — handler ที่มี `try/catch` ของตัวเองอยู่แล้วไม่ต้องห่อ (แต่ห่อก็ไม่ผิด)
 *
 * กติกา:
 *  - ตอบ 500 เป็น JSON เสมอ (ไม่ปล่อยเป็น HTML stack ของ Express)
 *  - ถ้าส่ง header ไปแล้ว (เช่น streaming) ให้ต่อให้ Express จัดการ (`next(err)`) — ห้ามเขียนทับ
 *  - `detail` ถูกตัดที่ 200 ตัวอักษร เหมือนจุดอื่นในระบบ (กัน log/response บวม)
 */
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncRoute(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err: unknown) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      console.error(
        `Async route failed: ${req.method} ${req.originalUrl}`,
        err instanceof Error ? err.message : err
      );
      res.status(500).json({
        error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์ — คำขอนี้ไม่สำเร็จ',
        detail: String((err as Error)?.message || '').slice(0, 200),
      });
    });
  };
}
