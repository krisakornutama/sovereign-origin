import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { config } from '../../config';

const router = Router();

// อุปกรณ์ = config จริงของบ้าน (ลบแล้วประวัติ/ค่า sensor ของอุปกรณ์นั้นหายตาม)
// ⇒ เขียนได้เฉพาะ role ที่ดูแลระบบ ไม่ใช่ทุกบัญชีที่ล็อกอินแล้ว (KID/SYSTEM_AI ไม่ได้)
const DEVICE_WRITE_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'SITE_ADMIN', 'OPERATOR'] as const;
const DEVICE_TYPE_PATTERN = /^[A-Za-z0-9 _.-]{1,32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ทำชื่ออุปกรณ์ให้เป็น segment ของ MQTT topic ที่ปลอดภัย
 * — `/`, `+`, `#` ในชื่อจะกลายเป็น wildcard/ชั้น topic ที่ไม่ตั้งใจ (`#` = ทุก topic)
 * — ภาษาไทยใช้ได้ (MQTT เป็น UTF-8) แต่ช่องว่างกลายเป็น `-` เพื่อให้ topic อ่านง่าย
 */
function topicSegment(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/[\s/+#\u0000-\u001f\u007f]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * ค่าที่จะฝังลงสตริง C (`const char* ssid = "…"`) ต้องถูก escape ก่อนเสมอ
 * — quote/backslash/ขึ้นบรรทัดใหม่จากผู้ใช้ ถ้าไม่ escape จะหลุดออกจากสตริง
 * กลายเป็นโค้ดที่ถูกแฟลชลงอุปกรณ์ (และอย่างน้อยที่สุดคือสเก็ตช์คอมไพล์ไม่ผ่าน)
 */
function cString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, max)
    .replace(/[\\"\u0000-\u001f\u007f]/g, (ch) => {
      if (ch === '\\') return '\\\\';
      if (ch === '"') return '\\"';
      if (ch === '\n') return '\\n';
      if (ch === '\r') return '\\r';
      if (ch === '\t') return '\\t';
      return `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
    });
}

/** เพดานจำนวน sensor ต่อการสร้างโค้ดหนึ่งครั้ง — กันการสร้างโค้ดเป็นพันบรรทัดจากคำขอเดียว */
const MAX_GENERATED_SENSORS = 32;

// GET /api/sensors/devices
// อ่าน DB ไม่ได้ ≠ ไม่มีอุปกรณ์ — คืน degraded flag ให้ UI พูดว่า "ไม่รู้" ไม่ใช่ "0 อุปกรณ์"
router.get('/devices', authenticate, async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      where: { is_active: true },
      orderBy: { last_heartbeat: 'desc' },
    });
    const now = Date.now();
    const result = [];
    for (const d of devices) {
      const sensors = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT DISTINCT ON (metric) metric, value FROM sensor_telemetry WHERE device_id = $1 ORDER BY metric, time DESC`,
        d.id
      );
      const online = d.last_heartbeat && (now - new Date(d.last_heartbeat).getTime()) < 120000;
      result.push({
        ...d,
        online,
        sensors: sensors.map(s => ({ metric: s.metric, value: s.value })),
      });
    }
    res.json({ devices: result, degraded: false, source: 'db' });
  } catch (err) {
    res.json({
      devices: [],
      degraded: true,
      source: 'unavailable',
      reason: 'อ่านรายการอุปกรณ์จากฐานข้อมูลไม่ได้',
      detail: String((err as Error)?.message || '').slice(0, 200),
    });
  }
});

// POST /api/sensors/devices
router.post('/devices', authenticate, requireRole(...DEVICE_WRITE_ROLES), async (req, res) => {
  const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
  if (!DEVICE_TYPE_PATTERN.test(type)) {
    return res.status(400).json({
      error: 'type ต้องเป็นตัวอักษร/ตัวเลข/ขีด ยาว 1-32 ตัว (เช่น ESP32, ESP8266, RaspberryPi)',
    });
  }
  const nodeId = req.body?.node_id;
  if (nodeId !== undefined && nodeId !== null && nodeId !== '' && (typeof nodeId !== 'string' || !UUID_PATTERN.test(nodeId))) {
    return res.status(400).json({ error: 'node_id ต้องเป็น UUID ที่ถูกต้อง' });
  }
  // name ไม่มีคอลัมน์เก็บใน devices — ใช้สร้าง mqtt_topic เท่านั้น (ต้องบอกในเอกสาร)
  const segment = topicSegment(req.body?.name) || 'device';
  const providedTopic = req.body?.mqtt_topic;
  let mqttTopic: string;
  if (providedTopic !== undefined && providedTopic !== null && providedTopic !== '') {
    if (typeof providedTopic !== 'string' || providedTopic.trim().length < 3 || providedTopic.trim().length > 200 || /[\s\u0000-\u001f]/.test(providedTopic)) {
      return res.status(400).json({ error: 'mqtt_topic ต้องยาว 3-200 ตัวและไม่มีช่องว่าง/อักขระควบคุม' });
    }
    mqttTopic = providedTopic.trim();
  } else {
    mqttTopic = `sovereign/${segment}/sensor/+`;
  }
  try {
    const device = await prisma.device.create({
      data: {
        node_id: (nodeId as string) || config.defaults.telemetryNodeId,
        type,
        mqtt_topic: mqttTopic,
        is_active: true,
      },
    });
    res.status(201).json(device);
  } catch (err) {
    res.status(500).json({ error: 'สร้างอุปกรณ์ไม่สำเร็จ', detail: String((err as Error)?.message || '').slice(0, 200) });
  }
});

// DELETE /api/sensors/devices/:id
router.delete('/devices/:id', authenticate, requireRole(...DEVICE_WRITE_ROLES), async (req, res) => {
  const id = req.params.id;
  // @db.Uuid: id ผิดรูปแบบทำให้ Prisma โยน P2023 — ต้องบอกก่อนถึง DB
  if (!UUID_PATTERN.test(id)) {
    return res.status(400).json({ error: 'id ต้องเป็น UUID ของอุปกรณ์' });
  }
  try {
    await prisma.device.delete({ where: { id } });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return res.status(404).json({ error: 'ไม่พบอุปกรณ์นี้ (อาจถูกลบไปแล้ว)' });
    }
    res.status(500).json({ error: 'ลบไม่สำเร็จ', detail: String(err?.message || '').slice(0, 200) });
  }
});

// POST /api/sensors/generate-code
// แยกตัวสร้างโค้ดออกจาก handler เพื่อดัก error ได้ — Express 4 ไม่ดัก async throw
// (handler ที่โยน error จะค้างไม่ตอบ ไม่ใช่ 500)
router.post('/generate-code', authenticate, (req: Request, res: Response) => {
  try {
    buildSensorSketch(req, res);
  } catch (err) {
    console.error('Generate sensor code error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'สร้างโค้ดไม่สำเร็จ' });
  }
});

function buildSensorSketch(req: Request, res: Response) {
  const { type } = req.body || {};
  const rawSensors = req.body?.sensors;
  // `sensors` ต้องเป็น array เท่านั้น — ก่อนหน้านี้ค่าอื่นทำให้ sensors.map โยน TypeError
  // ใน async handler = คำขอค้างจน timeout (ไม่ใช่ 400)
  if (!Array.isArray(rawSensors)) {
    res.status(400).json({ error: 'sensors ต้องเป็น array ของชื่อเซ็นเซอร์ เช่น ["temperature"]' });
    return;
  }
  if (rawSensors.length > MAX_GENERATED_SENSORS) {
    res.status(400).json({ error: `sensors เกิน ${MAX_GENERATED_SENSORS} รายการ — ลดจำนวนแล้วลองใหม่` });
    return;
  }
  const sensors = rawSensors.map((s: unknown) => String(s));
  const wifiSSID = cString(req.body?.wifiSSID, 64);
  const wifiPass = cString(req.body?.wifiPass, 64);
  const mqttServer = cString(req.body?.mqttServer, 64);
  const deviceId = cString(req.body?.deviceId, 64);
  const mqttHost = mqttServer || '10.12.55.234';
  const nodeId = config.defaults.telemetryNodeId;
  const deviceName = deviceId || `Sovereign-${Date.now()}`;

  let code = '';
  if (type === 'ESP8266' || type === 'ESP32') {
    code = `#include <${type === 'ESP32' ? 'WiFi' : 'ESP8266WiFi'}.h>
#include <PubSubClient.h>
${sensors.includes('temperature') || sensors.includes('humidity') ? '#include <DHT.h>' : ''}

const char* ssid = "${wifiSSID || 'YOUR_SSID'}";
const char* password = "${wifiPass || 'YOUR_PASS'}";
const char* mqtt_server = "${mqttHost}";
const char* device_id = "${deviceName}";

WiFiClient espClient;
PubSubClient client(espClient);

${sensors.includes('temperature') || sensors.includes('humidity') ? '#define DHTPIN 4\n#define DHTTYPE DHT22\nDHT dht(DHTPIN, DHTTYPE);' : ''}

void setup() {
  Serial.begin(115200);
  ${sensors.includes('temperature') || sensors.includes('humidity') ? 'dht.begin();' : ''}
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); }
  client.setServer(mqtt_server, 1883);
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect(device_id)) {
      Serial.println("MQTT Connected");
    } else { delay(2000); }
  }
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();
  // Heartbeat
  client.publish("sovereign/${nodeId}/heartbeat", device_id);
${sensors.map((s: string) => {
  switch(s) {
    case 'temperature': return '  float temp = dht.readTemperature();\n  if (!isnan(temp)) client.publish("sovereign/${nodeId}/sensor/temperature", String(temp).c_str());';
    case 'humidity': return '  float hum = dht.readHumidity();\n  if (!isnan(hum)) client.publish("sovereign/${nodeId}/sensor/humidity", String(hum).c_str());';
    case 'rain_detect': return '  int rain = digitalRead(5);\n  client.publish("sovereign/${nodeId}/sensor/rain_detect", String(rain == LOW ? 1 : 0).c_str());';
    case 'pir_motion': return '  int pir = digitalRead(12);\n  client.publish("sovereign/${nodeId}/sensor/pir_motion", String(pir).c_str());';
    case 'door_state': return '  int door = digitalRead(13);\n  client.publish("sovereign/${nodeId}/sensor/door_state", String(door).c_str());';
    case 'smoke': return '  int smoke = digitalRead(14);\n  client.publish("sovereign/${nodeId}/sensor/smoke", String(smoke).c_str());';
    case 'gas_leak': return '  int gas = digitalRead(15);\n  client.publish("sovereign/${nodeId}/sensor/gas_leak", String(gas).c_str());';
    default: return '';
  }
}).join('\n')}
  delay(5000);
}`;
  } else {
    code = '// Code generation for this controller type not yet available';
  }

  res.json({ code });
}

export default router;