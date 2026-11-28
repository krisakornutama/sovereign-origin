# awesome-selfhosted — ชุดส่งเอง (ยังไม่ยื่นในรอบนี้)

> ที่มา: `docs/LIVING-QUEUE.md` SEAL-015 · ตรวจกติกาจริงเมื่อ 2026-11-28
> สถานะ: **ยังไม่ยื่น** — ติด 2 ด่านที่ agent ทำแทนไม่ได้ (ดูหัวข้อ 1)

## 1. ผลตรวจคุณสมบัติ (ตาม `awesome-selfhosted-data/CONTRIBUTING.md` + PR template)

| เกณฑ์ | ผล | หมายเหตุ |
|---|---|---|
| Free/Open-source license | ผ่าน | Community Edition = AGPL-3.0 (`LICENSE`) |
| Self-hosted, ติดตั้งได้จริง | ผ่าน | `deploy/community/docker-compose.yml` + Quickstart ใน `README.en.md` |
| ไม่ใช่ desktop/CLI-only | ผ่าน | เป็นเว็บแอป + API ที่รันบนเครื่องผู้ใช้ |
| มี release แรกอายุ > 4 เดือน | **ยังไม่ผ่าน** | release แรก `v1.0` = 2026-09-17 ⇒ ครบเกณฑ์ราว **2027-01-18** |
| ผู้ส่งต้องเป็นมนุษย์ ไม่ใช่ LLM | **agent ทำไม่ได้** | template ระบุชัดว่า machine/LLM-generated จะถูกแบน ⇒ ต้องกดส่งด้วยมือเจ้าของบัญชี |

## 2. ไฟล์ที่ต้องส่ง (YAML — วางเป็น `software/sovereign-os.yml`)

```yaml
name: "Sovereign OS"
website_url: "https://sovereignoriginshop.dpdns.org/"
source_code_url: "https://github.com/krisakornutama/sovereign-origin"
description: "Operations suite for a small business: telemetry ingest, alerting, dashboards, encrypted backups and an offline license, all on one machine."
licenses:
  - AGPL-3.0
platforms:
  - Docker
  - Nodejs
tags:
  - Automation
  - Monitoring
```

> ตรวจชื่อ tag ให้ตรงกับโฟลเดอร์ `tags/` ของ repo นั้นก่อนส่ง (เช่น `Monitoring`, `Automation`) — ถ้าไม่มี ให้เลือกที่ใกล้ที่สุด ไม่ใส่ tag ที่ไม่มีอยู่

## 3. ข้อความ PR / issue

**หัวข้อ:** `Add Sovereign OS`

**เนื้อหา (คัดลอกได้):**

```
Adds Sovereign OS, a self-hosted operations suite for small businesses.

- Source: https://github.com/krisakornutama/sovereign-origin (AGPL-3.0)
- Install: Docker Compose quickstart in README.en.md (verified on Windows 11 + Docker Desktop; Linux should work, untested)
- Runs entirely on the operator's machine; the license is verified offline, no activation server
- First release: v1.0 on 2026-09-17; latest v1.3.10
- Site: https://sovereignoriginshop.dpdns.org/

The Community Edition in the repo is the whole free product; paid tiers are a separate closed add-on and are not required to run anything listed above.
```

## 4. ขั้นตอนของเจ้าของบัญชี (ทำหลัง 2027-01-18 หรือเมื่อ release แรกครบ 4 เดือน)

1. เปิด <https://github.com/awesome-selfhosted/awesome-selfhosted-data/issues/new?template=addition.md>
2. วาง YAML จากหัวข้อ 2 (แก้ `tags` ให้ตรงจริง)
3. ติ๊ก checkbox ทุกข้อ **ด้วยตัวเอง** — ข้อ "submission was done by a human, not a machine/LLM" เป็นเงื่อนไขที่ agent เซ็นแทนไม่ได้
4. ส่ง แล้วรอ reviewer (ปกติ ~1 สัปดาห์หลังอนุมัติ)

## 5. ทางเลือกที่ไม่ต้องรอ 4 เดือน

- `non-free.md` ของ repo เดียวกัน: สำหรับซอฟต์แวร์ที่ไม่ฟรี — แต่ผลิตภัณฑ์เรามี CE ฟรี จึงไม่ควรไปอยู่ที่นั่น (จะดูเหมือนหลบเกณฑ์)
- ลง `selfh.st/apps` (ฟอร์มเสนอ ไม่ใช่ PR) — ต้องกรอกด้วยมือเช่นกัน
- ช่องที่ได้ผลเร็วกว่าในระยะสั้น: outreach ตรง ตาม `marketing/outreach-20.md`
