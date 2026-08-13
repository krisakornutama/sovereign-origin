# edge-ai/scripts/oobm_alert.py
import serial
import time
import requests
import os

WATCHDOG_URL = "http://localhost:8000/health/heartbeat"
SERIAL_PORT = os.getenv("OOBM_SERIAL_PORT", "/dev/ttyUSB0")
BAUD = 19200
MESSAGE = "ALERT: NODE OFFLINE – Sovereign OS Base #1"

def send_serial_alert():
    try:
        with serial.Serial(SERIAL_PORT, BAUD, timeout=5) as ser:
            # AT commands for Iridium / LoRa module vary; this is a sketch
            ser.write(b'AT+MSG="' + MESSAGE.encode() + b'"\r\n')
            time.sleep(2)
            response = ser.read_all()
            print(f"Modem response: {response}")
    except Exception as e:
        print(f"OOBM serial error: {e}")

def monitor():
    while True:
        try:
            resp = requests.get(WATCHDOG_URL, timeout=5)
            if resp.status_code != 200:
                raise Exception("Bad status")
        except Exception:
            print("Heartbeat failed! Sending OOBM alert...")
            send_serial_alert()
        time.sleep(30)  # check every 30s

if __name__ == "__main__":
    monitor()