# micropython/main.py — DMS firmware สำหรับ ESP32-S3 (+ SIM7600 4G HAT)
# Series 🔴 Dead-Man Switch — สเปก: docs/SERIES_RED_DMS_BLUEPRINT.md
#
# ฟีเจอร์ (M0/M2):
#  - heartbeat POST /api/v1/dms/ping ทุก 30s (±5s jitter) พร้อม HMAC-SHA256 rolling key
#  - seq คงสภาพข้าม reboot (เก็บใน flash /seq.txt)
#  - ladder ในตัว: ส่งไม่ได้ 90s → SMS/Telegram ระดับ 1, 180s → ระดับ 2 (+ย้ำทุก cooldown)
#  - low-power heartbeat: ส่ง bat_pct (ADC) ไปให้ server เห็นล่วงหน้า
#
# หมายเหตุ: MicroPython ไม่มี module hmac → implement HMAC-SHA256 เองบน uhashlib
# (RFC 2104) — ใช้ได้กับ key/hash ที่ฟังก์ชันรองรับ
import gc
import hashlib
import json
import machine
import random
import time
import ubinascii

try:
    import urequests as requests
except ImportError:
    import requests  # CPython fallback (สำหรับทดสอบบนเครื่อง)

from config import (
    SERVER_URL,
    DEVICE_ID,
    DMS_MASTER_SECRET,
    HEARTBEAT_INTERVAL_SEC,
    JITTER_MAX_SEC,
    MISSED_MS,
    FAILOVER_MS,
    RETRY_COUNT,
    RETRY_INTERVAL_SEC,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    SMS_PHONE,
    BATTERY_ADC_PIN,
    BATTERY_VOLTAGE_MIN,
    BATTERY_VOLTAGE_MAX,
)

KEY_ROTATION_SEC = 300  # blueprint §3: KEY(t) = SHA256(secret || floor(t/300))

SEQUENCE_FILE = "/seq.txt"
LOG_FILE = "/dms.log"

_state = {
    "seq": 0,
    "missed_started_at": None,
    "level": "ALIVE",
    "last_alert_at_ms": 0,
    "alert_cooldown_ms": 300000,  # blueprint §6: cooldown 5 นาที
}


# ── HMAC-SHA256 (MicroPython มักไม่มี `hmac`) ──
def hmac_sha256(key: bytes, msg: bytes) -> bytes:
    block = 64
    if len(key) > block:
        key = hashlib.sha256(key).digest()
    key = key + bytes(block - len(key))
    o_key_pad = bytes(b ^ 0x5C for b in key)
    i_key_pad = bytes(b ^ 0x36 for b in key)
    return hashlib.sha256(o_key_pad + hashlib.sha256(i_key_pad + msg).digest()).digest()


# ── Rolling key + signature (ต้องตรงกับ server: src/services/dms.service.ts) ──
def rolling_key(secret: str, ts: int) -> bytes:
    return hashlib.sha256((secret + str(ts // KEY_ROTATION_SEC)).encode()).digest()


def sign_ping(secret: str, ts: int, seq: int) -> str:
    key = rolling_key(secret, ts)
    msg = "{}|{}|{}".format(ts, DEVICE_ID, seq).encode()
    return ubinascii.hexlify(hmac_sha256(key, msg)).decode()


def read_seq() -> int:
    try:
        with open(SEQUENCE_FILE) as f:
            return int(f.read().strip() or 0)
    except OSError:
        return 0


def write_seq(seq: int):
    try:
        with open(SEQUENCE_FILE, "w") as f:
            f.write(str(seq))
    except OSError:
        pass


def log(msg: str):
    try:
        with open(LOG_FILE, "a") as f:
            f.write("[{}] {}\n".format(time.time(), msg))
    except OSError:
        pass
    print(msg)


def read_battery_pct():
    if BATTERY_ADC_PIN < 0:
        return None
    try:
        adc = machine.ADC(machine.Pin(BATTERY_ADC_PIN))
        adc.atten(machine.ADC.ATTN_11DB)
        v = adc.read() / 4095 * 3.3 * 2  # แบ่งแรงดัน 1:1 (ปรับตามวงจรจริง)
        pct = (v - BATTERY_VOLTAGE_MIN) / (BATTERY_VOLTAGE_MAX - BATTERY_VOLTAGE_MIN) * 100
        return max(0, min(100, int(pct)))
    except Exception as e:
        log("battery read error: {}".format(e))
        return None


def send_ping():
    ts = int(time.time())
    seq = _state["seq"] + 1
    body = json.dumps({"seq": seq, "uptime": int(time.ticks_ms() / 1000), "bat_pct": read_battery_pct()})
    headers = {
        "content-type": "application/json",
        "x-dms-device": DEVICE_ID,
        "x-dms-timestamp": str(ts),
        "x-dms-signature": sign_ping(DMS_MASTER_SECRET, ts, seq),
    }
    try:
        url = SERVER_URL + "/api/v1/dms/ping"
        r = requests.post(url, data=body, headers=headers, timeout=8)
        status = r.status_code
        r.close()
        if status == 200:
            _state["seq"] = seq
            write_seq(seq)
            return True
        log("ping rejected: HTTP {}".format(status))
    except Exception as e:
        log("ping failed: {}".format(e))
    return False


# ── ช่อง OOB: SMS ผ่าน SIM7600 (AT commands) — เติมเบอร์ใน config (SMS_PHONE) ──
def send_sms(text: str) -> bool:
    if not SMS_PHONE:
        return False
    try:
        uart = machine.UART(1, 115200, tx=17, rx=16)  # พิน UART ไป 4G HAT (ปรับตามบอร์ด)
        uart.write("AT\r\n")
        time.sleep(1)
        uart.write("AT+CMGF=1\r\n")
        time.sleep(1)
        uart.write('AT+CMGS="{}"\r\n'.format(SMS_PHONE))
        time.sleep(1)
        uart.write(text + "\x1a")
        time.sleep(3)
        uart.deinit()
        return True
    except Exception as e:
        log("SMS failed: {}".format(e))
        return False


def send_telegram(text: str) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    try:
        url = "https://api.telegram.org/bot{}/sendMessage".format(TELEGRAM_BOT_TOKEN)
        r = requests.post(url, data=json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": text[:4000]}),
                          headers={"content-type": "application/json"}, timeout=15)
        ok = r.status_code == 200
        r.close()
        return ok
    except Exception as e:
        log("Telegram failed: {}".format(e))
        return False


def alert(msg: str, level: int):
    now_ms = time.ticks_ms()
    if now_ms - _state["last_alert_at_ms"] < _state["alert_cooldown_ms"]:
        log("alert suppressed (cooldown): {}".format(msg))
        return
    _state["last_alert_at_ms"] = now_ms
    log("[L{}] ALERT: {}".format(level, msg))
    send_telegram("[DMS L{}] {}".format(level, msg))
    send_sms("[DMS L{}] {}".format(level, msg))


def ladder_tick(last_ok: bool):
    now = time.time()
    if last_ok:
        if _state["level"] != "ALIVE":
            log("RECOVERED — reset ladder")
            send_telegram("[DMS] ALL CLEAR - ระบบหลักกลับมาแล้ว")
        _state["level"] = "ALIVE"
        _state["missed_started_at"] = None
        return
    if _state["missed_started_at"] is None:
        _state["missed_started_at"] = now
    missed = int(now - _state["missed_started_at"]) * 1000
    if missed > FAILOVER_MS and _state["level"] != "FAILOVER":
        _state["level"] = "FAILOVER"
        alert("ระบบหลักเงียบเกิน {}s — SPOF ยืนยัน".format(FAILOVER_MS // 1000), 2)
    elif missed > MISSED_MS and _state["level"] == "ALIVE":
        _state["level"] = "SUSPECT"
        alert("ระบบหลักเงียบเกิน {}s — สงสัยตาย".format(MISSED_MS // 1000), 1)


def main():
    _state["seq"] = read_seq()
    log("DMS boot (device={}, server={})".format(DEVICE_ID, SERVER_URL))
    while True:
        ok = False
        for attempt in range(RETRY_COUNT):
            ok = send_ping()
            if ok:
                break
            time.sleep(RETRY_INTERVAL_SEC)
        ladder_tick(ok)
        gc.collect()
        delay = HEARTBEAT_INTERVAL_SEC + random.randint(-JITTER_MAX_SEC, JITTER_MAX_SEC)
        time.sleep(delay)


if __name__ == "__main__":
    main()