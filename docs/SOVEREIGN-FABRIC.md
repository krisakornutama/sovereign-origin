# Sovereign Fabric — เอกสารโปรเจกต์ (ไทย)

`sovereign-fabric` คือโมดูล **sneakernet federation** ของ Sovereign OS: 2 ครัวเรือน (หรือ 2 ไซต์) รวม state เดียวกันโดย **คาร์รี่ไฟล์** — ไม่มีเซิร์ฟเวอร์, ไม่มีบัญชี, ไม่มีเครือข่าย, ไม่เชื่อใจช่องส่ง

---

## มุมมองระดับสูง

| ส่วน | บทบาท |
|------|------|
| **sovereign-vault** | เก็บ op log เข้ารหัส at-rest, append-only, มี hash chain ต่อ peer head |
| **sovereign-attest** | เซ็น receipt Ed25519 บน canonical JSON body, เก็บโซ่ `prev` ให้ตรวจสอบย้อนหลังได้ offline |
| **sovereign-fabric** | **OpLog (CRDT)** + **Bundle protocol** + **Ingest guard** = ข้อตกลง sync ทั้งหมดในไลบรารีเดียว |

> ไม่มี clock authority — `at` ใน op คือ wall time ที่ writer ตั้งเอง ลงลายเซ็นเข้า receipt แล้ว receiver ไม่แก้ได้

---

## โปรโตคอลแบบย่อ

```
[A] export({ to: 'home-b' }) → bytes → USB/ไฟล์ → [B] import(bytes)
```

1. **Export** เซ็น receipt บน `digestBody(body)` → `ACTION_BUNDLE = 'fabric.bundle.sealed'`
2. **Body** มี `from`, `to` (null = ใครก็ได้ที่ pinned), `since` (cursor), `heads` (state 全部), `ops` (delta), `at`
3. **Import** ตรวจ HMAC/receipt ก่อนใช้งาน → dry-run ทั้ง bundle กับ virtual heads → เขียนต่อเมื่อผ่านหมด
4. **Delta** ขับเคลื่อนด้วย `fabric/have/<peer>` ที่เขียนตอน import สำเร็จ: receiver ตอบกลับ ≥ 1 ครั้งถึงจะมี delta ได้

---

## สิ่งที่ fabric รับรอง (guarantees)

| รับรอง | กลไก |
|---------|------|
| **Offline by construction** | API รับ/ส่ง `Uint8Array` เท่านั้น — ไม่มี socket, ไม่มี URL, ไม่มี background task |
| **Transport hostile** | ทุก bundle ลงลายเซ็น Ed25519 บน canonical body; แก้ไข 1 ไบต์ก็แตก digest → ปฏิเสธ |
| **Sender pinned** | ตรวจ receipt ด้วย public key ที่ **pinned ในเครื่องรับ** ไม่ใช่ key ที่เดินทางมาพร้อม bundle |
| **Contiguous history** | Seq ต่อ peer เป็น `1..n`; bundle ข้าม seq → reject ทั้ง bundle (ไม่มี half-history) |
| **No forks** | `(peer, seq)` เดียวกัน 2 op ต่างกัน → reject; สิ่งที่ receiver เก็บอยู่คือสิ่งที่ชนะ |
| **No rollback** | Sender ไม่ได้อ้าง `heads[from]` น้อยกว่าที่ receiver มีอยู่แล้ว → `rollback` |
| **Tamper-evident at rest** | Peer head เก็บ hash chain ของ opId ทุกตัว → เขียนทับ op blob เก่า = fail ตอน `open()` |
| **Deterministic merge** | LWW เรียง `(at, peer, seq)` → replica ไหนก็ตามที่มี ops เดียวกัน คำนวณค่าเหมือนกัน |
| **Encrypted at rest** | Op log + metadata อยู่ใน vault → USB หายไม่รั่วข้อมูล |
| **Rollback evidence** | `anchor()` / `checkAnchor()` เข็ม root ไปยัง append-only log → ตัด store = มองเห็น |

---

## รหัสข้อผิดพลาด (failure codes = contract)

```ts
import { FabricError } from 'sovereign-fabric';
try { await home.import(bytes); } catch (e) { if (e instanceof FabricError) console.error(e.code); }
```

| Code | หมายความ |
|------|---------|
| `invalid-peer` | ชื่อ peer ผิด format, หรือ vault ผูก peer อื่นอยู่แล้ว |
| `invalid-op` | op มีฟิลด์ไม่รู้จัก, seq ไม่ต่อเนื่อง, value ใหญ่เกิน |
| `invalid-bundle` | ไบต์ไม่ใช่ bundle รุ่นนี้, หรือ body malformed |
| `bundle-too-large` | > 8 MiB, หรือ > 5 000 ops |
| `untrusted-peer` | ไม่มี pinned key สำหรับ sender, หรือ relay peer ไม่รู้จัก |
| `signature-invalid` | receipt ไม่เซ็น body นี้, หรือเซ็นด้วย key อื่น |
| `wrong-recipient` | bundle ถูก address ให้ peer อื่น |
| `gap` | bundle เริ่มหลัง op ที่ receiver ยังไม่มี |
| `fork` | `(peer, seq)` นี้มี op ตัวอื่นอยู่แล้ว |
| `rollback` | sender/local head ขัดแย้ง history ที่มีอยู่ |
| `receipt-required` | เซ็น bundle ไม่ได้ → ไม่ export อะไรเลย |

**Import fails closed**: dry-run ทั้ง bundle กับ virtual head map **ก่อน** เขียน op ตัวแรก → bundle ผิดไม่สลาย state

---

## ขีดจำกัด (limits)

| ขีดจำกัด | ค่า | เหตุผล |
|-----------|-----|--------|
| Bundle size | 8 MiB | ใส่ USB/QR ได้ |
| Ops per bundle | 5 000 | กัน DoS |
| Value per key | 64 KiB canonical JSON | sync file ≠ data dump |
| Peers in heads/since | 64 | memory footprint คงที่ |
| Peer id | `^[a-z][a-z0-9._:-]{0,63}$` | deterministic, ง่ายต่อ receipt |
| Key name | `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` | path-safe, human-readable |

ค่าที่ใหญ่กว่าให้เก็บใน vault เป็น artifact แล้วใส่ hash ใน op

---

## สิ่งที่ fabric **ไม่** ทำ

- ❌ ย้ายไบต์ (เขียนไฟล์, เข้ารหัส USB, เลือก courier = งานของคุณ)
- ❌ Merge field-level (op = หน่วย; ค่าใหม่ทั้งก้อนชนะ)
- ❌ ซ่อน traffic analysis (bundle แสดง sender/recipient/heads ใน plaintext ภายใน signature)
- ❌ รับ key ครั้งแรก (pinning = จุดประสงค์, เปลี่ยน key = pin ใหม่, bundle เก่ายัง refused)

---

## API หลัก

```ts
import { Fabric } from 'sovereign-fabric';

const home = await Fabric.open({ vault, peer: 'home-a', keyId: 'fabric' });
await home.trust('home-b', '-----BEGIN PUBLIC KEY-----\n...');  // pin ครั้งเดียว

await home.set('pump.mode', 'auto');
await home.set('note.today', { rainMm: 12 });

const bytes = await home.export({ to: 'home-b' });  // delta ถ้ามี cursor
// ... ส่ง bytes ไป home-b ...
const report = await homeB.import(bytes);
// { from: 'home-a', accepted: 2, skipped: 0, heads: { 'home-a': 2 } }
```

| เมธอด | ใช้เมื่อไหร่ |
|--------|-----------|
| `open({vault, peer, keyId?, now?})` | เริ่มต้น/เปิดซ้ำ (ผูก vault กับ peer) |
| `peer()` | ชื่อตัวเอง |
| `publicKey()` | PEM ให้อีกฝั่ง pin |
| `trust(peer, publicKey)` | pin public key ของ peer |
| `untrust(peer)` | ถอน pin |
| `trusted()` | รายชื่อ peer ที่ pin ไว้ |
| `set(key, value)` | เขียนค่า (append op) |
| `delete(key)` | ลบ (append delete-op) |
| `get(key)` / `has(key)` / `entries()` | อ่าน state ปัจจุบัน (LWW) |
| `heads()` | `{ peer: seq }` สำหรับ debug/sync |
| `ops()` | op ทั้งหมดเก่าสุด→ใหม่สุด |
| `export({to?})` | สร้าง bundle bytes (delta ถ้าระบุ `to`) |
| `import(bytes)` | verify + apply, คืน `{accepted, skipped, heads}` |
| `anchor(log)` / `checkAnchor(log, root?)` | pin root ไป log ภายนอก / ตรวจจับ rollback |

---

## การทดสอบ (verify)

```bash
npm ci
npm run lint
npm run typecheck
npm run format:check
npm run test:coverage   # 51 tests, thresholds 90/90/90/80
npm run build
npm run example
```

- **51 tests**: tampering, forged receipts, replay, gaps, forks, rollback, relays, impostor keys, damaged metadata, byte budgets
- **Red-first proven**: ยิง mutant `ingest()` ให้ verify ด้วย key ที่มาพร้อม bundle → test "impostor" แดง → คืนไฟล์ → เขียว
- **Example**: 2 ครัวเรือน sync ผ่านไฟล์ → converge บน `pump.mode = 'scheduled'`

---

## ตำแหน่งใน Roadmap

- **§5.3 → FABRIC-001** (milestone แรกของ multi-writer / peer-to-peer sync)
- ปลดล็อกข้อจำกัดของ `sovereign-agents` (writer เดียวต่อ vault) → agent หลายตัวบน peer ต่างเขียน vault เดียวกันได้
- งานถัดไป: **ENERGY-001** (`sovereign-energy`) — พยากรณ์/ตัดสินใจจากข้อมูล local ที่เข้ารหัส

---

## License

MIT — เป็นส่วนหนึ่งของ Sovereign OS