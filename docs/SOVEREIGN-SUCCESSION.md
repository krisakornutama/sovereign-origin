# `sovereign-succession` — heir access by policy (SUCC-001, M1)

> เป้าหมายตาม ROADMAP §5.6: **"จำลอง heir access ตาม policy โดยไม่ต้องมีเจ้าของออนไลน์"**
> repo: <https://github.com/krisakornutama/sovereign-succession> · commit `0eddebc` · CI run `45886509714` (Node 20/22 เขียว)

## M1 ปิดอะไร

ระบบที่เจ้าของหายไปแล้วต้อง **ไม่ตายไปด้วย** แต่ก็ต้อง **ไม่เปิดให้ใครก็ได้** สองข้อนี้ขัดกันจนกว่าจะมี
กลไกที่ตอบได้ว่า "ตอนนี้เจ้าของยังอยู่ไหม" และ "ใครมีสิทธิ์เมื่อเจ้าของไม่อยู่" โดยไม่ต้องมีเซิร์ฟเวอร์
M1 ตอบสองคำถามนี้ด้วยของสามอย่างที่ตรวจได้ออฟไลน์:

1. **heartbeat ที่เจ้าของเซ็น** — ทุกครั้งที่เจ้าของยืนยันว่ายังอยู่ จะเกิด receipt
   `succession.owner.alive` ต่อเข้าห่วงโซ่ ไม่มีตัวจับเวลา ไม่มีบริการเวลา
2. **นาฬิกาที่คำนวณจากหลักฐาน** — `DormancyClock` เป็นฟังก์ชันบริสุทธิ์ของ (heartbeat ที่ตรวจแล้ว,
   policy, เวลาที่ถาม) ⇒ เครื่องสองเครื่องที่มีโซ่เดียวกันและ `now` เดียวกันต้องตอบเหมือนกัน
   สถานะมีสามค่า: `active` (เจ้าของยังอยู่) · `dormant` (เงียบครบ `dormantAfterDays` แต่ยังติด time-lock)
   · `window-open` (ครบทั้งสองเงื่อนไข)
3. **k-of-n heir shares** — คำขอเดียวกัน (policyId + requestId + เวลา) ต้องถูกเซ็นโดยผู้สืบทอด
   **ต่างคน** ครบ `threshold` คน และไม่มีใครถูก revoke ⇒ กุญแจผู้สืบทอดหลุดหนึ่งดอกไม่พอ

## หลักการที่บังคับใช้ (ไม่ใช่แค่เอกสาร)

| หลัก | ที่บังคับในโค้ด |
| --- | --- |
| ไม่มีการตัดสินใจโดยไม่มีหลักฐาน | `grant` **และ `refusal`** ถูกเขียนเป็น receipt ก่อนส่งคำตอบ; เขียนไม่ได้ = `receipt-required` และไม่ตอบ |
| head ชี้ที่ของที่มีจริง | เขียน receipt ก่อนเลื่อน head ⇒ crash แล้วเหลือ receipt ที่ไม่มีใครอ้าง ไม่ใช่ head ที่ชี้ไปที่ว่าง |
| state ถูกลบ = tamper ไม่ใช่ reset | มี `policy.json` แต่ไม่มี `state.json` ⇒ `invalid-state` ตอน `open()` |
| โซ่ต้องเดินหน้าเสมอ | head ซ้ำ / ชี้ที่ไม่มี / เวลาย้อนหลัง / receipt ของ policy อื่น ⇒ `rollback` |
| policy แก้ไม่ได้หลังเซ็น | `policyId` = SHA-256 ของ canonical body และ owner เซ็นทับ ⇒ แก้ตัวเลขใด ๆ พังทั้ง id และลายเซ็น |
| คำขอใช้ซ้ำไม่ได้ | `requestId` ที่ตัดสินแล้วถูกเก็บใน `state.used` ⇒ `replay` |

## ตัวอย่างการใช้งาน

```ts
const succession = await Succession.open({ dir: './estate', ownerKey, policy });
await succession.heartbeat();                 // เจ้าของยังอยู่
const status = await succession.status();     // 'active' | 'dormant' | 'window-open'

const payload = claimPayload(succession.policyId, 'estate-2027', at);
const grant = await succession.claim({
  requestId: 'estate-2027',
  at,
  shares: heirs.slice(0, 2).map((h) => ({ heirId: h.keyId, sig: signBytes(h.privateKey, payload) })),
});
const report = await succession.verify();     // โซ่ตรวจแล้ว + fingerprint ของสองกุญแจ
```

## หลักฐานคุณภาพ

- **79 tests ผ่าน** (policy 24 · clock 6 · claim 22 · integration 27) ครอบทุก refusal code
  (`invalid-policy` · `invalid-claim` · `invalid-state` · `rollback` · `bad-signature` · `unauthorised` ·
  `not-dormant` · `too-early` · `insufficient-shares` · `unknown-heir` · `heir-revoked` ·
  `duplicate-share` · `bad-share` · `replay` · `receipt-required`)
- **coverage 96.11 / 90.28 / 98.30 / 97.89** (stmt / branch / func / line) — thresholds ในโปรเจกต์คือ 95/90/95/95
- **red-first:** ปิด guard `too-early` ใน `evaluateClaim` หนึ่งบรรทัด ⇒ แดง 2 ใบ
  (`refuses before the window opens`, `refuses during dormancy when an absolute time-lock has not passed`)
  ⇒ คืนไฟล์ ⇒ เขียว 79/79
- `lint` · `typecheck` · `format:check` · `build` ผ่านทั้งหมด · `npm run example` รันจบ (2-of-3, replay ถูกปฏิเสธ)
- CI matrix Node 20/22 (`.github/workflows/ci.yml`): clone + build `sovereign-attest` ก่อน `npm ci`
  เพราะยังไม่ได้อยู่บน npm

## ข้อจำกัดที่ยังเปิด (ห้ามลบ)

- **M1 ตัดสินสิทธิ์และออกหลักฐาน แต่ยังไม่ปลดล็อกกุญแจข้อมูล** — `custodyToken` ใน grant เป็น
  handle ที่อ้างอิงได้ ไม่ใช่กุญแจ ⇒ การปล่อย wrapped data key ให้ผู้สืบทอดคือ M2
- **ยังไม่มี multi-channel** (4G / LoRa / satellite) ตามที่ ROADMAP §5.6 ต้องการ — ตอนนี้โซ่เดินทาง
  เป็นโฟลเดอร์ ต้องขนย้ายเอง
- **ไม่มี anchor นอก vault** ⇒ การเขียนใหม่ทั้งโฟลเดอร์ (ทั้งโซ่ + state) ยังตรวจจับไม่ได้จากภายนอก
  (เหมือนข้อจำกัดของสาย attest) — ต้องมี anchor log/ประกาศ head ที่ที่อื่นจึงจะปิดช่องนี้
- **นาฬิกาเป็นของผู้เรียก** — ระบบตัดสินจากเวลาที่ส่งเข้ามา ไม่ได้กันเจ้าของที่โกงเวลา ณ จุดนี้;
  การผูกกับเวลาโลกต้องอาศัย anchor จากภายนอก
- ยังไม่มีใครใช้ `sovereign-succession` ในแอปจริง — การต่อกับ `sovereign-dms` คือขั้นถัดไปในสายผลิตภัณฑ์

## งานถัดไปในสายนี้

1. **M2** — wrapped data key ต่อ heir + rotation เมื่อมี heir ถูกถอด
2. ต่อกับ `sovereign-dms` v2 (หลายช่องทาง) ตาม ROADMAP ระยะ 3
3. พิจารณา `ATTEST-012` (ให้ตัวติดตั้ง/อัปเดตตรวจใบรับรองจริง) ซึ่งยังเป็นคอขวดของสาย attest
