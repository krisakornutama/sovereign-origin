# Token Rotation — PAGES_TOKEN (90 วัน)

> PAGES_TOKEN = fine-grained PAT ที่ workflow **Deploy portfolio** ใช้ push portfolio/ ขึ้น publish repo (`project-sovereign` = GitHub Pages production)
> หลักการ: สิทธิ์น้อยที่สุด + อายุสั้น + มีวันจดไว้เสมอ

## ๑. สเปกของ token

| หัวข้อ | ค่าที่กำหนด |
|---|---|
| ชนิด | Fine-grained personal access token (ไม่ใช้ classic `repo` ที่คลุมทุก repo) |
| Repository access | Only select repositories → `krisakornutama/project-sovereign` |
| Permissions | **Contents: Read and write** (เท่านี้ — ไม่ต้องมี workflow, metadata อื่น ๆ) |
| Expiration | **90 days** |
| อยู่ที่ไหน | Secret `PAGES_TOKEN` ของ repo `sovereign-origin` (Settings → Secrets and variables → Actions) |
| การเดินทาง | ผ่าน env เท่านั้น → script ใช้ `http.extraheader` (Basic auth) — **ไม่ฝังใน URL** จึงไม่มีทางโผล่ใน log/error ของ git หรือ `remote.origin.url` (ตั้งแต่ 2026-09-17) |

## ๒. ขั้นตอนหมุนเวียน (ทำทุก 90 วัน หรือเมื่อ workflow เตือน)

1. **สร้าง token ใหม่** — GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate new token ตามสเปกใน §๑ แล้วจดวันหมดอายุ (ตัวอย่าง: สร้าง 17 ก.ย. 2026 → หมดอายุ 16 ธ.ค. 2026)
2. **อัปเดต secret** — repo `sovereign-origin` → Settings → Secrets and variables → Actions → `PAGES_TOKEN` → Update (แทนค่าเดิม ชื่อเดิม ไม่ต้องแก้ workflow)
3. **อัปเดตตัวแปรวันหมดอายุ** — หน้าเดียวกัน แท็บ **Variables** → `PAGES_TOKEN_EXPIRES` = `YYYY-MM-DD` (วันหมดอายุของ token ใหม่) — ตัว workflow อ่านตัวนี้ไปเตือน ไม่ใช่ secret
4. **ทดสอบทันที** — Actions → Deploy portfolio → Run workflow (workflow_dispatch) แล้วดู step Preflight ต้องขึ้น `token: หมดอายุอีก ~90 วัน` และ publish สำเร็จ
5. **เก็บกวาดหลังผ่านจริง ~1 สัปดาห์** — revoke token ตัวเก่าที่หน้า Developer settings (ถ้าลืม ตัวเก่าก็ตายเองตามวันหมดอายุ แต่ revoke ก่อนดีกว่า)
6. **กรอกตารางประวัติ** ใน §๔

## ๓. ระบบเตือนในตัว (ทำไว้แล้ว)

- **ทุกรอบ deploy** (deploy-portfolio.yml → Preflight): ตัวแปร `PAGES_TOKEN_EXPIRES` ถูกตั้ง → คำนวณวันคงเหลือ:
  - เหลือ **≤ 14 วัน** → `::warning::` จะหมดอายุ พร้อมชี้มาที่เอกสารนี้
  - **หมดอายุแล้ว** (วันคงเหลือติดลบ) → `::warning::` หมดอายุ — รอบนั้นยัง publish ได้ถ้า GitHub ยังตอบรับ token แต่ต้องหมุนทันที
- **รายสัปดาห์** (token-expiry-watch.yml — วันจันทร์): เหลือ ≤14 วัน → เปิด issue "PAGES_TOKEN rotation due" (มีอยู่แล้ว = คอมเมนต์อัปเดต) · หมุนเสร็จ (เหลือ >14 วัน) → ปิด issue เอง — ครอบเคส "ไม่มี push เกิดขึ้นเลยช่วงใกล้หมดอายุ"
- **ไม่ได้ตั้งตัวแปร = ไม่มีการเตือนเลย** — เลยถือเป็นกติกา: ตอนสร้าง token ต้องตั้ง `PAGES_TOKEN_EXPIRES` เป็นขั้นตอนบังคับของ §๒ (watcher จะ warning ทุกสัปดาห์ถ้าตัวแปรหาย)
- ถ้า token ตายจริงโดยไม่ทันเตือน: Preflight เดิมจะข้าม publish พร้อม warning ใน run (เว็บยังใช้ได้จาก deploy รอบก่อน แค่ไม่อัปเดต)

## ๔. ประวัติการหมุนเวียน

| สร้าง | หมดอายุ | หมุนโดย | หมายเหตุ |
|---|---|---|---|
| 2026-09-17 (โดยประมาณ) | — | krisakornutama | รอบแรกหลังเปิดใช้ auto-deploy · ควรตั้ง `PAGES_TOKEN_EXPIRES` ให้ตรงจริงแล้วเริ่มนับ 90 วันจากวันตั้ง |

## ๕. ทางเลือกที่ยังไม่ทำ (จดไว้)

- **GitHub App** (ไฟล์ PEM + app id แทน PAT): ไม่มีวันหมดอายุให้ลืม สิทธิ์จำกัดต่อ repo ได้เช่นกัน — แลกมาด้วยการดูแล private key เอง + โค้ด mint installation token ใน workflow เหมาะตอนทีมใหญ่ขึ้น ตอนนี้ PAT 90 วัน + ตัวเตือนใน workflow พอดีกับขนาดงาน
