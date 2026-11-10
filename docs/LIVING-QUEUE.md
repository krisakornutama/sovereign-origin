# LIVING QUEUE — คิวงานถาวรของ Sovereign OS

> **สถานะไฟล์: APPEND-ONLY — ห้ามลบ ห้ามเขียนทับ ห้ามจัดเรียงใหม่**
> ไฟล์นี้เป็นข้อปฏิบัติหลัก (operating practice) ไม่ใช่เอกสารชั่วคราว
> เพิ่มได้อย่างเดียว: ต่อท้ายคิวใหม่, เติมหลักฐานในแถวเดิม, หรือเปลี่ยนสถานะเป็น `closed` / `superseded`
> ถ้าต้องการเล่าใหม่ทั้งย่อหน้า ให้เพิ่ม entry ใหม่ที่อ้าง entry เก่า — อย่าแก้ข้อความเดิม
> ประวัติคิวรุ่นก่อนหน้า (Reddit launch ฯลฯ) อยู่ใน `QUEUE.md` และ `QUEUE-ARCHIVE.md` และต้องคงอยู่เช่นกัน

อัปเดตล่าสุด: 2026-11-10 · เจ้าของ: krisakornutama · ใช้ร่วมกับ `AGENTS.md` ข้อ 9

---

## 1. กฎการใช้งาน (บังคับทุก session ของ agent)

1. **ห้ามลบ entry** ไม่ว่าสถานะใด — งานที่ถูกยกเลิกให้ใส่ `dropped` พร้อมเหตุผล ไม่ใช่ลบทิ้ง
2. **ห้ามแก้ประวัติ**: ข้อความของ entry เดิมเป็น immutable; สิ่งที่แก้ได้คือช่อง `สถานะ`, `หลักฐาน`, `ปิดเมื่อ`
3. **ทุกงานใหม่ต้องมี ID** รูปแบบ `<PREFIX>-<เลข 3 หลัก>` (เช่น `VAULT-004`) และต้องมี `ที่มา` ว่ามาจาก roadmap ข้อไหนหรือคำสั่งเจ้าของ
4. **ทุก session ที่ส่งงานขึ้น GitHub ต้องเติมหลักฐาน**: commit sha, ลิงก์ PR/CI run, ตัวเลข coverage — ใช้ `node -e` อ่าน JSON จาก `gh` แทน `jq`
5. **ก่อนปิดงานต้องมีเทสต์ที่ commit ไว้** (ตาม `AGENTS.md` ข้อ 8) — entry ที่ไม่มีหลักฐานให้คงสถานะ `in-progress`
6. **คิวเป็นแหล่งความจริงเดียวของลำดับงาน**: ถ้า entry ไม่อยู่ในไฟล์นี้ ให้ถือว่ายังไม่ได้รับอนุมัติให้ทำ
7. **ห้ามลบไฟล์นี้หรือเปลี่ยนชื่อ** แม้จะย้าย repo — ถ้าย้าย ให้เหลือไฟล์ stub ที่ชี้ไปที่ใหม่

### รูปแบบ entry

```md
| ID | รายการ | ที่มา | สถานะ | หลักฐาน |
|----|--------|-------|-------|---------|
| VAULT-004 | <สิ่งที่ทำ> | ROADMAP §6 | done 2026-11-10 | `8be1fbb` · CI 42628600000 |
```

สถานะที่อนุญาต: `queued` · `in-progress` · `blocked` (ระบุผู้ปลดบล็อก) · `done` · `dropped` (ระบุเหตุผล)

---

## 2. คิวงานปัจจุบัน

### 2.1 Sovereign Vault (M1 + M2 ส่งมอบแล้ว)

Repo: <https://github.com/krisakornutama/sovereign-vault> · เริ่มจาก roadmap §6 ลำดับที่ 1

| ID         | รายการ                                                                              | ที่มา             | สถานะ           | หลักฐาน                                   |
| ---------- | ----------------------------------------------------------------------------------- | ----------------- | --------------- | ----------------------------------------- |
| VAULT-001  | Envelope v1: AES-256-GCM ต่อ object, HKDF-SHA256, AAD = header ‖ ชื่อ key           | ROADMAP §6        | done 2026-11-10 | `609d006` · CI `42628286788` (Node 20/22) |
| VAULT-002  | Encrypted index + serialized writes + `verifyAll` + `FileBlobStore` atomic rename    | ROADMAP §6        | done 2026-11-10 | `609d006` · 46 tests                      |
| VAULT-003  | Snapshot API สำหรับ rule engine (versioned + SHA-256 checksum)                       | ROADMAP §6        | done 2026-11-10 | `609d006` · 46 tests                      |
| VAULT-004  | Anchor log แบบ hash-chain + pinned root → ตรวจจับ rollback ทั้ง store                | ROADMAP §6 (M2)   | done 2026-11-10 | `8be1fbb` · 64 tests · cov 98.84/97.98/98.78/99.38 |
| VAULT-005  | ต่อ `saveSnapshot` จริงเข้ากับ `sovereign-rule-engine` (boot → load, รอบ sync → save) | ROADMAP §6        | queued          | —                                         |
| VAULT-006  | Group key: หลายอุปกรณ์ใช้ vault เดียวกัน, rotation + revocation                     | ROADMAP §6 (M3)   | queued          | —                                         |
| VAULT-007  | Anchor checkpoint อัตโนมัติ (nightly task เขียน root ลง log นอก store)               | VAULT-004 ต่อยอด  | queued          | —                                         |
| VAULT-008  | Streaming/CHUNK envelope สำหรับไฟล์ใหญ่ (>64 MiB) แบบไม่โหลดทั้งก้อน               | ROADMAP §6        | queued          | —                                         |

**ข้อจำกัดที่ยังเปิดอยู่ (ห้ามลบ):** anchor เป็น checkpoint ที่เรียกเอง ไม่ได้ผูกทุก `put`; ถ้าไม่มี anchor หรือ pin ที่เก็บนอก vault จะยังแยก backup เก่าออกจาก store ที่ถูกล้างไม่ได้

### 2.2 โปรเจ็กต์ถัดไปในสายผลิตภัณฑ์

| ID        | รายการ                                                                 | ที่มา        | สถานะ | หลักฐาน |
| --------- | ---------------------------------------------------------------------- | ------------ | ----- | ------- |
| ATTEST-001 | `sovereign-attest`: signed receipt + artifact provenance (ใช้ vault เก็บ key) | ROADMAP §6   | queued | —       |
| AGENT-001  | `sovereign-agents`: agent action ทุกตัวมี signed receipt ก่อนแตะข้อมูล  | ROADMAP §6   | queued | —       |
| FABRIC-001 | `sovereign-fabric`: 2-peer sync แบบไม่พึ่ง cloud บน CRDT + anchor log   | ROADMAP §6   | queued | —       |
| ENERGY-001 | `sovereign-energy`: พยากรณ์/ตัดสินใจจากข้อมูล local ที่เข้ารหัส         | ROADMAP §6   | queued | —       |
| SUCC-001   | `sovereign-succession`: heir key + policy ให้ระบบอยู่ต่อหลังเจ้าของหาย   | ROADMAP §6   | queued | —       |

### 2.3 Sovereign OS core — ความปลอดภัยและความจริงของระบบ

ที่มา: คำสั่งเจ้าของ 2026-11-10 (โฟกัส "ใช้งานง่าย · ตอบเป้าหมาย offline-first · กันโจมตีทางไซเบอร์ · มีระบบจัดการครบ" ก่อนปิด Cold Soak) — งานชุดนี้แก้เฉพาะช่องโหว่/ข้อมูลปลอมใน UI ไม่แตะ runtime หรือ migration

| ID           | รายการ                                                                                                                     | ที่มา                                       | สถานะ                                          | หลักฐาน                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| SEC-001      | P0: `POST /api/auth/rate-limit/clear` ต้องผ่าน MFA เต็มขั้น + audit `RATE_LIMIT_CLEAR`; parser 25 MB ของ `/api/clone/import` ย้ายไปหลัง auth | คำสั่งเจ้าของ (security audit 2026-11-10)   | done 2026-11-10                                 | `ca4ce33` · PR #60 · tests 8/8 · `npm run verify` 6/6                  |
| SEC-002      | P1: SSRF guard ให้ vision `analyze-url` (LAN camera ยังใช้ได้, loopback/metadata/redirect ปิด); `GET /api/backup` + `processes/kill` = SUPERADMIN; actuation ปฏิเสธ `SYSTEM_AI`; MFA disable ต้องยืนยันรหัสผ่านปัจจุบัน + audit | คำสั่งเจ้าของ (security audit 2026-11-10)   | in-progress (PR #61 รอ CI)                      | `6fcdc04` (แก้ตาม CI: `c3e8d19`) · PR #61 · tests 68/68 · verify 6/6    |
| SYSTRUTH-001 | หน้า `/system` เลิก hardcode "● Running" — เพิ่ม `GET /api/system/services` probe DB/MQTT/Ollama จริงพร้อม timeout และแสดง `down`/`ไม่ทราบสถานะ` ตามจริง | คำสั่งเจ้าของ (ใช้งานง่าย/ตอบความจริงของระบบ) | in-progress (branch `ai/production-truth-ui`)   | เทสต์ `tests/systemServices.test.ts` 5/5 · หลักฐานแดง 404 ≠ 401 ก่อนเพิ่ม route |

**ข้อจำกัดที่ยังเปิดอยู่ (ห้ามลบ):** `SYSTEM_AI` ยังถือ JWT ได้ตามปกติ — การกันอยู่ที่ route ที่สั่ง actuator ต้องขยายไปทุก endpoint ที่แตะฮาร์ดแวร์เมื่อเพิ่ม endpoint ใหม่; recovery ของเจ้าของที่ล็อก MFA ต้องทำที่เครื่อง/คอนเทนเนอร์ (ยังไม่มี UI สำหรับ recovery ระดับเครื่อง)

---

## 3. แนวคิดที่จองไว้ (ยังไม่เริ่ม — ห้ามลบ)

ไอเดียที่อาจได้ใช้ทั้งตอนนี้และในอนาคต บันทึกไว้เพื่อไม่ให้หล่นหาย; การมี entry ที่นี่ไม่ถือว่าอนุมัติให้ทำทันที

| ID        | แนวคิด                                                                                       | ทำไมมีค่า                                                      |
| --------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| IDEA-001  | Content-defined chunking + dedupe ภายใน vault โดยไม่รั่วขนาดไฟล์ผ่าน index                    | backup หลายรุ่นไม่กินดิสก์ซ้ำ และไม่เปิดเผยความต่างของไฟล์     |
| IDEA-002  | Merkle root ของทั้ง vault ต่อ snapshot → proof ว่ารุ่นหนึ่งมาจากอีกรุ่นหนึ่งโดยไม่ต้องโหลดทั้งหมด | sync ระหว่างอุปกรณ์ตรวจ lineage ได้ถูกกว่าเต็มก้อน            |
| IDEA-003  | Key rotation แบบไม่ต้อง rewrite blob: envelope v2 เก็บ key epoch แล้ว re-wrap key เดิม        | เปลี่ยน master key ได้โดยไม่แตะข้อมูลจำนวนมาก                  |
| IDEA-004  | Anchor log แบบ witness ภายนอก (ไฟล์บน USB / เครื่องที่สอง / transparency log)                  | rollback ที่ attacker เขียนทั้ง store และ anchor ในเครื่องเดียว |
| IDEA-005  | Encrypted audit trail: ทุก mutation มี signed receipt ที่ verify ย้อนหลังได้                    | ตรวจย้อนหลังว่า agent ตัวไหนแก้อะไร เมื่อไร                     |
| IDEA-006  | Snapshot แบบ incremental (base + delta) สำหรับ CRDT ของ rule engine                          | ลดเวลา boot และพื้นที่เก็บเมื่อ state โต                         |
| IDEA-007  | Quota/retention policy ต่อ key prefix (PDPA 5 ปี, e-Tax) ฝังใน index metadata                  | บังคับ retention โดยไม่ต้องพึ่ง cron ภายนอก                     |
| IDEA-008  | Recovery drill อัตโนมัติ: restore จาก backup + verify anchor ทุกไตรมาส                         | พิสูจน์ว่า backup กู้ได้จริง ไม่ใช่แค่มีไฟล์                     |
| IDEA-009  | Runtime-agnostic crypto adapter (WebCrypto / node:crypto / HSM) โดย API เดียว                  | ใช้บนเครื่องราคาถูกและบน HSM โดยไม่แยกโค้ด                       |
| IDEA-010  | `sovereign-vault` CLI: `init`, `put`, `get`, `anchor`, `verify` สำหรับคนที่ไม่มีโค้ด            | ใช้งานหน้างาน/กู้ข้อมูลโดยไม่ต้องเขียนสคริปต์                     |

---

## 4. การเชื่อมกับ roadmap

- ลำดับหลัก: `sovereign-vault` → `sovereign-attest` → `sovereign-agents` → `sovereign-fabric` → `sovereign-energy` → `sovereign-succession` (ROADMAP §9)
- ทุก entry ในไฟล์นี้ต้องอ้าง `ROADMAP §...` หรือ IDEE ที่มีอยู่ เพื่อไม่ให้คิวแตกแขนงออกจากแผน 10 ปี
- เมื่อ milestone ปิด ให้เพิ่มแถวใน `docs/ROADMAP_2036.md` §10 (append-only log) และคง entry เดิมไว้ที่นี่

## 5. ประวัติของไฟล์นี้ (append-only)

- 2026-11-10 — สร้างไฟล์; บันทึก M1/M2 ของ `sovereign-vault` พร้อมหลักฐาน commit/CI; ตั้งกฎ append-only เป็นข้อปฏิบัติหลักใน `AGENTS.md` ข้อ 9
- 2026-11-10 — เพิ่ม §2.3 งาน core security (`SEC-001`, `SEC-002`) และความจริงของหน้า `/system` (`SYSTRUTH-001`) หลังเจ้าของสั่งโฟกัสความปลอดภัย/ใช้งานง่ายก่อนปิด Cold Soak
