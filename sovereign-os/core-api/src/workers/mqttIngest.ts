import mqtt from 'mqtt';
import { Pool } from 'pg';
import EventEmitter from 'events';
import { PrismaClient } from '@prisma/client';

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

async function insertTelemetry(nodeId: string, metric: string, value: number, deviceId: string = 'mqtt-auto') {
  try {
    await telemetryPool.query(
      `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value)
       VALUES (NOW(), $1::uuid, $2, $3, $4)`,
      [nodeId, deviceId, metric, value]
    );
  } catch (err) {
    console.error('Failed to insert telemetry:', err);
  }
}

function parseTopic(topic: string): { nodeId: string; category: string; deviceId?: string } | null {
  const parts = topic.split('/');
  if (parts.length === 4 && parts[0] === 'sovereign' && parts[2] === 'sensor') {
    return { nodeId: parts[1], category: parts[3] };
  }
  if (parts.length === 3 && parts[0] === 'sovereign' && parts[2] === 'heartbeat') {
    return { nodeId: parts[1], category: 'heartbeat', deviceId: undefined };
  }
  return null;
}

export class MqttIngestionWorker {
  private client: mqtt.MqttClient;

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

    this.client.on('connect', () => {
      console.log('✅ MQTT connected');
      this.client.subscribe('sovereign/+/sensor/+', { qos: 1 });
      this.client.subscribe('sovereign/+/heartbeat', { qos: 1 });
    });

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message);
    });
  }

  private async handleMessage(topic: string, message: Buffer) {
    const parsed = parseTopic(topic);
    if (!parsed) return;

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
    await insertTelemetry(nodeId, category, value);

    systemEvents.emit('telemetry_update', {
      node_id: nodeId,
      [category]: value,
    });
  }

  async shutdown() {
    this.client.end();
    await telemetryPool.end();
  }
}