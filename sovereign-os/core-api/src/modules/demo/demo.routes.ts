// src/modules/demo/demo.routes.ts
//
// PUBLIC DEMO (P: Publishing) — สนามทดลองสาธารณะ ไม่ต้อง login
// หลักการ:
//  - เสิร์ฟเฉพาะข้อมูลเดโม่จาก demo-sandbox.service (hardcode — ไม่แตะ DB จริงแม้แต่อ่าน)
//  - rate limit ต่อ IP ที่ route layer (โดนยิงหนัก = 429 ไม่กระทบระบบหลัก)
//  - เส้นทางนี้อยู่ใน allowlist WAF ร่วมกับ /shop /trace
import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.middleware';
import { demoFarmOverview, demoLivestock, demoFinance, publicCatalog, demoLot, demoShop } from '../../services/demo-sandbox.service';

export { demoFarmOverview, demoLivestock, demoFinance, publicCatalog, demoLot, demoShop }; // ให้เทส mock ผ่านชั้นเดียวกัน

const router = Router();

const demoLimiter = rateLimit({ windowMs: 60_000, max: 30, message: 'เปิดหน้าเดโม่ถี่เกินไป ลองใหม่อีกครั้ง' });

// GET /api/demo/overview — ภาพรวมทั้งสามโมดูลในคำเดียว (หน้าแรก /demo ใช้)
router.get('/overview', demoLimiter, async (_req, res) => {
  res.json({
    farm: demoFarmOverview().summary,
    livestock: demoLivestock().summary,
    finance: demoFinance().summary,
    disclaimer: 'ข้อมูลตัวอย่างล้วน — ระบบจริงของคุณจะเห็นข้อมูลของคุณเอง',
  });
});

// GET /api/demo/farm — แปลง+เซนเซอร์ (sandbox)
router.get('/farm', demoLimiter, async (_req, res) => {
  res.json(demoFarmOverview());
});

// GET /api/demo/livestock — ฝูงสัตว์ (sandbox)
router.get('/livestock', demoLimiter, async (_req, res) => {
  res.json(demoLivestock());
});

// GET /api/demo/finance — พอร์ตจำลอง (sandbox)
router.get('/finance', demoLimiter, async (_req, res) => {
  res.json(demoFinance());
});

// GET /api/demo/catalog — โมดูลทั้งหมดที่อาจขายจริง (P12 — metadata จาก scanner ไม่มีราคา/ข้อมูลภายใน)
router.get('/catalog', demoLimiter, async (_req, res) => {
  try {
    res.json(publicCatalog());
  } catch {
    res.status(500).json({ error: 'สแกนแคตตาล็อกไม่สำเร็จ' });
  }
});

// GET /api/demo/trace/:code — ล็อตตัวอย่างตามรอย (P12 — sandbox · รหัสจริงของลูกค้าไปที่ /api/trace/:code ของ trace module)
router.get('/trace/:code', demoLimiter, async (req, res) => {
  const lot = demoLot(String(req.params.code));
  if (!lot) return res.status(404).json({ error: 'ไม่พบล็อตตัวอย่างนี้' });
  return res.json(lot);
});

// GET /api/demo/shop — สินค้าที่ขายจริงตอนนี้ (P12 — snapshot ในโค้ด ไม่แตะ DB)
router.get('/shop', demoLimiter, async (_req, res) => {
  res.json(demoShop());
});

export default router;
