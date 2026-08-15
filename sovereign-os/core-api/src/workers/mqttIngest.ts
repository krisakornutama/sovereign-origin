import mqtt from 'mqtt';
import { Pool } from 'pg';
import EventEmitter from 'events';
import { PrismaClient } from '@prisma/client';
import { firstResponder } from '../services/first-responder.service';
import { relayGuard } from '../services/relay-guard.service';
import { telemetryBuffer, TELEMETRY_FLUSH_MS } from '../services/telemetry-buffer.service';

const prisma = new PrismaClient();
const telemetryPool = new Pool({
  host: process.env.TIMESCALE_HOST || 'localhost',
  port: Number(process.env.TIMESCALE_PORT) || 5432,
  database: process.env.TIMESCALE_DB || 'sovereign',
  // No hardcoded credentials – read from env (see .env.example).
  user: process.env.TIMESCALE_USER,
  password: process.env.TIMESCALE_PASSWORD,
});

export const systemEvents = new EventEmitter();

// ข้อ 4: Downsample — buffer ถูก flush เป็น batch INSERT ทุก TELEMETRY_FLUSH_MS (60s)
// 1 แถวต่อ (node, metric) ด้วยค่าเฉลี่ยของช่วง แทนการ INSERT ทีละ message (60:1)
async function flushTelemetry() {
  const rows = telemetryBuffer.drain();
  if (!rows.length) return;
  try {
    const values = rows
      .map((_, i) => `(NOW(), $${i * 4 + 1}::uuid, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
      .join(', ');
    const params = rows.flatMap((r) => [r.nodeId, r.deviceId, r.metric, r.value]);
    await telemetryPool.query(
      `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value) VALUES ${values}`,
      params
    );
  } catch (err) {
    console.error('Failed to flush telemetry:', err);
  }
}

// เรียกจากภายนอก (เช่น UPS graceful shutdown) ให้เท buffer ลง DB ทันที
export async function flushTelemetryNow(): Promise<void> {
  await flushTelemetry();
}

function parseTopic(topic: string): { nodeId: string; category: string; deviceId?: string } | null {
  const parts = topic.split('/');
  if (parts.length === 4 && parts[0] === 'sovereign' && parts[2] === 'sensor') {
    return { nodeId: parts[1], category: parts[3] };
  }
  if (parts.length === 3 && parts[0] === 'sovereign' && parts[2] === 'heartbeat') {
    return { nodeId: parts[1], category: 'heartbeat', deviceId: undefined };
  }
  // Phase 6 — Zero-Trust: ปุ่มฉุกเฉินกลไกในบ้าน (sovereign/{node}/emergency/button)
  if (parts.length === 4 && parts[0] === 'sovereign' && parts[2] === 'emergency' && parts[3] === 'button') {
    return { nodeId: parts[1], category: 'emergency_button', deviceId: undefined };
  }
  // Phase 6 — Relay chatter จากชิป/เฟิร์มแวร์ (sovereign/{node}/relay/{relayId})
  if (parts.length === 4 && parts[0] === 'sovereign' && parts[2] === 'relay') {
    return { nodeId: parts[1], category: 'relay_state', deviceId: parts[3] };
  }
  return null;
}

export class MqttIngestionWorker {
  private client: mqtt.MqttClient;
  private flushTimer?: NodeJS.Timeout;

  constructor() {
    const host = process.env.MQTT_HOST || 'localhost';
    const port = Number(process.env.MQTT_PORT) || 1883;
    this.client = mqtt.connect({
      host,
      port,
      protocol: 'mqtt',
      clientId: `worker-${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
    });

    // ข้อ 4: flush buffer ทุก 1 นาที (batch INSERT แทน write ทุกวินาที)
    this.flushTimer = setInterval(() => {
      flushTelemetry().catch(() => {});
    }, TELEMETRY_FLUSH_MS);
    this.flushTimer.unref?.();

    this.client.on('connect', () => {
      console.log('✅ MQTT connected');
      this.client.subscribe('sovereign/+/sensor/+', { qos: 1 });
      this.client.subscribe('sovereign/+/heartbeat', { qos: 1 });
      this.client.subscribe('sovereign/+/emergency/button', { qos: 1 });
      this.client.subscribe('sovereign/+/relay/+', { qos: 1 });
    });

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message);
    });
  }

  private async handleMessage(topic: string, message: Buffer) {
    const parsed = parseTopic(topic);
    if (!parsed) return;

    if (parsed.category === 'emergency_button') {
      // Zero-Trust Emergency Activation: ปุ่มกลไกในบ้านเท่านั้น — source='physical'
      const payload = message.toString().trim().toUpperCase();
      const on = payload === '1' || payload === 'ON' || payload === 'TRUE';
      const off = payload === '0' || payload === 'OFF' || payload === 'FALSE';
      if (on || off) {
        await firstResponder.activatePhysical(parsed.nodeId, on);
      }
      return;
    }

    if (parsed.category === 'relay_state') {
      // Relay Chattering จากชิป/เฟิร์มแวร์ — ตรวจจับอัตราสับ แล้วแจ้งเตือน/ล็อก
      const state = message.toString().trim();
      if (state === '0' || state === '1') {
        await relayGuard.onDeviceState(parsed.nodeId, parsed.deviceId!);
      }
      return;
    }

    if (parsed.category === 'heartbeat') {
      const deviceId = message.toString().trim();
      if (!deviceId) return;
      try {
        await prisma.device.updateMany({
          where: { id: deviceId },
          data: { last_heartbeat: new Date() },
        });
      } catch (e) {
        // device not in DB – ignore
      }
      return;
    }

    let value: number;
    try {
      const payload = JSON.parse(message.toString());
      value = parseFloat(payload.value ?? payload.val ?? payload);
    } catch {
      value = parseFloat(message.toString());
    }
    if (isNaN(value)) return;

    const { nodeId, category } = parsed;
    telemetryBuffer.add(nodeId, category, value); // ข้อ 4: ลง buffer ก่อน (flush 1 นาที)

    systemEvents.emit('telemetry_update', {
      node_id: nodeId,
      [category]: value,
    });
  }

  async shutdown() {
    await flushTelemetry(); // เท buffer ที่เหลือก่อนปิด
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.client.end();
    await telemetryPool.end();
  }
}