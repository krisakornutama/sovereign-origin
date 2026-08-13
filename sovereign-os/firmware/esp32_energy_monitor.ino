# ESP32 Energy Monitor — วัด โวลต์/กระแส/กำลังไฟ แล้วส่งเข้าระบบ
#
# อุปกรณ์: ESP32 DevKit + โมดูล INA219 (วัดกระแส-แรงดัน, I2C)
# ส่ง MQTT เป็น JSON ไป topic:  sovereign/{NODE_ID}/inverter/energy
#   {"voltage":225.4,"current":3.21,"power_kw":0.72,"battery_soc":78.5}
# ระบบ (mqtt-listener) จะแยกเก็บเป็น metric: voltage/current/power_kw/battery_soc
# และเตือนอัตโนมัติเมื่อ battery_soc < 20%
#
# ต่อสาย INA219: VIN+ ← ไฟขาเข้าจากแหล่งจ่าย, VIN- ← ไปโหลด
#   (ใช้ตัวนี้กับไฟ DC ได้ง่ายที่สุด เช่น ระบบโซลาร์ 12V/24V)
# =============================================================

#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <ArduinoJson.h>

// ========== CONFIG ==========
const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_WIFI_PASS";
const char* mqtt_server = "10.12.55.234";
const int mqtt_port = 1883;
const char* device_id = "ESP32-Energy-01";
const char* node_id = "11111111-1111-1111-1111-111111111111";
const char* topic = "sovereign/11111111-1111-1111-1111-111111111111/inverter/energy";

// แรงดันแบตเตอรี่เฉลี่ย + ความจุ (kWh) — ใช้คิง battery_soc เองถ้าไม่มีเซ็นเซอร์แบต
const float BATTERY_VOLTAGE_NOMINAL = 12.0;
const float POWER_WH_PER_PERCENT = 50.0; // 1% ของแบต เท่ากับ 50Wh

Adafruit_INA219 ina219;
WiFiClient espClient;
PubSubClient client(espClient);

float batterySoc = -1;

void setup() {
  Serial.begin(115200);
  Wire.begin();
  if (!ina219.begin()) {
    Serial.println("INA219 not found — ตรวจสาย I2C (SDA=21, SCL=22)");
  }

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi connected");
  client.setServer(mqtt_server, mqtt_port);
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect(device_id)) {
      Serial.println("MQTT connected");
    } else {
      Serial.print("MQTT failed rc=");
      Serial.println(client.state());
      delay(2000);
    }
  }
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  float busVoltage = ina219.getBusVoltage_V(); // แรงดันฝั่งโหลด (V)
  float shuntVoltage = ina219.getShuntVoltage_mV();
  float current = ina219.getCurrent_mA() / 1000.0; // A
  float power = ina219.getPower_mW() / 1000.0;     // W
  float voltage = busVoltage + (shuntVoltage / 1000.0);

  if (voltage > 0) {
    batterySoc = constrain((voltage - 11.0) / (BATTERY_VOLTAGE_NOMINAL - 11.0) * 100.0, 0, 100);
  }

  StaticJsonDocument<256> doc;
  doc["voltage"] = roundf(voltage * 10) / 10;
  doc["current"] = roundf(current * 100) / 100;
  doc["power_kw"] = roundf(power / 1000.0 * 10000) / 10000;
  if (batterySoc >= 0) doc["battery_soc"] = roundf(batterySoc * 10) / 10;

  char buf[256];
  serializeJson(doc, buf);
  client.publish(topic, buf);
  Serial.println(buf);

  client.publish(String("sovereign/") + node_id + "/heartbeat", device_id);
  delay(10000);
}