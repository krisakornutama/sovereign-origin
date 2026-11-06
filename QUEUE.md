# QUEUE — คิวงาน Launch Reddit (Sovereign OS CE)

ส่งต่อให้ agent ตัวถัดไป อ่านจบแล้วทำตามลำดับ ข้อใดทำบนเว็บ GitHub ไม่ได้ผ่าน `gh` (token หมดอายุ) ให้แจ้งผู้ใช้ให้ทำแทน

---

## สถานะภาพรวม (ยืนยันจาก GitHub API แล้ว)

| รายการ | สถานะ |
|---|---|
| About description | เสร็จแล้ว — "Sovereign Origin — self-sovereign home OS" |
| Release `v1.2.0` | เสร็จแล้ว — published ไม่ใช่ draft |
| Telegram token | ใช้งานจริงได้ — sendMessage → 200, message_id=11 |
| README.en.md + workflow + FAQ | เสร็จแล้ว — commit `c000361` push ขึ้น main แล้ว |
| `npm run verify` | ผ่าน 6/6 (2.6 นาที) |
| Workflow "Publish images (GHCR)" | **กำลังรันอยู่** — in_progress, trigger จาก tag v1.2.0 |

---

## งานค้าง (เรียงตามลำดับ)

### 1. รอ workflow images เสร็จ → ตรวจสอบผล
สั่งดูสถานะจาก GitHub API:

```bash
curl -s -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/krisakornutama/sovereign-origin/actions/runs?per_page=5
```

หา workflow ชื่อ **Publish images (GHCR)** event `push` head `v1.2.0`
- ถ้า `conclusion` = `success` → ไปข้อ 2
- ถ้า `conclusion` = `failure` → ดู log แล้วแจ้งผู้ใช้ (อาจต้องแก้ workflow แล้ว push tag ใหม่)
- ถ้ายัง `in_progress` → รอแล้วเช็คใหม่

### 2. แจ้งผู้ใช้ตั้ง package เป็น Public (ทำบนเว็บ GitHub)
หลัง images publish เสร็จแล้ว package `api` และ `web` จะเป็น **private** ตามค่าเริ่มต้นของ GHCR แม้ repo จะ public

บอกผู้ใช้: เข้า GitHub → Packages → เลือก `sovereign-origin/api` และ `sovereign-origin/web` → Package settings → Change visibility → **Public** (ทำครั้งเดียวต่อ package)

### 3. เพิ่ม topic "agpl" (ทำบนเว็บ GitHub)
ปัจจุบันมี topics: self-hosted, iot, mqtt, docker-compose, homelab, typescript, nextjs, postgresql
ให้เพิ่ม `agpl` ให้ครบ ตั้งที่หน้า repository settings บนเว็บ

### 4. เปิด Branch protection rule บน main (ทำบนเว็บ GitHub)
Settings → Branches → Add branch protection rule สำหรับ `main` (กัน force-push / ลบ branch)

### 5. ยืนยันโพสต์ Reddit ใช้ฉบับสั้น
ถ้าผู้ใช้ยังไม่ได้โพสต์ หรือยังใช้ข้อความยาวอยู่ → ให้ส่งข้อความฉบับสั้น (5 ช่อง: Project name / Repo / Description / Deployment / AI involvement) ภาษาอังกฤษ ภาษาคน ให้ผู้ใช้ก๊อปวาง

### 6. แนะนำ rotate Telegram token (ถ้าเคยพิมพ์หลุดใน log)
บอกผู้ใช้: token Telegram ที่พิมพ์ไว้ใน log ตอนตรวจระบบ อาจหลุดออกนอกเครื่อง → rotate ผ่าน @BotFather แล้วแก้ `TELEGRAM_BOT_TOKEN` ใน `sovereign-os/infra/.env` จากนั้นรัน `docker compose -f sovereign-os/infra/docker-compose.yml up -d core-api`

---

## หมายเหตุสำคัญ

- `gh` CLI **token หมดอายุ** (401 Bad credentials) → agent ทำงานฝั่ง GitHub UI แทนไม่ได้ ข้อ 2–4 ต้องให้ผู้ใช้ทำบนเว็บ
- workflow images ใช้เวลา ~15–20 นาที (build `linux/amd64` + `linux/arm64` ผ่าน QEMU) อย่าข้ามไปข้อ 2 ก่อนเช็ค conclusion
- ไฟล์ที่เกี่ยวข้องทั้งหมดอยู่ใน commit `c000361` บน branch `main` แล้ว
