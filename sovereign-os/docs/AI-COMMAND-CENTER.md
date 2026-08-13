# 🧠 Sovereign AI Command Center — แผนพัฒนาเป็นแพ็กเกจ (เจาะลึก)

> สถานะอ้างอิง: สำรวจ codebase วันที่ 2026-08-12
> หลักการ: ใช้ของที่มีอยู่ให้มากที่สุด (Ollama local, TimescaleDB, whisper.cpp, รายงาน AI ฯลฯ) — offline 100%

---

## ของที่มีอยู่แล้ว (ไม่ต้องสร้างใหม่)

| ความสามารถ | ที่อยู่ | สถานะ |
|---|---|---|
| AI Chat + 9 Agent Tools (blockIP/killProcess ฯลฯ) | `AiAgentService.ts` + `/api/ai/*` | ✅ ใช้ได้ |
| RAG / Semantic Search (Postgres embedding) | `semantic-search.service.ts` + `/api/knowledge/*` | ✅ ใช้ได้ |
| รายงาน AI รายวัน/สัปดาห์ + กราฟ PNG + Telegram | `report.service.ts` | ✅ ใช้ได้ |
| Voice: Whisper STT + TTS (pyttsx3 / Piper ready) | `/api/whisper`, `/api/tts` | ✅ ใช้ได้ |
| Farm Map SVG (จาก farm_plots) | `/api/farm/plots/map.svg` | ✅ ใช้ได้ |
| Vision LLM **ดาวน์โหลดแล้วแต่ไม่ได้ใช้!** | Ollama `qwen3-vl:8b` | ⚠️ รอเชื่อม |
| ฐานข้อมูลกล้อง + ตารางผลตรวจจับ | `/api/infrastructure/cameras|detections` | ✅ ใช้ได้ (ว่าง ยังไม่มี AI ส่งผล) |
| Health Screening (สังเกต/flag/สมุนไพร) | `/api/health` | ✅ ใช้ได้ |
| Risk/Threat/DEFCON/Wealth/ราคา | `/api/risk-monitor`, defcon engine, `/api/portfolio` | ✅ ใช้ได้ |
| เครื่องมือสถิติพื้นฐาน (regression) | ไม่มี — ต้องสร้างใน P4 | ❌ |

### 🔧 ฮาร์ดแวร์ฐาน (มีโค้ด flash พร้อมใน repo แล้ว)

#### 1️⃣ Home Base Node (ESP32) — node อ้างอิง + OTA
```
ESP32 DevKit (USB-C)
┌──────────────┐
│  ┌─────┐     │   WiFi → EMQX (192.168.x.x:1883)
│  │ESP32│ USB │   ส่ง: .../sensor/temperature|humidity|battery_soc
│  └─────┘     │   ฟัง: .../ota/command   ส่งผล: .../ota/status
└──────────────┘
```
| ของ | สเปคขั้นต่ำ | ราคา |
|---|---|---|
| ESP32 DevKit v1 (38 pin) | ESP32-WROOM-32, USB-C | ฿150-250 |
| (เพิ่มเติม) DHT22 | อุณหภูมิ/ความชื้น | ฿60-120 |

**วิธีทำ:** เปิด `firmware/esp32_ota_example.ino` → แก้ `WIFI_SSID/PASS/MQTT_HOST/NODE_ID` → บอร์ด `ESP32 Dev Module` → Upload (115200) → **OTA ครั้งต่อไปไม่ต้องต่อสาย** (หน้า `/ota`) ✔

#### 2️⃣ Multi-Sensor Node (ESP8266) — อุณหภูมิ/ฝน/คน
```
NodeMCU/WeMos D1 mini        DHT22      Rain      PIR
┌────────────────┐  D2(4) o─┤Data   │  DO→D1(5)  OUT→D6(12)
│ 3V3─(+) GND─(-)│  3V3/GND ─┘VCC GND│ 3V3/GND    VCC=5V,GND
└────────────────┘
```
| ของ | สเปคขั้นต่ำ | ราคา |
|---|---|---|
| NodeMCU/WeMos D1 mini | ESP-12E | ฿90-150 |
| DHT22 + Rain module + PIR HC-SR501 | 3 เซ็นเซอร์ชุดนี้ | ฿120-230 |

**วิธีทำ:** `tools/esp8266_multi_sensor/esp8266_multi_sensor.ino` → แก้ `mqtt_server` → Upload → ตั้ง WiFi ผ่าน AP `SovereignSensor` → ส่งอัตโนมัติทุก 5 วิ (เช็กหน้า `/sensors`) — ต่อเซ็นเซอร์ความปลอดภัยเพิ่ม (smoke/gas/door) ใช้ปุ่ม **Generate Code** ในหน้า `/sensors` ✔

#### 3️⃣ Relay Controller (ESP8266) — ปั๊ม/ไฟสวน/พัดลม
```
WeMos D1 mini            Relay 4ช่อง (5V active-low)
D1(5)─IN1   D2(4)─IN2    relay1=ปั๊ม  relay2=ไฟสวน  relay3=พัดลม
5V──VCC  GND──GND         ระบบสั่ง: .../relay/relay1 payload "1"/"0"
```
| ของ | สเปคขั้นต่ำ | ราคา |
|---|---|---|
| WeMos D1 mini | ตัวเดียวกับ #2 | ฿90-150 |
| Relay module 4 ช่อง | 5V active-low (ฝั่งไฟบ้าน 220V ต้องช่างไฟฟ้าต่อ) | ฿60-150 |

**วิธีทำ:** `firmware/esp8266_relay_controller.ino` (ตัวใหม่) → upload → ทดสอบหน้า `/relay` ได้ยินเสียงคลิก ✔ — ตั้งรดน้ำอัตโนมัติในหน้า `/relay/schedules` ได้เลย

#### 4️⃣ Energy Monitor (ESP32 + INA219) — วัดโซลาร์/แบต
```
แบต DC 12V ─(+VIN ── INA219 ── VIN- ── โหลด)
              SDA→21  SCL→22  VCC→3V3  GND
ส่ง JSON ทุก 10s → .../inverter/energy {voltage,current,power_kw,battery_soc}
```
| ของ | สเปคขั้นต่ำ | ราคา |
|---|---|---|
| ESP32 DevKit | v1 38 pin | ฿150-250 |
| INA219 module | I2C 0-26V/±3.2A | ฿40-90 |

**วิธีทำ:** `firmware/esp32_energy_monitor.ino` (ตัวใหม่) → upload → หน้า `/telemetry` เห็น voltage/current/power_kw/battery_soc → **เตือนอัตโนมัติเมื่อแบต < 20%** + Power Guard คำนวณชั่วโมงเหลือ ✔

#### 5️⃣ UPS Monitor (USB-NUT) — แบตสำรอง
```
[ไฟบ้าน]─UPS(USB HID)─โหลด     Windows: ติดตั้ง NUT → upsd พอร์ต 3493 (local)
```
| ของ | สเปคขั้นต่ำ | ราคา |
|---|---|---|
| UPS แบบ USB-HID (เช่น APC Back-UPS) | รู้จักเป็น "HID UPS Battery" | ฿2,500-4,500 |

**วิธีทำ:** ติดตั้ง [NUT for Windows](https://networkupstools.org/download.html) → `infra/.env` ตั้ง `UPS_ENABLED=true`, `UPS_HOST=localhost`, `UPS_PORT=3493` → restart core-api → เห็น `battery_soc` ทุก 30 วิ + แจ้งเตือนแบตต่ำ ✔

---

## แพ็กเกจที่วางแผน (เรียงตามลำดับทำ)

### 📦 P1 — Conversational Memory AI (1-2 ชม.) — ง่ายสุด
**เป้าหมาย:** AI จำประวัติสนทนา — ตอบต่อเนื่องได้, ล้างได้, เห็นได้

| ประเด็น | รายละเอียด |
|---|---|
| สิ่งที่มีแล้ว | ระบบ chat + Ollama `/api/generate` (ตอนนี้ส่งคำขอทีละข้อความ ไม่มี history) |
| ต้องสร้าง | Prisma model `ChatMessage` (actor, role, content, created_at) + migration |
| Backend | อัปเกรด `POST /api/ai/chat` → ส่ง Ollama `api/chat` พร้อม history 20 ข้อความล่าสุด | เพิ่ม `GET /api/ai/history`, `DELETE /api/ai/history` |
| Frontend | `AiChatPanel.tsx`: โหลด history ตอน mount, ปุ่ม 🗑️ ล้างประวัติ |
| เทสต์ | unit: history context builder; route test: history ถูกส่งต่อ/เคลียร์ได้ |
| หมายเหตุ | เก็บเฉพาะ 500 ข้อความล่าสุด (กันโตไม่รู้จบ) + privacy: ผู้ใช้ลบได้ |

### 📦 P2 — Decision Support AI (1-2 ชม.)
**เป้าหมาย:** ถาม "ควรทำอะไรดี" → AI วิเคราะห์จากข้อมูลจริง + สถานการณ์จำลอง (what-if)

| ประเด็น | รายละเอียด |
|---|---|
| สิ่งที่มีแล้ว | Gemma3:4b, telemetry, farm_plots, inventory, portfolio/ราคา, risk index |
| ต้องสร้าง | `POST /api/ai/advisor` — สร้าง "situation context" จากข้อมูลจริง (แบต, น้ำ, แปลง, เสบียง, ราคา, threat) → Ollama วิเคราะห์ตอบเป็นไทย |
| อีกส่วน | `POST /api/ai/advisor/what-if` — จำลอง: ให้พารามิเตอร์ (เช่น ฝนไม่ตก 14 วัน) → คำนวณผลกระทบแบบ heuristic (น้ำเหลือกี่วัน, แบตเหลือกี่วัน) + AI สรุป |
| Frontend | ช่องถามในหน้า `/ai` (AI Command Center หน้าใหม่) — แสดงการ์ดคำแนะนำ + ข้อมูลที่ AI ใช้ |
| เทสต์ | unit: context builder รวมข้อมูลจริงไม่อ้วนเกิน (truncate), what-if คำนวณถูก |

### 📦 P3 — Vision AI (2-3 ชม.) — ใช้ qwen3-vl:8b ที่มีอยู่!
**เป้าหมาย:** อัปโหลด/ถ่ายรูป → ตรวจจับคน/สัตว์/โรคพืช/อ่านมิเตอร์ + บันทึกผล

| ประเด็น | รายละเอียด |
|---|---|
| สิ่งที่มีแล้ว | Ollama `qwen3-vl:8b` (ยังไม่มีโค้ดใช้), ตาราง `detection_events` + `/api/infrastructure/detections`, multer (ใช้กับ whisper แล้ว) |
| ต้องสร้าง | `POST /api/vision/analyze` (upload image ≤10MB → base64 → qwen3-vl prompt ตรวจจับ → JSON labels+confidence+bbox) · `POST /api/vision/analyze-url` (วิเคราะห์จาก snapshot URL กล้อง) · `GET /api/vision/history` |
| บันทึก | ผลตรวจจับ → เขียน `DetectionEvent` (object_type, confidence, image_path) ต่อกับหน้า infrastructure ที่มีอยู่ได้เลย |
| Config | `VISION_MODEL=qwen3-vl:8b`, `VISION_ENABLED` (เปิด/ปิด), timeout ตั้ง 60s (CPU ประมวลผล 5-10 วิ/ภาพ) |
| Frontend | หน้า `/vision` ใหม่: กล่องอัปโหลด/URL, แสดงภาพ + ป้าย Ai สรุป (person 1, dog 1, 94%), ประวัติ |
| เทสต์ | mock Ollama response → ตรวจว่า parse JSON labels ถูก, reject ไฟล์ไม่ใช่ภาพ |
| หมายเหตุ | ถ้ากล้อง IP มี: เพิ่ม cron  snapshot กล้องที่ `enabled` → วิเคราะห์ทุก N นาที (ทำเป็นตัวเลือก) |

**🖼️ ฮาร์ดแวร์ของ P3 — IP Camera + AI Vision:**
```
IP Camera (RTSP) ── WiFi/แลนวงเดียว ── Server (Ollama qwen3-vl:8b)
ตัวอย่าง: TP-Link Tapo / Reolink / Hikvision — ยี่ห้อไหนก็ได้ที่มี RTSP
```
| ของ | สเปคขั้นต่ำ | ราคา |
|---|---|---|
| IP Camera (RTSP) | 1080p, รองรับ Onvif/RTSP, PoE หรือ WiFi | ฿800-1,500 |
| (ถ้า PoE) PoE switch/injector 48V | — | ฿350-700 |

**วิธีทำ:** ตั้งกล้องในวงเดียวกับ server → เปิด RTSP → หน้า `/infrastructure` เพิ่มกล้อง (`rtsp://user:pass@ip:554/...`) → แล้ว P3 นี้จะ snapshot มาวิเคราะห์ด้วย qwen3-vl (`person/vehicle/animal/venomous` + confidence + bbox) — เช็กประวัติที่หน้า `/visions` หรือ `/infrastructure/detections`

### 📦 P4 — Predictive AI (2-3 ชม.) — ใช้ TimescaleDB ที่มีอยู่
**เป้าหมาย:** พยากรณ์แบต/พลังงาน + ตรวจจับความผิดปกติเซ็นเซอร์ (pure TS ไม่พึ่ง python/scipy)

| ประเด็น | รายละเอียด |
|---|---|
| สิ่งที่มีแล้ว | telemetry ประวัติใน TimescaleDB, `power-guard` ประมาณชั่วโมงคงเหลือแบบเส้นตรง |
| ต้องสร้าง | `predictive.service.ts`: ① `batteryForecast()` — regression เชิงเส้นบน SOC 7 วัน → "แบตจะหมดเมื่อไหร่" (ชั่วโมง + confidence) ② `anomalyDetect(metric)` — rolling mean/std (z-score) 24-72 ชม. → จุดผิดปกติ |
| Endpoints | `GET /api/predictive/battery` · `GET /api/predictive/anomalies?metric=&hours=24` · `GET /api/predictive/summary` |
| Cron | ทุก 15 นาที ตรวจ anomaly ทั้ง metric สำคัญ → ถ้าเจอ: เขียน alert + แจ้ง Telegram/socket (reuse notification ของเดิม) |
| Frontend | การ์ด "⚡ แบตเตอรี่จะหมดใน: 3.5 วัน" + จุดแดงบนกราฟในหน้า `/predictive` (หรือรวมใน /ai) |
| เทสต์ | unit: regression/rolling-stats ถูกต้อง (ข้อมูลชุดควบคุม + flat data + NaN), route test |
| หมายเหตุ | ย้าย/ขยาย logic ใน `power-guard` มาใช้ร่วม (ไม่ซ้ำซ้อน) |

### 📦 P5 — Document Understanding AI / ฉลาก → Inventory (2-3 ชม.)
**เป้าหมาย:** ถ่ายรูปฉลากยา/อาหาร → AI อ่านชื่อ + วันหมดอายุ → กดเดียวบันทึกเข้า Inventory

| ประเด็น | รายละเอียด |
|---|---|
| สิ่งที่มีแล้ว | qwen3-vl:8b (OCR ผ่าน vision LLM ได้เลย ไม่ต้องติดตั้ง tesseract), `/api/inventory` (เพิ่มรายการ + คำนวณ expiry จาก shelf_life_days) |
| ต้องสร้าง | `POST /api/documents/analyze` — upload รูป → prompt กำหนด JSON → `{ name, category, quantity, unit, unit_price_usd, expiry_date, shelf_life_days, notes }` → validate → แสดง preview ให้ยืนยันก่อนบันทึก |
| อีกส่วน | `POST /api/documents/analyze/scan-to-inventory` — บันทึกเข้ารายการสินค้าจริง (หลังยืนยัน) |
| Frontend | ปุ่ม "📷 สแกนฉลาก" บนหน้า `/inventory` + modal preview ไม่มีข้อความ? → ป้อนเองได้ |
| เทสต์ | mock vision response → parse JSON จากภาพถูก, บันทึกเข้า inventory ได้จริง |
| หมายเหตุ | PDF: ยังไม่ต้อง (ต้องแปลงเป็นภาพก่อน) — เก็บเป็นตัวเลือกไว้ |

### 📦 P6 — Health Monitor ยกระดับ (1-2 ชม.) — ต่อยอดของที่มี
**เป้าหมาย:** บันทึกค่าน้ำหนัก/ความดัน/น้ำตาลด้วยมือ + AI วิเคราะห์แนวโน้ม (ใช้ z-score จาก P4)

| ประเด็น | รายละเอียด |
|---|---|
| สิ่งที่มีแล้ว | `/api/health` ครบ (observations, flags, พิกัดสมุนไพร, export) |
| ต้องสร้าง | ตาราง `HealthReading` (type: weight/bp/sugar/temp, value, systolic/diastolic, note) + `GET/POST /api/health/readings` · เตือนแนวน์โดย reuse `anomalyDetect()` จาก P4 |
| Frontend | การ์ดบันทึกค่า + กราฟmini ในหน้า `/health` ที่มีอยู่ |
| เทสต์ | route test CRUD + boundary ผิดปกติ |

### 📦 P7 — Generative (✅ เสร็จ — 2026-08-12)
**เป้าหมาย:** สร้างแผนที่แปลงฟาร์ม (SVG จาก farm_plots) + อัปเกรด TTS เป็น Piper (เสียงไทยคุณภาพสูงกว่า pyttsx3)
- `GET /api/farm/plots/map.svg` — วาดแปลงจากข้อมูลจริง (SVG pure Node ไม่พึ่ง lib) → ใช้ในหน้า `/farm` ✅
  - `src/services/farm-map.service.ts`: `buildFarmMapSvg()` — layout ตารางอัตโนมัติ (default 3 ช่อง/แถว, ปรับผ่าน `?cols=`), escape XML (กัน SVG injection จากชื่อแปลง), นับวันถึงเก็บเกี่ยว (พร้อมเก็บเมื่อผ่านกำหนด)
  - เทสต์ `tests/farmMap.test.ts` (10 case) ✅
- TTS: `/api/tts/speak` + `/health` รองรับ engine `piper` (เสียงไทยคุณภาพสูง) กะ config ผ่าน env: `TTS_ENGINE=piper|pyttsx3` (default `pyttsx3`) · `PIPER_EXE` · `PIPER_VOICE`
- ⚠️ ยังไม่ได้ติดตั้ง: ต้องแตก `tools/piper.zip` → `tools/piper/piper.exe` + โหลดเสียงไทย `th_TH-pipat-medium.onnx` (HuggingFace) → `tools/piper/voices/` — ตั้ง `TTS_ENGINE=piper` ใน `infra/.env` แล้ว `GET /api/tts/health` ต้องขึ้น `engine: piper`
- 🎵 Music/Ambiance: **เลื่อนก่อน** — ต้อง GPU หรือใช้ตอนเสียงสำเร็จรูป (CPU หลายนาที/เพลง)

**🖼️ ฮาร์ดแวร์ของ P7 — Voice Assistant (Whisper STT + Piper TTS):**
```
[ไมค์ USB array] ── PC (whisper.cpp ggml-small) ── Ollama AI ── [ลำโพง]
                    TTS: pyttsx3 (ทันที) / Piper เสียงไทย (คุณภาพสูงกว่า)
```
| ของ | สเปคขั้นต่ำ | ราคา |
|---|---|---|
| ไมโครโฟน USB แบบ array | plug-and-play | ฿200-600 |
| ลำโพง/หูฟัง | มีอยู่แล้วใช้ได้ | ฿0 |

**วิธีทำ:** ตรวจ `tools/whisper.cpp/models/ggml-small.bin` (มีแล้ว) → `python tools/voice_assistant.py` พูด→ตอบเป็นเสียงได้เลย — อัปเกรดเสียงไทยด้วย Piper ตาม ⚠️ ด้านบน → เช็ก `/api/tts/health`

**🖼️ ฮาร์ดแวร์ของ P7 — เซ็นเซอร์ฟาร์ม/น้ำ (bio):**
```
ความชื้นดิน:               ระดับน้ำ:
ESP8266 + capacitive soil   ESP8266 + JSN-SR04T (กันน้ำ)
A0 รับค่า analog            trigger=D1(5) echo=D2(4)
ส่ง JSON → .../bio/{device}  ค่า cm → water_level_cm
```
| ของ | สเปคขั้นต่ำ | ราคา |
|---|---|---|
| Soil moisture capacitive | analog 0-100% | ฿60-120 |
| หรือ JSN-SR04T (กันน้ำ) | วัดระดับถัง/บ่อ | ฿150-250 |

**วิธีทำ:** ใช้ ESP8266 ตัวเดิมจากฐานได้เลย (ตัวย้าย/เพิ่มได้) — ส่ง JSON ไป topic `sovereign/{NODE_ID}/bio/{device}` ระบบอ่าน `soil_moisture/water_level_cm/npk_*` ได้ทันที → ผูกกับหน้า `/farm` + automation แจ้งเตือน

### 📦 P8 — Package ที่รอฮาร์ดแวร์ (เลื่อน — ขึ้นกับการตัดสินใจซื้อ)
| แพ็กเกจ | ต้องใช้ | เวลา |
|---|---|---|
| 🔊 Sound Recognition (YAMNet/OpenWakeWord) | ไมค์ (มี) + python tensorflow env (ยังไม่มี) | 3-4 ชม. |
| 📡 Signal Intelligence (SDR/Meshtastic/Radio มorse) | RTL-SDR ~500-1,000฿ + LoRa ~200-500฿ | 3-5 ชม. |

**🖼️ ฮาร์ดแวร์ของ P8 — OOBM ฉุกเฉิน (LoRa) — แจ้งเตือนแม้เน็ตขาด:**
```
[Raspi/PC รัน oobm_alert.py] ── USB-Serial (19200) ── [LoRa E22-900M30D]
      อ่าน heartbeat ทุก 30s → ระบบหยุด → ส่ง AT ALERT (AT+MSG=...)
```
| ของ | สเปคขั้นต่ำ | ราคา |
|---|---|---|
| LoRa 900MHz (เช่น E22-900T30D) | serial AT/TTL — ซื้อเป็นคู่ (ส่ง+รับ) | ฿150-300/คู่ |
| USB-UART (CH340) | ถ้า module ไม่มี serial USB | ฿60 |

**วิธีทำ:** ต่อ LoRa กับพอร์ต serial → แก้ `OOBM_SERIAL_PORT`/baud 19200 ใน `edge-ai/scripts/oobm_alert.py` → `pip install pyserial` แล้วรัน — ระบบมี API `/api/infrastructure/radio` รอรับข้อความแล้ว (รอผูกกับ P8 เดิม)

---

## ลำดับการทำ (ตามความง่าย → ใช้ของที่มี)
1. **P1 Conversational Memory** — ทำก่อน: พื้นฐานให้ AI ทุกคำตอบดีขึ้นทันที
2. **P2 Decision Support** — ต่อยอด chat เดียวกัน
3. **P4 Predictive** — ใช้ข้อมูลที่มี ต้องไม่มีฮาร์ดแวร์เพิ่ม
4. **P3 Vision** — ผูก qwen3-vl ที่ดาวน์โหลดทิ้งไว้ กับระบบกล้อง/ตรวจจับที่ว่างอยู่
5. **P5 Documents/ฉลาก→Inventory** — ต่อเนื่องจาก P3 (ตัวเดียวกัน)
6. **P6 Health** — ต่อจาก P4 · **P7 Generative** — งานเล็ก
7. **P8** — รอสินค้าฮาร์ดแวร์

## Acceptance criteria โดยรวม
- ทุกแพ็กเกจมี endpoint + เทสต์ (`tsx --test`) และผ่าน `tsc --noEmit`
- ทุกฟีเจอร์หน้า UI สร้าง/แสดงผลจริงผ่าน API (ไม่ hardcode)
- ทำงาน offline ได้ 100% (Ollama local), CPU-only ได้
- ระบบ modules เหมือนเดิม: เปิด/ปิดได้ใน `infra/.env` (ENABLED_MODULES) สำหรับ P3-P5

---

## 🛠️ คู่มือรวม (ฉบับเดียวจบ — ทุกอุปกรณ์ครบ)
ดู [HARDWARE-BUILD-GUIDE.md](./HARDWARE-BUILD-GUIDE.md) — รวบรวมภาพร่าง + รายการซื้อ + ขั้นตอนเชื่อมระบบ ทั้งหมด 9 อุปกรณ์ไว้ในไฟล์เดียว (เนื้อหาเดียวกับที่แทรกตามหัวข้อ P1-P8 ข้างบน แต่รวมสุดท้ายครบชุด) + Checklist สุดท้ายก่อนใช้งานจริง