// src/modules/license/license.routes.ts
// ─────────────────────────────────────────────────────────────────────────────
// API สถานะไลเซนส์ (ออฟไลน์) — ให้ UI แสดงว่าเครื่องนี้ทำอะไรได้ตาม tier
//
//   GET /api/license — สถานะของเครื่องนี้ (ต้อง login)
//
// ห้ามคืน token / public key / machine hash เด็ดขาด: endpoint นี้บอกแค่
// "ผ่านหรือไม่ · tier อะไร · เหลือกี่วัน" ซึ่งเป็นข้อมูลที่ UI ต้องใช้เท่านั้น
// (คนที่ขโมย response นี้ไปก็ไม่ได้สิทธิ์เพิ่ม เพราะตรวจที่ middleware ทุกครั้ง)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { licenseView, readLicenseStatus } from '../../services/license-gate.service';

const router = Router();

router.get('/', authenticate, (_req, res) => {
  // สถานะเปลี่ยนได้ตลอดเมื่อเจ้าของต่ออายุ → ห้าม cache ที่ proxy/browser
  res.setHeader('Cache-Control', 'no-store');
  res.json(licenseView(readLicenseStatus()));
});

export default router;
