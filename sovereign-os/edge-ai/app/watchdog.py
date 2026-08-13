# edge-ai/app/watchdog.py (part of FastAPI)
from datetime import datetime

last_heartbeat = datetime.utcnow()

@app.get("/health/heartbeat")
def heartbeat():
    global last_heartbeat
    last_heartbeat = datetime.utcnow()
    return {"status": "ok", "timestamp": last_heartbeat.isoformat()}