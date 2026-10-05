# โมดูล payments

## เจตนา

รับเงินจริงจากลูกค้าผ่าน Stripe Checkout Session (THB) และ**ยืนยันว่าจ่ายแล้วจริง**
โดยผูก `checkout.session.completed` กลับเข้ากับ `TransferOrder.ref_code`
ตอนนี้ใช้ transport ของปลอมเสมอ (`mode: mock`) — สลับไปของจริงได้เมื่อเปิด
`STRIPE_LIVE_ENABLED=true` เท่านั้น เพราะบัญชีที่มี key เป็น live mode และสิทธิ์
เขียนยังไม่ผ่านการยืนยัน

## โครงสร้าง — ใครเป็นเจ้าของอะไร

| ไฟล์ | เป็นเจ้าของ | ห้ามยุ่ง |
|---|---|---|
| `services/payment-verification.service.ts` | **ศัพท์และกติกา** ว่า delivery จะถูก apply ไหม · `NotAppliedReason` (reason code ที่ API ตอบและ log) · ลำดับการตรวจ | ต้อง pure: ไม่แตะ HTTP · ไม่แตะ DB · ไม่อ่าน config/env · ไม่ยิงเน็ต เพิ่มเงื่อนไขใหม่ตรงนี้ ไม่ใช่ใน route · กฎของทั้งสองตารางอยู่ที่ `checkCompletion()` จุดเดียว ส่วนที่ต่างกัน (ชื่อคอลัมน์/ถ้อยคำ) อยู่ใน `OrderRules` เท่านั้น — ห้ามคัดลอกขั้นตรวจไปเขียนซ้ำ · ถ้าเพิ่ม reason ที่ route ผลิตเอง ให้เพิ่มใน union ก่อน แล้วค่อยใช้ `REASON_ORDER_NOT_PENDING` แบบเดียวกัน |
| `services/payment-apply.service.ts` | **การเขียนลงฐานข้อมูลทั้งหมด** ที่มาจาก Stripe: CAS (`transferOrder`/`businessOrder`) + แถวเงิน `businessPayment` ใน `$transaction` เดียวกัน | รับ `PrismaClient` ตัวจริงเท่านั้น (ห้าม `any` — ชื่อคอลัมน์ที่ผิดต้องเป็น compile error) · ห้ามแตะ HTTP/response · ห้ามเขียน DB จากที่อื่นของโมดูลนี้ (ถ้าจะเพิ่มจุดเขียน ให้มาที่นี่ทั้งหมด) |
| `services/stripe-checkout.ts` | ขอบเขตของ Stripe ฝั่งเรา: บาท↔สตางค์ (`toThbMinorUnit`), ค่าคงที่ที่มาจากเอกสาร Stripe, `normalizeRefCode`, payload builder, transport (fake/live) | ห้าม import `config` — โมดูลนี้ต้องทดสอบได้ด้วยเทสต์ล้วน |
| `services/stripe-webhook.service.ts` | ตรวจลายเซ็น Stripe (pure) | ไม่รู้จัก order / DB / business |
| `services/webhook-secret-source.service.ts` | **เจ้าของค่า `STRIPE_WEBHOOK_SECRET`** — ประกาศว่าไฟล์ไหนมีผลจริง (`WEBHOOK_SECRET_OWNER_FILE` = `sovereign-os/infra/.env`) + `fingerprintSecret` (พิสูจน์ว่าหมุนแล้วจริงโดยไม่เผยค่า) + `compareWebhookSecretSources` | เป็นจุดเดียวที่ตอบได้ว่า "ค่านี้อยู่ที่ไหน" — ถ้าจะเปลี่ยนเจ้าของ ต้องแก้ที่นี่ที่เดียว · **ห้ามคืนค่า secret ดิบจากฟังก์ชันที่จะถูก log** (คืน fingerprint เท่านั้น) · ห้ามเปลี่ยนเป็นรับค่าจาก `core-api/.env` เพราะ container ไม่มีไฟล์นั้น |
| `services/webhook-secret-source.runtime.ts` | ตรวจตอนบูตว่าค่าที่รันอยู่ตรงกับไฟล์เจ้าของไหม (อ่าน `/app/host-infra.env`) + พิมพ์คำเตือนตอนไม่ตรง | ห้ามโยน error (บูตต้องได้เสมอ) · ห้ามพิมพ์ค่าดิบ |
| `services/payment-rejected-deliveries.service.ts` | **หลักฐานของเงินที่ปฏิเสธถาวร** + allowlist ว่าเหตุผลไหนถาวร (`PERMANENT_REJECTION_REASONS`) + รูปของข้อมูล 1 บรรทัด | ห้ามเพิ่มฟิลด์นอก allowlist (เทสต์จะ fail — ฟิลด์ใหม่คือความเสี่ยง PII ใหม่) · ห้ามแตะ DB (งานของ payment-apply.service) · ห้ามโยน error ออกไปที่ route (`safeRecordRejectedDelivery` คือการันตีว่าหลักฐานล้ม ≠ เงินหายเพิ่ม) · `order_not_found`/**ไม่**อยู่ในชุดถาวร เพราะยัง retry ได้ |
| `services/stripe-reconcile.service.ts` | **ไล่เงินหาย (pure)** — เทียบ session ที่ Stripe บอกว่า "จ่ายแล้ว" กับแถวที่ฐานข้อมูลบันทึก จับคู่สองทาง (session id + `client_reference_id`) | จับช่องว่างที่ทำให้เงินหายโดยไม่มีใครสังเกต · **อ่านอย่างเดียว ห้ามเขียนทับ** (การแก้ทับเงินอัตโนมัติคืออีกช่องที่ทำให้เงินหาย) · นับเฉพาะ session ที่ `livemode` จริง ไม่งั้นของทดสอบจะทำให้สัญญาณเชื่อถือไม่ได้ |
| `services/stripe-reconcile.runtime.ts` | ต่อชิ้นจริงของการไล่เงิน: ดึงจาก Stripe (GET อย่างเดียว) + อ่าน DB → เรียก logic ข้างบน · ประตูสองชั้น | ต้องมี `STRIPE_SECRET_KEY` **และ** `STRIPE_LIVE_ENABLED=true` ถึงยิง Stripe จริงได้ · **ตอนยังไม่มี key/ยังไม่เปิดสวิตช์ต้องพิมพ์เหตุผลที่ข้ามเสมอ** (ห้ามเงียบตอนปิด) · ห้ามโยน error ออก |
| `modules/payments/payments.routes.ts` | **เฉพาะชั้น HTTP**: auth, raw body, สถานะ/รูปร่าง response, และการเดินสาย config→transport | ห้ามใส่ตรรกะทางธุรกิจ — ถ้าเริ่มเป็น `if (...) return 400` หลาย ๆ ที่ แปลว่าตรรกะหลุดมาอยู่ผิดชั้น · **ห้ามเขียน DB ตรง ๆ ในไฟล์นี้** — ทุกจุดที่แตะ order/payment เพื่อบันทึกการจ่ายของ Stripe ต้องอยู่ที่ `payment-apply.service` (CAS ที่ซ่อนใน route คือจุดที่ทำให้ `any` หลุดเข้ามาและบั๊กที่เทสต์ด้วย mock ไม่จับ) |

**ทิศทางข้อมูล (ทางเดียว):**
`HTTP → verify ลายเซ็น → หา order → decideCompletion()/decideStorefrontCompletion() → payment-apply (CAS + แถวเงิน) → ตอบ`

`decide*()` คืน `apply` หรือ `not_applied` เท่านั้น — ไม่เขียนอะไรลง DB
เพราะ CAS ต้องรู้ว่า "เขียนสำเร็จไหม" ซึ่งเป็นเรื่องของชั้นเขียนข้อมูล
(`payment-apply.service`) ไม่ใช่ชั้น HTTP — การแยกแบบนี้ทำให้ทั้งสองทาง
(TransferOrder / ออเดอร์หน้าร้าน) ใช้กติกาเดียวกันและถูก type-check ตอน compile

## เพดานยอดที่บังคับ (ทั้งสองมาจากเอกสาร Stripe)

| ค่าคงที่ | คุมอะไร | ที่มา |
|---|---|---|
| `THB_MAX_MINOR_UNIT` | ยอด **ต่อหน่วย** (99,999,999 สตางค์) | เอกสาร `unit_amount` — Maximum |
| `THB_MAX_CHARGE_MINOR_UNIT` | ยอด **รวมทั้ง session** = ต่อหน่วย × quantity | docs.stripe.com/currencies → "Maximum charge amounts": non-card "8 digits for all other currencies, for a maximum charge of 999,999.99" (THB ไม่อยู่ในรายการยกเว้น 12/10/9 หลัก) |

ตัวเลขทั้งสองเท่ากันโดยบังเอิญ แต่เป็นคนละเรื่อง — ถ้า Stripe เปลี่ยนเพดานยอดรวม
ต้องแก้ `THB_MAX_CHARGE_MINOR_UNIT` แยก อย่าแตะตัวบน

**ทำไมไม่ใช่แค่เชื่อต่อหน่วยพอ:** ต่อหน่วยที่เต็มพอดี × quantity แล้วยอดรวม
เกินเพดานของ Stripe — ระบบจะสร้าง payload ที่ถูกปฏิเสธตอนยิงจริง ทั้งที่ order
ถูกสร้างไว้แล้ว จึงต้องตรวจที่จุดเดียวกับที่คิด `unit_amount`

## สัญญาการตอบกลับของ webhook

ตัดสินด้วยคำถามเดียว: **"ถ้า Stripe ส่งชุดเดิมมาอีก คำตอบจะเปลี่ยนไหม?"**

| สถานะ | เมื่อไร | ทำไม |
|---|---|---|
| **2xx** `applied:true` | เขียน order เป็น VERIFIED | ตอบแล้วจบ |
| **2xx** `applied:false` + `reason` + `ignored:true` | ยอดไม่ตรง · สกุลเงินผิด · ยอดของ order ใช้ไม่ได้ · ไม่มี `client_reference_id` · order ถูกยกเลิก · event ไม่ใช่ของเรา | retry ซ้ำ**ไม่ช่วย** (ส่งชุดเดิมก็ยังไม่ตรงอีก เพราะไม่มี state เปลี่ยนระหว่าง delivery) ⇒ ตอบ 2xx เพื่อหยุด retry ปล่อย ๆ แล้ว**บันทึกหลักฐานให้คนตามเงิน** (ดูหัวข้อ "หลักฐานเงินที่ถูกปฏิเสธ" ข้างล่าง) — ถ้าตอบ 4xx Stripe จะ retry ~3 วันแล้วปิด endpoint ทิ้ง กระทบลูกค้าทุกคน |
| **409** `retryable:true` | `client_reference_id` เป็น UUID ถูกรูปแบบ แต่ยังไม่มี order (แข่งขันเวลา: webhook มาก่อนแถว order) | ส่งซ้ำแล้ว**อาจ**สำเร็จ → ต้องให้ Stripe ยิงซ้ำ |
| **non-2xx** `rejected:true` | ลายเซ็นผิด/ไม่มี · secret ไม่ได้ตั้ง | secret อาจเพิ่งหมุน = **อาจ**สำเร็จในการส่งครั้งหนัง ถ้าตอบ 2xx เราจะสั่ง Stripe ว่าเลิกส่ง = เงินที่จ่ายจริงหายเงียบ |

body ที่ `applied:false` ต้องห้ามอ่านเป็น "สำเร็จ" — และต้อง `console.error` พร้อม
`refCode`/ตัวเลข เพราะ 2xx ทำให้ event ไม่โผล่ในหน้า Stripe อีก

## หลักฐานเงินที่ถูกปฏิเสธ (เปิดดูตอนเงินหาย)

**ไฟล์:** `sovereign-os/core-api/data/payments-rejected-deliveries.jsonl`
(ใน container คือ `/app/data/…` · JSON ต่อบรรทัด · `append` เท่านั้น ห้ามเขียนทับ)

**ทำไมต้องมี:** `currency_mismatch` · `amount_mismatch` · `order_amount_unusable`
ตอบ **200** โดยไม่มีแถวเงิน และ Stripe **ไม่ retry** (ส่งชุดเดิมซ้ำก็ยังไม่ตรงอีก)
⇒ ลูกค้าจ่ายจริงเข้ามา แต่ event หายจากหน้า Stripe ถาวร ถ้าไม่มีไฟล์นี้
เงินหายโดยไม่มีใครรู้จนกว่าจะเจอคนมาบอก

**อ่านยังไง:** `tail -f` ไฟล์ ดูหนึ่งบรรทัด = เงินเข้ามาจริง 1 รายการที่ระบบปฏิเสธ
· `eventId` → เปิดหน้า Stripe ที่ event นี้เพื่อยืนยันว่ามีเงินจริง (แล้วจ่าย/คืนด้วยมือ)
· `refCode` → ไปหา order ที่ต้องแก้ (`amount_thb`/`total`)
· `receivedAmountSatang`/`expectedAmountSatang` → ยอดที่ได้จริงเทียบกับที่คาดไว้
· `orderAmountRaw` → ยอดดิบของ order ตอนที่ใช้ไม่ได้ (เหตุผลที่ปฏิเสธคือของเราผิด)

**ไม่มีในไฟล์ (โดยตั้งใจ):** อีเมล/ชื่อ/เลขบัตรลูกค้า · payload ดิบทั้งก้อน
— เก็บเท่าที่จำเป็นต่อการตามเงินเท่านั้น เทสต์ที่คุมคือ
`tests/paymentsRejectedDeliveries.test.ts` (allowlist คีย์ + ห้ามมี PII)

**หลักฐานคือ "บันทึก" ไม่ใช่ "จ่ายเงิน":** เขียนหลักฐานแล้ว **ยังไม่มีแถวเงินและออเดอร์
ไม่ถูกแตะ** คนต้องไปแก้ order แล้ว Stripe จะยิงใหม่ · ถ้าการบันทึกหลักฐานล้ม
เอง webhook ต้องตอบ**เหมือนเดิมทุก field** (ห้ามเปลี่ยนสัญญาเพราะหลักฐานล้ม —
เงินจริงเข้าแล้ว ถ้าไม่ตอบก็หายเงียบกลางคัน ซึ่งแย่กว่า) พร้อม `console.error`
เสียงดังเพราะหลักฐานที่หาย = ต้องกลับไปไล่จาก Stripe ด้วยมือ

## ข้อห้าม / ระวัง

- **ห้ามยิง Stripe จริงโดยไม่ตั้งใจ** — บัญชีเป็น live mode เงินจริงหายทันที
  `createLiveStripeTransport` โยน error ถ้า `enabled !== true`
- **ห้ามเชื่อ `session.amount_total`** — ตัวเลขที่เชื่อได้คือ `TransferOrder.amount_thb`
- **ห้ามแก้ schema** — ไม่มี `provider_ref`; `cs_…` เก็บใน `TransferOrder.txid`
  (`ref_code` เป็น `@unique` อยู่แล้ว)
- **ห้ามแก้ `.env`** — เป็นของเจ้าของ และห้าม commit ค่าจริง
- ลำดับของ `if` ใน `decideCompletion` คือสัญญา — branch แรกที่ match คือคำตอบ
  การสลับลำดับเปลี่ยน reason ที่ลูกค้าเห็นและที่ log

## เงื่อนไขก่อนรับเงินจริง (ตรวจจากของจริง 4/10/69)

โค้ดและเทสต์ของโมดูลนี้พร้อมแล้ว แต่ **ยังรับเงินจริงไม่ได้จนครบ 4 ข้อ** — ด่านที่พังบ่อยไม่ใช่โค้ด:

1. **endpoint ต้องเข้าถึงได้จากอินเทอร์เน็ต** — backend ผูก `127.0.0.1:3001` ⇒ Stripe ยิงตรงไม่ได้ ต้องผ่าน Cloudflare tunnel → `:3000` → Next rewrite `/api/*` → `:3001` · ขั้นตอน+สถานะจริงอยู่ใน `docs/ops-runbook.md` (§สิบ “สถานะ 4/10/69”)
2. **`STRIPE_WEBHOOK_SECRET` ต้องมีค่า — และต้องอยู่ที่ `sovereign-os/infra/.env` เท่านั้น** ไฟล์นี้คือเจ้าของค่า (docker-compose อ่านแล้วส่งเข้า container) · `sovereign-os/core-api/.env` **ไม่มีผลกับ container** เพราะ `.dockerignore` ตัด `.env` ออกจาก image — ใส่ผิดไฟล์ = เว็บปกติแต่ปฏิเสธทุก delivery เงียบ ๆ · พิสูจน์ด้วย `npm run check:stripe-secret` (เทียบ fingerprint ระหว่างไฟล์เจ้าของกับค่าที่ container ใช้จริง) · ไม่มี/เป็นช่องว่างล้วน = ปฏิเสธทุก delivery ด้วย **401** + `rejected:true` โดยไม่แตะ DB (เทสต์คุมอยู่ที่ `tests/paymentsFreshClone.test.ts`) · **400** สงวนไว้ให้ body ที่ไม่ใช่ JSON หลังลายเซ็นผ่านแล้ว
3. **WAF ต้องอนุญาต path นี้** — rule default-deny ของโซนบล็อกทุก path ที่ไม่อยู่ใน allowlist ⇒ ถ้าไม่เติม `/api/payments/webhook` จะได้ **403 ที่ edge** ก่อนถึงแอป
4. **`STRIPE_LIVE_ENABLED=true` เป็นข้อสุดท้ายเสมอ** — ค่า default คือ `false` ⇒ transport เป็นของปลอม ไม่มี request ออกไป Stripe แม้ key ใน `.env` เป็น `rk_live` แล้ว · เปิดก่อนมีข้อ 1-3 = เงินเข้าจริงแต่ออเดอร์ไม่ถูกบันทึก

**URL ของ endpoint ต้องมี `/` ปิดท้าย** — ใช้ `/api/payments/webhook/` เพราะ frontend ตั้ง `trailingSlash: true` ⇒ แบบไม่มี `/` ตอบ **308** และ Stripe ไม่ตาม redirect ของ delivery (วัดจริง: `no_slash=308`, `with_slash=401`)

**การ deploy โมดูลนี้ = restart container** — `sovereign-core-api` mount `src` จาก MAIN และรัน `prisma generate && tsc && node dist/server.js` ทุกครั้งที่บูต ⇒ โค้ดใหม่ขึ้นเมื่อ container restart เท่านั้น (ถ้า `/api/payments/*` ตอบ 404 ให้ restart ก่อนไปสงสัยโค้ด · และรัน `npm run build` ใน MAIN ให้ผ่านก่อน restart เพราะถ้า tsc ในคอนเทนเนอร์ล้ม API จะไม่ขึ้นเลย)

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

_(ยังไม่มีตารางใน owners map)_
<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `payments/payments.routes.ts` (253 บรรทัด)

### Endpoints (จาก router)
```
POST /checkout-session
POST /webhook
```

<!-- auto:end -->


---

## ตรวจเงินหาย: `stripe-reconcile`

webhook คือช่องทางที่ Stripe **ดึง** เข้ามาเอง — ถ้ามันหลุด ไม่มีใครดัน เงินจริงจะอยู่ที่ Stripe อย่างเดียว ฝั่งเรายังโชว์ "ค้างชำระ" เต็มจำนวน และ**ไม่มีอะไรเตือน** เพราะทุกอย่างดูปกติ (เคยเกิดจริงตอน `STRIPE_WEBHOOK_SECRET` หลุด: หน้าเว็บปกติ · webhook 401 ทุก delivery · ลูกค้าจ่ายเงินจริงแล้วระบบไม่รู้)

worker นี้จึงไล่สองทางทุก 30 นาที แล้วเทียบกัน:

| ฝั่ง | ที่มา | ความหมาย |
|---|---|---|
| Stripe | `GET /v1/checkout/sessions` (อ่านอย่างเดียว · แบ่งหน้า · กรอง `livemode`) | "ลูกค้าจ่ายเงินจริงแล้ว" |
| ฐานข้อมูลเรา | `transfer_orders` ที่ `VERIFIED` + `business_payments` ที่ผูกกับ `cs_…` | "ระบบรู้ว่าจ่ายแล้ว" |

ผลลัพธ์สองแบบที่ต้องสนใจ:

- `⚠️ พบช่องว่าง` → **เงินจริงอยู่คนละฝั่งกับที่ระบบบันทึก** ต้องให้คนตรวจและแก้ด้วยมือ · ระบบไม่แก้ทับให้ เพราะการแก้ทับเงินอัตโนมัติโดยไม่มีคนสั่งคืออีกช่องหนึ่งที่ทำให้เงินหาย
- `⚠️ [stripe-reconcile] ข้ามรอบนี้: …` → ยังตรวจไม่ได้ (ไม่มี key / ยังไม่เปิดสวิตช์ / ยิงไม่สำเร็จ) · **นี่ไม่ใช่ "ไม่มีเงินหาย"** ข้อความถูกระบุไว้เพื่อกันไม่ให้อ่านผิด

ดูผล: `docker logs sovereign-core-api | grep stripe-reconcile` · ทดสอบตรรกะทั้งหมดได้โดยไม่ต้องมี Stripe จริงที่ `tests/stripeReconcile.test.ts`
