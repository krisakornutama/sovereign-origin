#!/usr/bin/env python3
# pizero/dms_client.py — DMS client สำหรับ Raspberry Pi Zero 2 W (+ USB 4G modem)
# Series 🔴 Dead-Man Switch — สเปก: docs/SERIES_RED_DMS_BLUEPRINT.md
#
# M0/M2: heartbeat POST /api/v1/dms/ping ทุก 30s (±5s jitter) + HMAC rolling key
# M3:    WoL magic packet → Cold Standby (เมื่อ ladder ถึงระดับ 2 และตั้ง WOL_MAC)
# M4:    dual-channel check — ถ้า LAN ยังไปถึง server IP ได้ = ยังมีชีวิต → ลดระดับเป็น WARN
#
# รัน: python3 dms_client.py            (systemd: ดู dms-client.service)
# config: คัดลอก ../config.example.py → ../config.py
import hashlib
import hmac
import json
import random
import socket
import sys
import time
import urllib.request
import urllib.error

sys.path.insert(0, __file__.rsplit("/", 2)[0])  # ใช้ config ที่โฟลเดอร์บน
from config import (  # noqa: E402
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
    WOL_MAC,
    WOL_BROADCAST,
    MAIN_SERVER_LAN_IP,
    MAIN_SERVER_LAN_PORT,
    DUAL_CHANNEL_TIMEOUT_SEC,
)

KEY_ROTATION_SEC = 300
STATE_FILE = "/var/lib/dms/state.json"

state = {"seq": 0, "missed_started_at": None, "level": "ALIVE", "next_alert_ms": 0, "alert_cooldown_ms": 300000}


# ── Rolling key + signature (ต้องตรงกับ server: src/services/dms.service.ts) ──
def rolling_key(secret: str, ts: int) -> bytes:
    return hashlib.sha256(f"{secret}{ts // KEY_ROTATION_SEC}".encode()).digest()


def sign_ping(secret: str, ts: int, seq: int) -> str:
    key = rolling_key(secret, ts)
    return hmac.new(key, f"{ts}|{DEVICE_ID}|{seq}".encode(), hashlib.sha256).hexdigest()


def load_state():
    try:
        with open(STATE_FILE) as f:
            data = json.load(f)
            state["seq"] = int(data.get("seq", 0))
    except Exception:
        pass


def save_state():
    try:
        with open(STATE_FILE, "w") as f:
            json.dump({"seq": state["seq"]}, f)
    except Exception:
        pass


def send_ping() -> bool:
    ts = int(time.time())
    seq = state["seq"] + 1
    body = json.dumps({"seq": seq, "uptime": int(time.time() - BOOT_TIME), "bat_pct": None})
    headers = {
        "content-type": "application/json",
        "x-dms-device": DEVICE_ID,
        "x-dms-timestamp": str(ts),
        "x-dms-signature": sign_ping(DMS_MASTER_SECRET, ts, seq),
    }
    req = urllib.request.Request(SERVER_URL + "/api/v1/dms/ping", data=body.encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status == 200:
                state["seq"] = seq
                save_state()
                return True
            log(f"ping rejected: HTTP {resp.status}")
    except (urllib.error.URLError, OSError) as e:
        log(f"ping failed: {e}")
    return False


# ── M4: dual-channel — ลอง TCP ไป server IP ทาง LAN (ยังมีไฟ/เน็ตบ้านไหม) ──
def lan_reachable() -> bool:
    if not MAIN_SERVER_LAN_IP:
        return False
    try:
        with socket.create_connection((MAIN_SERVER_LAN_IP, MAIN_SERVER_LAN_PORT), timeout=DUAL_CHANNEL_TIMEOUT_SEC):
            return True
    except OSError:
        return False


# ── M3: Wake-on-LAN magic packet (UDP:9) ──
def send_wol(mac: str, broadcast: str) -> bool:
    mac = mac.replace(":", "").replace("-", "")
    if len(mac) != 12:
        log(f"WOL: invalid MAC {mac!r}")
        return False
    packet = b"\xff" * 6 + bytes.fromhex(mac) * 16
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            s.sendto(packet, (broadcast, 9))
        log(f"WOL sent to {broadcast} -> {mac}")
        return True
    except OSError as e:
        log(f"WOL failed: {e}")
        return False


def send_telegram(text: str) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False
    body = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": text[:4000]}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage", data=body,
        headers={"content-type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status == 200
    except Exception as e:
        log(f"Telegram failed: {e}")
        return False


def alert(msg: str, level: int):
    now_ms = int(time.time() * 1000)
    if now_ms - state["next_alert_ms"] < 0:
        log(f"alert suppressed (cooldown): {msg}")
        return
    state["next_alert_ms"] = now_ms + state["alert_cooldown_ms"]
    log(f"[L{level}] ALERT: {msg}")
    send_telegram(f"[DMS L{level}] {msg}")


def ladder_tick(last_ok: bool):
    now = time.time()
    if last_ok:
        if state["level"] != "ALIVE":
            log("RECOVERED - reset ladder")
            send_telegram("[DMS] ALL CLEAR - ระบบหลักกลับมาแล้ว")
        state["level"] = "ALIVE"
        state["missed_started_at"] = None
        return
    if state["missed_started_at"] is None:
        state["missed_started_at"] = now
    missed_ms = int(now - state["missed_started_at"]) * 1000
    if missed_ms > FAILOVER_MS and state["level"] != "FAILOVER":
        state["level"] = "FAILOVER"
        # dual-channel: LAN ยังถึง server = เครื่องหลักมีชีวิต (ช่องทาง 4G พังเอง) → ลดระดับ
        if lan_reachable():
            log("LAN ยัง reachable — เครื่องหลักน่าจะยังมีชีวิต ลดระดับ alert")
            alert("4G ช่องทางขัดข้อง (LAN ยังถึง server) — ระบบหลักน่าจะปกติ", 1)
        else:
            alert(f"ระบบหลักเงียบเกิน {FAILOVER_MS // 1000}s — SPOF ยืนยัน", 2)
            if WOL_MAC:
                send_wol(WOL_MAC, WOL_BROADCAST)
    elif missed_ms > MISSED_MS and state["level"] == "ALIVE":
        state["level"] = "SUSPECT"
        alert(f"ระบบหลักเงียบเกิน {MISSED_MS // 1000}s — สงสัยตาย", 1)


def log(msg: str):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] DMS: {msg}", flush=True)


BOOT_TIME = time.time()


def main():
    load_state()
    log(f"DMS boot (device={DEVICE_ID}, server={SERVER_URL})")
    while True:
        ok = False
        for _ in range(RETRY_COUNT):
            ok = send_ping()
            if ok:
                break
            time.sleep(RETRY_INTERVAL_SEC)
        ladder_tick(ok)
        delay = HEARTBEAT_INTERVAL_SEC + random.randint(-JITTER_MAX_SEC, JITTER_MAX_SEC)
        time.sleep(delay)


if __name__ == "__main__":
    main()