# Series 🔴 — External Dead-Man Switch (DMS) Blueprint

> สถาปัตยกรรมและสเปกสำหรับ "ตัวดักคอย" ที่แยกวงจรจาก Sovereign OS โดยสมบูรณ์
> จัดทำขึ้นระหว่าง Soak Phase (ช่วงพัก 3–7 วันของระบบหลัก) — เอกสารนี้ไม่แตะต้องโค้ดที่รันอยู่
>
> หลักการสูงสุด: **Dead-Man Switch ต้องไม่ตายพร้อมกับระบบหลัก**
> (independent power + independent network = 4G OOB เท่านั้น)

---

## 1. ภาพรวม (Overview)

```
 ┌────────────────────────┐        ┌─────────────────────────────┐        ┌─────────────────┐
 │  Sovereign OS (หลัก)   │  HB    │  Dead-Man Switch (อุปกรณ์ 2)  │  4G    │  Operator /    │
 │  Express :3001         │ ─────► │  ESP32-S3 / Pi Zero 2 W     │ ─────► │  Telegram /    │
 │  heartbeats ทุก 30s    │        │  + SIM7600G 4G LTE          │  OOB   │  SMS / Webhook │
 └────────────────────────┘        └─────────────┬───────────────┘        └─────────────────┘
                                                 │  WoL magic packet (LAN ของเครื่องหลัก หรือสายตรง)
                                                 ▼
                                       Cold Standby Machine (ชุด 🔴 ข้อ 2)
```

- **A** — ระบบหลักส่ง `POST /api/v1/dms/ping` (HMAC-SHA256, rolling key) ทุก 30s
- **B** — DMS ตรวจว่าหมดหน้า > 90s (MISSED) → > 180s (FAILOVER) ตามบันไดวิกฤต
- **C** — การแจ้งเตือนวิ่งผ่าน Cellular Data (4G SIM) เท่านั้น — ไม่พึ่ง router/WAN บ้าน
- **D** — Failover = Wake-on-LAN ไป Cold Standby หรือแจ้งเจ้าของเพื่อปิดระบบสำรองด้วยมือ

### ทำไมต้องมีตัวจริง (ไม่ใช่แค่ Telegram แจ้งเตือน)

| สถานการณ์ | แค่แจ้งเตือน | DMS จริง |
|---|---|---|
| ไฟบ้านขาดตอนกลางคืน (UPS ปิด 5 นาที) | ตื่นมาเช้าถึงรู้ | แจ้งทันที T+90s + ยืนยัน SPOF T+180s |
| เครื่องหลักแฮงก์/ค้าง (ยังมีไฟ ยังมีเน็ต) | ไม่มีอะไรเตือน | เห็น Heartbeat หาย → รู้ทันที |
| LAN/WAN บ้านล่ม (router ไหม้ ฟ้าผ่า) | Telegram จากบอทตัวบ้านส่งไม่ออก | DMS ส่งผ่าน 4G ออกนอกระบบบ้าน |

---

## 2. Hardware BOM & Power Isolation

### 2.1 ตัวเลือก Primary (แนะนำ 2 ทาง)

| คุณสมบัติ | **ESP32-S3 + SIM7600G (4G HAT)** ✅ แนะนำ | Raspberry Pi Zero 2 W + USB 4G modem |
|---|---|---|
| ราคา | ~600–1,200 บาท (clone module) | ~1,500–2,500 บาท |
| พลังงาน | ~0.1–0.3W ตอน sleep, ~0.5W ตอนส่ง | ~0.8–1.2W (Linux) |
| อุณหภูมิทำงาน | −40…+85°C | 0…+50°C |
| Boot เร็ว | < 1s | ~20–30s |
| ภาษาเฟิร์มแวร์ | C/C++ (ESP-IDF / Arduino) หรือ **MicroPython** | Python (ง่ายสุดสำหรับ Rapid Prototype) |
| ข้อดี | กันความร้อน/ไฟฟ้าได้ดีกว่า, sleep ลึก | ecosystem Linux เต็มใบ, ง่าย debug |
| ข้อเสีย | ต้องจัดการ TLS/clock เอง | เปลืองไฟกว่า, ต้องตั้ง ntp/เวลา |

> หมายเหตุ: ถ้าเริ่มเร็วสุด = **Pi Zero 2 W + modem USB** (Python dev cycle สั้น)
> ถ้าอยากได้ของที่ "ลืมได้ยาวนาน" = **ESP32-S3** (hardened, battery-friendly)

### 2.2 Power Isolation (ไฟแยกเดี่ยว 100%)

- [ ] แหล่งจ่าย DMS แยกจากวงจรบ้านโดยสิ้นเชิง: **LiFePO4 6–10Ah (12V/3.2V) + solar trickle 10W** หรือ **Power Bank 20,000mAh+** (ต้อง type ที่ไม่ auto-shutdown)
- [ ] ห้ามต่อสายไฟร่วมกับ PSU/UPS ของเครื่องหลัก — เป้าหมาย: ไฟบ้านหายหมดบ้าน ยังรัน ≥ 3–7 วัน
- [ ] พลังงาน бюджет:
  - ESP32-S3: deep sleep ระหว่าง ping (30s cycle, wake 1–2s ส่ง) → ~5–10mA เฉลี่ย → 20,000mAh ≈ **รอด 1–3 เดือน**
  - Pi Zero 2 W: ปลุกได้ยาก → แนะนำ modem-off-between-pings หรือ accept ~6–8 วันต่อ 20,000mAh
- [ ] กันไฟตกด้วย **BOD (Brown-Out Detection)** + ตรวจแรงดันแบตเตอรี่ ส่งเป็น "low-power heartbeat" ล่วงหน้า

### 2.3 Placement / Enclosure

- วาง DMS อยู่ตำแหน่งที่ระบบหลัก **เข้าถึงได้ทาง LAN** (ส่ง ping ได้) แต่ **ไฟฟ้า/เน็ตคนละเส้นทาง** เท่าที่จะทำได้
- กล่องกันน้ำ IP54+, กันความชื้น, หนูแทะสาย — รื้อถอนง่าย (วาง shelf เดียวกับ Cold Standby)

---

## 3. Heartbeat Protocol & HMAC Security

### 3.1 Endpoint (Server Side — ยังไม่ต้อง implement ระหว่าง Soak)

```
POST /api/v1/dms/ping
Headers:
  X-DMS-Device: <device-id>                 # เช่น "dms-esp32s3-01"
  X-DMS-Timestamp: <unix-seconds>           # เวลาผู้ส่ง
  X-DMS-Signature: <hex(hmac_sha256)>       # ดูด้านล่าง
Body: (empty) หรือ { "seq": 123, "uptime": 4567, "bat_pct": 82 }
```

**HMAC ใช้ "rolling secret" กัน replay:**

```
KEY(t) = SHA256(DMS_MASTER_SECRET || FLOOR(t / 300))     # หมุนทุก 5 นาที
SIG    = HMAC-SHA256( KEY(t), t || device_id || seq )
```

- DMS มี secret ร่วมกับ server: `DMS_MASTER_SECRET` (ตั้งใน infra/.env ของระบบหลัก และ flash ใน DMS)
- Server ตรวจ: |now − X-DMS-Timestamp| ≤ 30s (reject อดีต/อนาคต) → คำนวณ KEY(t) ที่ทั้ง 2 ข้างของ window (กัน drift 1 window) → `timingSafeEqual`
- **Replay protection**: seq ต้อง > seq ล่าสุดของ device (ใน memory + เขียน audit ทุก 15 นาที)

### 3.2 Pacing & Threshold (ตามพิมพ์เขียว)

| ตัวแปร | ค่า | หมายเหตุ |
|---|---|---|
| HB interval | 30s | ส่งทุก 30 วินาที พร้อม seq++ |
| `DMS_MISSED_MS` | 90s (3 missed) | เข้า Level 1 — "สงสัยตาย" |
| `DMS_FAILOVER_MS` | 180s (6 missed) | เข้า Level 2 — "ยืนยัน SPOF" |
| Jitter | ±5s random | กัน 60+ DMS ชนกันส่งพร้อมกัน (future) |

### 3.3 Server Side พฤติกรรม (เมื่อ implement)

- `/api/v1/dms/ping` → อัปเดต `lastSeen[device_id]` + ตรวจ signature (HMAC) — **ไม่ผ่าน featureGuard** (ไม่ต้อง Bearer; ใช้ DMS auth แทน)
- เขียน `securityEvent` เฉพาะเหตุการณ์ (ไม่ใช่ทุก ping):
  - `DMS_PING_RECOVERED` (info) — หายแล้วกลับมา
  - `DMS_PING_MISSED` (warning) — ครั้งแรกที่เกิน 90s
  - `DMS_FAILOVER_TRIGGERED` (critical) — เกิน 180s
  - `DMS_SIGNATURE_FAIL` (critical) — HMAC ผิด (ใครก็ได้พยายามปลอม)
- เส้นทางแจ้งเตือน: ผ่าน `sendTelegramAlert()` ที่มีอยู่แล้ว (severity ตามตาราง, eventKey `dms:*`)

---

## 4. Escalation Ladder (บันไดวิกฤต)

```
T+0s   HB ปกติ (ทุก 30s)
   │
T+90s  ── Level 1: DMS สงสัย
   │      • ping ย้ำ (retry 3 ครั้ง ห่าง 10s — เผื่อ server ยุ่งอยู่)
   │      • ยืนยันยังเงียบ → ส่งแจ้งเตือนผ่าน 4G: Telegram (bot ตัว DMS) + SMS (ถ้า SIM มี)
   │      • ยังไม่ทำอะไรกับเครื่องหลัก (เผื่อเครื่องกลับมาเอง)
   │
T+180s ── Level 2: SPOF Confirmed
   │      • ส่ง Telegram/SMS ระดับ critical (ย้ำ 2 ครั้ง ห่าง 5 นาที — กันพลาด)
   │      • ถ้าตั้ง DMS_WOL_CM=true → ส่ง WoL magic packet ไป Cold Standby
   │      • (option) ยิง webhook ไป VPS / SMS gateway สำรอง
   │
T+แก้   ── Recovery: ระบบหลักกลับมา ping ตามปกติ
   │      • ส่ง "🟢 ALL CLEAR" ผ่าน 4G
   │      • reset state machine (missedCount = 0)
```

**ข้อควรระวัง (Design Constraint):**
- Level 2 ควรมี **safety countdown** ตั้งค่าได้ (`DMS_AUTO_FAILOVER=false` default) — ครั้งแรก ๆ ให้คนตัดสินใจก่อนเปิดอัตโนมัติเต็มตัว
- WoL magic packet ส่งไป Cold Standby **ทาง LAN ของเครื่องหลัก** (อาจตายพร้อมกัน) → แนะนำตัวเลือกสายตรง DMS ↔ Standby (Ethernet direct/GPIO) สำหรับรุ่น 2
- การตัดสินใจ "ตายจริง" ต้องอิง HB ที่พลาดจริง ไม่ใช่แค่ 4G ออก — ใช้ **dual-channel check**: DMS ลอง TCP ถึง server IP ในเครื่องหลัก (LAN) + สังเกต MQTT (ถ้า EMQX ยังตอบ = เครื่องหลักยังมีชีวิต → ลดระดับ alert เป็น WARN)

---

## 5. Out-of-Band (OOB) Channel — 4G Cellular

### 5.1 หลักการ

- ช่องทางสื่อสารฉุกเฉินวิ่งบน **Cellular Data (4G SIM)** เท่านั้น
- **ห้าม** ให้ DMS เชื่อมเน็ตผ่าน Wi-Fi/LAN ของบ้าน (พ่ายแพ้พร้อม router)
- กรณี LAN บ้านล่ม → DMS ยังส่งออกไปข้างนอกได้ (Telegram/SMS/webhook)

### 5.2 องค์ประกอบ

| ชิ้น | ข้อกำหนด |
|---|---|
| SIM | ซิมรายเดือนถูกสุด (AIS/dtac/true ~30–100 บาท/เดือน) หรือ ซิม IoT (nb: DTAC Smart SIM / AIS Cinterion) ที่ APN โทรศัพท์ได้ |
| APN | ตั้ง APN ตรงตามค่าย + **PIN off** (กัน lock หลัง boot) |
| TLS | ใช้ HTTPS เสมอ (`https://api.telegram.org`, webhook) — modem ต้องรองรับ TLS 1.2 |
| DNS | ใช้ DNS ของค่าย (อัตโนมัติจาก APN) — ห้าม hardcode DNS บ้าน |
| กันลืม | DMS firmware ต้องมี "watchdog": โมเด็มค้าง → power-cycle modem (GPIO) |

### 5.3 Fallback (ระดับความแรงของการแจ้งเตือน)

1. Telegram bot ของ DMS เอง (token แยกจาก bot ระบบหลัก — เผื่อ API/rate-limit ปัญหา)
2. SMS gateway ผ่าน SIM (ถ้าแพ็กเกจมี) / Twilio-class third-party
3. Webhook → VPS ที่อยู่คนละโครงข่าย (อีกทางที่พึ่งได้)

> อย่าใช้ token bot เดียวกับระบบหลัก — แยก "ตัวแจ้งเตือนหลัก" กับ "ตัวแจ้งเตือนฉุกเฉิน" คนละ channel

---

## 6. Failover & Recovery Flows (State Machine)

```
         ┌──────────────┐    HB ปกติ    ┌──────────────┐
         │   ALIVE      │ ────────────► │  ALIVE (ref) │
         └──────┬───────┘               └──────────────┘
                │ missed > 90s (ยังได้ LAN response = WARN เท่านั้น)
                ▼
         ┌──────────────┐   dual-channel check  ┌──────────────┐
         │   SUSPECT    │ ────────────────────► │   CONFIRMED  │  (>180s & LAN ตายด้วย)
         └──────────────┘                       └──────┬───────┘
                                                       │ WoL / webhook / SMS
         พัก 5 นาที ตรวจซ้ำ ───────────────────────────► FAILOVER ACTIVE
         (กลับมาได้ทันที ไม่ยิง WoL ซ้ำ)
```

- **Recovery**: ping ใดก็ตามจาก device → ALIVE + `DMS_PING_RECOVERED` + ข้อความ ALL CLEAR ผ่าน 4G
- **Anti-flap**: หลัง Level 2 มี cooldown 5 นาที (`DMS_FAILOVER_COOLDOWN_MS`) ก่อนจะยิง WoL/alert ซ้ำได้
- **Session/persistence**: DMS เก็บ state ใน flash (ESP32 NVS / Pi SQLite) — reboot DMS เองไม่ลืมว่าอยู่สถานะไหน

---

## 7. API Contract & Environment Variables (สำหรับเมื่อเริ่ม implement)

### 7.1 ไฟล์ที่จะสร้าง (ยังไม่ต้องแตะใน Soak)

```
sovereign-os/core-api/src/modules/dms/dms.routes.ts     # POST /api/v1/dms/ping, GET /api/v1/dms/status
sovereign-os/core-api/src/services/dms.service.ts       # rolling-key verify, missed/failover logic, WoL
sovereign-os/core-api/tests/dms.test.ts                 # HMAC, replay, thresholds, state machine
dms-firmware/                                            # (โฟลเดอร์ใหม่) firmware DMS: ESP32 (MicroPython/C) หรือ Pi
infra/docker-compose(.prod).yml                          # env DMS_* เพิ่ม
```

### 7.2 Env (ฝั่ง server)

| ตัวแปร | ค่าเริ่มต้น | หมายเหตุ |
|---|---|---|
| `DMS_ENABLED` | `false` | ปิดไว้ก่อนเสมอ |
| `DMS_MASTER_SECRET` | (ว่าง = ปิด) | secret ร่วมกับ DMS (สุ่มยาว ≥ 32 ไบต์) |
| `DMS_MISSED_MS` | `90000` | เข้า Level 1 |
| `DMS_FAILOVER_MS` | `180000` | เข้า Level 2 |
| `DMS_AUTO_FAILOVER` | `false` | false = แจ้งเตือนอย่างเดียว ไม่สั่ง WoL/action |
| `DMS_WOL_MAC` | (ว่าง) | MAC Cold Standby ที่จะปลุก |
| `DMS_WOL_BROADCAST` | `192.168.1.255` | broadcast ของ LAN หลัก |
| `DMS_FAILOVER_COOLDOWN_MS` | `300000` | กันยิงซ้ำ (anti-flap) |
| `DMS_ALLOWED_DEVICES` | `dms-esp32s3-01` | รายการ device_id ที่ยอมรับ (`,` คั่น) |

### 7.3 HMAC Verifier (pure function — เทสต์ได้ไม่พึ่ง network)

```
verifyDmsPing({ deviceId, ts, seq, sig }, secret, now, allowedDevices)
  → { ok, reason }   # 'signature_ok' | 'bad_timestamp' | 'unknown_device' | 'replay' | 'bad_signature'
```

### 7.4 WoL (Phase 2 เท่านั้น)

- DMS (หรือ server เองเมื่อ `DMS_AUTO_FAILOVER=true`) ส่ง magic packet (UDP 9, FF:FF:FF:FF:FF:FF + MAC x16)
- Cold Standby ต้องตั้ง Wake-on-LAN ใน BIOS + network stack ต้อง active เมื่อปิด (ACPI S5 + magic packet)

---

## 8. Security Analysis (สิ่งที่ต้องปิดตั้งแต่วันแรก)

| ภัยคุกคาม | มาตรการ |
|---|---|
| **Replay attack** (ดักจับ ping แล้วยิงซ้ำ) | rolling key 5 นาที + seq monotonic + window 30s |
| **ปลอม device** (ยิง ping ปลอมเพื่อปิด alarm) | HMAC + `DMS_ALLOWED_DEVICES` + audit `DMS_SIGNATURE_FAIL` |
| **Modem hijack / SIM clone** | PIN off เฉพาะตัวเครื่อง + สมัคร SIM บนนามเจ้าของ + ตรวจ SMS เตือนเสริมจากค่าย |
| **DMS โดนแฮกเข้าถึงเน็ตบ้าน** | DMS ไม่มี route ไป LAN บ้าน (ซอฟต์แวร์ไม่เปิด interface LAN) — ติดแค่สายถึง Cold Standby WoL ถ้าจำเป็นจริง |
| **Clock drift** (4G นาฬิกาเพี้ยน) | NTP ผ่าน cellular + tolerance window 60s + accept ±1 window |
| **Secret รั่ว** (DMS_MASTER_SECRET ใน flash) | flash encryption (ESP32 efuse), ไม่ hardcode ใน repo — ตั้งผ่านไฟล์ config นอก repo |

---

## 9. Implementation Phases (เริ่มหลัง Soak Pass)

| Phase | ขอบเขต | ตรวจรับ |
|---|---|---|
| **M0** | Firmware skeleton: heartbeat timer 30s + HTTP POST (JSON) | ส่ง ping เข้า server ได้จริง |
| **M1** | Server: `/api/v1/dms/ping` + HMAC verify + audit events + `GET /api/v1/dms/status` (lastSeen map) | `tests/dms.test.ts` ผ่าน (HMAC/replay/threshold) |
| **M2** | DMS: Escalation Ladder (90s/180s) + 4G alert (Telegram/SMS) — ยังไม่มี action | ทดสอบตัดไฟบ้านจำลอง: alert มาถึงใน ~2 นาที |
| **M3** | WoL → Cold Standby (server trigger หรือ DMS direct) | Cold Standby boot ภายใน 3–5 นาทีหลังไฟดับ |
| **M4** | Hardening: flash encryption, dual-channel check (LAN+4G), cooldown, dry-run mode (`DMS_DRY_RUN=true` จำลองลาดเดอร์โดยไม่ยิงจริง — เหมือน `UPS_DRY_RUN`) | Drill แบบ dry-run ผ่าน |

### Acceptance Criteria (สุดท้าย)
1. ตัดไฟบ้านจริงตอน 23:00 → DMS แจ้ง Telegram ผ่าน 4G ≤ 2 นาที
2. Cold Standby ตื่น ≤ 5 นาที และดึงข้อมูล (จาก offsite `infra/offsite/` ที่ replication ไว้) มารันต่อได้
3. ไฟกลับ → ระบบหลัก ping กลับ → ข้อความ ALL CLEAR ≤ 1 นาที, ไม่มี false trigger ใน 7 วัน

---

## 10. สิ่งที่ต่อยอดได้ (ชุด 🔴 ข้อ 2: Cold Standby Machine)

- Postgres streaming replication (primary → standby) แทนการ pull จาก offsite เพียงอย่างเดียว
- `pg_rewind` / failover ตรวจสอบ: `sovereign_v2` + `sovereign` สองตัวอย่างไร → ต้องมีทั้งสองใน standby
- Standby ต้องมี secret/env ชุดเดียวกับหลัก (`infra/.env` copy) + CORS/SSE พร้อมย้ายไปรองรับการเข้าถึงครั้งเดียว (single-owner)

---

*Blueprint จัดทำ: 16 ส.ค. 2026 · สถานะ: DRAFT (รอ Soak Phase ผ่าน 3–7 วัน → เริ่ม M0)*
*หลักการ: เอกสารเท่านั้น ไม่มีการแก้โค้ดที่กำลังรัน — ระบบหลักยังคงรัน dist/ เวอร์ชันที่ผ่าน 649/649 tests*
