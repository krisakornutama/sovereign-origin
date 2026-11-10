# Sovereign OS — Roadmap 2026 → 2036

เอกสารนี้คือทิศทาง 10 ปีของ Sovereign OS เขียนจากสถานะจริงของโค้ดและ repo ที่มีอยู่
(ไม่ใช่ wishlist) เป้าหมายคือทำให้ระบบ "อยู่นอก cloud ได้จริง, ทนต่อการสูญหาย,
ตรวจสอบย้อนหลังได้, และอยู่ต่อได้เกินอายุของผู้ดูแล"

- ปรับปรุงล่าสุด: 2026-11-09
- สถานะ: living document — แก้ได้ทุกครั้งที่ milestone เปลี่ยน
- หลักการที่ห้ามละเมิด: offline-first · self-hosted · zero-cloud-by-default · signed-everything · data-portable

---

## 1. สินทรัพย์ที่มีอยู่แล้ว

| Repo | บทบาทในระบบ | สถานะ |
| --- | --- | --- |
| `sovereign-origin` | Home OS แกนกลาง: 38 modules, core-api (Express + Prisma), dashboard (Next.js), Ollama, MQTT/EMQX, UPS, Telegram | 994 tests ผ่าน, single-node docker compose |
| `sovereign-rule-engine` | ชั้นตัดสินใจ offline-first + P2P E2EE (Ed25519 + X25519 + HKDF + XChaCha20-Poly1305, Merkle-DAG, LWW CRDT) | coverage ~99%, CI + diff coverage gate |
| `sovereign-pq-identity` | ตัวตน post-quantum: Ed25519 + ML-DSA-44 (FIPS 204), dual-signed receipts | ใช้งานได้, ยังไม่ผูกกับ session layer |
| `sovereign-offgrid` | PWA offline, LAN mesh, POS + Ed25519 receipt, Web NFC/BLE | ใช้งานได้ |
| `sovereign-dms` | Out-of-band dead-man switch (ESP32-S3 + SIM7600G / Pi Zero) | ใช้งานได้ |
| `project-sovereign` | POS/บัญชี/ภาษีไทย + ฟาร์ม IoT — สนามทดสอบตลาดจริง | ใช้งานจริง |
| `ev-csms` | OCPP charge point management (Go) | เริ่มต้น |
| `finance-screener-th`, `thai-buddha-ai-search`, `Smart-Agri` | AI/ข้อมูลเฉพาะทางแบบ offline (RAG, MLP, screening) | ใช้งานได้ |

---

## 2. ช่องว่างที่ต้องปิด (พร้อมหลักฐานจากโค้ด)

1. **Crypto ยัง classical ที่ชั้น session**
   `src/crypto/session.ts` ใช้ Ed25519 + X25519 + HKDF เท่านั้น ขณะที่ ML-DSA อยู่แค่ใน
   `pq-identity` แปลว่า handshake ทั้งหมดยังพังได้เมื่อมี quantum attacker
   → ต้องเป็น hybrid: X25519 + ML-KEM-768 (FIPS 203) ใน KEM, Ed25519 + ML-DSA ใน signature
   และมี algorithm id + version negotiation ตั้งแต่วันนี้

2. **CRDT เป็น LWW register เดียว**
   `src/crdt/engine.ts` เก็บ `Map<key, {value, timestamp, peerId}>` ไม่มี causal metadata
   → concurrent write = lost update, ไม่มี sequence CRDT สำหรับ ledger/text
   → ต้องมี dotted version vector, append-only ledger CRDT, และ deterministic merge policy

3. **State อยู่ใน memory ทั้งหมด**
   Merkle store + CRDT store ไม่มี persistence, ไม่มี at-rest encryption, ไม่มี per-device key,
   ไม่มี group key rotation, ไม่มี backup/restore ที่ verify ได้
   → ทุกอย่างที่เหลือพังถ้าปิดโปรเซส

4. **Sync จำกัดที่ 2 peer**
   `LocalSyncEngine` ผูกกับ peer เดียวต่อ session, ไม่มี relay, ไม่มี multi-writer group,
   ไม่มี sneakernet (USB/QR) และไม่มีการต่อระหว่าง household

5. **Rule engine มีอำนาจเต็มโดยไม่มีการจำกัดสิทธิ์**
   `ActionDispatcher` เรียก action ใดก็ได้เมื่อ rule match
   → เมื่อมี AI agent ตัดสินใจแทน ต้องมี capability token ที่ attenuate/revoke ได้
   และมี human-approval gate สำหรับ action อันตราย

6. **`sovereign-origin` ยัง single-node**
   ไม่มี HA/cold standby ที่ทดสอบแล้ว, ไม่มี TPM/secure boot, ไม่มี signed module registry,
   ไม่มี reproducible build

---

## 3. หลักการออกแบบระยะยาว

- **Crypto agility**: ทุก envelope มี `version` + `alg` id; rotate algorithm ได้โดยไม่ต้อง migrate ข้อมูล
  (key wrapping layer แยกจาก payload encryption)
- **Signed everything**: firmware, module, rule, receipt, backup, release artifact
- **Proof over trust**: ทุกการเปลี่ยนแปลงสำคัญมี Merkle proof / append-only log ที่ตรวจได้ฝั่ง client
- **Offline is the default path**: online เป็น enhancement ไม่ใช่เงื่อนไขการทำงาน
- **Data is the user's**: export ทั้งระบบเป็นไฟล์เดียวได้ทุกเมื่อ และ import กลับได้
- **Succession by design**: ระบบต้องทำงานต่อได้เมื่อเจ้าของหายไป (มรดก/ทีม/ครอบครัว)

---

## 4. Roadmap แบ่ง 3 ระยะ

### ระยะ 1 (2026–2028) — Trust & Durability

เป้าหมาย: ข้อมูลไม่หาย, ปลอมไม่ได้, กู้คืนได้

| งาน | ผลลัพธ์ที่วัดได้ |
| --- | --- |
| Hybrid PQ handshake (X25519 + ML-KEM-768, Ed25519 + ML-DSA-44) | เทสต์ interop ระหว่าง classical-only / hybrid / PQ-only ผ่าน; downgrade ถูกปฏิเสธ |
| `sovereign-vault` (ดู §5.1) | ปิดโปรเซสแล้วเปิดใหม่ ข้อมูลครบ; 2 process เขียนพร้อมกันไม่ lost update; restore จาก backup ได้และ verify Merkle root |
| Sequence CRDT + append-only ledger | concurrent add/remove บน ledger ให้ผล deterministic ทุก replica |
| Device attestation + signed modules | module ที่ไม่ผ่าน signature ไม่ถูกโหลด; TPM-bound key ใช้งานได้ |
| Key recovery / heir key / revocation | กู้ key ด้วย k-of-n shares; revoke device แล้ว sync ถูกปฏิเสธภายใน 1 รอบ |
| At-rest encryption ต่อ object | ดิสก์ที่ถูกขโมยอ่านข้อมูลไม่ได้โดยไม่มี device key |

### ระยะ 2 (2028–2031) — Federation & Agents

เป้าหมาย: บ้านคุยกับบ้านได้โดยไม่มี cloud; agent ทำงานแทนได้อย่างควบคุมได้

| งาน | ผลลัพธ์ที่วัดได้ |
| --- | --- |
| `sovereign-fabric`: DID + หลาย transport (LAN/WiFi mesh/LoRa/4G/sneakernet USB-QR) | sync ระหว่าง 2 บ้านผ่าน USB อย่างเดียวได้; LoRa ส่ง delta ขนาดเล็กได้ |
| Capability tokens (macaroon/Biscuit) ผูกกับ rule/agent | token attenuate แล้วทำได้น้อยลงเท่านั้น; revoke มีผลทันที |
| Agent runtime local (Ollama) + policy sandbox | agent ทุก action มี signed receipt; action ระดับอันตรายต้องอนุมัติจากมนุษย์ |
| Interop: W3C VC, import/export แบบพกพา, bridge Matrix/ActivityPub (opt-in) | VC ที่ระบบออกเอง verify ได้ด้วย library มาตรฐาน |
| `sovereign-energy`: OCPP 2.0.1 + V2G + solar forecast | charge session ถูกบันทึกและ settle ด้วย receipt ที่ตรวจสอบได้ |
| Observability local-first | metric/log/anomaly ทำงานได้โดยไม่มี SaaS |

### ระยะ 3 (2031–2036) — Succession & Assurance

เป้าหมาย: ระบบอยู่ต่อได้เกินอายุเจ้าของ และพิสูจน์ความถูกต้องได้

| งาน | ผลลัพธ์ที่วัดได้ |
| --- | --- |
| `sovereign-succession`: DMS v2 หลายช่องทาง + time-locked access + multi-party inheritance | จำลองเจ้าของหาย 90 วัน: ระบบยังทำงาน, ผู้สืบทอดเข้าถึงได้ตาม policy |
| Crypto migration ในทางปฏิบัติ | เปลี่ยน algorithm ทั้งระบบด้วยคำสั่งเดียว และย้อนกลับได้ |
| Formal verification จุดวิกฤต (TLA+/Alloy) | protocol state machine และ ledger invariants ผ่าน model check |
| Chaos + soak 30 วัน | ไม่มี data loss, recovery time < 5 นาที |
| Module marketplace + conformance kit + ชุดฮาร์ดแวร์อ้างอิง | third-party module ที่ผ่าน conformance ติดตั้งได้โดยไม่ต้องแก้ core |

---

## 5. Spec โปรเจกต์ถัดไป (เรียงตาม leverage)

### 5.1 `sovereign-vault` — durable encrypted multi-writer store (ทำก่อน)

**ทำไมก่อน**: rule-engine เก็บ state ใน memory และ sync ได้ 2 peer; federation, agents,
ledger, backup ทั้งหมดต้องพึ่งชั้นนี้

- **Scope**
  - Encrypted persistence (per-object key + envelope version + alg id)
  - Multi-writer CRDT (dotted version vector + LWW/sequence policy ต่อ type)
  - Group/device key management + rotation + revocation
  - Backup/restore + Merkle root verification + cold standby replication
  - Isomorphic `Uint8Array` API แบบเดียวกับ rule-engine (Node + browser/PWA)
- **Milestones**
  1. M1: persist/load + at-rest encryption + tamper detection (fail closed)
  2. M2: 2-process concurrent write ไม่ lost update + deterministic merge
  3. M3: backup → restore → verify root + cold standby replay
  4. M4: key rotation/revocation + heir key share
- **Non-goals**: cloud sync, server-side search, real-time collaboration UI
- **Acceptance**: ทดสอบ crash ระหว่างเขียนแล้ว reopen ได้ state ที่ consistent; ไม่มี plaintext บนดิสก์;
  ทุก blob ตรวจ Merkle proof ได้

### 5.2 `sovereign-attest` — trust chain ของอุปกรณ์และโมดูล

- Device attestation (TPM 2.0 / Secure Element), secure boot, signed firmware
- Module registry + signature verification ก่อนโหลด
- Reproducible build + in-toto/SLSA provenance สำหรับ release artifact
- **Milestone แรก**: ปฏิเสธการโหลด module ที่ signature ผิด และพิสูจน์ได้ด้วยเทสต์

### 5.3 `sovereign-agents` — agent ที่ถูกจำกัดสิทธิ์

- Agent runtime บน Ollama + tool calling ที่ผ่าน policy
- Capability token ต่อ agent/rule, approval workflow, signed receipt ทุก action
- Rule engine ทำหน้าที่เป็น guardrail (ไม่ใช่แค่ trigger)
- **Milestone แรก**: agent ขอ action นอก scope แล้วถูกปฏิเสธพร้อม audit log

### 5.4 `sovereign-fabric` — federation ระหว่าง household

- DID-based trust, multi-transport, relay แบบ zero-knowledge, sneakernet sync
- **Milestone แรก**: sync 2 instance ผ่านไฟล์ USB (export/import delta + verify) ได้

### 5.5 `sovereign-energy` — ต่อยอด `ev-csms`

- OCPP 2.0.1, V2G, solar forecast, settlement ด้วย receipt
- **Milestone แรก**: charge session → signed receipt → ตรวจยอดกับ meter ได้

### 5.6 `sovereign-succession` — ต่อยอด `sovereign-dms`

- DMS หลายช่องทาง (4G + LoRa + satellite), time-locked access, multi-party inheritance
- **Milestone แรก**: จำลอง heir access ตาม policy โดยไม่ต้องมีเจ้าของออนไลน์

---

## 6. บริบทไทยที่ต้องฝังตั้งแต่ต้น

- **PDPA**: data minimization, consent record, right to deletion, breach log
- **e-Tax Invoice / ใบกำกับภาษีอิเล็กทรอนิกส์**: signed receipt + ตรวจสอบย้อนหลังได้
- **การเก็บเอกสาร 5 ปี**: retention policy + legal hold + time-travel audit
- **ETDA / Thai Digital ID**: เป็น identity bridge แบบ opt-in ไม่ใช่ dependency
- **PromptPay reconciliation**: จับคู่ยอดอัตโนมัติจาก slip/receipt ที่ลงนามแล้ว
- **ข้อจำกัดหน้างาน**: อินเทอร์เน็ตไม่เสถียร, ไฟดับ, เครื่องราคาถูก (arm64, RAM 2GB)

---

## 7. ตัวชี้วัดความสำเร็จระยะยาว

| ปี | ตัวชี้วัด |
| --- | --- |
| 2028 | ติดตั้งใหม่แล้วกู้ข้อมูลจาก backup ได้ 100% ในเทสต์; ไม่มี plaintext บนดิสก์ |
| 2031 | 2 บ้าน sync กันได้โดยไม่มี cloud; agent ทุก action มี signed receipt |
| 2036 | ระบบทำงานต่อได้ 90 วันหลังเจ้าของหาย; ทุก release artifact reproduce ได้ |

## 8. ความเสี่ยงและวิธีรับมือ

- **Scope creep จาก 38 modules** → ทุก module ใหม่ต้องผ่าน gate: signed, tested, documented, removable
- **Crypto ตกรุ่น** → agility layer + annual crypto review + algorithm sunset plan
- **ฮาร์ดแวร์พัง/ไฟดับ** → UPS + checkpoint + cold standby + restore drill รายไตรมาส
- **Bus factor = 1** → reproducible build, ops runbook, succession policy, heir key
- **กฎหมายเปลี่ยน** → แยก policy layer ออกจาก core; compliance เป็น module ที่ถอดได้

---

## 9. ลำดับที่แนะนำ

`sovereign-vault` → `sovereign-attest` → `sovereign-agents` → `sovereign-fabric` → `sovereign-energy` → `sovereign-succession`

เหตุผล: vault ปลดล็อกทุกอย่าง; attest ทำให้ของที่โหลดเข้ามาเชื่อถือได้; agents ต้องมีทั้ง vault และ attest;
fabric ต้องมี identity + vault; energy/succession เป็น use case ที่พิสูจน์ว่าทั้ง stack ทำงานจริง

---

## 10. บันทึกความคืบหน้า (append-only — ห้ามลบ)

ส่วนนี้เป็น log ต่อท้ายเท่านั้น: บันทึกว่า milestone ไหนปิดแล้วด้วยหลักฐานอะไร
รายละเอียดคิวและงานที่ยังเปิดอยู่ดูที่ [`LIVING-QUEUE.md`](./LIVING-QUEUE.md)

### 2026-11-10 — `sovereign-vault` M1 + M2

- **M1 (VAULT-001–003)**: envelope v1 (AES-256-GCM ต่อ object, HKDF-SHA256, AAD = header ‖ key),
  encrypted index + serialized writes, `verifyAll`, `FileBlobStore` atomic rename,
  snapshot API (versioned + checksum) สำหรับ state ของ rule engine
  → repo <https://github.com/krisakornutama/sovereign-vault> commit `609d006` · CI `42628286788` เขียว (Node 20/22)
- **M2 (VAULT-004)**: anchor log แบบ hash-chain (`MemoryAnchorLog` / `BlobAnchorLog`) + `expectedRoot` pin
  → ตรวจจับการถอย store ทั้งชุดด้วย `VaultRollbackError`; 64 tests, coverage 98.84/97.98/98.78/99.38
  → commit `8be1fbb`
- **ข้อจำกัดที่ยังเปิด**: anchor เป็น checkpoint ที่เรียกเอง; ถ้าไม่มี anchor/pin ที่เก็บนอก vault
  ยังแยก backup เก่าออกจาก store ที่ถูกล้างไม่ได้ · group key/rotation = M3 (`VAULT-006`)
- **งานถัดไปที่ผูกไว้แล้ว**: `VAULT-005` ต่อ `saveSnapshot` เข้า `sovereign-rule-engine`,
  `VAULT-007` anchor checkpoint อัตโนมัติ (nightly)
