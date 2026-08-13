import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { PrismaClient } from '@prisma/client';
import mqtt from 'mqtt';

const router = Router();
const prisma = new PrismaClient();

const mqttClient = mqtt.connect({
  host: process.env.MQTT_HOST || 'localhost',
  port: Number(process.env.MQTT_PORT) || 1883,
  protocol: 'mqtt',
});

mqttClient.on('connect', () => console.log('Relay MQTT connected'));

const DEFAULT_NODE_ID = '11111111-1111-1111-1111-111111111111';

const DEFAULT_RELAYS = [
  { id: 'relay1', label: 'ปั๊มน้ำ' },
  { id: 'relay2', label: 'ไฟสวน' },
  { id: 'relay3', label: 'พัดลม' },
];

// สร้าง relay เริ่มต้นเมื่อรันครั้งแรก (ถ้ายังไม่มีใน DB)
async function ensureDefaultRelays() {
  try {
    const count = await prisma.relay.count();
    if (count > 0) return;
    for (const relay of DEFAULT_RELAYS) {
      await prisma.relay.create({
        data: { id: relay.id, node_id: DEFAULT_NODE_ID, label: relay.label, state: 0 },
      });
    }
    console.log(`⚙️ Created ${DEFAULT_RELAYS.length} default relays`);
  } catch (err) {
    console.error(
      'Failed to seed default relays (relays table missing? run `npx prisma migrate dev`):',
      err
    );
  }
}
ensureDefaultRelays();

// GET /api/relay/status – สถานะจริงจากฐานข้อมูล
router.get('/status', authenticate, async (req, res) => {
  try {
    const relays = await prisma.relay.findMany({ orderBy: { id: 'asc' } });
    res.json(relays.map((r) => ({ relayId: r.id, label: r.label, state: r.state })));
  } catch (err) {
    console.error('Relay status error:', err);
    res.status(500).json({ error: 'Failed to load relay status' });
  }
});

// POST /api/relay/control – อัปเดตสถานะใน DB แล้วส่งคำสั่งผ่าน MQTT
router.post('/control', authenticate, async (req, res) => {
  try {
    const { nodeId, relayId, state } = req.body;
    if (state !== 0 && state !== 1) {
      return res.status(400).json({ error: 'state must be 0 or 1' });
    }
    if (!relayId) {
      return res.status(400).json({ error: 'relayId required' });
    }

    const relay = await prisma.relay.findUnique({ where: { id: relayId } });
    if (!relay) {
      return res.status(404).json({ error: `Relay ${relayId} not found` });
    }

    const effectiveNode = nodeId || relay.node_id;
    const topic = `sovereign/${effectiveNode}/relay/${relayId}`;
    mqttClient.publish(topic, String(state));

    // บันทึกสถานะจริงลง DB
    await prisma.relay.update({ where: { id: relayId }, data: { state } });

    res.json({ success: true, relayId, state, topic });
  } catch (err) {
    console.error('Relay control error:', err);
    res.status(500).json({ error: 'Failed to send command' });
  }
});

// ---------- Scheduled Relay (CRUD) ----------

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS_PATTERN = /^(\*|([1-7](,[1-7])*))$/;

// GET /api/relay/schedules – รายการตารางเวลาทั้งหมด
router.get('/schedules', authenticate, async (req, res) => {
  try {
    const schedules = await prisma.relaySchedule.findMany({
      orderBy: { time: 'asc' },
      include: { relay: { select: { id: true, label: true } } },
    });
    res.json(
      schedules.map((s) => ({
        id: s.id,
        relayId: s.relay_id,
        relayLabel: s.relay.label,
        enabled: s.enabled,
        time: s.time,
        state: s.state,
        days: s.days,
      }))
    );
  } catch (err) {
    console.error('Relay schedules error:', err);
    res.status(500).json({ error: 'Failed to load schedules' });
  }
});

// POST /api/relay/schedules – สร้างตารางเวลาใหม่
router.post('/schedules', authenticate, async (req, res) => {
  try {
    const { relayId, time, state, days, enabled } = req.body;
    if (!relayId) return res.status(400).json({ error: 'relayId required' });
    if (!TIME_PATTERN.test(time || '')) {
      return res.status(400).json({ error: 'time must be HH:mm (24h format)' });
    }
    if (state !== 0 && state !== 1) {
      return res.status(400).json({ error: 'state must be 0 or 1' });
    }
    const daysValue = days === undefined || days === null ? '*' : String(days);
    if (!DAYS_PATTERN.test(daysValue)) {
      return res.status(400).json({ error: 'days must be "*" or comma-separated 1-7' });
    }

    const relay = await prisma.relay.findUnique({ where: { id: relayId } });
    if (!relay) return res.status(404).json({ error: 'Relay not found' });

    const schedule = await prisma.relaySchedule.create({
      data: {
        relay_id: relayId,
        time,
        state,
        days: daysValue,
        enabled: enabled !== false,
      },
    });
    res.status(201).json({ success: true, id: schedule.id });
  } catch (err) {
    console.error('Create schedule error:', err);
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

// PUT /api/relay/schedules/:id – เปิด/ปิดตารางเวลา
router.put('/schedules/:id', authenticate, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be boolean' });
    }
    await prisma.relaySchedule.update({ where: { id: req.params.id }, data: { enabled } });
    res.json({ success: true });
  } catch (err) {
    console.error('Update schedule error:', err);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

// DELETE /api/relay/schedules/:id – ลบตารางเวลา
router.delete('/schedules/:id', authenticate, async (req, res) => {
  try {
    await prisma.relaySchedule.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete schedule error:', err);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

export default router;