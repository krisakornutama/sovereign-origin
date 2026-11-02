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
1. **PDPA / consent** — ยังไม่มีหน้าขอความยินยอม + นโยบายลบข้อมูลครบวงจร (คิว I4c/F2) ⇒ ผิดกฎหมายถ้าเก็บข้อมูลลูกค้าจริง
2. **e-Tax** — `thai-tax.service` เป็นเครื่องคำนวณ ไม่มี CA/ลายเซ็นดิจิทัล ⇒ ห้ามโฆษณาว่า "ออกใบกำกับได้" (คิว G1/I5d)
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

# 3) migrate + build + restart
npx prisma migrate deploy && npm run build
docker restart sovereign-core-api

# 4) ยืนยันสุขภาพจริง (ไม่ใช่แค่ container ขึ้น)
curl -s http://localhost:3001/api/health      # ต้อง 200 + migrationHead ตรงรุ่นล่าสุด
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200

# 5) smoke เส้นสำคัญ: login → /machine-console → /ecosystem → งาน runner 1 งาน
```

กฎเหล็ก: **ไม่มี backup = ไม่ deploy** · **health ไม่ขึ้น = ย้อนรุ่นทันที ไม่ไล่แก้บน production**

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
