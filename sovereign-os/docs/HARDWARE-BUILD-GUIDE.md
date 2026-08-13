# 🛠️ คู่มือประกอบฮาร์ดแวร์ Sovereign OS — ฉบับซื้อ-ต่อ-ใช้ได้เลย

> **วัตถุประสงค์:** อ่านภาพร่าง → ไปซื้อของสเปคตามตาราง → ต่อสายตามรูป → flash โค้ด → อุปกรณ์ส่งข้อมูลเข้าระบบอัตโนมัติ
> ทุกอุปกรณ์คุยกับระบบผ่าน **MQTT (WiFi วงเดียวกัน)** หรือ **USB/RTSP** — ไม่ต้องเขียนโค้ดเพิ่มเอง

---

## 📋 สารบัญ

| # | อุปกรณ์ | งานที่ทำ | งบประมาณรวม |
|---|---|---|---|
| 1 | **Home Base** (ESP32) | ตัวอย่าง node OTA + ส่งค่าจำลอง | ~฿200-300 |
| 2 | **Multi-Sensor** (ESP8266) | อุณหภูมิ/ความชื้น/ฝน/คนเดิน | ~฿250-400 |
| 3 | **Relay Controller** (ESP8266) | เปิด-ปิด ปั๊มน้ำ/ไฟสวน/พัดลม | ~฿200-350 |
| 4 | **Energy Monitor** (ESP32) | วัดไฟ/กระแส/กำลังโซลาร์ | ~฿350-500 |
| 5 | **UPS Monitor** (USB-NUT) | แบตเตอรี่สำรอง + แจ้งเตือน | ~฿2,500-4,500 |
| 6 | **IP Camera + Vision AI** | กล้อง + AI ตรวจจับคน/รถ/งู | ~฿800-1,500 |
| 7 | **Voice Assistant** | ฟังพูด-ตอบ (Whisper+Piper) | ~฿0-600 (ไมค์) |
| 8 | **ฟาร์ม/น้ำ (bio)** | ความชื้นดิน/ระดับน้ำ | ~฿200-500 |
| 9 | **OOBM ฉุกเฉิน** (LoRa) | แจ้งเตือนนอกเครือข่าย | ~฿300-600 |

**✨ Quick Start:** ซื้อแค่ **#1 หรือ #2** ก็เห็นค่าขึ้นหน้าก่อนได้เลยจริง — ที่เหลือค่อยๆ ต่อทีละตัว

---

## 0️⃣ เตรียมเครื่องก่อน (ทำครั้งเดียว)

### ของทั่วไปที่ต้องมี (ทุกโปรเจกต์ใช้ร่วมกัน)
- สาย USB (micro-USB สำหรับ NodeMCU, USB-C สำหรับ ESP32 DevKit)
- (แนะนำ) สายไฟจัมเปอร์ dupont ยาว 20cm ชุดละ ~฿40
- กล่องต่อสาย / heat-shrink / เทปพันสาย

### ตั้งค่า Arduino IDE (ครั้งเดียว)
1. ติดตั้ง [Arduino IDE](https://www.arduino.cc/en/software)
2. **Boards Manager:** เพิ่ม URL `http://arduino.esp8266.com/stable/package_esp8266com_index.json` →
   ติดตั้ง `esp8266 by ESP8266 Community` และ `esp32 by Espressif Systems`
3. **Library Manager** ติดตั้ง: `PubSubClient` · `WiFiManager` · `DHT sensor library` · `ArduinoJson` · `Adafruit INA219`

### ค่าที่ต้องรู้ของระบบคุณ (ใช้ทุกตัว)
- **IP MQTT Server** = IP ที่รัน EMQX (เครื่องที่รัน docker) เช่น `10.12.55.234` — ดูในไฟล์ `.ino`
- **NODE_ID** = `11111111-1111-1111-1111-111111111111` (ค่าปริยายของ Home Base)
- **การ set WiFi ครั้งแรก** ใช้วิธี WiFiManager บอร์ดจะออก AP ชื่อ `SovereignSensor` / `SovereignRelay` → เปิดมือถือเลือก AP → ใส่ WiFi บ้าน

---

## 1️⃣ Home Base Node (ESP32) — node อ้างอิง + OTA

### 🖼️ ภาพร่าง
```
ESP32 DevKit (USB-C)
┌──────────────────────────────┐
│  ┌─────┐   USB ── PC/ไฟ      │
│  │ESP32│   3V3(fixed)        │
│  └─────┘   EN ── ปุ่ม reset  │
│  WiFi → EMQX (192.168.x.x)   │
└──────────────────────────────┘
```

### 🛒 ของที่ต้องซื้อ
| ของ | สเปคขั้นต่ำ | ราคาโดยประมาณ |
|---|---|---|
| ESP32 DevKit v1 (38 pin) | ESP32-WROOM-32, USB-C | ฿150-250 |
| (เพิ่มเติม) DHT22 | sensor อุณหภูมิ/ความชื้น | ฿60-120 |

### ⚡ วิธีทำ
1. เปิด `sovereign-os/firmware/esp32_ota_example.ino` ใน Arduino IDE
2. แก้ `WIFI_SSID`, `WIFI_PASS`, `MQTT_HOST`, `NODE_ID`, `FIRMWARE_VERSION`
3. เลือกบอร์ด `ESP32 Dev Module` → Tools → Port เลือกพอร์ต USB → **Upload**
4. เปิด Serial Monitor (115200) — รอข้อความ MQTT connected

### 🔌 เชื่อมเข้าระบบ
- อุปกรณ์ส่งเองอัตโนมัติ: `sovereign/{NODE_ID}/sensor/temperature|humidity|battery_soc`
- **OTA ครั้งต่อไปไม่ต้องต่อสาย:** หน้าเว็บ `/ota` → ใส่ URL ไฟล์ `.bin` → บอร์ด reboot อัตโนมัติ
- เช็ก: หน้า `/sensors` เห็นค่า temperature/humidity อัปเดตทุก 30 วิ

---

## 2️⃣ Multi-Sensor Node (ESP8266) — DHT22 + ฝน + ตรวจจับคน

### 🖼️ ภาพร่าง
```
NodeMCU/WeMos D1 mini            DHT22
┌───────────────────┐          ┌────────┐
│ D2 (GPIO4) o──────┼──────────┤ Data   │
│ 3V3        o──────┼──────────┤ VCC(+) │
│ GND        o──────┼──────────┤ GND(-) │
│                   │          └────────┘
│ D1 (GPIO5) o──────┼──┬── Rain Sensor  (DO ต่อ D1, VCC=3V3, GND)
│ D6 (GPIO12)o──────┼──┴── PIR HC-SR501 (OUT ต่อ D6, VCC=5V, GND)
│ 5V=USB (2A)       │
└───────────────────┘
```

### 🛒 ของที่ต้องซื้อ
| ของ | สเปคขั้นต่ำ | ราคาโดยประมาณ |
|---|---|---|
| NodeMCU/WeMos D1 mini (ESP8266) | ESP-12E, USB micro | ฿90-150 |
| DHT22 (AM2302) | 3 ขา หรือ 4 ขา | ฿60-120 |
| Rain sensor module | แผ่น PCB + LM393, ขา DO+AO | ฿30-60 |
| PIR HC-SR501 | ตรวจจับการเคลื่อนไหว | ฿30-50 |

### ⚡ วิธีทำ
1. เปิด `tools/esp8266_multi_sensor/esp8266_multi_sensor.ino`
2. แก้ `mqtt_server` ให้เป็น IP EMQX ของคุณ
3. เลือกบอร์ด `NodeMCU 1.0 (ESP-12E)` → Upload
4. ครั้งแรก: บอร์ดออก AP `SovereignSensor` → ใส่ WiFi ผ่านมือถือ
5. ติดตั้ง DHT22 / Rain / PIR ตามภาพ

### 🔌 เชื่อมเข้าระบบ
- ส่งอัตโนมัติทุก 5 วิ: `.../sensor/temperature`, `humidity`, `rain_detect` (1=ฝนตก), `pir_motion` (1=มีคน)
- เช็ก: หน้า `/sensors` หรือ `/telemetry` — เปียกมือที่แผ่นฝน → `rain_detect=1`
- **ขยายเพิ่ม sensor ความปลอดภัย (smoke/gas/door):** หน้าเว็บ `/sensors` → ปุ่ม **Generate Code** → เลือก sensor → flash ได้ทันที (โค้ดให้ pin มาตรฐาน: smoke=D5, gas=D8, door=D7)

---

## 3️⃣ Relay Controller (ESP8266) — ปั๊มน้ำ/ไฟสวน/พัดลม

### 🖼️ ภาพร่าง
```
WeMos D1 mini              Relay Module 4ช่อง (5V active-low)
┌───────────────┐      ┌──────────────────────────┐
│ D1 (GPIO5) o──┼──────┤IN1  ← relay1 (ปั๊มน้ำ)    │
│ D2 (GPIO4) o──┼──────┤IN2  ← relay2 (ไฟสวน)     │
│ D0 (GPIO16)*o─┼──────┤IN3  ← relay3 (พัดลม)     │
│ 3V3/5V    o───┼──────┤VCC=5V  GND                │
│ GND       o───┼──────┤COM-ดึงไฟ, NO→โหลด        │
└───────────────┘      └──────────┬───────────────┘
                                  └─ ไฟบ้าน 220V → ปั๊ม (ระวัง! ใช้มืออาชีพต่อฝั่งไฟแรง)
 * D0(GPIO16) อาจขัดกับไฟ led — ใช้ D3/D4 หรือ ESP32 แทนถ้ามีปัญหา
```

### 🛒 ของที่ต้องซื้อ
| ของ | สเปคขั้นต่ำ | ราคาโดยประมาณ |
|---|---|---|
| WeMos D1 mini (ESP8266) | ตัวเดียวกันกับ #2 | ฿90-150 |
| Relay module 4 ช่อง | 5V, active-low (IN รับ LOW = ON), optocoupler | ฿60-150 |
| (ถ้าควบคุมไฟบ้าน) | ต้องมีช่างไฟฟ้าต่อฝั่ง 220V — module ไม่แยกแรงดัน | — |

### ⚡ วิธีทำ (ของใหม่ในครั้งนี้ ✨)
1. เปิด `sovereign-os/firmware/esp8266_relay_controller.ino`
2. แก้ `mqtt_server` → Upload (บอร์ด NodeMCU 1.0)
3. ตั้ง WiFi ผ่าน AP `SovereignRelay`
4. ต่อ relay ตามภาพ — **relay1=ปั๊มน้ำ, relay2=ไฟสวน, relay3=พัดลม** ตรงกับระบบอยู่แล้ว
5. ทดสอบครั้งแรก: หน้า `/relay` → กดเปิด "ปั๊มน้ำ" → ได้ยินเสียง relay คลิก! ✔

### 🔌 เชื่อมเข้าระบบ
- ระบบสั่งผ่าน topic: `sovereign/{NODE_ID}/relay/relay1` payload `"1"/"0"`
- **ตารางเวลา:** หน้า `/relay/schedules` ตั้ง "รดน้ำทุกวัน 06:00-06:05" ได้เลย (RelayScheduler)
- **DEFCON:** ระบบปิด relay อัตโนมัติเมื่อฉุกเฉิน (level 2) และเปิด `relay4` สำรอง (level 1)
- เช็ก: กราฟ/หน้า relay แสดงสถานะตรงกับความเป็นจริง

---

## 4️⃣ Energy Monitor (ESP32 + INA219) — วัดโซลาร์/แบต

### 🖼️ ภาพร่าง
```
โซลาร์/แบต DC 12V                     ESP32 DevKit
      │  (+)─┬─────────────┬───────── VIN+ INA219  (จ่ายแรงดันแบต)
      │      │             │           │
      │     INA219 ──SDA→21, SCL→22, VCC→3V3, GND
      │  (-)─┴─────────────┴───────── VIN- →โหลด (-)
     (ระหว่าง INA219 กับโหลด = วัดกระแส)
```

### 🛒 ของที่ต้องซื้อ
| ของ | สเปคขั้นต่ำ | ราคาโดยประมาณ |
|---|---|---|
| ESP32 DevKit | v1 38 pin | ฿150-250 |
| INA219 module | I2C, วัด 0-26V / ±3.2A (ขยายได้ด้วย shunt ภายนอก) | ฿40-90 |
| แหล่งจ่าย DC เช็ค | เช่น แบต 12V + แผงโซลาร์ หรือ SMPS | ฿150-500 |

### ⚡ วิธีทำ (ของใหม่ในครั้งนี้ ✨)
1. เปิด `sovereign-os/firmware/esp32_energy_monitor.ino` — แก้ `ssid/password/mqtt_server`
2. บอร์ด `ESP32 Dev Module` → Upload
3. ต่อ INA219: **SDA→GPIO21, SCL→GPIO22, VCC→3V3, GND→GND** และ VIN+/VIN- อนุกรมกับโหลด DC

### 🔌 เชื่อมเข้าระบบ
- ส่งทุก 10 วิ เป็น JSON → `sovereign/{NODE_ID}/inverter/energy` → ระบบแยกเก็บ `voltage, current, power_kw, battery_soc`
- **แจ้งเตือนอัตโนมัติ:** `battery_soc < 20%` → alert (ระบบมีอยู่แล้ว)
- **Power Guard:** อ่านค่าไปคำนวณชั่วโมงที่เหลือแล้วเตือน — ถ้ามีไฟเลี้ยงเครื่อง server ตรงๆ ควรต่อ UPS (#5) แทน

---

## 5️⃣ UPS Monitor (USB HID UPS + NUT) — แบตสำรอง

### 🖼️ ภาพร่าง
```
[ไฟบ้าน] ── UPS (USB) ── โหลด/เครื่อง Server
              │
              └─ USB สาย data ไปเครื่อง Windows ที่รัน NUT (same machine = core-api)
NUT: usbhid-ups → upsd พอร์ต 3493 (TCP localhost)
```

### 🛒 ของที่ต้องซื้อ
| ของ | สเปคขั้นต่ำ | ราคาโดยประมาณ |
|---|---|---|
| UPS แบบ USB-HID | เช่น APC Back-UPS, ตัวที่ Windows รู้จักเป็น "HID UPS Battery" | ฿2,500-4,500 |
| สาย USB printer | A–B (ตามรุ่น UPS) | มีในกล่อง |

### ⚡ วิธีทำ
1. ติดตั้ง [NUT for Windows](https://networkupstools.org/download.html) → ตั้งค่าเปิดบริการ `upsd`
2. ต่อ UPS ผ่าน USB → ตรวจ `NUT` เห็นค่า เช่น `battery.charge=100`
3. ระบบอ่านอัตโนมัติผ่าน TCP 3493 — แก้ค่าใน `infra/.env`:
   ```
   UPS_ENABLED=true
   UPS_HOST=localhost
   UPS_PORT=3493
   UPS_NAME=ups
   UPS_LOW_BATTERY_THRESHOLD=20
   ```
4. Restart core-api → หน้า `/telemetry` เริ่มเห็น `battery_soc` (ทุก 30 วิ)

### 🔌 เชื่อมเข้าระบบ
- ข้อมูลเขียนตรง TimescaleDB (ไม่ผ่าน MQTT) + แจ้งเตือนเมื่อแบตต่ำ พร้อม cooldown กันสแปม
- ⚠️ ไม่ต้องซื้อ sensor เพิ่ม — UPS ส่วนใหญ่มีวัดแรงดันเองครบ

---

## 6️⃣ IP Camera + Vision AI — กล้องกับ AI ตรวจจับ

### 🖼️ ภาพร่าง
```
IP Camera (RTSP) ── WiFi/แลนวงเดียว ── Server (Ollama qwen3-vl:8b)
   ตัวอย่าง: TP-Link Tapo / Reolink / Hikvision (ยี่ห้อไหนก็ได้ที่มี RTSP)
```

### 🛒 ของที่ต้องซื้อ
| ของ | สเปคขั้นต่ำ | ราคาโดยประมาณ |
|---|---|---|
| IP Camera (RTSP) | 1080p, รองรับ Onvif/RTSP, PoE หรือ WiFi | ฿800-1,500 |
| (ถ้าใช้ PoE) | PoE switch หรือ injector 48V | ฿350-700 |

### ⚡ วิธีทำ
1. ตั้งกล้องให้อยู่ในวงเดียวกับ server แล้วเปิด RTSP (ปกติหน้า config กล้อง)
2. หน้า `/infrastructure` → เพิ่มกล้อง: ชื่อ, `rtsp://user:pass@ip:554/stream1` (ดูสเปคกล้อง), ที่ตั้ง เช่น "หน้าบ้าน"
3. ตรวจ `qwen3-vl:8b` พร้อมใช้: `ollama pull qwen3-vl` (CPU-only ก็รันได้ ช้าบ้าง)

### 🔌 เชื่อมเข้าระบบ
- (แผน P3 ยังรอต่อ) ระบบส่งภาพ → Ollama ตรวจจับ `person / vehicle / animal / venomous / other` + confidence + bbox
- สั่ง action อัตโนมัติได้ เช่น `relay1:ON` (เปิดสปอตไลท์เมื่อเจอคน)
- เช็ก: หน้า `/visions` (หรือ `/infrastructure/detections`) เห็นเหตุการณ์ + ภาพ

---

## 7️⃣ Voice Assistant — พูดคุยกับระบบ (Whisper STT + Piper TTS)

### 🖼️ ภาพร่าง
```
[ไมโครโฟน USB] ── PC (whisper.cpp ggml-small) ── Ollama AI ── [ลำโพง]
                    TTS: pyttsx3 (ทันที) / Piper เสียงไทย (คุณภาพสูงกว่า)
```

### 🛒 ของที่ต้องซื้อ
| ของ | สเปคขั้นต่ำ | ราคาโดยประมาณ |
|---|---|---|
| ไมโครโฟน USB (แบบ array) | USB plug-and-play, กันเสียงก้องหน่อย | ฿200-600 |
| ลำโพง/หูฟัง | มีอยู่แล้วก็ใช้ได้ | ฿0 |

### ⚡ วิธีทำ
1. ตรวจ `tools/whisper.cpp/models/ggml-small.bin` มีอยู่แล้ว → ใช้ `tools/voice_assistant.py`
2. ทดสอบ round-trip: `python tools/voice_assistant.py` — พูด → ระบบตอบเป็นเสียง
3. **อัปเกรดเสียงเป็น Piper (ไทย):** ดาวน์โหลด `th_TH-pipat-medium.onnx` (HuggingFace `rhasspy/piper-voices`) → วางที่ `tools/piper/voices/` → ตั้ง `TTS_ENGINE=piper` ใน `infra/.env`
4. เช็ก: `GET /api/tts/health` → `engine: piper`

### 🔌 เชื่อมเข้าระบบ
- `/api/tts/speak` (POST text → รับ .wav) และ `/api/tts/health`
- พูดคุย 9 เครื่องมือ AI ได้ (ถามสุขภาพ/สั่ง block IP ฯลฯ) — ไม่ต้องซื้อของเพิ่มถ้ามีไมค์อยู่แล้ว

---

## 8️⃣ ฟาร์ม/น้ำ (bio) — ความชื้นดิน, ระดับน้ำ

### 🖼️ ภาพร่าง (2 แบบ)
```
แบบความชื้นดิน:                     แบบระดับน้ำ:
ESP8266 + โมดูล capacitive soil     ESP8266 + เซ็นเซอร์อัลตราโซนิก (JSN-SR04T)
  D1(5) o── ADC(A0)  ← soil        trigger=D1(5) echo=D2(4)
  3V3/GND ต่อ module                3V3/GND ต่อ 4 ขา
 โหมด: ส่ง JSON ไป topic  bio       ค่า cm → water_level_cm
```

### 🛒 ของที่ต้องซื้อ
| ของ | สเปคขั้นต่ำ | ราคาโดยประมาณ |
|---|---|---|
| ESP8266 (ตัวเดิม #2 ใช้ซ้ำได้) | — | 0 (ถ่ายโอนได้) |
| Soil moisture capacitive | อ่านค่า analog 0-100% | ฿60-120 |
| หรือ JSN-SR04T (กันน้ำ) | วัดระดับน้ำ ถัง/บ่อ | ฿150-250 |

### ⚡ วิธีทำ
1. ใช้ปุ่ม **Generate Code** ที่หน้า `/sensors` (หรือแก้จาก #2) — เลือก sensor ที่ต้องการ
2. ส่งแบบ JSON ไป topic `sovereign/{NODE_ID}/bio/{device}` — ระบบอ่าน `soil_moisture, water_level_cm, npk_*` ได้เลย
3. (P8) ระบบมี schema อยู่แล้ว: `water_quality` (TDS/pH/ความขุ่น) — เพิ่มมือในหน้าได้ก่อนมี node

### 🔌 เชื่อมเข้าระบบ
- หน้า `/farm` เห็นค่าความชื้นดินของแต่ละแปลง (แผนที่แปลงจากระบบ)
- เตือนอัตโนมัติเมื่อระดับน้ำ/ความชื้นผิดปกติ (ทำผ่าน automation)

---

## 9️⃣ OOBM ฉุกเฉิน (LoRa) — แจ้งเตือนแม้เน็ตขาด

### 🖼️ ภาพร่าง
```
[Raspi/PC รัน oobm_alert.py] ── USB-Serial (TTL 19200) ── [LoRa E22-900M30D]
    อ่าน heartbeat ของระบบทุก 30s → ระบบหยุด → ส่ง AT คำสั่ง ข้อความ ALERT
```

### 🛒 ของที่ต้องซื้อ
| ของ | สเปคขั้นต่ำ | ราคาโดยประมาณ |
|---|---|---|
| LoRa module 900MHz (เช่น E22-900T30D) | serial AT/TTL | ฿150-300/คู่ |
| USB-UART (CH340) | ถ้าอุปกรณ์ไม่มี serial USB | ฿60 |

### ⚡ วิธีทำ
1. ต่อ LoRa กับ serial (`/dev/ttyUSB0` หรือ COM port) ที่เครื่องรัน `oobm_alert.py`
2. แก้ `OOBM_SERIAL_PORT` + baud 19200 ในสคริปต์ + ตั้งค่า AT ของ module ตามคู่มือ
3. รัน: `pip install pyserial && python edge-ai/scripts/oobm_alert.py` (Python 3.10+)

### 🔌 เชื่อมเข้าระบบ
- ส่งข้อความแจ้งเตือนฉุกเฉินแบบ offline — ตัวรับอีกฝั่ง (มือถือ/หน้าจอ Ra-02) จะได้ alert ตรงๆ
- (P8) ยังเป็นแผน — ระบบมี API `/api/infrastructure/radio` รอรับข้อความแล้ว

---

## 🧪 Checklist สุดท้ายก่อนใช้งานจริง
- [ ] ทุก node ตั้ง WiFi + mqtt_server ถูก (IP EMQX เดียวกัน)
- [ ] หน้า `/sensors` เห็น device + ค่าไหลอัปเดต
- [ ] หน้า `/relay` กดเปิด/ปิดแล้วได้ยินเสียงคลิกจริง
- [ ] UPS: `/api/energy/summary` (หรือหน้า telemetry) เห็น charge %
- [ ] TTS: `/api/tts/health` ตอบ `ok`
- [ ] ทดสอบตัด WAN → ระบบยังทำงาน (local-only, offline 100%)