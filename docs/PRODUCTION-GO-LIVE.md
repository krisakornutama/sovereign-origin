# PRODUCTION GO-LIVE — ขายได้จริงแบบเจ้าของคนเดียว

> ปรับปรุง: 3 พ.ย. 2569 · เจ้าของ: Krisakorn · สถานะ: **Pre-commercial** (ใช้งานจริงได้ภายในองค์กรเดียว ยังไม่พร้อมขายเป็นผลิตภัณฑ์)
> เอกสารนี้เป็น "ด่านสุดท้ายก่อนรับเงิน" ไม่ใช่คู่มือฟีเจอร์ — ฟีเจอร์อยู่ที่ `docs/modules/`, ความพร้อมระดับองค์กรอยู่ที่ `docs/ENTERPRISE-READINESS.md`

---

## 1) หลักฐานที่ผ่านแล้ว (อย่าอ้างเกินกว่านี้)

| ด้าน | หลักฐาน |
|---|---|
| ชุดทดสอบ core-api | `npm test` (mock suite) เขียวบน CI ทั้ง ubuntu + windows · real-DB suite แยก job |
| ลงทะเบียนเครื่อง + สิทธิ์ | machine token ผูก hash, role เริ่มต้น USER, ผูกเจ้าของ+ยืนยันที่ /machine-console |
| อัปเดตระยะไกล | manifest เซ็น Ed25519 ตรวจสองชั้น (HUB + runner), asset ตรวจ sha256 |
| ชุดติดตั้งเครื่องใหม่ | **ต้องมีสิทธิ์ก่อนโหลด** (รหัสเชิญ `enr_…` / `MACHINE_ENROLL_CODE` / machine token) — ปิดช่องเดิม 3 พ.ย. 69 |
| งานค้างของเครื่องที่หาย | stale-job reaper (45 นาที + heartbeat ขาด 10 นาที) + แจ้ง Telegram |
| รับชุดใหม่เร็ว | `jobs/pull` แนบ `x-agent-update-version` → runner อัปเดตเมื่อว่างงาน |
| ฐานข้อมูล | migration + backup dump + restore drill (TimescaleDB) ทำซ้ำได้ |

## 2) ช่องที่ยังเปิดอยู่ — ห้ามขายจนกว่าจะปิด

**P0 (บล็อกการขาย)**
1. **PDPA / consent** — *ปิดแล้วบางส่วน*: มีหน้า `/consent` + นโยบาย `/privacy` + `PUT /api/consent` (event หลักฐาน) + `DELETE /api/consent/account` (anonymize + ลบข้อมูลสุขภาพ/ย้ายประวัติแชทเป็นชื่อนิรนัย) พร้อมเทสต์แล้ว ⇒ เหลือตรวจกับที่ปรึกษากฎหมายว่าถ้อยความยินยอมครอบคลุมวัตถุประสงค์ที่ขายจริง
2. **e-Tax** — `thai-tax.service` เป็นเครื่องคำนวณ ไม่มี CA/ลายเซ็นดิจิทัล ⇒ ห้ามโฆษณาว่า "ออกใบกำกับได้" (คิว G1/I5d) — คำเตือนอยู่ในหัวไฟล์ service และ `docs/TAX-DISCLAIMER.md` แล้ว
3. **Credential rotation** — bot token เก่า 2 ตัวยังไม่ revoke, `.env.bak` รุ่น 12/10 ยังอยู่บนเครื่องที่แจกไปแล้ว (คิว J4a/J3g)
4. **Backup อัตโนมัติก่อน deploy** — ปัจจุบันเป็นขั้นมือ ⇒ deploy ผิดจังหวะแล้วย้อนยาก

**P1 (ทำก่อนขายรายแรก)**
5. ไม่มี metrics/error-budget จริง (มีแต่ log + Telegram) — คิว A-obs7
6. ไม่มีหน้า onboarding สำหรับ "ลูกค้าซื้อแล้วติดตั้งเอง" (ตอนนี้ต้องมีคนช่วยติดตั้ง)
7. สัญญา/ใบเสนอราคา/ขอบเขต 지원 → ต้องมีเอกสารธุรกิจแยก (ไม่อยู่ในรีโป)

## 3) ขั้นตอน deploy ที่ปลอดภัย (ใช้ทุกครั้ง ห้ามข้าม)

```bash
# 1) สำรองก่อนแตะอะไรทั้งสิ้น
powershell -NoProfile -ExecutionPolicy Bypass -File tools\backup-db.ps1 -Keep 14

# 2) ตรวจว่าโค้ดผ่านด่าน
cd sovereign-os/core-api && npx tsc --noEmit && npm test

# 3) migrate + build + restart (ผ่าน wrapper — เขียน build-info ให้เองก่อน restart)
npx prisma migrate deploy && npm run build
cd "E:/My work/Project Sovereign Origin"
node tools/deploy-core-api.mjs        # = write-build-info.mjs → docker restart sovereign-core-api → รอ health

# 4) ยืนยันสุขภาพจริง (ไม่ใช่แค่ container ขึ้น)
curl -s http://localhost:3001/api/health      # ต้อง 200 + migrationHead ตรงรุ่นล่าสุด
#   + build.commit ต้องตรงกับ `git rev-parse --short=12 HEAD` และ build.builtAt เป็นเวลารอบนี้
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200

# 5) smoke เส้นสำคัญ: login → /machine-console → /ecosystem → งาน runner 1 งาน
```

กฎเหล็ก: **ไม่มี backup = ไม่ deploy** · **health ไม่ขึ้น = ย้อนรุ่นทันที ไม่ไล่แก้บน production**

### 3.1) ตราประทับ build — กัน "prod รัน build เก่าโดยไม่มีใครรู้"

คอนเทนเนอร์ `sovereign-core-api` เมานต์แค่ `core-api/src` + `core-api/data` (**ไม่มี `.git`**) ⇒ โปรเซสในคอนเทนเนอร์ตอบ commit เองไม่ได้ `/api/health` จึงอ่าน `core-api/data/build-info.json` (ไฟล์ generated, gitignore)

```bash
node tools/write-build-info.mjs --check   # exit 1 + บอกว่า stamp เก่ากว่า HEAD
node tools/deploy-core-api.mjs            # ทางที่ควรใช้: เขียน stamp → restart → รอ health ตรง HEAD
node tools/deploy-core-api.mjs --dry-run  # เขียน stamp + พิมพ์คำสั่ง แต่ไม่ restart
```

- `deploy-core-api.mjs` **ไม่ปล่อยให้ลืม** — เขียน stamp จาก `git rev-parse HEAD` ให้ทุกครั้งก่อน `docker restart` แล้ววนเช็ค `/api/health` (ค่าเริ่มต้น 180 วิ) จน `build.commit` ตรง HEAD; ไม่ตรง = **exit 1** พร้อมบอกค่าล่าสุดที่เห็น
- ถ้ารัน `docker restart` เองโดยไม่ผ่าน wrapper: health จะรายงาน commit เก่า (หรือ `null`) **โดยไม่มี error** — เช็คด้วย `node tools/write-build-info.mjs --check` และเทียบ `build.commit` กับ `git rev-parse --short=12 HEAD`
- `build.builtAt` = mtime ใหม่สุดของไฟล์ในโฟลเดอร์ที่โปรเซสโหลด (`dist`) ไม่ใช่ mtime ของ directory (tsc เขียนทับไฟล์เดิม ⇒ mtime โฟลเดอร์ไม่ขยับบน NTFS)
- **rollback**: `docker restart` กลับ build เดิมแล้วรัน `write-build-info.mjs` ซ้ำ (ให้ stamp ตรงกับรุ่นที่รันจริง) — อย่าปล่อย stamp ค้างที่รุ่นที่ถูกถอยออกไป

## 4) ความปลอดภัยขั้นต่ำก่อนเปิดให้คนนอก

- ทุกเส้นที่แจกไฟล์/ติดตั้ง/อัปเดตต้องมีสิทธิ์ (มาตรฐานเดียวกับ node-kits ที่ปิด 3 พ.ย.)
- machine token หมุนได้ และทุกการหมุนมี audit
- รหัสเชิญมีวันหมดอายุ + โควตา + เพิกถอนได้ (มีแล้วใน `fleet_enrollment_tokens`)
- ห้าม commit `.env*` ยกเว้น `*.example`; ชุดติดตั้งต้องสแกน secret ก่อน publish (มีใน `build-node-kit.mjs`)
- เปิด WAF allowlist ให้ครบทุกเส้นที่ผู้ใช้จริงใช้ (เคส `/mbti/compare*` ยังพังอยู่)

## 5) นิยาม "พร้อมขาย" (ใช้ตัดสิน ไม่ใช่ความรู้สึก)

ขายได้เมื่อ **ทั้ง 5 ข้อ** เป็นจริงพร้อมกัน:
1. P0 ทั้ง 4 ข้อปิดและมีหลักฐานในคิว
2. deploy ตาม §3 ผ่านโดยไม่มีขั้นมือ
3. มีลูกค้าทดลอง 1 รายใช้ครบวงจร 30 วันโดยไม่ต้องแก้โค้ดฉุกเฉิน
4. มี SLA เขียนไว้ (อ้าง `docs/SLO.md`) และตัววัดจริงรองรับ
5. เอกสารสัญญา/ขอบเขต/ราคา พร้อมลงนาม

ก่อนถึงข้อ 1–5: รับงานเป็น **"ติดตั้ง+ดูแลเฉพาะราย"** (service) ไม่ใช่ขายผลิตภัณฑ์ — ความเสี่ยงรับได้เพราะมีคนดูแลตลอด
