// MQTT client กลาง — ใช้ร่วมทุกโมดูล (relay / ota / relay-scheduler)
//
// ทำไมต้องมี: เดิมแต่ละโมดูลเรียก `mqtt.connect()` เองตอน import ⇒ เมื่อ broker ไม่มี
// (เช่นในชุดเทสต์ หรือเครื่องที่ไม่มีชั้น IoT) mqtt.js จะ reconnect ทุก 1 วิตลอดไป
// socket จึงค้างขวาง process ไม่ให้จบ — เคสจริง 16/11/69: CI matrix (ubuntu/windows)
// ค้างชน timeout 25 นาที เพราะเทสต์ role gate ของ relay import router นี้
//
// กติกา:
// - production (ไม่ตั้ง flag) = ต่อ MQTT จริงเหมือนเดิม
// - ชุดเทสต์ตั้ง `MQTT_DISABLED=1` ⇒ ได้ client หลอกที่ API เหมือนกัน (publish/on/end)
//   ไม่เปิด socket เลย ⇒ process จบได้เอง และเทสต์เดิมที่ mock `publish` ยังทำงานได้
import mqtt from 'mqtt';

export interface MqttLikeClient {
  connected: boolean;
  publish: (topic: string, message: string) => MqttLikeClient;
  on: (event: string, listener: (...args: unknown[]) => void) => MqttLikeClient;
  end: (force?: boolean, opts?: unknown, cb?: () => void) => MqttLikeClient;
}

export function isMqttDisabled(): boolean {
  return process.env.MQTT_DISABLED === '1';
}

/** client หลอก: รูปร่างเหมือน mqtt.js แต่ไม่แตะเครือข่ายเลย */
function createNoopClient(): MqttLikeClient {
  const noop: MqttLikeClient = {
    connected: false,
    publish: () => noop,
    on: () => noop,
    end: (_force?: boolean, opts?: unknown, cb?: () => void) => {
      const done = typeof opts === 'function' ? (opts as () => void) : cb;
      if (typeof done === 'function') done();
      return noop;
    },
  };
  return noop;
}

/**
 * สร้าง (หรือคืน) client ตาม env — เรียกได้ที่ระดับโมดูลเหมือนเดิม
 * @param label ใช้ใน log เพื่อรู้ว่าตัวไหนต่อ/หลุด
 */
export function createMqttClient(label: string): MqttLikeClient {
  if (isMqttDisabled()) return createNoopClient();

  const client = mqtt.connect({
    host: process.env.MQTT_HOST || 'localhost',
    port: Number(process.env.MQTT_PORT) || 1883,
    protocol: 'mqtt',
    reconnectPeriod: Number(process.env.MQTT_RECONNECT_MS ?? 1000),
  });

  // กัน process ตายเมื่อ EMQX ถูกหยุดในโหมดที่ไม่มีชั้น IoT
  client.on('error', (err) =>
    console.error(`${label} MQTT error:`, err instanceof Error ? err.message : err),
  );
  client.on('connect', () => console.log(`${label} MQTT connected`));

  return client as unknown as MqttLikeClient;
}
