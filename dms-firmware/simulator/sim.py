#!/usr/bin/env python3
# simulator/sim.py — จำลอง DMS โดยไม่มีฮาร์ดแวร์ (acceptance: dry-run ladder)
# Series 🔴 Dead-Man Switch — สเปก: docs/SERIES_RED_DMS_BLUEPRINT.md
#
# ส่ง ping จริงไปที่ server ทุก 30s ด้วย signature ตรงตาม spec ที่ server ใช้
# ใช้ตรวจรับ M1 โดยไม่ต้องมี ESP32/Pi — server ต้องตั้ง DMS_ENABLED=true +
# DMS_MASTER_SECRET + DMS_ALLOWED_DEVICES (แนะนำ DMS_DRY_RUN=true ก่อน)
#
# ตัวอย่าง:
#   python sim.py --until 100          # ส่ง 100 วินาทีแล้วหยุด → server ควรขึ้น SUSPECT หลัง 90s
#   python sim.py --until 200          # ครบ 180s → server ขึ้น FAILOVER (ดู log / GET /api/v1/dms/status)
#   python sim.py --once --inject-bad-sig   # ยิง ping ปลอม 1 ครั้ง (ดู DMS_SIGNATURE_FAIL)
import argparse
import hashlib
import hmac
import json
import random
import sys
import time
import urllib.request
import urllib.error

sys.path.insert(0, __file__.rsplit("/", 2)[0])

HEARTBEAT_SEC = 30
KEY_ROTATION_SEC = 300


def sign(secret: str, device_id: str, ts: int, seq: int) -> str:
    key = hashlib.sha256(f"{secret}{ts // KEY_ROTATION_SEC}".encode()).digest()
    return hmac.new(key, f"{ts}|{device_id}|{seq}".encode(), hashlib.sha256).hexdigest()


def ping(server: str, secret: str, device_id: str, seq: int, bad_sig: bool = False) -> int:
    ts = int(time.time())
    sig = "0" * 64 if bad_sig else sign(secret, device_id, ts, seq)
    body = json.dumps({"seq": seq, "uptime": 0, "bat_pct": 80}).encode()
    req = urllib.request.Request(
        f"{server}/api/v1/dms/ping", data=body, method="POST",
        headers={
            "content-type": "application/json",
            "x-dms-device": device_id,
            "x-dms-timestamp": str(ts),
            "x-dms-signature": sig,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError as e:
        print(f"connection error: {e}")
        return 0


def main():
    parser = argparse.ArgumentParser(description="DMS heartbeat simulator (dry-run acceptance)")
    parser.add_argument("--server", default="http://127.0.0.1:3001", help="URL ของ Sovereign OS (default http://127.0.0.1:3001)")
    parser.add_argument("--secret", default=None, help="DMS_MASTER_SECRET (default: อ่านจาก config.py)")
    parser.add_argument("--device", default=None, help="device_id (default: config.py)")
    parser.add_argument("--until", type=int, default=None, help="ส่ง ping กี่วินาทีแล้วหยุด (default: ไม่หยุด)")
    parser.add_argument("--interval", type=int, default=HEARTBEAT_SEC, help="ช่วงระหว่าง ping (default 30)")
    parser.add_argument("--once", action="store_true", help="ส่งแค่ 1 ครั้งแล้วจบ")
    parser.add_argument("--inject-bad-sig", action="store_true", help="ยิง sig ปลอม 1 ครั้ง (ทดสอบ DMS_SIGNATURE_FAIL)")
    args = parser.parse_args()

    try:
        from config import DEVICE_ID, DMS_MASTER_SECRET
    except ImportError:
        DEVICE_ID, DMS_MASTER_SECRET = "dms-esp32s3-01", ""

    device = args.device or DEVICE_ID
    secret = args.secret or DMS_MASTER_SECRET
    if not secret:
        print("ERROR: ไม่มี secret — ตั้งใน config.py หรือ --secret")
        sys.exit(1)

    seq = 1
    t0 = time.time()
    print(f"[sim] device={device} -> {args.server} ทุก {args.interval}s "
          f"(หยุด {args.until}s)" if args.until else f"[sim] device={device} -> {args.server} ทุก {args.interval}s (ไม่หยุด)")
    while True:
        elapsed = time.time() - t0
        if args.until and elapsed >= args.until:
            print(f"[sim] หยุดส่งแล้ว (ครบ {args.until}s) — ดู server ขึ้น ladder: "
                  f"SUSPECT หลัง 90s / FAILOVER หลัง 180s")
            break
        if args.inject_bad_sig:
            status = ping(args.server, secret, device, seq, bad_sig=True)
            print(f"[sim] ping (BAD sig) -> HTTP {status} (คาด 401, server ควร log DMS_SIGNATURE_FAIL)")
            args.inject_bad_sig = False
            continue
        status = ping(args.server, secret, device, seq)
        print(f"[sim] ping seq={seq} -> HTTP {status}")
        if status == 200:
            seq += 1
        time.sleep(args.interval + random.uniform(-5, 5) if not args.once else 0)
        if args.once:
            break


if __name__ == "__main__":
    main()