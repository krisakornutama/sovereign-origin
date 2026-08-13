// src/services/mqtt-listener.ts
import mqtt from 'mqtt';
import { Pool } from 'pg';
import { EventEmitter } from 'stream';

// TimescaleDB connection pool (dedicated for high‑frequency writes)
const telemetryPool = new Pool({
  host: process.env.TIMESCALE_HOST || 'localhost',
  port: Number(process.env.TIMESCALE_PORT) || 5432,
  database: process.env.TIMESCALE_DB || 'sovereign',
  user: process.env.TIMESCALE_USER,
  password: process.env.TIMESCALE_PASSWORD,
});

// Event bus for system alerts
export const systemEvents = new EventEmitter();

interface EnergyPayload {
  voltage: number;
  current: number;
  power_kw: number;
  battery_soc: number;
}

interface BioSensorPayload {
  soil_moisture: number;
  npk_n: number;
  npk_p: number;
  npk_k: number;
  water_level_cm: number;
}

async function insertTelemetry(
  nodeId: string,
  deviceId: string,
  metric: string,
  value: number
) {
  await telemetryPool.query(
    `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value)
     VALUES (NOW(), $1, $2, $3, $4)`,
    [nodeId, deviceId, metric, value]
  );
}

function parseTopic(topic: string): {
  nodeId: string;
  category: string;
  deviceId: string;
} | null {
  // Expected: sovereign/{node_id}/{category}/{device_id}
  const parts = topic.split('/');
  if (parts.length !== 4 || parts[0] !== 'sovereign') return null;
  const [_, nodeId, category, deviceId] = parts;
  return { nodeId, category, deviceId };
}

export class MqttListenerService {
  private client: mqtt.MqttClient;

  constructor() {
    this.client = mqtt.connect({
      host: process.env.MQTT_HOST || 'localhost',
      port: Number(process.env.MQTT_PORT) || 1883,
      protocol: 'mqtt',           // in production use 'mqtts' with TLS
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASS,
      clientId: `core-listener-${process.pid}`,
      clean: true,
    });

    this.client.on('connect', () => {
      console.log('MQTT listener connected');
      // Subscribe to all nodes, all categories, all devices
      this.client.subscribe('sovereign/+/+/+', { qos: 1 });
    });

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message).catch((err) =>
        console.error('Message handling error:', err)
      );
    });

    this.client.on('error', (err) => {
      console.error('MQTT error:', err);
    });
  }

  private async handleMessage(topic: string, message: Buffer) {
    const parsed = parseTopic(topic);
    if (!parsed) {
      console.warn(`Invalid topic: ${topic}`);
      return;
    }
    const { nodeId, category, deviceId } = parsed;

    let payload: any;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      console.warn(`Invalid JSON on topic ${topic}`);
      return;
    }

    // Insert raw telemetry based on category
    if (category === 'energy') {
      const energy = payload as EnergyPayload;
      // Insert individual metrics
      await insertTelemetry(nodeId, deviceId, 'voltage', energy.voltage);
      await insertTelemetry(nodeId, deviceId, 'current', energy.current);
      await insertTelemetry(nodeId, deviceId, 'power_kw', energy.power_kw);
      await insertTelemetry(nodeId, deviceId, 'battery_soc', energy.battery_soc);

      // Emergency alert: battery low
      if (energy.battery_soc < 20) {
        systemEvents.emit('alert:battery_low', {
          nodeId,
          deviceId,
          battery_soc: energy.battery_soc,
          message: `Critical: Battery SOC dropped to ${energy.battery_soc}%`,
        });
      }
    } else if (category === 'bio') {
      const bio = payload as BioSensorPayload;
      await insertTelemetry(nodeId, deviceId, 'soil_moisture', bio.soil_moisture);
      await insertTelemetry(nodeId, deviceId, 'npk_n', bio.npk_n);
      await insertTelemetry(nodeId, deviceId, 'npk_p', bio.npk_p);
      await insertTelemetry(nodeId, deviceId, 'npk_k', bio.npk_k);
      await insertTelemetry(nodeId, deviceId, 'water_level_cm', bio.water_level_cm);
    } else {
      // Generic sensor: metric field in payload, e.g. {"metric":"temperature","value":27.3}
      if (payload.metric && typeof payload.value === 'number') {
        await insertTelemetry(nodeId, deviceId, payload.metric, payload.value);
      } else {
        console.warn(`Unrecognised payload format for topic ${topic}`);
      }
    }
  }

  async shutdown() {
    this.client.end();
    await telemetryPool.end();
  }
}