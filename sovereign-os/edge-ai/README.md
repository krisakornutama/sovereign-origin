# Sovereign Edge AI — ชั้น Inference สำหรับ 2–5 คนบนเครื่องเล็ก

โฟลเดอร์นี้คือ **ชุดติดตั้ง Edge AI แบบพกพา** สำหรับ Sovereign OS/Desktop
เป้าหมายคือให้เครื่อง mini PC หรือโน้ตบุ๊ก RAM 8–32 GB รับผู้ใช้ 2–5 คนได้จริง
โดยไม่ต้องเพิ่ม dependency ใน `package.json` และไม่แตะ `.env`, Docker หรือ database ในช่วง Cold Soak

ชุดนี้ประกอบด้วย:

- **Ollama แบบ portable** (ดาวน์โหลดตอนติดตั้ง) เป็น runtime ที่ core-api ใช้อยู่แล้ว
- **Edge AI Gateway** เป็น Node.js HTTP service ไม่มี dependency ภายนอก
  ทำ queue, cache, task routing, context trimming และ model alias/downgrade
- **Hardware profiles** 4 ระดับ: `nano`, `mini`, `standard`, `gpu`
- **ตัวติดตั้ง/เริ่ม/หยุด/benchmark** สำหรับ Windows แบบ double-click
- **เทสต์** ใน `tools/test/edge-ai.test.mjs`
- **เอกสารเหตุผลการเลือกโปรเจ็ก** และข้อจำกัดที่ต้องรู้

> สถานะ: ชุดนี้เป็น opt-in และไม่ถูกเริ่มอัตโนมัติ
> การติดตั้ง/รันจะไม่ restart `sovereign-core-api`, ไม่แก้ `.env` และไม่รัน migration

---

## 1. ทำไมต้องมีชั้นนี้

การเอาโมเดลไปวางหลัง API ตรง ๆ แล้วให้ผู้ใช้ 2–5 คนยิงพร้อมกัน มีปัญหา 4 ข้อ:

1. **RAM/VRAM ไม่พอ** — Ollama โหลดโมเดลตาม request และถ้าตั้ง parallel หลาย slot
   KV cache จะคูณตามจำนวน slot
2. **โมเดลใหญ่เกินไป** — โมเดล 8B บน CPU 16 GB ใช้ได้แต่ช้า และถ้าหลายคนพร้อมกันจะยิ่งช้า
3. **งานซ้ำถูกคิดใหม่** — คำถามเดิม/คำสั่ง deterministic ถูกส่งเข้าโมเดลซ้ำโดยไม่จำเป็น
4. **ไม่มีคิว/เพดาน** — ผู้ใช้คนเดียวสามารถกินทั้งเครื่อง ทำให้คนอื่นรอหรือ timeout

ชั้นนี้แก้ด้วยหลัก **“แบ่งงานก่อน แล้วค่อยเลือกโมเดล”**:

```
L0  deterministic / SQL / template / cache hit     ← เร็วที่สุด ไม่ใช้โมเดล
L1  fast model (0.6B)                              ← classify, routing, งานสั้น
L2  main model (1B–8B ตาม hardware)                ← chat, extract/JSON, งานทั่วไป, ภาษาไทย
L3  deep model (8B–14B)                            ← เฉพาะเมื่อขอ และเครื่องไหว
L4  remote/cloud fallback (ยังไม่ตั้งค่า)           ← ทางเลือกในอนาคต ไม่ใช่ค่าเริ่มต้น
```

Gateway จะเลือกชั้นจาก `x-sovereign-task` หรือ `task` ใน body
ถ้าไม่ได้ระบุจะใช้ `main` เพื่อไม่ให้เกิดการสลับโมเดลบ่อยโดยไม่จำเป็น

---

## 2. สำรวจโปรเจ็กบน GitHub (snapshot 2026-10-19)

ตัวเลขดาวเป็น snapshot ณ วันที่เขียน ไม่ใช่ตัวชี้วัดคุณภาพเพียงอย่างเดียว
ก่อนนำไปใช้ในผลิตภัณฑ์ต้องตรวจ license ของ **ตัวโปรเจ็กและตัวโมเดล** แยกกันอีกครั้ง

| โปรเจ็ก | License | Stars | บทบาท | ใช้ในชุดนี้? |
|---|---|---:|---|---|
| [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT | 131.7k | inference engine C/C++, CPU/GPU hybrid, GGUF, layer offload | ใช่ — เป็น engine ใต้ Ollama |
| [ollama/ollama](https://github.com/ollama/ollama) | MIT | 183.8k | model lifecycle + HTTP API + GPU/CPU scheduling | ใช่ — runtime หลัก |
| [mostlygeek/llama-swap](https://github.com/mostlygeek/llama-swap) | MIT | 6.0k | สลับโมเดลบน llama.cpp ตาม request, TTL, groups | ยังไม่ใช้ — ตัวเลือก advanced |
| [ikawrakow/ik_llama.cpp](https://github.com/ikawrakow/ik_llama.cpp) | MIT | 3.3k | fork ที่เน้น CPU/hybrid MoE และ IQK quant | ยังไม่ใช้ — ต้อง build เอง |
| [mudler/LocalAI](https://github.com/mudler/LocalAI) | MIT | 49.6k | OpenAI-compatible หลาย backend, vision/voice | ยังไม่ใช้ — หนักกว่าและซ้ำกับ Ollama |
| [EricLBuehler/mistral.rs](https://github.com/EricLBuehler/mistral.rs) | MIT | 7.8k | inference Rust, CPU/GPU, quantization | ยังไม่ใช้ — ทางเลือกอนาคต |
| [kvcache-ai/ktransformers](https://github.com/kvcache-ai/ktransformers) | Apache-2.0 | 19.6k | CPU+GPU hybrid สำหรับ MoE ขนาดใหญ่ | ยังไม่ใช้ — ต้อง RAM/GPU สูง |
| [lyogavin/airllm](https://github.com/lyogavin/airllm) | Apache-2.0 | 39.4k | layer-by-layer offload ลงดิสก์/GPU เล็ก | ไม่ใช้กับ interactive — ช้ามาก |
| [SJTU-IPADS/PowerInfer](https://github.com/SJTU-IPADS/PowerInfer) | MIT | 9.8k | sparse activation, CPU/GPU hybrid | ยังไม่ใช้ — model support จำกัด |
| [Mozilla-Ocho/llamafile](https://github.com/Mozilla-Ocho/llamafile) | NOASSERTION | 26.4k | single-file executable + server | ทางเลือกสำรอง — เหมาะ demo/พกพา |
| [vllm-project/vllm](https://github.com/vllm-project/vllm) | Apache-2.0 | 94.1k | high-throughput GPU serving | ไม่ใช้บน CPU/mini PC |
| [sgl-project/sglang](https://github.com/sgl-project/sglang) | Apache-2.0 | 37.3k | high-throughput GPU serving, RadixAttention | ไม่ใช้บน CPU/mini PC |
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | NOASSERTION | 61.5k | AI gateway, routing, budgets, keys | ไม่ใช้ — เขียน gateway เบา ๆ ใน Node แทน |
| [open-webui/open-webui](https://github.com/open-webui/open-webui) | NOASSERTION | 156.1k | chat UI/RAG หลายผู้ใช้ | ไม่ใช้ — มี Next.js UI อยู่แล้ว |
| [zilliztech/GPTCache](https://github.com/zilliztech/GPTCache) | MIT | 8.2k | semantic cache | ไม่ใช้ — exact cache ปลอดภัยกว่า |
| [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM) | Apache-2.0 | 5.6k | router ระหว่างโมเดลแรง/เบา | ไม่ใช้ — ใช้ task routing แบบ deterministic |

### เหตุผลที่เลือก Ollama + gateway ของเรา

- **Ollama** เป็นสิ่งที่ core-api ใช้อยู่แล้ว (`OLLAMA_URL`, `/api/generate`, `/api/tags`)
  และมี Windows zip แบบ portable ไม่ต้องติดตั้งเป็น service/admin
- **llama.cpp** คือ engine ข้างในอยู่แล้ว เราไม่ต้องเขียน inference เอง
- **gateway เบา ๆ ใน Node** ทำให้เพิ่ม queue/cache/routing ได้โดยไม่เพิ่ม Python service
  และไม่ต้องแก้ backend ในช่วง Cold Soak
- **llama-swap / KTransformers / vLLM** เป็นตัวเลือกที่ดีเมื่อ hardware เปลี่ยน
  แต่เกินความจำเป็นของ mini PC 16 GB ในรอบแรก

### สิ่งที่ไม่ได้ทำและไม่ควรอ้างเกินจริง

- โมเดล 70B ไม่สามารถโต้ตอบเร็ว ๆ บน CPU 16 GB ได้
  AirLLM ทำได้แต่แลกด้วยความเร็วระดับนาที ไม่เหมาะกับ 2–5 คน
- การ offload layer ไป GPU ช่วยได้เมื่อมี discrete GPU จริง
  iGPU Radeon บน Ryzen 7730U ใช้ RAM ร่วมกับระบบ จึงตั้งใจให้ profile นี้เป็น CPU inference
- vLLM/SGLang จะชนะเรื่อง throughput เมื่อมี NVIDIA GPU และโมเดล fits VRAM
  แต่ไม่ใช่คำตอบของเครื่องนี้

---

## 3. Hardware profiles

ค่าเหล่านี้อยู่ใน `profiles.json` และถูก adjust ตามจำนวน physical core จริงอีกครั้ง

| Profile | RAM | Models (fast / main / deep / embed) | Parallel | Context | Gateway concurrency |
|---|---|---|---:|---:|---:|
| `nano` | 8 GB | qwen3:0.6b / gemma3:1b / - / nomic-embed-text | 1 | 2048 | 1 |
| `mini` | 16 GB | qwen3:0.6b / gemma3:4b / qwen3:8b (opt-in) / bge-m3 | 2 | 4096 | 2 |
| `standard` | 32 GB | qwen3:1.7b / qwen3:8b / qwen3:14b (opt-in) / bge-m3 | 2 | 8192 | 2 |
| `gpu` | 8 GB+ VRAM | qwen3:1.7b / qwen3:8b / qwen3:14b / bge-m3 | 4 | 8192 | 4 |

`mini` ใช้ `qwen3:0.6b` เป็น fast เพราะชั้นนี้ทำงานสั้น ๆ (classify/routing) และช่วยคืน RAM ให้ main model
ส่วนงาน `extract`/JSON ถูก route ไป `main` (`gemma3:4b`) เพื่อคุณภาพและกันโมเดลเล็กวนซ้ำ
ถ้าต้องการ fast ที่ฉลาดขึ้นบนเครื่อง 16 GB ใช้ `--models`/`pull.mjs --model qwen3:1.7b` แล้วแก้ `models.fast` ใน config ได้

**Embed** เป็น optional: ค่าเริ่มต้นติดตั้งแค่ `fast,main` (~4 GB)
ถ้าจะใช้ knowledge/RAG ค่อย pull `bge-m3` (~1.2 GB) ด้วย `EDGE-AI-PULL.cmd --models embed`

**Deep tier** ถูกปิดเป็นค่าเริ่มต้นบน `mini`/`standard`
ถ้าจะใช้ต้องส่ง header `x-sovereign-allow-deep: 1`
เพื่อกันคนหนึ่งคนโหลด 8B/14B แล้วทำให้ทั้งเครื่องช้า

**Vision** ใช้ `gemma3:4b` (multimodal) บน `mini` และ `qwen3-vl:8b` บน `standard`/`gpu`
ถ้าไม่ได้ใช้ภาพก็ไม่ต้อง pull โมเดล vision

### ขนาดโมเดลโดยประมาณ (Q4/Q8)

| Model | Size |
|---|---:|
| qwen3:0.6b | ~0.5 GB |
| gemma3:1b | ~0.9 GB |
| qwen3:1.7b | ~1.4 GB |
| gemma3:4b | ~3.4 GB |
| qwen3:8b | ~5.3 GB |
| qwen3:14b | ~9.0 GB |
| bge-m3 | ~1.2 GB |

สูตรหยาบ ๆ ที่ gateway ใช้เตือน:
`weights ของโมเดลที่โหลดพร้อมกัน + KV cache (ctx × parallel × 0.00012 GB) + 2 GB OS`
ถ้าเกิน 85% ของ RAM จะมี warning ตอนติดตั้ง

---

## 4. สถาปัตยกรรม

```
Desktop / Browser
      │
      ▼
core-api :3001  (ไม่แก้ในรอบนี้)
      │  OLLAMA_URL=http://host.docker.internal:11434
      ▼
Edge AI Gateway :11434
  ├─ auth (ถ้าตั้ง token)
  ├─ task routing / model aliases / deep opt-in
  ├─ queue: maxConcurrent, per-user, maxQueue, timeout
  ├─ exact cache + single-flight
  ├─ context trim (history + max chars + maxPredict)
  └─ metrics / health
      │
      ▼
Ollama :11435  (portable, loopback)
  └─ llama.cpp engine, CPU/GPU ตาม hardware
```

### ทำไมต้องมี gateway ทั้งที่ Ollama มี queue อยู่แล้ว

- Ollama queue ไม่รู้จักผู้ใช้/งาน และไม่มี exact cache
- Ollama ไม่รู้ว่า request นี้ควรใช้โมเดลชั้นไหน
- Ollama ไม่ trim history ให้พอดี context ของเครื่อง
- Gateway ทำให้เปลี่ยน runtime ในอนาคต (llama.cpp/llama-swap/remote) โดย backend ไม่ต้องรู้

---

## 5. การติดตั้งบนเครื่องนี้ / mini PC

### วิธี double-click

1. คัดลอกโฟลเดอร์โปรเจ็กไปไว้บน **drive E:** (หรือ drive ที่มีที่ว่าง ≥ 10 GB)
2. เปิด `sovereign-os\edge-ai\EDGE-AI-INSTALL.cmd`
3. รอ download Ollama (~1.4 GB) และ models (ค่าเริ่มต้น fast+main ~4 GB) — ถ้ามี runtime/models อยู่แล้วจะข้ามให้
4. เปิด `EDGE-AI-START.cmd` / หยุดด้วย `EDGE-AI-STOP.cmd`
5. benchmark ด้วย `EDGE-AI-BENCH.cmd`
6. ถ้าเน็ตหลุดระหว่าง pull โมเดล เปิด `EDGE-AI-PULL.cmd` เพื่อ pull เฉพาะโมเดลที่ยังขาด (retry อัตโนมัติ)

ตัวติดตั้งจะ:

- ตรวจ CPU/RAM/GPU/ดิสก์ และเลือก profile
- ดาวน์โหลด Ollama zip จาก GitHub release ที่ pin ไว้ (`v0.40.6`) และตรวจ SHA-256
- แตกไฟล์ไว้ใน `sovereign-os/edge-ai/runtime/ollama` (ไม่ใช่ C:)
- เก็บโมเดลไว้ใน `sovereign-os/edge-ai/models`
- เขียน `edge-ai.config.json`
- เริ่ม Ollama บน loopback และ gateway
- **ไม่** แก้ `.env`, ไม่แตะ Docker, ไม่รัน migration, ไม่ติดตั้ง Windows service

### วิธี CLI

```powershell
cd "E:\My work\Project Sovereign Origin"
node sovereign-os\edge-ai\scripts\probe.mjs
node sovereign-os\edge-ai\scripts\install.mjs --dry-run
node sovereign-os\edge-ai\scripts\install.mjs --models fast,main
```

ตัวเลือกที่ใช้บ่อย:

```text
--profile nano|mini|standard|gpu   บังคับ profile
--models fast,main|fast,main,embed|all|none  เลือกโมเดลที่จะ pull (ค่าเริ่มต้น fast,main)
--quick                            = --models fast
--gateway-port 11434               พอร์ตที่ core-api จะต่อ
--ollama-port 11435                พอร์ตภายในของ Ollama
--import-from <path>               import models จากเครื่องเก่า (hardlink ถ้าอยู่ drive เดียวกัน)
--import-only gemma3               import เฉพาะโมเดลที่ชื่อมีคำนี้
--no-start                         ดาวน์โหลด/เขียน config แต่ไม่เริ่ม process
--download-only                    เหมือน --no-start และไม่ pull โมเดล
--force                            ดาวน์โหลด/แตกไฟล์ใหม่
--token <secret>                   bearer token (จำเป็นเมื่อ bind ไม่ใช่ loopback)
--version v0.40.6|latest           เลือก Ollama release
```

### pull โมเดลแยก (ไม่ต้องรัน installer ใหม่)

```powershell
node sovereign-os\edge-ai\scripts\pull.mjs --models fast,embed --retry 8
node sovereign-os\edge-ai\scripts\pull.mjs --model qwen3:0.6b --retry 8
# หรือ
EDGE-AI-PULL.cmd
```

สคริปต์จะถาม `/api/tags` ก่อน ข้ามโมเดลที่มีอยู่ แล้ว pull เฉพาะที่ขาดผ่าน HTTP API
พร้อม retry เมื่อเน็ตหลุด (ค่าเริ่มต้น 6 ครั้ง)

### ย้ายไป mini PC

1. คัดลอกทั้งโปรเจ็ก (หรืออย่างน้อย `sovereign-os/edge-ai` + `runtime` + `models`) ไปเครื่องใหม่บน drive E:
2. ดับเบิลคลิก `EDGE-AI-INSTALL.cmd` — ตัวติดตั้งจะ:
   - ตรวจว่า `runtime/ollama/ollama.exe` มีอยู่และใช้งานได้หรือไม่
   - ตรวจ SHA-256 ของ archive ที่มีอยู่ก่อนแตกไฟล์
   - เห็นโมเดลที่คัดลอกมาอยู่แล้วและ **ข้ามการ pull**
   - สร้าง `edge-ai.config.json` ใหม่ให้ตรง path ของเครื่องใหม่
3. ถ้าเครื่องใหม่ยังไม่มี models และเน็ตไม่เสถียร ให้รัน `EDGE-AI-PULL.cmd` แยกได้ (retry 8 ครั้ง/โมเดล)
4. เปิด `EDGE-AI-START.cmd`

> ห้ามรัน `ollama pull` ตรง ๆ บน Windows เครื่องนี้ เพราะคำสั่งอาจไปเรียก Ollama app ที่ติดตั้งอยู่เดิม (คนละเวอร์ชัน/คนละ model store) — ให้ใช้ `EDGE-AI-PULL.cmd` หรือ installer เท่านั้น

---

## 6. การทำงานกับ 2–5 ผู้ใช้

### ค่าเริ่มต้น

- `maxConcurrent` = 2 บน mini (Ollama `OLLAMA_NUM_PARALLEL=2`)
- `perUserConcurrent` = 1 **เมื่อมี header `x-sovereign-user`**
  ถ้าไม่มี header จะไม่จำกัดรายคน แต่ยังจำกัด global 2
- `maxQueue` = 24, `queueTimeoutMs` = 180 s
- ถ้าคิวเต็ม → `429` พร้อม `Retry-After`
- `maxPredictTokens` = 2048 ต่อ request (กันคนเดียวGenerate ยาวจนบล็อกคนอื่น)
- `maxPromptChars` = 24,000 บน mini; history ถูกตัดเหลือ 12 ข้อความล่าสุด

### Cache

- cache เฉพาะ request ที่ **ไม่ stream**, ไม่มีรูป และ `temperature = 0` หรือส่ง `cache: true`
- key = SHA-256 ของ endpoint + model + prompt/messages/options ที่มีผลต่อผลลัพธ์
- request เดียวกันที่มาพร้อมกันจะถูก **single-flight** ให้ทำงานครั้งเดียว
- ไม่ทำ semantic cache เพราะอาจคืนคำตอบผิดบริบท; exact cache ปลอดภัยกว่า

### Ollama tuning ที่ installer ตั้งให้

```
OLLAMA_NUM_PARALLEL=2
OLLAMA_MAX_LOADED_MODELS=2
OLLAMA_CONTEXT_LENGTH=4096
OLLAMA_MAX_QUEUE=24
OLLAMA_KEEP_ALIVE=30m
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_MULTIUSER_CACHE=1
OLLAMA_NO_CLOUD=1
OLLAMA_LLM_LIBRARY=cpu        (profile mini/nano ที่ใช้ iGPU)
```

`num_thread` ถูกส่งเป็น option ต่อ request และตั้งเป็นจำนวน **physical core**
ไม่ใช้ logical core ทั้งหมด เพราะถ้ามีโปรเซสอื่นแย่ง CPU การใช้ thread เกินจะช้าลงมาก

---

## 7. เชื่อมกับ core-api

core-api ใช้ `OLLAMA_URL` (ค่าเริ่มต้น `http://127.0.0.1:11434`)
และใน `docker-compose.yml` ตั้งเป็น `http://host.docker.internal:11434`

ทางที่ปลอดภัยที่สุดหลัง Cold Soak:

1. ให้ gateway อยู่บนพอร์ต **11434** ( installer เลือกให้อัตโนมัติถ้าพอร์ตว่าง)
2. ให้ Ollama อยู่บน **11435**
3. core-api ไม่ต้องแก้ `.env` — มันจะต่อ gateway ทันทีเมื่อ container มองเห็น host
4. ถ้า gateway ต้องอยู่พอร์ตอื่น ให้แก้ `OLLAMA_URL` **หลัง** Cold Soak เท่านั้น

> ถ้า core-api อยู่ใน Docker และ gateway bind แค่ `127.0.0.1`
> container จะต่อไม่ได้ ต้องใช้ `--gateway-host 0.0.0.0 --token <secret>`
> เฉพาะใน LAN ที่เชื่อถือได้ หรือทำ compose sidecar ใน phase ถัดไป

### Model alias / downgrade

backend เดิมมี route ไป `qwen3:8b`, `deepseek-r1:8b`, `qwen3-vl:8b`
บน `mini` gateway จะ map โมเดลพวกนี้เป็น tier ที่เหมาะกับเครื่อง:

- `qwen3:8b` / `deepseek-r1:8b` → `main` (gemma3:4b) เว้นแต่ส่ง `x-sovereign-allow-deep: 1`
- `qwen3-vl:8b` → `vision` (gemma3:4b)
- โมเดลที่ไม่รู้จัก → `main` (เปลี่ยนได้ด้วย `routing.unknownModelPolicy`)

ทุก response มี header `x-edge-model`, `x-edge-tier`, `x-edge-substituted`
เพื่อให้ตรวจย้อนหลังได้ว่าใช้โมเดลอะไรจริง

---

## 8. Security / Cold Soak

- Gateway bind `127.0.0.1` เป็นค่าเริ่มต้น
- ถ้า bind `0.0.0.0` ต้องมี bearer token; installer จะ generate ให้และพิมพ์ครั้งเดียว
- ไม่ log prompt หรือ content ลงไฟล์; log แค่ method/path/status/model/เวลา
- `OLLAMA_NO_CLOUD=1` ปิด cloud features ของ Ollama
- ไม่มีการแก้ `.env`, `docker-compose`, database หรือ restart service ใด ๆ
- ไม่มี dependency ใหม่ใน `package.json`; ทุกอย่างเป็น Node built-in + binary ที่ดาวน์โหลดแยก

---

## 9. Benchmark

```powershell
node sovereign-os\edge-ai\scripts\bench.mjs
# หรือ
EDGE-AI-BENCH.cmd
```

ผลจะถูกเขียนที่ `sovereign-os/edge-ai/benchmarks/this-machine.json`
ประกอบด้วย:

- hardware ที่ตรวจได้
- โมเดล/ค่า runtime
- latency, output tok/s, prompt tok/s ต่อ prompt
- concurrent throughput ตาม `maxConcurrent`

ผลของเครื่องที่ใช้พัฒนา (Ryzen 7 7730U / 16 GB / Radeon iGPU) จะถูกบันทึกหลังรันจริง
ตัวเลขจะแตกต่างตาม RAM, storage, background apps และโมเดล

---

## 10. เทสต์

```powershell
node --test tools/test/edge-ai.test.mjs
```

เทสต์ครอบ:

- profile selection / auto-fit
- model routing, alias, deep opt-in
- context trimming / cache key / cache eligibility
- queue concurrency, per-user fairness, queue full, timeout
- gateway กับ mock Ollama: model rewrite, cache hit, 429, streaming, auth
- `.cmd` เป็น ASCII + CRLF + `chcp 65001`
- ไม่มีไฟล์ runtime/model หลุดเข้า git

จากนั้นรัน quality gate ที่ root:

```powershell
npm run test:tools
npm run verify
```

---

## 11. ข้อจำกัดที่ต้องรู้

- **Ollama 0.40.6** เป็น release ที่ pin ไว้; `--version latest` อาจมี behavior เปลี่ยน
- โมเดล каждого tier ต้อง pull ก่อน; ถ้า pull ไม่ครบ gateway จะได้ 404 จาก Ollama
- `gemma3` มี license ของ Google; `qwen3` เป็น Apache-2.0; ตรวจ license ก่อน redistribute
- บน Windows + Radeon iGPU บางรุ่น Ollama อาจพยายามใช้ ROCm; profile นี้บังคับ CPU
  เพื่อความเสถียร ถ้ามี discrete GPU ให้ใช้ profile `gpu` และทดสอบอีกครั้ง
- gateway ยังไม่รองรับ multi-tenant auth เต็มรูปแบบ; token เดียวใช้ร่วมกัน
- ยังไม่มี UI ใน Sovereign OS สำหรับ edge AI; รอบนี้เป็น backend/installer pack
- การใช้ `x-sovereign-user` ต้องให้ core-api ส่ง header นี้ accordingly; ถ้าไม่ส่งจะจำกัดแค่ global

---

## 12. Roadmap

1. เพิ่มหน้า UI `Edge AI` ใน Sovereign OS (health, model pull, queue stats)
2. เพิ่ม compose sidecar สำหรับ core-api + gateway + Ollama ใน network เดียว
3. เพิ่ม semantic cache แบบ opt-in และวัดผลก่อนเปิด
4. เพิ่ม llama-swap profile สำหรับเครื่องที่มี RAM 32 GB+ และต้องการหลายโมเดล
5. เพิ่ม GPU profile ที่ตรวจ VRAM จริงและเลือก `--n-gpu-layers`
6. ย้าย policy/config จากไฟล์ JSON ไป DB หลังพ้น Cold Soak (ต้องมี migration)

---

## 13. ไฟล์ legacy

`app/rag.py`, `app/watchdog.py`, `scripts/oobm_alert.py` เป็น prototype เก่า
ที่ยังไม่ได้ใช้งานในชุดนี้ ไม่ถูกเรียกโดย installer/gateway
เก็บไว้เพื่ออ้างอิง ไม่ได้แปลว่ามี dependency Python ใน production
