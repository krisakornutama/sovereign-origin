import { Router } from 'express';
import { unlinkSync, readFileSync, existsSync } from 'fs';
import multer from 'multer';
import os from 'os';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import {
  prisma,
  analyzeProductLabel,
  createInventoryItem,
  extractExpiry,
  parseLabelResponse,
  WRITE_ROLES,
  type ProductLabel,
} from '../../services/documents.service';
import { isCategoryValid } from '../../services/inventory.service';
import type { CallVisionDeps } from '../../services/vision.service';

const router = Router();

// ใช้สำหรับเทสต์ยิงได้โดยไม่แตะเครือข่าย — inject post ผ่านตัวนี้
export const visionDeps: CallVisionDeps = {};

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']);

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg/png/webp/gif/bmp/tiff)'));
  },
});

function toBase64DataUri(path: string, mimetype: string): string {
  const buf = readFileSync(path);
  return `data:${mimetype};base64,${buf.toString('base64')}`;
}

/** ตรวจความถูกต้องขั้นต่ำก่อนบันทึก */
function validateLabel(label: ProductLabel): string | null {
  if (!label.name.trim()) return 'name is required';
  if (!isCategoryValid(label.category)) return 'Invalid category';
  if (label.quantity != null && label.quantity < 0) return 'quantity must be >= 0';
  if (label.expiry_date && !extractExpiry(label.expiry_date)) return 'expiry_date is not a valid date';
  return null;
}

/** รับ override จากฟอร์มแก้ไข (ค่าที่ส่งมาทับค่าจาก AI) */
function applyOverrides(label: ProductLabel, body: Record<string, unknown>): ProductLabel {
  const pick = (v: unknown) => v === undefined || v === null || v === '' ? undefined : v;
  const next: ProductLabel = { ...label, warnings: [...label.warnings] };
  if (pick(body.name) !== undefined) next.name = String(body.name).trim();
  if (pick(body.category) !== undefined) next.category = String(body.category).toUpperCase();
  if (pick(body.quantity) !== undefined) next.quantity = Number(body.quantity);
  if (pick(body.unit) !== undefined) next.unit = String(body.unit).trim().slice(0, 16) || 'piece';
  if (pick(body.unit_price_usd) !== undefined) next.unit_price_usd = Number(body.unit_price_usd);
  if (pick(body.expiry_date) !== undefined) next.expiry_date = String(body.expiry_date);
  if (pick(body.shelf_life_days) !== undefined) next.shelf_life_days = body.shelf_life_days === '' ? null : Number(body.shelf_life_days);
  if (pick(body.notes) !== undefined) next.notes = String(body.notes).trim().slice(0, 500) || null;
  return next;
}

// POST /api/documents/analyze — อัปโหลดรูปฉลาก → AI อ่าน → คืน preview (ยังไม่บันทึก)
router.post('/analyze', authenticate, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Invalid image upload', detail: err.message });
    try {
      if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
      const base64 = toBase64DataUri(req.file.path, req.file.mimetype);
      const label = await analyzeProductLabel(base64, visionDeps);
      unlinkSync(req.file.path);
      res.json(label);
    } catch (e: any) {
      if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);
      res.status(500).json({ error: 'Label analysis failed', detail: e?.message || 'unknown' });
    }
  });
});

// POST /api/documents/scan-to-inventory — บันทึกเข้ารายการสินค้าจริง (หลังคนยืนยัน)
// รองรับ 2 แบบ:
//   multipart: image + override fields (เรียก AI ใหม่)
//   JSON:      { parsed: {...} } หรือส่ง fields ตรง ๆ จาก preview (ไม่ต้องส่งภาพซ้ำ)
router.post('/scan-to-inventory', authenticate, requireRole(...WRITE_ROLES), async (req, res) => {
  if (req.is('application/json')) {
    try {
      const raw = (req.body?.parsed && typeof req.body.parsed === 'object' ? req.body.parsed : req.body) as Record<string, unknown>;
      const label = parseLabelResponse(JSON.stringify(raw));
      const err = validateLabel(label);
      if (err) return res.status(400).json({ error: err });
      const id = await createInventoryItem(label, req.user?.id);
      return res.status(201).json({ success: true, id });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to save inventory item', detail: e?.message || 'unknown' });
    }
  }

  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Invalid image upload', detail: err.message });
    try {
      if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
      const base64 = toBase64DataUri(req.file.path, req.file.mimetype);
      let label = await analyzeProductLabel(base64, visionDeps);
      label = applyOverrides(label, (req.body || {}) as Record<string, unknown>);
      const e2 = validateLabel(label);
      if (e2) {
        unlinkSync(req.file.path);
        return res.status(400).json({ error: e2 });
      }
      const id = await createInventoryItem(label, req.user?.id);
      unlinkSync(req.file.path);
      res.status(201).json({ success: true, id });
    } catch (e: any) {
      if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);
      res.status(500).json({ error: 'Failed to save inventory item', detail: e?.message || 'unknown' });
    }
  });
});

export default router;
