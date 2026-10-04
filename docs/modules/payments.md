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
| `services/payment-verification.service.ts` | **ศัพท์และกติกา** ว่า delivery จะถูก apply ไหม · `NotAppliedReason` (reason code ที่ API ตอบและ log) · ลำดับการตรวจ | ต้อง pure: ไม่แตะ HTTP · ไม่แตะ DB · ไม่อ่าน config/env · ไม่ยิงเน็ต เพิ่มเงื่อนไขใหม่ตรงนี้ ไม่ใช่ใน route |
| `services/stripe-checkout.ts` | ขอบเขตของ Stripe ฝั่งเรา: บาท↔สตางค์ (`toThbMinorUnit`), ค่าคงที่ที่มาจากเอกสาร Stripe, `normalizeRefCode`, payload builder, transport (fake/live) | ห้าม import `config` — โมดูลนี้ต้องทดสอบได้ด้วยเทสต์ล้วน |
| `services/stripe-webhook.service.ts` | ตรวจลายเซ็น Stripe (pure) | ไม่รู้จัก order / DB / business |
| `modules/payments/payments.routes.ts` | **เฉพาะชั้น HTTP**: auth, raw body, สถานะ/รูปร่าง response, การเขียน DB (CAS) และการเดินสาย config→transport | ห้ามใส่ตรรกะทางธุรกิจ — ถ้าเริ่มเป็น `if (...) return 400` หลาย ๆ ที่ แปลว่าตรรกะหลุดมาอยู่ผิดชั้น |

**ทิศทางข้อมูล (ทางเดียว):**
`HTTP → verify ลายเซ็น → หา order → decideCompletion() → CAS เขียน DB → ตอบ`

`decideCompletion()` คืน `apply` หรือ `not_applied` เท่านั้น — ไม่เขียนอะไรลง DB
เพราะ CAS ต้องรู้ว่า "เขียนสำเร็จไหม" ซึ่งเป็นเรื่องของชั้น HTTP

## สัญญาการตอบกลับของ webhook

ตัดสินด้วยคำถามเดียว: **"ถ้า Stripe ส่งชุดเดิมมาอีก คำตอบจะเปลี่ยนไหม?"**

| สถานะ | เมื่อไร | ทำไม |
|---|---|---|
| **2xx** `applied:true` | เขียน order เป็น VERIFIED | ตอบแล้วจบ |
| **2xx** `applied:false` + `reason` | order ไม่มี · ยอดไม่ตรง · สกุลเงินผิด · ไม่มี `client_reference_id` · order ถูกยกเลิก · event ไม่ใช่ของเรา | ไม่มีทางสำเร็จในการส่งครั้งหนัง → ตอบ 4xx แล้ว Stripe retry ~3 วัน แล้ว**ปิด endpoint ทิ้ง** กระทบลูกค้าทุกคน |
| **non-2xx** `rejected:true` | ลายเซ็นผิด/ไม่มี · secret ไม่ได้ตั้ง | secret อาจเพิ่งหมุน = **อาจ**สำเร็จในการส่งครั้งหนัง ถ้าตอบ 2xx เราจะสั่ง Stripe ว่าเลิกส่ง = เงินที่จ่ายจริงหายเงียบ |

body ที่ `applied:false` ต้องห้ามอ่านเป็น "สำเร็จ" — และต้อง `console.error` พร้อม
`refCode`/ตัวเลข เพราะ 2xx ทำให้ event ไม่โผล่ในหน้า Stripe อีก

## ข้อห้าม / ระวัง

- **ห้ามยิง Stripe จริงโดยไม่ตั้งใจ** — บัญชีเป็น live mode เงินจริงหายทันที
  `createLiveStripeTransport` โยน error ถ้า `enabled !== true`
- **ห้ามเชื่อ `session.amount_total`** — ตัวเลขที่เชื่อได้คือ `TransferOrder.amount_thb`
- **ห้ามแก้ schema** — ไม่มี `provider_ref`; `cs_…` เก็บใน `TransferOrder.txid`
  (`ref_code` เป็น `@unique` อยู่แล้ว)
- **ห้ามแก้ `.env`** — เป็นของเจ้าของ และห้าม commit ค่าจริง
- ลำดับของ `if` ใน `decideCompletion` คือสัญญา — branch แรกที่ match คือคำตอบ
  การสลับลำดับเปลี่ยน reason ที่ลูกค้าเห็นและที่ log
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

_(ยังไม่มีตารางใน owners map)_
<!-- auto:end -->