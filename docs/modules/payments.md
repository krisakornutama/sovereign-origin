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

## เงื่อนไขก่อนรับเงินจริง (ตรวจจากของจริง 4/10/69)

โค้ดและเทสต์ของโมดูลนี้พร้อมแล้ว แต่ **ยังรับเงินจริงไม่ได้จนครบ 4 ข้อ** — ด่านที่พังบ่อยไม่ใช่โค้ด:

1. **endpoint ต้องเข้าถึงได้จากอินเทอร์เน็ต** — backend ผูก `127.0.0.1:3001` ⇒ Stripe ยิงตรงไม่ได้ ต้องผ่าน Cloudflare tunnel → `:3000` → Next rewrite `/api/*` → `:3001` · ขั้นตอน+สถานะจริงอยู่ใน `docs/ops-runbook.md` (§สิบ “สถานะ 4/10/69”)
2. **`STRIPE_WEBHOOK_SECRET` ต้องมีค่า** — ไม่มี/เป็นช่องว่างล้วน = ปฏิเสธทุก delivery ด้วย **401** + `rejected:true` โดยไม่แตะ DB (เทสต์คุมอยู่ที่ `tests/paymentsFreshClone.test.ts`) · **400** สงวนไว้ให้ body ที่ไม่ใช่ JSON หลังลายเซ็นผ่านแล้ว
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
