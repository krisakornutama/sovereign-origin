// src/modules/system/qr.routes.ts
// POST-free helper: สร้างภาพ QR เป็น PNG
//
// ทำไมต้องมี: ป้ายสติกเกอร์ของ Soverien ต้องฝัง QR ที่สแกนแล้วเปิดหน้า "ตรวจประกัน"
// พร้อม S/N ให้กรอกไว้ให้แล้ว · frontend ไม่มี dependency สร้าง QR
// จึงยืม `qrcode` ที่ backend มีอยู่แล้ว (ไม่เพิ่ม package ใหม่)
//
// หลักการ: ไม่แตะ DB · ไม่มี migration · stateless · จำกัดขนาด text
import { Router } from 'express';
import QRCode from 'qrcode';

const router = Router();

const MAX_TEXT = 512;      // QR เวอร์ชัน 40 (byte mode, EC L) รับได้ ~2953 ไบต์
                          // เผื่อ headroom ไว้ เพราะเราเข้าเงื่อนไข margin/ECC ต่างกัน
const MAX_SIZE = 1024;
const MIN_SIZE = 64;

/** GET /api/util/qr?text=...&size=256&margin=1 → image/png */
router.get('/qr', async (req, res) => {
  try {
    const text = String(req.query.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'ต้องส่ง text' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `text ยาวเกิน ${MAX_TEXT} ตัวอักษร` });

    const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Number(req.query.size) || 256));
    const margin = Math.max(0, Math.min(8, Number(req.query.margin ?? 1)));

    const png = await QRCode.toBuffer(text, {
      type: 'png',
      width: size,
      margin,
      // errorCorrectionLevel 'M' = ทนคราบ/เสียหายระดับกลาง (สติกเกอร์พิมพ์แล้วขูดได้)
      errorCorrectionLevel: 'M',
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(png);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'สร้าง QR ไม่สำเร็จ' });
  }
});

export default router;