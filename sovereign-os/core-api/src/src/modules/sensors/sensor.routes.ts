import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../../middleware/auth.middleware';
import { config } from '../../config';

const router = Router();

// GET /api/sensors/devices
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
    res.json(result);
  } catch (err) {
    res.status(500).json([]);
  }
});

// POST /api/sensors/devices
router.post('/devices', authenticate, async (req, res) => {
  try {
    const { name, type, mqtt_topic, node_id } = req.body;
    const device = await prisma.device.create({
      data: {
        node_id: node_id || config.defaults.telemetryNodeId,
        type,
        mqtt_topic: mqtt_topic || `sovereign/${name}/sensor/+`,
        is_active: true,
      },
    });
    res.status(201).json(device);
  } catch (err) {
    res.status(500).json({ error: 'สร้างอุปกรณ์ไม่สำเร็จ' });
  }
});

// DELETE /api/sensors/devices/:id
router.delete('/devices/:id', authenticate, async (req, res) => {
  try {
    await prisma.device.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'ลบไม่สำเร็จ' });
  }
});

// POST /api/sensors/generate-code
router.post('/generate-code', authenticate, async (req, res) => {
  const { type, sensors, wifiSSID, wifiPass, mqttServer, deviceId } = req.body;
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
});

export default router;