# คิวงาน (QUEUE)

เพิ่มงานด้านล่างได้โดยตรง (บรรทัดละ 1 งาน เริ่มด้วย `- [ ] `) หรือใช้คำสั่ง `/queue <งาน>`
เมื่องานเสร็จ agent จะเปลี่ยนเป็น `- [x]` พร้อมหมายเหตุผลลัพธ์

- [x] ปรับ frontend ให้สวยขึ้น (ผู้ใช้ขอ) — **เสร็จแล้ว 23/8/69** (`master d235a67`)
  - ทำแล้วทั้ง 4 ลำดับ: login redesign, dashboard command center, POS premium, สี/คอนทราสต์
  - ผ่าน `npm run verify` 4/4 + E2E 44/44
- [x] เพิ่ม E2E นำทางแบบ SPA — **เสร็จแล้ว 23/8/69** (`e2e/spa-nav.spec.ts` 7 tests)
- [x] แก้สิ่งค้างรอบ 25/8/69 — **เสร็จแล้ว 25/8/69** (`master aa8246f` + `ef50b64` + `b3569a0`)
  - Migration debt ปิดแล้ว (`20260825000000_add_restaurant_empire` — schema up to date)
  - Restaurant flow ครบ: สั่งวัตถุดิบ `/purchases` + ยกเลิกออเดอร์ + ใช้แต้ม 1=1฿ + สถานะครัว PREPARING/READY
  - KDS จอครัว `/restaurant/kds` (อัปเดตทุก 10 วิ)
  - helmet + CORS จำกัด origin (ผู้ใช้แก้ infra/.env เอง + recreate container แล้ว — ทดสอบ evil.com โดนบล็อก)
  - SPCX disabled (ticker ซ้ำไม่ใช่ SpaceX)
  - Portfolio Manager + WAN Monitor MR505 live ทดสอบผ่าน (ราคาจริง ASPI $3.89 อยู่โซนซื้อ)
- [x] Self-Reliance S1+S2 วันรอด + ทรัพยากรทุกศาสตร์ — **เสร็จแล้ว 25/8/69** (`master 8145555`)
  - `/selfreliance` Days of Autonomy: น้ำ/อาหาร/ไฟ/เงิน + จุดอ่อนบ้านอัตโนมัติ (ทดสอบจริง: อาหาร 1.2 วัน = จุดอ่อน)
  - Inventory เพิ่ม category: SEED/MEDICINE/TOOL — tests 7/7 ผ่าน
- [x] Router MR505 — ระบบเฝ้าดู + admin API ถอดรหัส — **เสร็จแล้ว 25/8/69** (`master b1417f1` + `efc67fb` + `0f11c7c`)
  - ทำงานอยู่: router up/down + latency + speedtest + LAN device scan + Telegram alerts (ทุก 60 วิ)
  - ถอด firmware architecture ครบ: 381 models, Data IDs, login flow, XOR+AES crypto (เอกสารใน `tplink-mr505.service.ts`)
  - ขาด: AES key exchange (RSA) — ข้อมูลซิม (สัญญาณ/data usage/SMS) เข้ารหัสอยู่ → **defer ไป Sprint ถัดไป**
- [ ] Router MR505 — AES crypto stack (RSA key exchange + AES-CBC decrypt) — **defer จาก 25/8/69**
  - โค้ด framework พร้อมใน `tplink-mr505.service.ts` — แค่เพิ่ม crypto + `syncEncryptor` step
  - ได้เมื่อเสร็จ: สัญญาณซิม RSRP/SINR · data usage · SMS · clients ทุกเครื่อง
- [x] Self-Reliance S3-S6 — สวนสมุนไพร+ยาต่อ HERB_DB · วงจรปิดขยะ→ปุ๋ย · Skills Matrix ต่อคน · Crisis Playbooks 1 ปุ่ม — **เสร็จแล้ว 29/8/69** (`create_missing.sql` + `schema.prisma` per-user health)
  - DB drift ปิดแล้ว: `health_readings/observations/flags/consents user_id` + `farm_plots category` + `herb_catalogs/dose_logs/herb_beds/skill_matrix/crisis_modes` สร้างแล้ว + seed 12 สมุนไพร/3 crisis modes — build 50 routes + full CRUD 38/38 ผ่าน
- [ ] ตั้ง Telegram token ใหม่ — **รอผู้ใช้** (token เดิมโดน Telegram revoke เพราะหลุดในข้อความ) → ไป @BotFather สร้างใหม่ + กด START ที่ bot 1 ครั้ง แล้วใส่ที่หน้า Settings (แล้ว agent ทดสอบส่งให้)
- [ ] ใบหน้า auto-recognize บน POS — **รอ Ollama เปิด** (โค้ด face-embed พร้อม แต่ Ollama offline)
- [ ] i18n หน้า restaurant + E2E หน้าใหม่ — priority ต่ำ (ใช้งานได้แล้ว แค่ไม่สลับภาษา/ไม่มี E2E)

หมายเหตุสถานะระบบ (29/8/69): backend tsc สะอาด + tests 16/16 + frontend 50 routes build ผ่าน + API 38/38 full CRUD ผ่าน + 43 หน้าเว็บ render ครบ — จ่ายร้านค้าครบวงจร (harvest→inventory→order→pay→report), health per-user, self-reliance Days-of-Autonomy พร้อม
หมายเหตุเทคนิค: container dev mount เฉพาะ `src/` — ถ้า recreate container ต้อง `docker exec sovereign-core-api npm install helmet` ใหม่ (node_modules ไม่ persist)
หมายเหตุ hydration: dashboard layout + history range แก้แล้ว (`05a2264` + `ffac9e2`) — ห้ามอ่าน localStorage/URL ตอน render แรก ให้ไปอ่านใน useEffect
