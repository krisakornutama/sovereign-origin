# Local LLM Models — เป็นของโปรเจ็ก 100% (offline)

โมเดล GGUF เก็บที่นี่ — ไม่พึ่ง Ollama process แยกอีกต่อไป
- ปิดเป็น default — เปิดเมื่อกดสวิตช์ในแอป (`/system` → AI ในเครื่อง)
- `.gguf` ถูก ignore ใน `.gitignore` — ไม่เข้า git (หลาย GB)

## โมเดลที่แนะนำ

| โมเดล | ขนาด | ใช้ทำอะไร |
|---|---|---|
| `gemma3-4b-it-Q4_K_M.gguf` | ~3.3 GB | เร็ว แม่นพอสำหรับ chat/วิเคราะห์ |
| `qwen3-8b-Q4_K_M.gguf` | ~5 GB | แม่นกว่า ต้อง RAM ≥16GB |

## ดาวน์โหลด (ครั้งเดียว เก็บตลอดไป)

```powershell
# ใน sovereign-os/core-api/models/
.\download.ps1
# หรือเลือกตัวเดียว:
.\download.ps1 gemma3
```

## Ollama เดิม

โมเดล Ollama เดิมยังอยู่ที่ `E:\My work\Project Sovereign Origin\Ollama` (19 blobs, 4 โมเดล: gemma3:4b, qwen3:8b, qwen3-vl:8b, deepseek-r1:8b)
- ยังใช้งานได้คู่ขนานกับ GGUF ใหม่
- local-llm.service จะลอง GGUF ก่อน ไม่ได้ค่อย fallback ไป Ollama
