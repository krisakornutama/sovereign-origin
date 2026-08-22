// ═════════════════════════════════════════════════════════════
// Sovereign Livestock Engine — 6 Operational Pillars:
// 1) Medical & Biosecurity Gate  2) Microclimate & Ventilation Fail-Safe
// 3) Precision Feed & Production 4) Reproductive & Breeding Cycle
// 5) Biosecurity Access Control  6) Batch Financial Engine
// Mount: /api/livestock (featureGuard('/livestock'))
// ═════════════════════════════════════════════════════════════
// โครงสร้าง: แยก route ตาม domain ออกเป็น sub-router (ไฟล์ livestock-*.routes.ts)
// shared constants/helpers อยู่ใน livestock-shared.ts — path และพฤติกรรม
// ทุก endpoint เหมือน livestock.routes.ts ฉบับเดิมทุกประการ
import { Router } from 'express';
import { prisma } from '../../lib/prisma';

import groupsRouter from './livestock-groups.routes';
import medicalRouter from './livestock-medical.routes';
import climateRouter from './livestock-climate.routes';
import productionRouter from './livestock-production.routes';
import breedingRouter from './livestock-breeding.routes';
import biosecurityRouter from './livestock-biosecurity.routes';
import batchesRouter from './livestock-batches.routes';
import visionRouter from './livestock-vision.routes';
import dashboardRouter from './livestock-dashboard.routes';

const router = Router();
export { prisma };

router.use(groupsRouter);
router.use(medicalRouter);
router.use(climateRouter);
router.use(productionRouter);
router.use(breedingRouter);
router.use(biosecurityRouter);
router.use(batchesRouter);
router.use(visionRouter);
router.use(dashboardRouter);

export default router;
