/*
 * Sovereign OS – ESP32 OTA Reference Sketch
 * -------------------------------------------------
 * ฟีเจอร์:
 * 1. เชื่อม WiFi + MQTT (EMQX ของ Sovereign OS)
 * 2. ส่งข้อมูลเซ็นเซอร์ไปที่ topic  sovereign/<NODE_ID>/sensor/<metric>
 * 3. ฟัง topic sovereign/<NODE_ID>/ota/command — เมื่อได้รับคำสั่ง OTA
 *    จะดาวน์โหลด .bin จาก URL ที่ส่งมา แล้วอัปเดต + รีบูตอัตโนมัติ
 * 4. รายงานผล OTA กลับที่ topic sovereign/<NODE_ID>/ota/status
 *    (success / failed / rebooted) — หน้าเว็บ /ota จะแสดงสถานะสด
 *
 * วิธีใช้:
 * - ติดตั้ง Libraries: PubSubClient, ArduinoJson (ผ่าน Library Manager)
 * - แก้ค่า: WIFI_SSID, WIFI_PASS, MQTT_HOST, NODE_ID, FIRMWARE_VERSION
 * - Upload ผ่าน USB ครั้งแรกเท่านั้น — ครั้งต่อไปใช้ OTA จากหน้าเว็บได้เลย
 * - Build: Sketch → Export Compiled Binary (.bin) แล้วอัปโหลดผ่านหน้า OTA
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>

// ─── ตั้งค่า ───
const char* WIFI_SSID     = "YOUR_WIFI";
const char* WIFI_PASS     = "YOUR_PASSWORD";
const char* MQTT_HOST     = "192.168.1.10";   // IP ของเครื่องที่รัน EMQX + Core API
const int   MQTT_PORT     = 1883;
const char* NODE_ID       = "11111111-1111-1111-1111-111111111111"; // nodeId ของอุปกรณ์นี้
const char* FIRMWARE_VERSION = "v1.0.0"; // ⬅ เปลี่ยนทุกครั้งที่ build เวอร์ชันใหม่ (หน้า OTA จะแสดงผล)

WiFiClient espClient;
PubSubClient mqtt(espClient);

unsigned long lastPublish = 0;
bool bootReported = false;

const char* topicOtaCommand() {
  static String t = String("sovereign/") + NODE_ID + "/ota/command";
  return t.c_str();
}
const char* topicOtaStatus() {
  static String t = String("sovereign/") + NODE_ID + "/ota/status";
  return t.c_str();
}

// ─── รายงานสถานะ OTA กลับไปที่ server ───
void publishOtaStatus(const char* status, const char* version = "", const char* error = "") {
  StaticJsonDocument<256> doc;
  doc["status"] = status;
  if (strlen(version)) doc["version"] = version;
  if (strlen(error)) doc["error"] = error;
  String payload;
  serializeJson(doc, payload);
  mqtt.publish(topicOtaStatus(), payload.c_str());
  Serial.printf("[OTA][TX] status=%s\n", payload.c_str());
}

// ─── รับคำสั่ง OTA ───
void onOtaCommand(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.printf("[OTA] Command: %s\n", msg.c_str());

  // พาร์ส JSON { "url": "...", "file": "...", "version": "..." }
  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, msg)) {
    publishOtaStatus("failed", "", "invalid command JSON");
    return;
  }
  const char* url = doc["url"] | "";
  if (strlen(url) == 0) {
    publishOtaStatus("failed", "", "no url in command");
    return;
  }

  Serial.printf("[OTA] Downloading %s ...\n", url);

  HTTPClient http;
  http.begin(url);
  http.setTimeout(30000);
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.printf("[OTA] Download failed: HTTP %d\n", code);
    http.end();
    publishOtaStatus("failed", "", "HTTP download failed");
    return;
  }

  int contentLength = http.getSize();
  Serial.printf("[OTA] Size: %d bytes\n", contentLength);

  if (!Update.begin(contentLength)) {
    Serial.printf("[OTA] Not enough space: %s\n", Update.errorString());
    http.end();
    publishOtaStatus("failed", "", Update.errorString());
    return;
  }

  WiFiClient* stream = http.getStreamPtr();
  size_t written = Update.writeStream(*stream);
  if (written != (size_t)contentLength) {
    Serial.printf("[OTA] Write failed: wrote %u/%d\n", written, contentLength);
  }
  if (!Update.end()) {
    Serial.printf("[OTA] Update failed: %s\n", Update.errorString());
    http.end();
    publishOtaStatus("failed", "", Update.errorString());
    return;
  }

  http.end();
  Serial.println("[OTA] Update OK — reporting & rebooting");
  publishOtaStatus("success", FIRMWARE_VERSION);
  delay(1000);
  ESP.restart();
}

// ─── ส่งข้อมูลเซ็นเซอร์ (topic ละ metric — ตรงกับ mqttIngest ของ server) ───
void publishSensor(const char* metric, float value) {
  String topic = String("sovereign/") + NODE_ID + "/sensor/" + metric;
  mqtt.publish(topic.c_str(), String(value, 2).c_str());
}

void publishTelemetry() {
  // ตัวอย่าง — เปลี่ยนเป็นอ่านค่าจากเซ็นเซอร์จริง (DHT22, ADS1115, ฯลฯ)
  publishSensor("temperature", 26.5 + random(0, 50) / 10.0);
  publishSensor("humidity", 60 + random(0, 20));
  publishSensor("battery_soc", 80 + random(0, 10));
  Serial.println("[TX] sensors published");
}

void reconnect() {
  while (!mqtt.connected()) {
    Serial.print("[MQTT] Connecting... ");
    if (mqtt.connect(NODE_ID)) {
      Serial.println("OK");
      mqtt.subscribe(topicOtaCommand());
      Serial.printf("[MQTT] Subscribed: %s\n", topicOtaCommand());

      // รายงานตอน boot ครั้งแรก (รันโค้ดเวอร์ชันนี้แล้ว) — หน้า OTA จะเห็นเวอร์ชันจริง
      if (!bootReported) {
        bootReported = true;
        publishOtaStatus("rebooted", FIRMWARE_VERSION);
      }
    } else {
      Serial.printf("failed rc=%d — retry in 5s\n", mqtt.state());
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[WiFi] Connected, IP: %s\n", WiFi.localIP().toString().c_str());

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onOtaCommand);
}

void loop() {
  if (!mqtt.connected()) reconnect();
  mqtt.loop();

  // ส่งข้อมูลทุก 30 วิ
  if (millis() - lastPublish > 30000) {
    lastPublish = millis();
    publishTelemetry();
  }
}
