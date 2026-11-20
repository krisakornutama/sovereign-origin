# Sovereign Energy — เอกสารโปรเจกต์ (ไทย)

`sovereign-energy` คือโมดูล **charge session ที่ตรวจยอดด้วยมิเตอร์** ของ Sovereign OS: เครื่องชาร์จรายงานตัวเลขของตัวเอง แต่มิเตอร์เรียกเก็บเงินคือความจริง — โมดูลนี้เก็บ session ลง [`sovereign-vault`](https://github.com/krisakornutama/sovereign-vault), **ปฏิเสธการคิดเงินเมื่อสองตัวเลขไม่ตรงกัน** และผนึกยอดที่ตกลงแล้วเป็น receipt Ed25519 ด้วย [`sovereign-attest`](https://github.com/krisakornutama/sovereign-attest) ที่ใครก็ตรวจ offline ได้

> ขอบเขต M1 (ENERGY-001): `start()` → `reconcile()` → `stop()` + OCPP 2.0.1 `TransactionEvent` subset + signed receipt
> V2G dispatch และ solar forecast เลื่อนไป ENERGY-002/003 ตาม roadmap — **ยังไม่มีในโค้ดนี้**

---

## มุมมองระดับสูง

| ส่วน | บทบาท |
|------|------|
| **sovereign-vault** | เก็บ session record, meter pin, index เข้ารหัส at-rest; root ใช้ตรวจ rollback |
| **sovereign-attest** | เซ็น receipt บน canonical JSON body (start/settlement), เก็บโซ่ `prev` ต่อ artifact |
| **sovereign-energy** | **Session state machine** + **meter trust** + **settlement math** + **offline verifier** ในไลบรารีเดียว |

> มิเตอร์คือแหล่งความจริง: `amountSatang` คิดจาก `meterWh` (ผลต่างของ signed reading) ไม่ใช่ตัวเลขที่เครื่องชาร์จอ้าง

---

## โฟลว์แบบย่อ

```
meter.start(signed) ─┐
charger.startWh ─────┴→ start() ──→ session id = sha256(header)
                                        │
                     reconcile(chargerStopWh, meterStop) ──→ drift, ไม่แตะ state
                                        │
                     stop(chargerStopWh, meterStop)
                          ├─ |chargerWh − meterWh| > tolerance → meter-mismatch (session ยัง active)
                          └─ ผ่าน → ผนึก settlement receipt → เขียน record เป็น settled
                                        │
                     Energy.verifySettlement(receipt, { publicKey }) ──→ ตรวจ offline
```

1. **Start** ผนึก `energy.charge.started` receipt **ก่อน** เขียน record — เขียน receipt ไม่ได้ = `receipt-required` ไม่มี session เกิดขึ้น
2. **Reconcile** คำนวณ drift ให้ดูระหว่าง session ยังเปิด (operator แก้ reading ได้ก่อนปิด)
3. **Stop** เปรียบเทียบ signed meter กับ charger; เกิน tolerance = `meter-mismatch` พร้อม `details` (`chargerWh`, `meterWh`, `driftWh`, `toleranceWh`) — ไม่มีการเขียนอะไรลงดิสก์
4. **Settlement receipt** ผนึกก่อนเขียน record; verifier คำนวณ `drift`, ช่วงเวลา และผลต่างซ้ำเอง ไม่เชื่อตัวเลขที่ผู้เซ็นอ้าง

---

## สิ่งที่ energy รับรอง (guarantees)

| รับรอง | กลไก |
|---------|------|
| **มิเตอร์คือความจริง** | `amountSatang` = `meterWh × price` เป็นจำนวนเต็มสตางค์ (ปัด half-up) โดย `meterWh` มาจาก signed stop − signed start |
| **ไม่คิดเงินจากตัวเลขที่ยังไม่ตรวจ** | `stop()` เทียบ signed meter กับ charger; เกิน `toleranceWh` (default 100 Wh) = `meter-mismatch`, session คง `active` |
| **Reading ต้องพิสูจน์ตัวได้** | ตรวจ Ed25519 ด้วย public key ที่ **pin ต่อ `meterId`** — มิเตอร์ที่ pin แล้วส่ง unsigned มา = ปฏิเสธ (ไม่ fallback) |
| **Receipt มาก่อนใบเรียกเก็บ** | ผนึก settlement receipt สำเร็จก่อนเขียน settled record; ผนึกไม่ได้ = `receipt-required` ไม่คิดเงิน |
| **ตรวจ offline ได้** | `Energy.verifySettlement()` ตรวจลายเซ็น + artifact name + digest + `drift = \|charger − meter\|` + `drift ≤ tolerance` + ช่วงเวลา |
| **ไม่มี silent edit บนดิสก์** | `open()` ตรวจ record ทุกใบ: id ต้อง hash header ตัวเอง, index/t meter file ต้อง parse ได้, session ที่ถูก index ต้องมีจริง → ผิด = `rollback` |
| **Rollback เห็นได้** | `anchor()` / `checkAnchor()` เข็ม vault root ไป append-only log |
| **เลขจำนวนเต็มทั้งหมด** | `wh`, ราคา, tolerance, timestamp มีเพดานชัด (`MAX_ENERGY_WH`, `MAX_PRICE_SATANG_PER_KWH`, `MAX_TOLERANCE_WH`, `MAX_TIMESTAMP`) และ amount เป็น safe integer |
| **ฟิลด์ที่ไม่รู้จัก = ปฏิเสธ** | reading/session ที่มีฟิลด์เกิน schema ถูกปฏิเสธ ⇒ ลายเซ็นครอบ payload หนึ่ง แต่ verifier อ่านอีก payload ไม่ได้ |

---

## รหัสข้อผิดพลาด (failure codes = contract)

```ts
import { EnergyError } from 'sovereign-energy';
try {
  await energy.stop(session.id, { chargerStopWh, meterStop });
} catch (error) {
  if (error instanceof EnergyError) console.error(error.code, error.details);
}
```

| Code | หมายความ |
|------|---------|
| `invalid-connector` | `connectorId` ผิด format |
| `invalid-session` | session record/option ผิดรูป, id ไม่ hash header, settled ขาดตัวเลข, ราคา/เวลาเกินช่วง |
| `invalid-meter` | reading ผิดรูป/ติดเพดาน/ถอยหลัง, หรือ unsigned เมื่อไม่อนุญาต |
| `invalid-ocpp` | `TransactionEvent` ไม่ตรง subset ที่รองรับ (ไม่เดา) |
| `untrusted-meter` | มีลายเซ็นแต่ไม่มี pinned key ของ `meterId` นั้น |
| `signature-invalid` | ลายเซ็นไม่ตรง pinned key, receipt ไม่ครอบ session นี้, หรือ meta arithmetic ขัดกัน |
| `meter-mismatch` | charger กับ meter ต่างเกิน tolerance → ไม่คิดเงิน (มี `details`) |
| `connector-busy` | connector นี้มี session active อยู่ |
| `session-not-found` | ไม่มี session id นี้ใน vault นี้ |
| `session-not-active` | เรียก stop/settlement ผิดสถานะ (settled แล้ว / ยัง active) |
| `receipt-required` | ผนึก receipt ไม่สำเร็จ → ไม่เขียน record / ไม่คิดเงิน |
| `rollback` | สถานะบนดิสก์ไม่ consistent (index ชี้ session ที่หาย, record ถูกแก้, ไฟล์ meter เสีย) |

**Fail closed**: ทุกเส้นทางที่เขียน state จะผนึก receipt และตรวจ invariant ก่อน; เส้นทางที่อ่าน state จะปฏิเสธทั้ง vault เมื่อเจอหลักฐานว่าถูกแก้

---

## ขีดจำกัด (limits)

| ขีดจำกัด | ค่า | เหตุผล |
|-----------|-----|--------|
| Energy ต่อ session/reading | 1 000 000 000 Wh (1 GWh) | คูณราคาแล้วยังอยู่ใน `Number.MAX_SAFE_INTEGER` |
| ราคา | ≤ 1 000 000 สตางค์/kWh (10 000 บาท/kWh) | กัน overflow และกัน receipt ที่อ้างราคาเกินจริง |
| Tolerance | ≤ 10 000 Wh (10 kWh) | drift ที่ยอมรับได้ต้องมีขอบเขต |
| Timestamp | ≤ 8 640 000 000 000 000 ms | กันค่าที่ทำให้ Date เพี้ยน |
| OCPP samples | ≤ 1 000 meterValue / 1 000 sampledValue | กัน memory blow-up จาก peer ที่ไม่น่าไว้ใจ |
| `connectorId` | `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$` | path-safe, ใช้ใน receipt ได้ |
| `meterId` | `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` | human-readable, ใช้เป็น key ของ pin |

---

## สิ่งที่ energy **ไม่** ทำ (ใน M1)

- ❌ V2G dispatch / solar forecast — งานของ ENERGY-002/003
- ❌ OCPP transport (WebSocket/CSMS) — โมดูลนี้ parse เฉพาะ `TransactionEvent` subset ที่ต้องใช้คิดเงิน
- ❌ เรียกเก็บเงิน/ตัดบัตร — `amountSatang` คือยอดที่พร้อมส่งต่อให้ Payment
- ❌ เป็นเจ้าของนโยบายราคา — ราคาต่อ session ถูกลงลายเซ็นใน header และตัดสินโดยผู้เรียก
- ❌ กู้คืน vault ที่ถูก rollback อัตโนมัติ — ตรวจแล้วแจ้ง (`rollback`/`checkAnchor`), ไม่เดาแทนคน

---

## API หลัก

```ts
import { Energy, parseTransactionEvent } from 'sovereign-energy';

const energy = await Energy.open({ vault, site: 'home-a', keyId: 'energy' });
await energy.trustMeter('meter-1', meterPublicKeyPem); // pin ครั้งเดียว

const started = parseTransactionEvent(ocppTransactionEvent);
const session = await energy.start({
  connectorId: '1',
  vehicleId: 'ev:vin-hash',
  priceSatangPerKwh: 450,
  chargerStartWh: 900_000,
  meterStart: signedReading(900_000),
});

const quote = energy.reconcile(session.id, { chargerStopWh, meterStop }); // ดู drift ก่อน
const { session: settled, settlement } = await energy.stop(session.id, {
  chargerStopWh,
  meterStop,
});

const audited = Energy.verifySettlement(settlement.receipt, {
  publicKey: energy.publicKey(),
});
```

| เมธอด | ใช้เมื่อไหร่ |
|--------|-----------|
| `open({vault, site, keyId?, now?, allowUnsignedMeter?, toleranceWh?})` | เริ่มต้น/เปิดซ้ำ (ผูก vault กับ site) |
| `site()` / `publicKey()` | ชื่อไซต์ / PEM ให้ผู้ตรวจ pin |
| `trustMeter(meterId, publicKey)` / `untrustMeter(meterId)` / `meters()` | จัดการ pinned meter key |
| `start(input)` | เปิด session (ผนึก start receipt ก่อนเขียน) |
| `reconcile(id, input)` | เทียบ charger/meter แบบอ่านอย่างเดียว |
| `stop(id, input)` | ปิด session + ผนึก settlement receipt (fail closed) |
| `get(id)` / `sessions()` | อ่าน session ในหน่วยความจำ (settled ก่อน) |
| `settlement(id)` | เปิด receipt ที่เก็บไว้และตรวจกับ record ซ้ำ |
| `anchor(log)` / `checkAnchor(log, root?)` | pin root ไป log ภายนอก / ตรวจจับ rollback |
| `Energy.verifySettlement(receipt, {publicKey})` | ตรวจ offline ด้วย key ที่ pin เท่านั้น (ไม่ต้องมี state) |

---

## การทดสอบ (verify)

```bash
npm ci
npm run lint
npm run typecheck
npm run format:check
npm run test:coverage   # 115 tests, thresholds 90/90/90/80
npm run build
npm run example
```

- **115 tests**: mismatch/tolerance boundary, reconcile ไม่แตะ state, connector busy, replay header เดิม, meter signature ผิด/ไม่มี pin/คนละมิเตอร์, unsigned default reject, impostor key, tampered session/index/meter file → `rollback`, receipt หาย → `rollback`, forged receipt (ผิด action/name/digest/meta) → `signature-invalid`, receipt เขียนไม่ได้ → `receipt-required` + session ยัง active
- **Coverage**: 98.97 / 97.39 / 100 / 99.35
- **Red-first proven**: mutant ปิด guard `!quote.withinTolerance` ใน `stop()` → เทสต์แดง 3 ใบ (drift เกิน, retry, zero tolerance) → คืนไฟล์ byte-for-byte → 115/115 เขียว
- **Example**: หนึ่ง session จบด้วย receipt ที่ตรวจ offline ได้ + session ที่สองถูกปฏิเสธด้วย `meter-mismatch` และยัง `active`

---

## หลักฐานการส่งมอบ

| รายการ | ค่า |
|--------|-----|
| Repo | <https://github.com/krisakornutama/sovereign-energy> (public) |
| Commit | `c5faa382573277b0bb18a402ee496ab7d5d0902d` |
| CI | [44547087595](https://github.com/krisakornutama/sovereign-energy/actions/runs/44547087595) — success (Node 20 + 22) |
| Tests / coverage | 115 tests · 98.97 / 97.39 / 100 / 99.35 |
| Red-first | mutant ปิด tolerance guard → แดง 3 → คืนไฟล์ → เขียว 115/115 |

---

## ตำแหน่งใน Roadmap

- **§5.5 → ENERGY-001** (milestone แรกของ energy: charge session + meter-verified settlement)
- ต่อจาก FABRIC-001: ข้อมูลที่ converge ข้าม peer แล้วถูกใช้ตัดสินใจเรื่องเงิน โดยมี receipt เป็นหลักฐาน
- งานถัดไปในสายผลิตภัณฑ์: **SUCC-001** (`sovereign-succession`) — heir key + policy ให้ระบบอยู่ต่อหลังเจ้าของหาย

---

## License

MIT — เป็นส่วนหนึ่งของ Sovereign OS
