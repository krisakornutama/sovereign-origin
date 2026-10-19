# Edge AI (Sovereign OS)

เอกสารฉบับเต็มและคู่มือติดตั้งอยู่ที่:

- [`sovereign-os/edge-ai/README.md`](../sovereign-os/edge-ai/README.md)

สรุปสั้น:

- Runtime: Ollama portable (pin `v0.40.6`) + Edge AI Gateway (Node built-ins, ไม่มี dependency ใหม่)
- Profiles: `nano` (8 GB), `mini` (16 GB), `standard` (32 GB), `gpu` (8 GB+ VRAM)
- Gateway: queue 2–4 concurrent, per-user limit, exact cache, single-flight, task routing, context trim
- ติดตั้ง: `sovereign-os\edge-ai\EDGE-AI-INSTALL.cmd`
- pull โมเดลซ้ำ/เฉพาะที่ขาด: `EDGE-AI-PULL.cmd` (HTTP + retry, ไม่พึ่ง CLI)
- เริ่ม/หยุด/วัดผล: `EDGE-AI-START.cmd`, `EDGE-AI-STOP.cmd`, `EDGE-AI-BENCH.cmd`
- ไม่แก้ `.env`, ไม่แตะ Docker/DB, ไม่ restart service ระหว่าง Cold Soak
- เทสต์: `node --test tools/test/edge-ai.test.mjs`

ข้อจำกัดสำคัญ: โมเดล 8B/14B บน CPU 16 GB ใช้ได้แต่ไม่เร็วสำหรับ 2–5 คนพร้อมกัน
profile `mini` จึงใช้ `qwen3:0.6b` เป็น fast (classify/routing) และ `gemma3:4b` เป็น main (chat/extract/JSON)
ส่วน deep model เป็น opt-in; embed (`bge-m3`) เป็น optional และไม่ได้ pull ในค่าเริ่มต้น (ติดตั้งเริ่มต้น fast+main ~4 GB)
