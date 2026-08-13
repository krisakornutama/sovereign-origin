#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <WiFiManager.h>   // <-- เพิ่มไลบรารีนี้เพื่อให้จัดการ WiFi ผ่านมือถือ

// ========== คอนฟิก MQTT ==========
const char* mqtt_server = "10.12.55.234";   // IP ของเครื่องที่รัน EMQX
const int mqtt_port = 1883;
const char* mqtt_topic = "sovereign/11111111-1111-1111-1111-111111111111/sensor/rain_detect";

// ขาที่ต่อ Rain Sensor (DO)
const int rainPin = 5;   // D1 (GPIO5)

WiFiClient espClient;
PubSubClient client(espClient);

void setup() {
  Serial.begin(115200);
  pinMode(rainPin, INPUT);

  // ---------- เริ่ม WiFiManager ----------
  WiFiManager wifiManager;

  // ถ้าไม่เคยตั้งค่า WiFi มาก่อน หรือเชื่อมต่อไม่ได้ มันจะสร้าง Access Point ชื่อ "RainSensorConfig"
  // ให้เราใช้มือถือเชื่อมต่อ แล้วเข้าไปตั้งค่า WiFi ผ่านหน้าเว็บ (192.168.4.1)
  wifiManager.autoConnect("RainSensorConfig");

  Serial.println("WiFi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());

  // ตั้งค่า MQTT server
  client.setServer(mqtt_server, mqtt_port);
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Connecting to MQTT...");
    if (client.connect("ESP8266-RainSensor")) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      delay(2000);
    }
  }
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  // อ่านค่าเซ็นเซอร์ (0 = ฝนตก / 1 = ไม่มีฝน)
  int rainState = digitalRead(rainPin);
  // กลับค่าให้ 1 = ฝนตก, 0 = ไม่มีฝน (ปรับตามโมดูล)
  int payloadValue = (rainState == LOW) ? 1 : 0;

  // ส่งผ่าน MQTT
  String payload = String(payloadValue);
  client.publish(mqtt_topic, payload.c_str());

  Serial.print("Rain: ");
  Serial.println(payloadValue);

  delay(5000); // ส่งทุก 5 วินาที
}