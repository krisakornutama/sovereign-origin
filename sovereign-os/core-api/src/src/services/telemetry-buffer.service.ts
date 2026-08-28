// src/services/telemetry-buffer.service.ts
// Telemetry Downsampling — ข้อ 4: ลด write ทุกวินาทีเป็น 1 นาที (60:1)
// sensor → MQTT → buffer ใน RAM (avg ต่อ node+metric) → flush ทุก TELEMETRY_FLUSH_MS
// เป็น batch INSERT ครั้งเดียว (multi-VALUES) แทนการ INSERT ทีละ message
// Realtime path (SSE telemetry_update / alert) ยังส่งทันทีทุก message — เฉพาะการเขียน DB ที่ downsample

export interface TelemetryRow {
  time: Date;
  nodeId: string;
  deviceId: string;
  metric: string;
  value: number;
}

const TELEMETRY_FLUSH_MS = parseInt(process.env.TELEMETRY_FLUSH_MS || '60000', 10) || 60000;

export class TelemetryBuffer {
  private buckets = new Map<string, { deviceId: string; count: number; sum: number }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  add(nodeId: string, metric: string, value: number, deviceId = 'mqtt-auto'): void {
    const key = `${nodeId}|${metric}`;
    const b = this.buckets.get(key);
    if (b) {
      b.count += 1;
      b.sum += value;
    } else {
      this.buckets.set(key, { deviceId, count: 1, sum: value });
    }
  }

  // คืน 1 แถวต่อ (node, metric) ด้วยค่าเฉลี่ยของช่วง แล้วล้าง buffer
  drain(): TelemetryRow[] {
    const rows: TelemetryRow[] = [];
    const t = this.now();
    for (const [key, b] of this.buckets) {
      const sep = key.indexOf('|');
      rows.push({
        time: t,
        nodeId: key.slice(0, sep),
        deviceId: b.deviceId,
        metric: key.slice(sep + 1),
        value: b.sum / b.count,
      });
    }
    this.buckets.clear();
    return rows;
  }

  size(): number {
    return this.buckets.size;
  }
}

export const telemetryBuffer = new TelemetryBuffer();
export { TELEMETRY_FLUSH_MS };