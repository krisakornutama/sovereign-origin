import mqtt from 'mqtt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * ฟังผล OTA จากอุปกรณ์ผ่าน MQTT topic: sovereign/{nodeId}/ota/status
 * payload (JSON): { "status": "success"|"failed"|"rebooted", "version": "...", "error": "..." }
 */
export class OtaStatusService {
  private client: mqtt.MqttClient;

  constructor() {
    this.client = mqtt.connect({
      host: process.env.MQTT_HOST || 'localhost',
      port: Number(process.env.MQTT_PORT) || 1883,
      protocol: 'mqtt',
      clientId: `ota-status-${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => {
      console.log('🚀 OTA Status listener connected');
      this.client.subscribe('sovereign/+/ota/status', { qos: 1 });
    });

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message).catch((err) =>
        console.error('OTA status handle error:', err)
      );
    });
  }

  private async handleMessage(topic: string, message: Buffer): Promise<void> {
    const parts = topic.split('/');
    if (parts.length !== 4 || parts[0] !== 'sovereign' || parts[2] !== 'ota') return;
    const nodeId = parts[1];

    let payload: any = {};
    try {
      payload = JSON.parse(message.toString());
    } catch {
      // ไม่ใช่ JSON → ใช้ raw text เป็น status
      payload = { status: message.toString().trim() };
    }

    const status = String(payload.status || 'unknown');
    // อนุญาตเฉพาะค่าที่รู้จัก
    const normalized = ['success', 'failed', 'rebooted'].includes(status) ? status : 'unknown';

    const event = await prisma.otaEvent.create({
      data: {
        node_id: nodeId,
        type: 'status',
        status: normalized,
        version: payload.version ? String(payload.version) : null,
        error: payload.error ? String(payload.error).slice(0, 500) : null,
      },
    });

    console.log(
      `🚀 OTA status from ${nodeId}: ${normalized}${payload.version ? ' (v' + payload.version + ')' : ''}${payload.error ? ' — ' + payload.error : ''}`
    );
  }
}
