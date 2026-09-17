import { Router, raw } from 'express';
import fs from 'fs';
import path from 'path';
import mqtt from 'mqtt';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

export { prisma };

const router = Router();

// โฟลเดอร์เก็บ firmware .bin — ตั้งผ่าน env OTA_DIR
// (ใช้ process.cwd() แทน __dirname เพราะ dev mode รันผ่าน tsx/ESM ที่ __dirname เป็น
//  undefined → path.join โยน exception ทำให้ GET /firmwares ตาย 500 ตลอดใน container)
const OTA_DIR = process.env.OTA_DIR || path.join(process.cwd(), 'ota_firmwares');
// URL ฐานที่ ESP ใช้ดาวน์โหลดไฟล์ — ตั้งเป็น IP/โดเมนของเครื่องนี้ที่ ESP เข้าถึงได้
const OTA_BASE_URL = process.env.OTA_BASE_URL || 'http://localhost:3001';
// ถ้าตั้ง OTA_TOKEN → endpoint download ต้องส่ง ?token= มาตรงกัน (กันคนนอกดาวน์โหลด)
const OTA_TOKEN = process.env.OTA_TOKEN || '';

export const mqttClient = mqtt.connect({
  host: process.env.MQTT_HOST || 'localhost',
  port: Number(process.env.MQTT_PORT) || 1883,
  protocol: 'mqtt',
});
mqttClient.on('connect', () => console.log('🚀 OTA MQTT connected'));
// ต้องมี listener 'error' เสมอ: mqtt client เชื่อมต่อตอน module load (localhost:1883) —
// ถ้า broker ไม่พร้อมแล้ว error event ไม่มีใครรับ = uncaught exception ล้มทั้ง process
// (เคยทำให้ test runner ล้มทั้งไฟล์ด้วย "Unable to deserialize cloned data" แบบสุ่ม)
// client ยัง reconnect เองตามปกติ — เราแค่ไม่ให้ error พุ่งทะลุ
mqttClient.on('error', (err) => console.error('OTA MQTT error:', err instanceof Error ? err.message : err));

function isSafeFileName(name: string): boolean {
  return !!name && path.basename(name) === name && name.endsWith('.bin') && !name.includes('..') && !name.includes('/') && !name.includes('\\');
}

// GET /api/ota/firmwares – รายการ firmware
router.get('/firmwares', authenticate, (req, res) => {
  try {
    if (!fs.existsSync(OTA_DIR)) return res.json([]);
    const files = fs
      .readdirSync(OTA_DIR)
      .filter((f) => f.endsWith('.bin'))
      .map((f) => {
        const st = fs.statSync(path.join(OTA_DIR, f));
        return { file: f, size: st.size, date: st.mtime.toISOString() };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list firmwares' });
  }
});

// POST /api/ota/firmwares?name=esp32_v1.2.bin – อัปโหลด .bin (raw body, SUPERADMIN)
router.post(
  '/firmwares',
  authenticate,
  requireRole('SUPERADMIN'),
  raw({ type: ['application/octet-stream', 'application/x-msdownload', 'application/zip', '*/*'], limit: '16mb' }),
  (req, res) => {
    try {
      const name = String(req.query.name || '');
      if (!isSafeFileName(name)) return res.status(400).json({ error: 'Invalid file name (ต้องลงท้าย .bin)' });
      const buffer = req.body as Buffer;
      // body ว่าง → raw() parser ทิ้ง req.body เป็น {} (object ว่าง) — ต้องเช็คด้วย isBuffer
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) return res.status(400).json({ error: 'Empty file' });
      if (buffer.length > 16 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 16MB)' });

      fs.mkdirSync(OTA_DIR, { recursive: true });
      fs.writeFileSync(path.join(OTA_DIR, name), buffer);
      console.log(`🚀 Firmware uploaded: ${name} (${buffer.length} bytes)`);
      res.json({ success: true, file: name, size: buffer.length });
    } catch (err) {
      console.error('Firmware upload error:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

// GET /api/ota/firmwares/:file – ดาวน์โหลด (ESP ใช้ — ไม่ต้อง login; ถ้าตั้ง OTA_TOKEN ต้องส่ง ?token=)
router.get('/firmwares/:file', (req, res) => {
  const file = req.params.file;
  if (!isSafeFileName(file)) return res.status(400).json({ error: 'Invalid file name' });
  if (OTA_TOKEN && req.query.token !== OTA_TOKEN) return res.status(401).json({ error: 'Invalid token' });

  const filePath = path.join(OTA_DIR, file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.download(filePath, file);
});

// DELETE /api/ota/firmwares/:file (SUPERADMIN)
router.delete('/firmwares/:file', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const file = req.params.file;
  if (!isSafeFileName(file)) return res.status(400).json({ error: 'Invalid file name' });
  const filePath = path.join(OTA_DIR, file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

// POST /api/ota/deploy { nodeId, file } – สั่ง ESP ผ่าน MQTT ให้ OTA (SUPERADMIN)
router.post('/deploy', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { nodeId, file } = req.body || {};
    if (!nodeId || typeof nodeId !== 'string') return res.status(400).json({ error: 'nodeId required' });
    if (!isSafeFileName(String(file || ''))) return res.status(400).json({ error: 'Invalid firmware file' });
    const filePath = path.join(OTA_DIR, String(file));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Firmware not found' });

    const url = `${OTA_BASE_URL}/api/ota/firmwares/${encodeURIComponent(file)}${OTA_TOKEN ? `?token=${OTA_TOKEN}` : ''}`;
    const topic = `sovereign/${nodeId}/ota/command`;
    const payload = JSON.stringify({ url, file, version: String(file).replace(/\.bin$/, '') });

    mqttClient.publish(topic, payload);

    // บันทึกคำสั่ง deploy ลง DB (ผลจากอุปกรณ์จะมาต่อผ่าน ota-status listener)
    await prisma.otaEvent.create({
      data: {
        node_id: nodeId,
        type: 'deploy',
        status: 'sent',
        firmware: String(file),
        version: String(file).replace(/\.bin$/, ''),
      },
    });

    console.log(`🚀 OTA deploy: ${nodeId} <- ${file} (topic: ${topic})`);
    res.json({ success: true, topic, payload });
  } catch (err) {
    console.error('OTA deploy error:', err);
    res.status(500).json({ error: 'Deploy failed' });
  }
});

// GET /api/ota/events?limit=50 – ประวัติ OTA ทั้งหมด (คำสั่ง + ผลจากอุปกรณ์)
router.get('/events', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const events = await prisma.otaEvent.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    res.json(events);
  } catch (err) {
    console.error('OTA events error:', err);
    res.status(500).json({ error: 'Failed to load OTA events' });
  }
});

export default router;
