# ESP8266 Relay Controller — สั่งเปิด/ปิด ปั๊มน้ำ, ไฟสวน, พัดลม ผ่าน MQTT
#
# อุปกรณ์: NodeMCU/WeMos D1 mini (ESP8266) + Relay Module 4 ช่อง (5V active-low)
# ต่อ WiFi ผ่าน WiFiManager (AP ชื่อ "SovereignRelay" — ตั้งค่าผ่านมือถือครั้งแรก)
# สั่งงานจากหน้าเว็บ /relay หรือตารางเวลา (RelayScheduler) หรือ DEFCON
#
# Relay 4 ช่อง ใช้รหัส relay1..relay4 ให้ตรงกับที่ seed ไว้ในระบบ:
#   relay1 = ปั๊มน้ำ    relay2 = ไฟสวน    relay3 = พัดลม    relay4 = สำรอง (security)
#
# MQTT topic ที่ฟัง:  sovereign/{NODE_ID}/relay/relay1 .. relay4   (payload "0"/"1")
# MQTT topic ที่ส่งกลับ: sovereign/{NODE_ID}/sensor/relay_state   (JSON ทั้งหมด)
# =============================================================

#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>

// ========== CONFIG ==========
const char* mqtt_server = "10.12.55.234";   // เปลี่ยนเป็น IP ของเครื่องที่รัน EMQX
const int mqtt_port = 1883;
const char* device_id = "ESP8266-Relay-01";
const char* node_id = "11111111-1111-1111-1111-111111111111"; // NODE_ID ของฐาน

// Pin mapping — D1..D4 ของ WeMos D1 mini (ดูป้าย D1/D2/D3/D4 ที่บอร์ด)
const int RELAY_PINS[4] = { 5, 4, 0, 2 };   // D1=GPIO5, D2=GPIO4, D3=GPIO0, D4=GPIO2
const char* RELAY_IDS[4] = { "relay1", "relay2", "relay3", "relay4" };

bool relayState[4] = { false, false, false, false };

WiFiClient espClient;
PubSubClient client(espClient);

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], HIGH); // active-low: HIGH = ปิด
  }

  WiFiManager wifiManager;
  wifiManager.autoConnect("SovereignRelay");
  Serial.println("WiFi connected!");

  client.setServer(mqtt_server, mqtt_port);
}

void publishState() {
  StaticJsonDocument<256> doc;
  for (int i = 0; i < 4; i++) doc[RELAY_IDS[i]] = relayState[i] ? 1 : 0;
  char buf[256];
  serializeJson(doc, buf);
  client.publish(String("sovereign/") + node_id + "/sensor/relay_state", buf);
}

void setRelay(int idx, bool on) {
  if (idx < 0 || idx >= 4) return;
  relayState[idx] = on;
  digitalWrite(RELAY_PINS[idx], on ? LOW : HIGH); // active-low
  Serial.printf("relay%d -> %s\n", idx + 1, on ? "ON" : "OFF");
  publishState();
}

void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  for (int i = 0; i < 4; i++) {
    String t = String("sovereign/") + node_id + "/relay/" + RELAY_IDS[i];
    if (String(topic) == t) {
      setRelay(i, msg == "1");
      return;
    }
  }
}

void reconnect() {
  while (!client.connected()) {
    if (client.connect(device_id)) {
      client.setCallback(callback);
      String sub = String("sovereign/") + node_id + "/relay/#";
      client.subscribe(sub.c_str());
      Serial.println("MQTT connected, subscribed: " + sub);
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
  client.publish(String("sovereign/") + node_id + "/heartbeat", device_id);
  delay(5000);
}
