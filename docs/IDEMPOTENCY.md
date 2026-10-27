# Idempotency (กลาง) — "เน็ตหลุดก็ขายได้"

> สถานะ: **โค้ด + เทสต์เสร็จ (27/10/69)** · **ยังไม่ apply migration ขึ้น production** และยังไม่ restart runtime (Cold Soak)
> ไฟล์ที่เกี่ยวข้อง: `sovereign-os/core-api/src/services/idempotency.service.ts` · `src/middleware/idempotency.middleware.ts` · `prisma/migrations/20261027120000_idempotency_keys/`

## ทำไมต้องมี

ระบบนี้มีจุดที่ "ทำซ้ำแล้วเสียของจริง" — เปิดออเดอร์, บันทึกรับเงิน, รับซื้อวัตถุดิบเข้าสต็อก
เน็ตหลุด/ผู้ใช้กดซ้ำ/คิวออฟไลน์ replay จึงต้องทำให้ **ผลข้างเคียงเกิดครั้งเดียว** แม้คำขอจะมาหลายรอบ

ทางเลือกที่ปัดทิ้ง: ให้แต่ละ endpoint จำเอง → กฎไม่เหมือนกัน, ตรวจสอบไม่ได้, และเพิ่มจุดใหม่แล้วลืมง่าย
ทางที่เลือก: **ตารางกลาง 1 ใบ + middleware 1 ตัว** ที่ทุก endpoint ใช้ร่วมกัน

## สัญญา (สิ่งที่ระบบรับประกัน)

| กรณี | ผลลัพธ์ |
|---|---|
| ไม่ส่ง header `Idempotency-Key` / `x-idempotency-key` | ผ่านปกติ **ไม่เขียนตาราง** (client เก่าไม่พัง) |
| ส่งคีย์ผิดรูปแบบ (ไม่ใช่ 8–200 ตัว `A-Za-z0-9._:-`) | `400 IDEMPOTENCY_INVALID_KEY` ก่อนแตะธุรกิจ |
| คีย์เดิม + payload เดิม + ทำเสร็จแล้ว | ตอบ **ผลเดิม** + หัว `Idempotency-Replayed: true` (handler ไม่รัน) |
| คีย์เดิม + payload ต่าง | `409 IDEMPOTENCY_CONFLICT` |
| คีย์เดิมแต่คนละผู้ใช้ | `409 IDEMPOTENCY_CONFLICT` (ไม่คืน body ของคนอื่น) |
| คีย์เดิม + คำขอแรกยังทำงานอยู่ | `409 IDEMPOTENCY_IN_PROGRESS` + `Retry-After` (1–60 วิ) |
| handler ตอบ 4xx/5xx | **ไม่แคช** — ปล่อยคีย์ทิ้ง ให้แก้แล้วลองใหม่ได้ |
| lease หมดอายุ (คำขอแรกตายกลางทาง) | ใช้คีย์เดิมทำงานต่อได้ (ไม่สร้างแถวซ้ำ) |
| ตารางยังไม่ถูก migrate (`P2021`) | **fail-open** — ทำงานต่อได้ + เตือนครั้งเดียวใน log |
| ฐานข้อมูลล่มจริง | `503 IDEMPOTENCY_UNAVAILABLE` (ไม่ยอมให้ทำเงินซ้ำโดยไม่มีการป้องกัน) |

กติกาเพิ่มเติม:

- **fingerprint** = `sha256(userId + method + path + body)` โดย body ถูก normalize (เรียง key) ⇒ payload เดียวกันแต่สลับลำดับ key = เรื่องเดียวกัน
- **lease 60 วิ / TTL 24 ชม.** — ระหว่างทำงานจับจองสั้น ๆ, ผลสำเร็จเก็บยาวเพื่อ replay
- **เก็บเฉพาะผล 2xx** และผลที่ใหญ่เกิน 64 KB จะไม่ถูกเก็บ (ปล่อยให้ retry ทำงานใหม่)
- **บันทึกผลก่อนส่ง response** — ถ้า process ตายหลังส่งแต่ก่อนบันทึก ลูกค้าจะ retry แล้วได้ผลซ้ำ (เลือก at-least-once สำหรับ "การบันทึก" แต่ exactly-once สำหรับ "ผลข้างเคียง")
- แถวหมดอายุถูก prune แบบเบา ๆ (ไม่เกินทุก 10 นาทีต่อ process) และเรียก `pruneExpiredIdempotency()` จาก worker/cron ได้

## Endpoint ที่ต่อแล้ว

| Endpoint | scope |
|---|---|
| `POST /api/business/:businessId/orders` | `business.order` |
| `POST /api/business/:businessId/orders/:id/payments` | `business.payment` |
| `POST /api/restaurant/orders` | `restaurant.order` |
| `POST /api/restaurant/purchases` | `restaurant.purchase` |

ตำแหน่งใน middleware chain: หลัง `authenticate` (ต้องรู้ userId ก่อน) และหลัง `requireRole` ถ้ามี
⇒ คำขอที่ไม่มีสิทธิ์ไม่กินคีย์

## ฝั่ง client

`authFetch` (`sovereign-frontend/src/lib/apiFetch.ts`) แนบ `x-idempotency-key` ให้เองสำหรับ
`POST/PUT/PATCH/DELETE` — ยกเว้น caller ตั้ง header มาเอง (ส่งคีย์เดิมได้เวลา retry เอง)

คิวออฟไลน์ (`lib/offlineQueue.ts`) เก็บ header ไว้กับ action ⇒ ตอน replay จึงส่งคีย์เดิมกลับไป
**นี่คือเหตุผลที่ "เน็ตหลุดก็ขายได้"**: งานที่เข้าคิวตอนออฟไลน์จะไม่กลายเป็นออเดอร์ซ้ำเมื่อกลับมาออนไลน์

## env ที่ปรับได้

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `IDEMPOTENCY` | `on` | `off` = ปิดทั้งระบบ (ไม่ตรวจ header) — ใช้เมื่อฉุกเฉินเท่านั้น |
| `IDEMPOTENCY_TTL_SEC` | `86400` | เก็บผลสำเร็จไว้นานแค่ไหน (ขั้นต่ำ 60) |
| `IDEMPOTENCY_LEASE_SEC` | `60` | จับจองคำขอที่ยังทำงานอยู่ (ขั้นต่ำ 5) |

## ขั้นตอนเปิดใช้บน production (ยังไม่ทำ — รออนุมัติ/จบ Cold Soak)

1. backup DB ตามปกติ (`backups/postgres/...`)
2. `docker exec sovereign-core-api npx prisma migrate deploy` → apply `20261027120000_idempotency_keys`
3. `docker restart sovereign-core-api` (container จะ `prisma generate && npm run build && npm start` เอง)
4. ตรวจ: `\d idempotency_keys` มี 11 คอลัมน์ + unique `(scope, key)` + index `expiresAt`
5. smoke: ยิง `POST /api/restaurant/orders` ด้วยคีย์เดิม 2 ครั้ง → ครั้งที่สองต้องได้ `Idempotency-Replayed: true` และมีออเดอร์เดียว

**ลำดับที่ปลอดภัย**: โค้ด deploy ก่อน migrate ได้ (fail-open) แต่ **อย่าให้ window ยาว** —
ระหว่างที่ยังไม่ migrate ระบบจะไม่กันซ้ำเลย (มี log เตือนบรรทัดเดียว)

## เทสต์ที่คุมพฤติกรรมนี้

- `sovereign-os/core-api/tests/idempotency.test.ts` — **22/22** (service + middleware บน HTTP จริง)
- `tools/test/idempotency-migration.test.mjs` — **12 เคส**: schema ↔ migration ตรงกัน, ไม่มี BOM, ไม่มี FK, unique/index ครบ
- `tools/test/idempotency-wiring.test.mjs` — **12 เคส**: route จริงติด middleware, frontend แนบ header, คิวออฟไลน์เก็บ header
- mutation ที่พิสูจน์แล้วว่าเทสต์จับได้จริง (exit 1 ทั้งหมด):
  ถอด `idempotent()` ออกจาก route · สลับให้ middleware อยู่ก่อน `requireRole` · ให้ `authFetch` ทับคีย์ของ caller · แก้ชื่อคอลัมน์ใน migration

## ยังไม่ทำ (ตั้งใจ)

- **local read model / ขายต่อได้ตอนออฟไลน์เต็มรูปแบบ** — ต้องตัดสินขอบเขตข้อมูลที่จะเก็บในเครื่องก่อน (ยังไม่มีหลักฐานความต้องการ)
- **conflict resolution ระดับข้อมูล** (สองเครื่องแก้เรื่องเดียวกัน) — ต้องมี sync จริงก่อน
- **cron prune แยก** — ตอนนี้ prune ใน `beginIdempotent` พอ (ตารางเล็ก)
