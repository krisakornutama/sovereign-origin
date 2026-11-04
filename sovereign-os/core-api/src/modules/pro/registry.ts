// src/modules/pro/registry.ts — จุดเชื่อมเดียวระหว่าง CE กับโมดูล Pro
//
// ทำไมต้องมี: ก่อนหน้านี้ routes.ts import โมดูลพาณิชย์กระจาย 8 จุด ทำให้
// การแยก Pro ออกจาก public repo ต้องแก้ไฟล์กลางหลายที่ และถ้าย้ายไฟล์ไปแล้ว
// ยัง import อยู่ = API ล้มทั้งตัว (บูตไม่ขึ้น) ไม่ใช่แค่ฟีเจอร์หาย
//
// กติกา:
// 1) CE ไม่รู้จักชื่อโมดูล Pro นอกจากไฟล์นี้
// 2) ถ้าโมดูลไม่มีอยู่ (แยกไป repo Pro แล้ว) → mount 404 พร้อมเหตุผล ไม่ throw
// 3) ลำดับ mount ต้องคงเดิม (เช่น /api/payments/slips ก่อน /api/payments)
import type { Express, Request, Response } from 'express';
import { featureGuard } from '../../services/feature-grant.service';

export interface ProMount {
  /** ชื่อสั้นของโมดูล — ใช้ใน log/เทสต์ */
  key: string;
  /** path ที่ mount */
  path: string;
  /** path ของไฟล์ route (require แบบ lazy เพื่อให้ CE บูตได้แม้ไฟล์ถูกย้ายออก) */
  file: string;
  /** feature key ที่ใช้กับ featureGuard (ถ้ามี) */
  guard?: string | string[];
}

export const PRO_MOUNTS: ProMount[] = [
  { key: 'business', path: '/api/business', file: '../business/business.routes' },
  { key: 'fleet', path: '/api/fleet', file: '../fleet/fleet.routes' },
  { key: 'portfolio', path: '/api/portfolio', file: '../portfolio/portfolio.routes', guard: '/portfolio' },
  { key: 'treasury', path: '/api/treasury', file: '../treasury/treasury.routes', guard: ['/treasury', '/portfolio'] },
  { key: 'dime', path: '/api/dime', file: '../dime/dime.routes', guard: ['/treasury', '/portfolio'] },
  { key: 'payments-slips', path: '/api/payments/slips', file: '../payments/payment-slips.routes' },
  { key: 'payments', path: '/api/payments', file: '../payments/payments.routes' },
  { key: 'restaurant', path: '/api/restaurant', file: '../restaurant/restaurant.routes', guard: '/restaurant' },
];

/** handler กลางเมื่อโมดูล Pro ไม่มีอยู่ใน build นี้ (แยกไป repo Pro แล้ว) */
export function moduleNotAvailable(key: string) {
  return (_req: Request, res: Response) => {
    res.status(404).json({ error: 'โมดูลนี้ไม่รวมอยู่ใน Community Edition', module: key });
  };
}

/**
 * mount ทุกโมดูล Pro — เรียกครั้งเดียวจาก routes.ts
 * คืนรายการที่ mount สำเร็จจริง (ใช้ตรวจในเทสต์/health ได้)
 */
export function registerProRoutes(app: Express): string[] {
  const mounted: string[] = [];
  for (const m of PRO_MOUNTS) {
    let router: unknown;
    try {
      // lazy require: ถ้าไฟล์ถูกย้ายออกไป repo Pro แล้ว จะไม่ทำให้บูตพัง
      router = require(m.file)?.default ?? require(m.file);
    } catch (err) {
      const why = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.warn(`[pro] โมดูล ${m.key} ไม่พร้อม (${why}) — mount ${m.path} เป็น 404`);
      app.use(m.path, moduleNotAvailable(m.key));
      continue;
    }
    if (!router) {
      console.warn(`[pro] โมดูล ${m.key} ไม่ได้ export router — mount ${m.path} เป็น 404`);
      app.use(m.path, moduleNotAvailable(m.key));
      continue;
    }
    app.use(m.path, m.guard ? featureGuard(m.guard) : (_req, _res, next) => next(), router as never);
    mounted.push(m.key);
  }
  if (mounted.length > 0) console.log(`[pro] mounted: ${mounted.join(', ')}`);
  return mounted;
}
