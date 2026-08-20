# config.example.py — คัดลอกไปเป็น config.py แล้วเติมค่าจริง
# ⚠️ config.py ต้องอยู่นอก repo (หรือใน .gitignore) — secret ไม่ควร commit

SERVER_URL = "http://192.168.1.100:3001"       # IP/URL ของ Sovereign OS หลัก (ต้องเข้าได้ทาง LAN หรือผ่าน tunnel)
DEVICE_ID = "dms-esp32s3-01"                    # ต้องอยู่ใน DMS_ALLOWED_DEVICES ของ server
DMS_MASTER_SECRET = "เปลี่ยนเป็น-secret-ยาว-32-ไบต์-สุ่ม"  # ต้องตรงกับ infra/.env: DMS_MASTER_SECRET
HEARTBEAT_INTERVAL_SEC = 30                     # ส่ง ping ทุก 30s (blueprint: HB interval 30s)
JITTER_MAX_SEC = 5                              # ±5s random กันอุปกรณ์หลายตัวชนกันส่งพร้อมกัน
MISSED_MS = 90000                               # ระดับ 1 (90s = 3 missed) — ตรงกับ server
FAILOVER_MS = 180000                            # ระดับ 2 (180s = 6 missed) — ตรงกับ server
RETRY_COUNT = 3                                 # ping ย้ำ 3 ครั้ง ห่าง 10s (blueprint §4)
RETRY_INTERVAL_SEC = 10

# --- ช่อง OOB (4G) — ใช้ bot token แยกจาก bot ระบบหลักเสมอ (blueprint §5.3) ---
TELEGRAM_BOT_TOKEN = ""                         # bot ของ DMS เอง (ส่งผ่าน 4G)
TELEGRAM_CHAT_ID = ""
SMS_PHONE = ""                                  # เบอร์รับ SMS ฉุกเฉิน (ปล่อยว่าง = ข้าม SMS)

# --- WoL → Cold Standby (เฉพาะ Pi version ที่ต่อ Ethernet สายตรง/LAN) ---
WOL_MAC = ""                                    # ปล่อยว่าง = ไม่ปลุก
WOL_BROADCAST = "192.168.1.255"

# --- Dual-channel check (M4 — เฉพาะ Pi version) ---
# ถ้า LAN ยังไปถึง server IP ได้ = เครื่องหลักยังมีชีวิต → ลดระดับ alert เป็น WARN
MAIN_SERVER_LAN_IP = "192.168.1.100"
MAIN_SERVER_LAN_PORT = 3001
DUAL_CHANNEL_TIMEOUT_SEC = 3

# --- ESP32: แบตเตอรี่ (ADC) — ส่ง bat_pct ในทุก ping (low-power heartbeat) ---
BATTERY_ADC_PIN = 4                             # GPIO ที่ต่อตัวแบ่งแรงดันแบตเตอรี่ (หรือ -1 = ปิด)
BATTERY_VOLTAGE_MIN = 3.0
BATTERY_VOLTAGE_MAX = 4.2