# Series RED — DMS Firmware (Dead-Man Switch)

เฟิร์มแวร์ + simulator สำหรับอุปกรณ์ DMS — สเปกเต็มอยู่ใน
[`docs/SERIES_RED_DMS_BLUEPRINT.md`](../docs/SERIES_RED_DMS_BLUEPRINT.md)

## โครงสร้าง

```
dms-firmware/
├── config.example.py        # config กลาง (คัดลอกไปเป็น config.py — อย่า commit secret จริง)
├── micropython/
│   └── main.py              # ESP32-S3 + SIM7600 (MicroPython): heartbeat 30s + ladder 90s/180s
├── pizero/
│   ├── dms_client.py        # Pi Zero 2 W (Python 3): heartbeat + dual-channel check + WoL
│   └── dms-client.service   # systemd unit (ตัวอย่าง)
└── simulator/
    └── sim.py               # จำลอง DMS จากเครื่องใดก็ได้ — ทดสอบ ladder โดยไม่ต้องมีฮาร์ดแวร์
```

## สิ่งที่ต้องตั้ง

1. คัดลอก `config.example.py` → `config.py` แล้วเติมค่า: `DEVICE_ID`, `DMS_MASTER_SECRET`
   (ต้องตรงกับ `infra/.env` ของระบบหลัก), `SERVER_URL`, `HEARTBEAT_INTERVAL_SEC` (30s + jitter ±5s)
2. ระบบหลักตั้ง: `DMS_ENABLED=true` + `DMS_MASTER_SECRET=<secret เดียวกัน>` + `DMS_ALLOWED_DEVICES=<device id>`
   (ทดลองครั้งแรกแนะนำ `DMS_DRY_RUN=true` ที่ฝั่ง server ด้วย)
3. รัน simulator ก่อนซื้อฮาร์ดแวร์:
   ```bash
   python dms-firmware/simulator/sim.py --until 130   # ส่ง ping 130 วินาทีแล้วหยุด → ดู server ขึ้น SUSPECT
   ```
   Server ควร log ระดับ 1 (SUSPECT) หลัง 90s และระดับ 2 (FAILOVER) หลัง 180s
   (ดู `GET /api/v1/dms/status` ด้วย token SUPERADMIN)

## ลำดับการใช้งานจริง

| Stage | อะไร | ตรวจรับ |
|---|---|---|
| M0/M2 (simulator ก่อน) | ส่ง ping + ดู ladder บน server | `tests/dms.test.ts` ผ่าน + sim ทำงาน |
| M2 (Pi) | `dms_client.py` รันบน Pi + 4G modem | ตัดไฟบ้านจำลอง → Telegram ผ่าน 4G ~2 นาที |
| M3 | WoL → Cold Standby (server side `DMS_AUTO_FAILOVER=true` + `DMS_WOL_MAC`) | Standby ตื่น ≤ 5 นาที |
| M4 | dual-channel (Pi ตรวจ LAN), cooldown, dry-run, flash encryption (ESP32) | drill dry-run ผ่าน |

## ข้อควรรู้ (จาก blueprint §2/§5)

- **ห้าม** ให้ DMS ต่อเน็ตผ่าน Wi-Fi/LAN ของบ้าน — ใช้ 4G SIM + APN ของค่ายเท่านั้น (ช่องทาง OOB)
- DMS ต้องมีแหล่งไฟแยก: LiFePO4 + solar trickle หรือ power bank ที่ไม่ auto-shutdown
- Secret ไม่ commit ใน repo — ตั้งใน `config.py` ที่อยู่ข้างนอก repo (หรือ flash encryption บน ESP32)
- ซิมตั้ง PIN off กัน lock หลัง boot + มี watchdog power-cycle โมเด็มถ้าค้าง (ESP32: GPIO ต่อ PWRKEY)
