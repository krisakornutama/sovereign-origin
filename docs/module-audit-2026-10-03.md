# Audit ความลึกของโมดุล backend + coverage (3/10/69)

> วัดจากของจริงด้วย `npm run coverage:core` (c8 + ชุด mock) ไม่ใช่การนับด้วยสายตา
> เกณฑ์ floor: `tools/coverage-floor.json`

## สรุป

| ตัวเลข | ค่า |
|---|---|
| โมดุลใน `src/modules` | **64** |
| service ใน `src/services` | 124 |
| ไฟล์เทสต์ | 119 (เพิ่ม 4 ไฟล์รอบนี้) |
| coverage รวม (statements) | **68.34%** (30,120 / 44,070) · branches 74.77% · functions 84.15% |
| โมดุลที่ 0% | **33** |

## โครงสร้างที่เจอ (3 กลุ่ม)

**A · Production-ready** — `*.routes.ts` แยก concern แล้ว delegate เข้า `src/services/*`

`livestock` 92% · `health` 92% · `analytics` 92% · `govsim` 91% · `demo` 91% · `trace` 89% · `ota` 88% · `energy` 86% · `inventory` 86% · `software` 85% · `backup` 84% (ยกรอบนี้) · `sensors` 84% (ยกรอบนี้) · `predictive` 82% · `risk` 71% (ยกรอบนี้)

**B · Thin wrapper โดยเจตนา** — routes บาง 14–46 บรรทัดเพราะ logic อยู่ service หมด (เช่น `waste` 54 · `governor` 64 · `tts` 156)

**ไม่ใช่ปัญหา** เป็นแบบแผนเดียวกันทั้งระบบ แต่ coverage ของโมดุลจะต่ำเสมอถ้าเทสต์ไปที่ service แทน

**C · หลุมที่ต้องรู้**

| กลุ่ม | รายละเอียด |
|---|---|
| ขนาดใหญ่ 0% | `coding` 202 · `system` 220 · `relay` 198 · `compost` 168 · `skillmatrix` 152 · `healing` 149 · `devices` 140 |
| หลุมใหญ่สุด | `knowledge` 1,083 บรรทัด (เคย 13% → ยกเป็น 33% รอบนี้) · `ai` 740 บรรทัด ครอบ 26% |
| ต่ำมาก | `tts` 33% · `infrastructure` 34% · `vision` 34% · `portfolio` 45% |
| โครงสร้าง | `workers/` 0/849 · `scripts/` 0/212 · `src/routes.ts` 0/283 · `src/server.ts` 0/102 — จุดเข้า HTTP ทั้งหมดไม่มีเทสต์ชั้นเดียว |

## บั๊กที่เจอระหว่างเขียนเทสต์ (ยังไม่แก้ — รอเจ้าของอนุมัติ)

| # | ที่ | อาการ | ผลกระทบ |
|---|---|---|---|
| 1 | `POST /api/sensors/data` | `Number(null)` = 0 ผ่าน `isFinite` → ค่าที่ไม่ได้ส่งมาถูกเขียนลง TimescaleDB เป็น **0** (เหมือนกันที่ string ว่าง, false, array ว่าง) | ค่าเซนเซอร์ปลอม (เช่น 0°C) เข้า time-series จริง |
| 2 | `POST /api/backup/schedule` | regex ตรวจแค่รูป `HH:mm` ไม่ตรวจช่วงค่า → `25:00` ผ่าน · `toMin("25:00") = 1500` เกินเวลาที่เป็นไปได้ของวัน | **catch-up window ไม่มีวันเข้า = backup ไม่เคยรันอีก** โดยไม่มีอะไรฟ้อง (รอ machine-health เตือนที่ 26 ชม.) |
| 3 | `POST /api/risk-monitor/defcon/drill` | `index: null` → 0 → รัน drill ระดับ 0 เงียบ ๆ (ส่ง body ว่างถูกต้องแล้ว = 400) | เบา — ลืมส่งค่า กลายเป็นสั่งลดระดับ |
| 4 | `GET /api/knowledge/uploads/:file` | path traversal กันไว้แล้ว แต่ตอบ **500** ไม่ใช่ 400 | ไม่ leak ไฟล์ แต่ log รบกวนเวลามีคนสแกน |

เทสต์ที่เกี่ยวกับบั๊ก 1–3 เขียนเป็น `ข้อบกพร่อง` ไว้ในชุด — ล็อกพฤติกรรมปัจจุบันไว้
ถ้าวันหนึ่งแก้แล้วเทสต์จะแดง = สัญญาณว่าเปลี่ยนจริง (อย่าลบทิ้งเงียบ ๆ)

## แก้อะไรไปรอบนี้

- **เพิ่มเทสต์ 94 เคส** 4 ไฟล์: `sensors` (28) · `riskRoutes` (21) · `backupRoutes` (17) · `knowledgeRoutes` (28)
- coverage รวม **66.86% → 68.34%** (+1.48 จุด · +659 บรรทัดที่ถูกครอบ)
- ยก `backup` 0%→84% · `sensors` 0%→84% · `risk` 0%→71% · `knowledge` 13%→33%
- **เพิ่ม `tools/coverage-floor.mjs` + `tools/coverage-floor.json`** — แก้รหนี coverage (เดิมเป็นกระจกส่อง no threshold)
  · รวมต้องไม่ต่ำกว่า floor · โมดุลที่มีอยู่ห้ามถอยทีละตัว · **โมดุลใหม่ต้อง ≥ 40%** → ไม่มีโมดุลใหม่ที่ลงมา 0% ได้อีก
  · ผูกเข้า `npm run coverage:core` (อยู่ใน `npm run verify -- --db`) → commit ที่ทำให้ถอยหลัง = gate แดง
  · ยก baseline: `node tools/coverage-floor.mjs --update` (ยกเฉพาะขึ้น — ค่าที่ลดจะไม่ถูกยก) · ปิดชั่วคราว: `--no-floor`
- **เพิ่ม `KNOWLEDGE_DIR` env override** ใน `knowledge-dir.service.ts` — เดิมโมดุลนี้ผูกกับพาธในเครื่องอย่างเดียว
  ทำให้เขียนเทสต์แล้วเสี่ยงแตะไฟล์ความรู้จริง (11 ไฟล์) · ไม่ตั้งใน production = พฤติกรรมเดิมทุกประการ

## ตารางเต็มทุกกลุ่ม (เรียงจากต่ำสุด)

| กลุ่ม | ครอบ | ทั้งหมด | % |
|---|---|---|---|| `actuation` | 0 | 61 | 0% |
| `agent` | 0 | 121 | 0% |
| `audit` | 0 | 39 | 0% |
| `clone` | 0 | 45 | 0% |
| `coding` | 0 | 202 | 0% |
| `compost` | 0 | 168 | 0% |
| `crisis` | 0 | 102 | 0% |
| `dashboard` | 0 | 45 | 0% |
| `devices` | 0 | 140 | 0% |
| `dime` | 0 | 119 | 0% |
| `healing` | 0 | 149 | 0% |
| `learning` | 0 | 89 | 0% |
| `lifestyle` | 0 | 55 | 0% |
| `mesh` | 0 | 35 | 0% |
| `nodes` | 0 | 73 | 0% |
| `notes` | 0 | 38 | 0% |
| `property` | 0 | 269 | 0% |
| `relay` | 0 | 198 | 0% |
| `reports` | 0 | 31 | 0% |
| `routes` | 0 | 283 | 0% |
| `scripts` | 0 | 212 | 0% |
| `search` | 0 | 41 | 0% |
| `selfreliance` | 0 | 45 | 0% |
| `server` | 0 | 102 | 0% |
| `skillmatrix` | 0 | 152 | 0% |
| `system` | 0 | 220 | 0% |
| `telemetry` | 0 | 52 | 0% |
| `timescale` | 0 | 79 | 0% |
| `users` | 0 | 88 | 0% |
| `war-room` | 0 | 13 | 0% |
| `waste` | 0 | 53 | 0% |
| `whisper` | 0 | 101 | 0% |
| `workers` | 0 | 849 | 0% |
| `ai` | 196 | 740 | 26% |
| `knowledge` | 346 | 1083 | 32% |
| `tts` | 51 | 155 | 33% |
| `infrastructure` | 120 | 350 | 34% |
| `vision` | 70 | 203 | 34% |
| `portfolio` | 165 | 367 | 45% |
| `farm` | 277 | 509 | 54% |
| `security` | 412 | 680 | 61% |
| `telegram` | 174 | 280 | 62% |
| `ai-models` | 115 | 180 | 64% |
| `partners` | 126 | 192 | 66% |
| `auth` | 151 | 228 | 66% |
| `business` | 390 | 574 | 68% |
| `automation` | 113 | 161 | 70% |
| `lib` | 233 | 324 | 72% |
| `feedback` | 69 | 94 | 73% |
| `(middleware)` | 256 | 335 | 76% |
| `treasury` | 550 | 714 | 77% |
| `risk` | 163 | 211 | 77% |
| `(services)` | 22300 | 28214 | 79% |
| `features` | 74 | 92 | 80% |
| `predictive` | 104 | 127 | 82% |
| `backup` | 48 | 57 | 84% |
| `software` | 58 | 68 | 85% |
| `inventory` | 220 | 256 | 86% |
| `energy` | 145 | 168 | 86% |
| `ota` | 133 | 151 | 88% |
| `trace` | 104 | 117 | 89% |
| `demo` | 58 | 64 | 91% |
| `governor` | 58 | 64 | 91% |
| `govsim` | 72 | 79 | 91% |
| `livestock` | 1085 | 1181 | 92% |
| `health` | 554 | 603 | 92% |
| `analytics` | 47 | 51 | 92% |
| `config` | 268 | 290 | 92% |
| `documents` | 99 | 107 | 93% |
| `sensors` | 220 | 228 | 96% |
| `dms` | 44 | 45 | 98% |
| `restaurant` | 381 | 388 | 98% |
| `realtime` | 71 | 71 | 100% |

## ข้อสังเกตอื่นที่เจอระหว่างทาง

- **20 จาก 115 ไฟล์เทสต์เดิมไม่ import service เลย** — ทดสอบแค่ route/HTTP layer → ผ่านง่าย แต่ไม่ได้พิสูจน์ logic
  (ชุดใหม่ 4 ไฟล์ของรอบนี้ mock ทั้ง prisma delegate และ `app.locals` ที่ route อ่านจริง)
- **coverage ไม่บังคับ threshold มาตลอด** คือที่มาของ `tools/coverage-floor.mjs` — ไม่งั้นตัวเลขนี้จะลดลงเงียบ ๆ ไปเรื่อย ๆ
