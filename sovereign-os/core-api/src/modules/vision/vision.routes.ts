import { Router } from 'express';
import axios from 'axios';
import { authenticate } from '../../middleware/auth.middleware';
import { hardenUpload, IMAGE_MIME, IMAGE_EXTS } from '../../lib/harden-upload';
import {
  prisma,
  runVisionAnalysis,
  VISION_ENABLED,
  VISION_MAX_IMAGE_MB,
} from '../../services/vision.service';

const router = Router();

// harden: memory mode (ไม่ลงดิสก์ — อ่านเป็น base64 ส่ง VL model แล้วทิ้ง) + whitelist MIME/นามสกุล + จำกัดตาม VISION_MAX_IMAGE_MB — เหมือนเดิมทุกข้อ
const upload = hardenUpload({
  mode: 'memory',
  allowedExtensions: IMAGE_EXTS,
  maxSizeMB: VISION_MAX_IMAGE_MB,
  mimeAllow: IMAGE_MIME,
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function toDataUri(buffer: Buffer, mimetype: string): string {
  return `data:${mimetype};base64,${buffer.toString('base64')}`;
}

// POST /api/vision/analyze — อัปโหลดภาพ → VL model → บันทึก DetectionEvent (ถ้าให้ camera_id)
router.post('/analyze', authenticate, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Invalid image upload', detail: err.message });
    try {
      if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
      const cameraId = typeof req.body?.camera_id === 'string' && req.body.camera_id.trim() ? req.body.camera_id.trim() : null;
      if (cameraId && !isUuid(cameraId)) {
        return res.status(400).json({ error: 'Invalid camera_id format' });
      }
      const base64 = toDataUri(req.file.buffer, req.file.mimetype);
      const result = await runVisionAnalysis(base64, { cameraId });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: 'Vision analysis failed', detail: e?.message || 'unknown' });
    }
  });
});

// POST /api/vision/analyze-url — วิเคราะห์ snapshot จาก URL กล้อง (http://กล้อง/snapshot.jpg)
router.post('/analyze-url', authenticate, async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must be http(s)' });
    if (url.length > 2048) return res.status(400).json({ error: 'url too long' });
    const cameraId = typeof req.body?.camera_id === 'string' && req.body.camera_id.trim() ? req.body.camera_id.trim() : null;
    if (cameraId && !isUuid(cameraId)) return res.status(400).json({ error: 'Invalid camera_id format' });

    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: { 'User-Agent': 'sovereign-os/1.0' },
    });
    const contentType = String(resp.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_MIME.has(contentType)) {
      return res.status(400).json({ error: 'URL does not point to an image (unsupported content-type)' });
    }
    const base64 = `data:${contentType};base64,${Buffer.from(resp.data as Buffer).toString('base64')}`;
    const result = await runVisionAnalysis(base64, { cameraId });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: 'Vision analysis failed', detail: e?.message || 'unknown' });
  }
});

// GET /api/vision/history — รายการตรวจจับย้อนหลัง (จาก DetectionEvent)
router.get('/history', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const cameraId = (req.query.camera_id as string) || '';
    const rows = await prisma.detectionEvent.findMany({
      where: cameraId ? { camera_id: cameraId } : {},
      orderBy: { detected_at: 'desc' },
      take: limit,
      include: { camera: { select: { name: true, location: true } } },
    });
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to load vision history' });
  }
});

export default router;
