# B2B / SaaS Readiness — ตรวจข้อกล่าวอ้างกับของจริงในโค้ด

> วันที่: 21/10/69 · ช่วง Cold Soak (ห้าม restart / migrate / deploy)
> ที่มา: เอกสารข้อเสนอช่องว่างธุรกิจ B2B/SaaS ที่เจ้าของส่งมา — บางข้อล้าสมัยแล้ว
> เอกสารนี้ตอบทีละข้อว่า **ของจริงคืออะไร** (มีหลักฐาน file:line) และ **อะไรยังขาดจริง**
> ใช้คู่กับ `docs/ENTERPRISE-READINESS.md` (แผนฝูงเครื่อง/หลายสาขา) — ไม่ทับกัน

---

## 1. สรุปผู้บริหาร

| # | ข้อกล่าวอ้างในเอกสาร | ผลตรวจ | หลักฐาน |
|---|---|---|---|
| 1 | ฐานข้อมูลเป็น SQLite | **ไม่จริง** | `prisma/schema.prisma:6` = `postgresql` · `prisma/migrations/migration_lock.toml:3` = `postgresql` |
| 2 | ไม่มี off-site backup ที่เข้ารหัส | **ไม่จริง — มี 2 ช่องทาง** | `tools/verify/offsite-push.mjs` เข้ารหัสด้วย age (X25519) + ส่ง Telegram `sendDocument` + mirror นอก repo · งานตั้งเวลา `tools/hidden-tasks/sovereign-offsite-backup.cmd` |
| 3 | ไม่มี rate limit / WAF | **ไม่จริง** | `middleware/rateLimit.middleware.ts:58` (backoff + cap) ใช้ที่ `auth.routes.ts:10,18,41,61,70,77`, `trace.routes.ts:12-13` · WAF default-deny ใช้งานจริงตาม `docs/ops-runbook.md:330-332,346` |
| 4 | ไม่มีตัวติดตั้งแบบคลิกเดียว | **ไม่จริง** | `tools/install/install.cmd` (ดับเบิลคลิก) → `install.mjs` 34 KB + `install.ps1` + `install.sh` + `lib.mjs` + `sovereign.env.template` · มีเทสต์ `tools/test/install-one-shot.test.mjs`, `installer-cmd.test.mjs` |
| 5 | ไม่มีระบบตรวจสลิปโอนเงิน | **จริงบางส่วน** | ไม่มีตัวตรวจ/อ่านสลิปเลย · มีแค่ "อัปโหลดหลักฐานโอน" ฝั่ง Treasury (`treasury.routes.ts:37,533`) และร้านให้ลูกค้า **แจ้งยอดเอง** (`business-shop.service.ts:172-222`) เจ้าของกดยืนยันมือ (`:230-275`) |
| 6 | ไม่มี e-Tax Invoice XML + ลายเซ็นดิจิทัล | **จริง — และห้ามทำครึ่ง ๆ** | ไม่มีโมเดลใบกำกับภาษี (มีแค่ `BusinessOrder:2133`, `BusinessOrderLine:2167`, `BusinessPayment`) · ไม่มี XML builder/signature · `xml` ที่ grep เจอเป็นเรื่องแผนที่/ฟาร์ม ไม่เกี่ยวกับภาษี |
| 7 | ภาษี hardcode 7% ทุกที่ | **ไม่จริง** | VAT ต่อธุรกิจ `Business.vatRate` (`schema.prisma:2040`) · อัตรากลาง `thai-tax.service.ts:16` (`RATES`) · `computeVatMonthly` ใช้ `input.vatRate` |
| 8 | health check 30 วิ / self-heal 60 วิ | **ไม่จริง — ช้ากว่า** | Task `Sovereign Docker Watch` ทำงาน **ทุก 1 นาที** (ยืนยันจาก Task Scheduler 21/10/69 · สคริปต์ legacy เขียน 10 นาที — แก้ให้ตรงแล้ว); หลังปลุก Docker รอ backend ได้ถึง 180 วิ (`docker-watchdog.mjs:189`) ⇒ ฟื้นจริง ~1–4 นาที |
| 9 | ไม่มีระบบสิทธิ์/แพ็กเกจให้ต่อยอด SaaS | **มี entitlements แล้ว** | `GET /api/features/me` (`modules/features/feature.routes.ts:5,22`) + `useFeatureStore` ฝั่งหน้าเว็บ |

**ข้อสรุป:** เอกสารต้นทางประเมินต่ำเกินจริงในเรื่องพื้นฐาน (DB/backup/WAF/installer) — เสี่ยงตัดสินใจลงทุนซ้ำในของที่ทำแล้ว
ช่องว่างจริงมี 3 เรื่อง: **ตรวจสลิปอัตโนมัติ**, **e-Tax ที่ถูกกฎหมาย**, **cloud object storage สำหรับ backup**
(บวกเรื่องธุรกิจ SaaS: metering/tenant isolation ซึ่งเป็นงานออกแบบ ไม่ใช่บั๊ก)

---

## 2. รายละเอียดช่องว่างจริง

### 2.1 ตรวจสลิปโอนเงิน (P0)

ของจริงวันนี้:

- ลูกค้าเปิดลิงก์ลับ → กด "แจ้งชำระ" → ระบบบันทึก `BusinessPayment` ตาม **ยอดที่ลูกค้าพิมพ์เอง** (`business-shop.service.ts:172-222`)
- Telegram แจ้งเจ้าของพร้อมปุ่มยืนยัน/ปฏิเสธ (`:196-219`) → เจ้าของต้องเปิดแอปธนาคารเทียบเองทุกครั้ง (`:230-275`)
- อัปโหลดรูปที่มีอยู่เป็น "หลักฐานการโอน" ของ `TransferOrder` (Treasury) ไม่ผูกกับออเดอร์ร้าน (`treasury.routes.ts:37,533`)

ความเสี่ยง: สลิปปลอม/สลิปซ้ำ/ยอดไม่ครบ/โอนเข้าบัญชีอื่น — ตรวจด้วยคนทุกออเดอร์และตรวจไม่ได้จริงถ้าลูกค้าส่งรูปตัดต่อ

**ที่ทำแล้วรอบนี้ (ปลอดภัยระหว่าง Cold Soak):** แกนตัดสินแบบบริสุทธิ์
`sovereign-os/core-api/src/services/slip-verify.service.ts`

- `evaluateSlip(facts, expectation)` → `ACCEPTED | AMOUNT_MISMATCH | PAYEE_MISMATCH | PAYEE_UNVERIFIED | DUPLICATE | STALE | INVALID`
- เทียบเงินเป็น **สตางค์ (จำนวนเต็ม)** กันเศษลอย · เผื่อปัดเศษ 1 สตางค์
- เทียบชื่อผู้รับแบบไทย (ตัด นาย/นาง/นางสาว/บริษัท/จำกัด/ช่องว่าง/จุด) + 4 หลักท้ายบัญชี
- กันสลิปซ้ำด้วย `slipKey(provider, transRef)` · กันสลิปเก่า/สลิปอนาคต (clock skew 5 นาที)
- **ไม่เรียกเครือข่าย ไม่แตะ DB ไม่แตะ env** — เทสต์ได้ด้วยข้อมูลล้วน
- เทสต์: `sovereign-os/core-api/tests/slipVerify.test.ts` 22 เคส + `tools/test/slip-verify-boundary.test.mjs` 3 เคส
- พิสูจน์ red-first แล้ว: ปิดกฎ UNDERPAID ชั่วคราว → เทสต์แดง 2 ตัว (exit 1) → คืนกฎ → เขียว 22/22

**ที่ยังขาด (ต้อง migrate + restart):**

1. ตารางเก็บสลิป: `payment_slips(id, paymentId, provider, trans_ref, amount_satang, trans_at, receiver_name, receiver_tail, raw_hash, decision, reasons[], created_at)` + `UNIQUE(provider, trans_ref)`
2. Endpoint อัปโหลด/ตรวจ: `POST /api/shop/orders/:token/slip` (multipart ≤ 2 MB ผ่าน `hardenUpload`, rate limit 10/นาที/IP)
3. Adapter ผู้ให้บริการ (SlipOK / EasySlip / อื่น) — เจ้าของเลือกเจ้าที่มีสัญญา/ราคาชัด; adapter ทำหน้าที่แค่ "อ่านสลิป → SlipFacts"
4. UI: หลักฐานสลิป + เหตุผลที่ระบบตัดสิน + ปุ่ม "ยืนยันทั้งที่ระบบเตือน" (ต้องมีเหตุผล + audit)
5. กติกาเหล็ก: **ห้าม auto-ปิดยอด** ถ้า `PAYEE_UNVERIFIED` หรือ `AMOUNT_MISMATCH` — ต้องมีคนตัดสิน

**Acceptance:** สลิปซ้ำถูกปฏิเสธที่ DB (409) · ยอดขาด/เกินไม่ถูกบันทึกเป็นรับเงิน · override ทุกครั้งมี audit + เหตุผล · ทดสอบกับ sandbox ของผู้ให้บริการจริง 1 ราย

### 2.2 e-Tax Invoice XML + ลายเซ็นดิจิทัล (P1 — ต้องมีพันธมิตร)

สิ่งที่ "ถูกกฎหมาย" ต้องมีครบ (ขาดข้อใดข้อหนึ่ง = ใช้ยื่นไม่ได้):

1. **เอกสาร**: ใบกำกับภาษี/ใบลดหนี้ + **เลขรันต่อเนื่อง** ที่ไม่ซ้ำและยกเลิกแล้วต้องมีใบแทน → ต้องมีตาราง `invoices` + running number (migration)
2. **รูปแบบ**: XML ตาม schema ของ ETDA/สรรพากร (เวอร์ชันระบุปี) — รวมถึง mandatory fields ที่ระบบร้านยังไม่มี (เลขผู้เสียภาษีผู้ซื้อ, สถานประกอบการ, สาขา)
3. **ลายเซ็น**: XMLDSig enveloped + canonicalization (C14N) + certificate จาก CA ที่ได้รับการยอมรับ — Node ไม่มี C14N ในตัว ต้องใช้ไลบรารีที่ผ่านการตรวจ หรือให้ผู้ให้บริการเซ็น
4. **ช่องทาง**: ส่งผ่านผู้ให้บริการ/ระบบที่ ETDA รับรอง + เก็บหลักฐานการส่ง/ตอบรับ

**คำแนะนำ:** อย่าเขียน XMLDSig เองแบบเดา (เสี่ยง "ดูเหมือนผ่าน" แต่ใช้ยื่นไม่ได้) — เลือกผู้ให้บริการ e-Tax ที่มี API + certificate แล้วทำ adapter คล้าย slip
ระหว่างรอ: ออก **ใบเสร็จ/ใบกำกับภาษีแบบ PDF** ที่มีฟิลด์ครบ + รายงานภาษีซื้อ/ขายจาก `thai-tax.service.ts` (ทำได้โดยไม่ต้อง migrate ถ้าใช้ข้อมูลออเดอร์เดิม)

### 2.3 Cloud object storage สำหรับ backup (P1)

ของจริง: age-encrypted dump → Telegram + mirror นอก repo (2 failure domains แล้ว)
ที่ขาด: **object storage ที่มี lifecycle/immutability** (S3/R2/B2) เหมาะกับ retention 1 ปี + object lock
งานที่ต้องทำหลัง Cold Soak: uploader ที่เซ็น SigV4 เอง (ไม่เพิ่ม dependency) + ตั้ง creds ใน `.env` (เจ้าของเท่านั้น) + ทดสอบ restore จาก cloud จริง 1 ครั้ง/ไตรมาส
**ห้าม** ถอด Telegram/mirror ออก — cloud คือช่องทางที่ 3 ไม่ใช่ตัวแทน

### 2.4 SaaS: usage metering + tenant isolation (P2)

- Entitlements มีแล้ว (`/api/features/me`) แต่ยังไม่มี **metering** (จำนวนเครื่อง/คำขอ/พื้นที่ backup ต่อรอบบิล)
- Multi-tenant ยังไม่เริ่ม — `docs/ENTERPRISE-READINESS.md` Phase 5 ระบุว่าเป็นงานออกแบบ data model รอบใหญ่ (tenant_id ทุกตาราง + บทบาท SITE_*)
- Risk/strategy ที่เอกสารพูดถึงเป็นเรื่อง **ธุรกิจ** ไม่ใช่โค้ด; โมดูล `/risk-monitor` ในระบบเป็นความเสี่ยงส่วนบุคคล/ทรัพย์สิน ไม่ใช่ risk register ของบริษัท

---

## 3. สิ่งที่ทำรอบนี้ (และไม่ทำ)

### ทำแล้ว

- **ไม่เพิ่มทางเข้าเมนูให้ `/hover-cards`** — ด่าน `desktop-only` ของโปรเจกต์ห้ามลิงก์หน้านี้ในเมนู/⌘K โดยตรง
  (`tools/test/desktop-only.test.mjs:83`) จึงเลือกทางที่ปลอดภัย: คงหน้าไว้ที่ URL ตรงและคืน `navigation.ts`
  ไม่แตะนโยบายเดิม — ถ้าเจ้าของต้องการให้เข้าจาก ⌘K ต้องแก้ policy พร้อมเหตุผลก่อน

| งาน | หลักฐาน |
|---|---|
| ปิดช่องโหว่ dependency ฝั่ง backend (patch) | `follow-redirects 1.16.0 → 1.16.1` ใน `sovereign-os/core-api/package-lock.json`; `npm audit` = **0** |
| ตรวจ dependency ฝั่ง frontend | prod deps = **0 ช่องโหว่**; 15 รายการเป็น devDependency ล้วน (tailwind 4 / electron-builder major) → **เลื่อนไปหลัง Cold Soak** |
| แกนตัดสินสลิป + เทสต์ 25 เคส | `src/services/slip-verify.service.ts`, `tests/slipVerify.test.ts`, `tools/test/slip-verify-boundary.test.mjs` |
| **Tax Rules config (fail-closed)** | `src/services/tax-rules.ts` + `getTaxRules()` ใน `thai-tax.service.ts` · ไฟล์ `core-api/data/tax-rules.json` (ไม่ commit) · เทสต์ 12 เคส + boundary 3 เคส |
| เอกสารนี้ | `docs/B2B-READINESS-AUDIT-2026-10-21.md` |

### ไม่ทำ (เจตนา)

- ไม่เขียน XMLDSig/e-Tax เองแบบไม่มีการรับรอง — เสี่ยงผิดกฎหมายและทำให้เข้าใจผิดว่าพร้อมยื่น
- ไม่เพิ่ม dependency ใหม่ (ต้องขออนุญาตเจ้าของ)
- ไม่แตะ `sovereign-os/infra/.env`, ไม่ migrate, ไม่ restart, ไม่ deploy
- ไม่ auto-รับเงินจากสลิปที่ผู้รับไม่ตรง/ยอดไม่ตรง
- ไม่แก้ policy `desktop-only` เพื่อดัน `/hover-cards` ขึ้นเมนู/⌘K — ต้องให้เจ้าของอนุมัติก่อน

---

## 4. ลำดับงานที่เสนอ (หลังพ้น Cold Soak)

| ลำดับ | งาน | ต้องมี | เวลาประมาณ | เกณฑ์ผ่าน |
|---|---|---|---|---|
| 0 | `npm run verify` ที่ MAIN + backup/restore ล่าสุดผ่าน | — | 30 นาที | เขียว 6/6 |
| 1 | Slip verification end-to-end | migration + provider creds | 3–5 วัน | สลิปซ้ำ/ยอดผิดถูกกันที่ DB; override มี audit |
| 2 | Cloud backup (S3/R2) + restore drill | creds ใน `.env` (เจ้าของ) | 1–2 วัน | restore จาก cloud สำเร็จ 1 ครั้ง + log |
| 3 | e-Tax adapter | ผู้ให้บริการ ETDA + certificate | 2–4 สัปดาห์ | เอกสารทดสอบถูกตอบรับจากผู้ให้บริการ |
| 4 | Usage metering + แพ็กเกจ | ตัดสินราคา/โควตา | 1–2 สปรินต์ | ใบแจ้งหนี้ตรงกับ metering 3 รอบ |
| 5 | Tenant isolation (Phase 5) | อนุมัติสถาปัตยกรรม | หลายสัปดาห์ | tenant A อ่านข้อมูล B ไม่ได้ (เทสต์) |

> ข้อ 1–2 ทำได้ทันทีหลัง soak เพราะแกนตัดสิน/รูปแบบ backup เตรียมไว้แล้ว
> ข้อ 3 ห้ามลัด — ต้องมีผู้ให้บริการที่รับรอง

---

## 5. วิธีตรวจซ้ำ

```bash
# แกนตัดสินสลิป
cd sovereign-os/core-api && npx tsx --test tests/slipVerify.test.ts

# ขอบเขตโมดูล + เมนู
node --test tools/test/slip-verify-boundary.test.mjs
node --test tools/test/nav-consolidation.test.mjs

# กฎภาษี (config)
cd sovereign-os/core-api && npx tsx --test tests/taxRules.test.ts tests/thaiTax.test.ts
node --test tools/test/tax-rules-boundary.test.mjs

# ด่านรวม (ที่ MAIN)
npm run verify
```

---

## 6. ภาคผนวก — ตรวจเอกสารฉบับขยาย (รอบ 2)

เอกสารรอบสองมีข้อความที่ควรแก้ก่อนใช้ขาย/คุยกับลูกค้า เพราะตรวจโค้ดแล้วไม่ตรง:

| ข้อความในเอกสาร | ของจริง | หลักฐาน |
|---|---|---|
| "45+ หน้าจอ" | **จริง (มากกว่า)** — 61 ไฟล์หน้า `.tsx` + 85 route module | `sovereign-frontend/src/pages/**/*.tsx`, `core-api/src/modules/**/*.routes.ts` |
| "ระบบหน้าร้าน `/shop`" | **ไม่จริงใน repo นี้** — หน้า `shop.tsx` ถูกลบ และ backend ไม่ mount `/api/shop` แล้ว (ย้ายไป `Sovereign-Web-Standalone`) | `routes.ts:110` (คอมเมนต์ "ย้ายไป…") · `tools/test/desktop-only.test.mjs:40-49,88-96` |
| "Dynamic PromptPay QR 0% fee" | **โค้ดมีจริง** — `buildPromptPayPayload` + `QRCode.toDataURL` | `business-shop.service.ts:278-291` (แต่ endpoint สาธารณะอยู่ใน repo ร้าน) |
| "ออกใบกำกับภาษี/ใบเสร็จ PDF อัตโนมัติ" | **จริงบางส่วน** — เป็นเอกสาร A4 พร้อมพิมพ์ + แปลงจำนวนเงินเป็นตัวอักษรไทย แล้ว **Print/Save as PDF** จากเบราว์เซอร์; ไม่ได้สร้างไฟล์ PDF เองและไม่เก็บถาวร | `components/business/TaxInvoice.tsx`, `lib/bahtText.ts` (ไม่มีไลบรารี PDF ใน package.json) |
| "สมุดบัญชี + แยก VAT 7%" | **จริง** — ledger + แยก VAT ตามอัตราร้าน + แผ่น ภ.พ.30 | `business.service.ts:324,459,800` · `BusinessTaxTab.tsx:98-115` |
| "KDS / จอครัว" | **จริง** | `pages/restaurant/kds.tsx`, `pages/restaurant/kitchen.tsx` |
| "ลูกค้าแนบสลิปผ่านลิงก์ลับ" | **ไม่จริงใน repo นี้** — รับแค่ `amount`; ไม่มีฟิลด์สลิปใน schema (อัปโหลดหลักฐานที่มีเป็นของ Treasury) | `business-shop.service.ts:172-192` · `treasury.routes.ts:37,533` |
| "Self-healing ทุก 30 วิ / ฟื้นใน 60 วิ" | **ไม่จริง** — Task ตรวจทุก 1 นาที; หลังปลุก Docker รอ backend ได้ถึง 180 วิ ⇒ ฟื้นจริง ~1–4 นาที | `docker-watchdog.mjs:3,189` · Task Scheduler (21/10/69) |
| "เปิด Rate Limiting + WAF" (เป็นข้อเสนอ) | **ทำแล้ว** | `rateLimit.middleware.ts:58` · `docs/ops-runbook.md:330-332,346` |
| "SQLite/PostgreSQL" | **PostgreSQL เท่านั้น** | `schema.prisma:6` |
| "Nice level ให้ AI ใช้ CPU ต่ำกว่าระบบขาย" | **ยังไม่มี** — ไม่พบ `setPriority`/nice ในโค้ด | ค้นทั้ง `core-api/src` + `tools/*.mjs` |
| "Tax Rules แก้ผ่าน config" | **เพิ่มให้แล้วรอบนี้** (ค่าเริ่มต้นในโค้ด + override ผ่าน `data/tax-rules.json`, fail-closed) | `tax-rules.ts` · `thai-tax.service.ts` (`getTaxRules`) |

### Tax Rules config — กติกาที่ล็อกไว้

- ไม่มีไฟล์ = ใช้ `RATES` เดิมเป๊ะ (ผลคำนวณไม่เปลี่ยน; เทสต์ยืนยัน 105,000 และ 21,500)
- ไฟล์ผิดรูป/คีย์พิมพ์ผิด/อัตรา > 1/ขั้นบันไดไม่เรียง/ขั้นสุดท้ายไม่เปิด → **ไม่ใช้ไฟล์ทั้งใบ** + `getTaxRulesStatus().errors`
- `effectiveFrom` ในอนาคต = ยังไม่ใช้ (เตรียมกฎหมายล่วงหน้าได้)
- ไฟล์อยู่ `core-api/data/tax-rules.json` (gitignored) — ไม่ commit ค่า override ลง repo
- เทสต์: `tests/taxRules.test.ts` 12 เคส + `tools/test/tax-rules-boundary.test.mjs` 3 เคส · พิสูจน์ red-first (ปล่อยให้ rate 1.5 ผ่าน → แดง 1 ตัว)

**ข้อความที่ควรใช้แทนในเอกสารขาย:** "ออกใบกำกับภาษี/ใบเสร็จพร้อมพิมพ์ (Save as PDF ได้)" · "ตรวจสลิปด้วยคน + แกนตัดสินพร้อมต่อ API" · "สำรองข้อมูลเข้ารหัสออกรอบเครื่องผ่าน 2 ช่องทาง (Telegram + mirror)" · "ฟื้นระบบอัตโนมัติภายในรอบ 10 นาที"
