# คู่มือติดตั้ง Ollama (วันติดตั้งจริง) — Sovereign Origin

> ระบบ AI ทั้งหมดถูกออกแบบไว้พร้อมแล้ว — test ครบ, โค้ดรออยู่, ทางนี้คือขั้นตอนเปิดไฟเท่านั้น
> (ตามคำสั่งเจ้าของ: ตอนนี้ยังไม่ยุ่ง — เอกสารนี้ไว้ใช้วันติดตั้งจริง)

## 1. ติดตั้ง Ollama บนเครื่อง host (E: ไม่เกี่ยว — Ollama ติดตั้งบน C: ตามปกติของโปรแกรม)

1. โหลดตัวติดตั้งจาก https://ollama.com/download (Windows)
2. ติดตั้ง → Ollama จะ listen ที่ `http://127.0.0.1:11434` เองโดย default
   (backend อ่านค่านี้จาก env `OLLAMA_URL` — ไม่ต้องตั้งอะไรเพิ่มถ้าใช้ default)

## 2. โหลดโมเดล (ใช้ drive เดิมของ Ollama — ห้ามย้ายโมเดลไป C: เพิ่ม)

```bash
ollama pull gemma3:4b      # โมเดลหลักของ AI chat กลาง + Agent ทีม (env AI_MODEL, default gemma3:4b)
ollama pull qwen3-vl:8b    # โมเดล vision สำหรับแชทแนบรูป (env VISION_MODEL, default qwen3-vl:8b)
```

> หมายเหตุ: ถ้าดิสก์ระบบ (C:) พื้นที่น้อย ให้ตั้ง `OLLAMA_MODELS` ชี้ไป drive E: ก่อนติดตั้ง
> (เช่น ตั้ง system environment `OLLAMA_MODELS=E:\ollama\models`) แล้วค่อย `ollama pull` — ตามกฎ PROJECT DRIVE ONLY

## 3. ตรวจว่า backend เห็น Ollama

- เปิดแอป → หน้า `/ai-agent` → การ์ด "สถานะ AI Agent" ต้องขึ้น **Ollama ออนไลน์** + ชื่อโมเดลที่ใช้ + จำนวนโมเดลในเครื่อง
- หรือเช็คด้วยมือ: `curl http://127.0.0.1:11434/api/tags`

## 4. พิสูจน์โทนหลวงพี่ (16 โค้ด MBTI) บนของจริง

1. ทำแบบทดสอบที่หน้า `/mbti` (หรือ seed ผลลง localStorage key `sovereign.mbti.results.v1`)
2. พิมพ์คุยในแชทกลางบน dashboard (หรือหน้า `/ai-agent`) — น้ำเสียงคำตอบต้องเปลี่ยนตามโค้ด
   (INTJ = ตรง กระชับ มีตัวเลข, ESFP = สดใส อบอุ่น ฯลฯ)
3. หน้า `/healing` (AI Dhamma Companion) ก็ปรับโทนหลวงพี่เหมือนกัน

> test ฝั่ง backend พิสูจน์ "16 โค้ด → prompt ต่างกันจริง" ไว้แล้วทั้ง 120 คู่ (mock ไม่ต้องมี Ollama)
> — สิ่งที่ต้องตาเปล่ายืนยันหลังติดตั้งจริงคือข้อ 4 นี้เท่านั้น

## 5. ถ้าแชทตอบ "⚠️ AI ออฟไลน์"

- เช็คว่า Ollama รันอยู่: `ollama list` + `curl http://127.0.0.1:11434/api/tags`
- ดู log backend (`sovereign-os/core-api`) หาบรรทัด `AI processing error` / `Ollama not reachable`
- ระบบปกติตอบ `⚠️ AI อยู่ในโหมด Offline (Ollama not reachable)` — ไม่พังอย่างอื่น

## หมายเหตุ Docker

- คอนเทนเนอร์ backend เคยชี้ Ollama ผ่าน `host.docker.internal:11434` (ดู QUEUE.md เก่า 29/8)
- ถ้ารัน backend แบบ node ตรงบน host (npm run dev) → ใช้ 127.0.0.1:11434 ได้เลย
