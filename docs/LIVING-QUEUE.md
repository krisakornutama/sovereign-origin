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
| VAULT-005  | ต่อ snapshot เข้ากับ `sovereign-rule-engine`: boot → load, หลังเปลี่ยน rule/sync → save            | ROADMAP §6        | done 2026-11-10 | PR rule-engine #5 · `157bcb6` · CI `42872531142` |
| VAULT-006  | Group key: หลายอุปกรณ์ใช้ vault เดียวกัน, rotation + revocation                     | ROADMAP §6 (M3)   | done 2026-11-10 | PR vault #2 · `0e6f1d5` · CI `42880040950` |
| VAULT-007  | Anchor checkpoint อัตโนมัติ (nightly task เขียน root ลง log นอก store)               | VAULT-004 ต่อยอด  | done 2026-11-10 | PR vault #1 · `00dce9f` · CI `42876459888` |
| VAULT-008  | Streaming/CHUNK envelope สำหรับไฟล์ใหญ่ (>64 MiB) แบบไม่โหลดทั้งก้อน               | ROADMAP §6        | done 2026-11-10 | PR vault #3 · `7a78d83` · CI `42882770489` |
| VAULT-009  | เก็บกวาด orphan chunk (GC) เมื่อเขียน chunk ไม่จบ แล้ว index ไม่เคย commit          | VAULT-008 ต่อยอด  | done 2026-11-10 | PR vault #4 · `3290a44` · CI `42901667670` |

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
| SEC-002      | P1: SSRF guard ให้ vision `analyze-url` (LAN camera ยังใช้ได้, loopback/metadata/redirect ปิด); `GET /api/backup` + `processes/kill` = SUPERADMIN; actuation ปฏิเสธ `SYSTEM_AI`; MFA disable ต้องยืนยันรหัสผ่านปัจจุบัน + audit | คำสั่งเจ้าของ (security audit 2026-11-10)   | done 2026-11-10                                 | `0404d3a` · PR #61 (squash) · tests 68/68 · verify 6/6 · E2E fix `c3e8d19` |
| SYSTRUTH-001 | หน้า `/system` เลิก hardcode "● Running" — เพิ่ม `GET /api/system/services` probe DB/MQTT/Ollama จริงพร้อม timeout และแสดง `down`/`ไม่ทราบสถานะ` ตามจริง | คำสั่งเจ้าของ (ใช้งานง่าย/ตอบความจริงของระบบ) | done 2026-11-10                                 | `85dc09e` · PR #62 (squash) · `tests/systemServices.test.ts` 5/5 · แดง 404 ≠ 401 ก่อนเพิ่ม route · verify 6/6 |
| MFAADMIN-001 | ผู้ดูแลรีเซ็ต 2FA ของสมาชิกที่ทำ authenticator หายได้โดยไม่ต้องเปิด DB console — `POST /api/users/:id/reset-mfa` (SUPERADMIN), audit `USER_MFA_RESET_BY_ADMIN`, ตัด session เดิม (bump `token_version`), รีเซ็ตของตัวเองผ่าน endpoint นี้ไม่ได้; `GET /api/users` ส่งแค่ `mfa_enabled` | คำสั่งเจ้าของ (มีระบบจัดการครบ/ใช้งานง่าย) | done 2026-11-10                                 | `2305ac9` · PR #63 (squash) · `tests/adminResetMfa.test.ts` 5/5 · แดง 404 ≠ 401 / 401 ≠ 403 ก่อนเพิ่ม route · verify 6/6 |
| AUDIT-001    | ส่งออก audit log เป็น CSV (`GET /api/audit/export`, SUPERADMIN) — ตัวกรองเดียวกับรายการ + `from`/`to`, เพดาน 10,000 แถว, UTF-8 BOM, กัน CSV formula injection, เขียน `AUDIT_EXPORT` ทุกครั้งที่ดึงออก และปุ่ม "ส่งออก CSV" ในหน้า `/audit` | คำสั่งเจ้าของ (ตรวจย้อนได้/มีระบบจัดการครบ) | done 2026-11-11                                 | `57ed179` · PR #64 (squash) · `tests/auditExport.test.ts` 5/5 · แดง 404 ≠ 401 / 404 ≠ 200 · verify 6/6 |
| USERS-001    | `POST /api/users` ตรวจ input ก่อนแตะ bcrypt — ไม่ส่ง/รหัสสั้น/รหัสอ่อน/username ว่างหรือ > 64/role นอกรายการ = 400, username ซ้ำ (P2002) = 409; ก่อนหน้านี้ throw ใน async handler ทำให้ request **ค้าง** (Express 4) · ใช้ `AuthService.validateNewPassword` กฎเดียวกับตอนผู้ใช้ตั้งรหัสเอง และ `VALID_ROLES` ชุดเดียวกับ `PUT` | คำสั่งเจ้าของ (ใช้งานง่าย/กันโจมตี) | done 2026-11-11 | `97fd52e` · PR #71 (squash) · `tests/usersInputValidation.test.ts` 8/8 · แดง: ไม่ส่งรหัสผ่าน/username ซ้ำ = timeout, ไม่มีการตรวจความยาว/role เลย · verify 6/6 |
| AUDIT-002    | audit body ปลอดภัย: ปิดความลับทุกชั้น (object/array ไม่ใช่แค่ key ชั้นบน) + จำกัด 4 KB ต่อ body — body 25 MB ของ `/api/clone/import` ไม่ไหลลง `audit_logs` ทั้งก้อนอีก | คำสั่งเจ้าของ (กันโจมตี/ตรวจย้อนได้อย่างปลอดภัย) | done 2026-11-11 | `0a838fe` · PR #69 (squash) · `tests/auditBodySafety.test.ts` 5/5 · แดง 3 เคส (nested/array leak, ไม่มีการตัดขนาด) · verify 6/6 |
| SEC-003      | ล็อกการ verify JWT ให้รับอัลกอริทึมเดียว (`HS256`) ที่จุดเดียว — ก่อนหน้านี้ `jwt.verify` รับ HS512 ที่เซ็นด้วย secret เดียวกันได้ (รวมถึง `alg: none` ต้องถูกปฏิเสธ) ใช้ทั้ง `authenticate`, `authenticatePartial`, socket handshake, automation และ nextgen | คำสั่งเจ้าของ (กันโจมตีทางไซเบอร์) | done 2026-11-11 | `e439f3a` · PR #66 (squash) · `tests/jwtAlgorithmLock.test.ts` 4/4 · หลักฐานแดง 200 ≠ 401 สองจุดก่อนแก้ · verify 6/6 |
| BACKUP-001   | บอกความสดของ backup จริง — `computeBackupStatus` + `GET /api/backup/status` (SUPERADMIN) คืน `lastBackupAt`/`ageHours`/`stale` (เกณฑ์ 26 ชม. ที่เดียว) และแบนเนอร์ในหน้า `/backup` เตือนเมื่อยังไม่เคยสำรอง/ค้างเกินเกณฑ์/ปิดตารางอัตโนมัติ | คำสั่งเจ้าของ (ข้อมูลไม่หาย/ใช้งานง่าย) | done 2026-11-11 | `c423c38` · PR #68 (squash) · `tests/backupFreshness.test.ts` 7/7 · แดง 404 ≠ 401 / 404 ≠ 200 ก่อนเพิ่ม route · verify 6/6 |
| USERS-002    | กันการล็อกตัวเองออกจากระบบที่ระดับ API (ปุ่มที่ UI disable ไม่ใช่ด่าน): `DELETE /api/users/:id` ปฏิเสธลบตัวเอง/`SUPERADMIN` คนสุดท้าย (400) และแปลง FK `P2003`→400, ไม่พบ→404, id ผิดรูป `P2023`→400; `PUT /:id` ลดสิทธิ์ `SUPERADMIN` คนสุดท้ายไม่ได้ · หน้า `/users` แสดงเหตุผลที่ server ปฏิเสธแทนการขึ้นว่าสำเร็จ | คำสั่งเจ้าของ (มีระบบจัดการครบ/ใช้งานง่าย) | done 2026-11-11 | `5578852` · PR #75 (squash) · `tests/userLockoutGuards.test.ts` 9/9 · แดง 5 เคส (ลบตัวเอง/คนสุดท้ายสำเร็จ, 404→500, P2003→500, ไม่มี reason ใน response) · verify 6/6 |
| AUTH-001     | เพดานรหัสผ่านต้องตรงกับสิ่งที่ bcrypt ทำได้จริง — `validateNewPassword` ปฏิเสธรหัสที่ยาวเกิน 72 ไบต์ (เดิมรับถึง 128 ตัวอักษร แล้ว bcrypt ตัดส่วนเกินทิ้งเงียบ ๆ ⇒ รหัสต่างกันท้ายใช้แทนกันได้; อักษรไทย 25 ตัว = 75 ไบต์ก็โดน) ใช้กฎเดียวทั้ง `POST /api/users`, เปลี่ยนรหัสผ่าน และรับคำเชิญ | คำสั่งเจ้าของ (กันโจมตีทางไซเบอร์) | done 2026-11-11 | `3dce1d6` · PR #73 (squash) · `tests/passwordByteLimit.test.ts` 4/4 · แดง: `Missing expected exception` 2 เคส + POST 73 ไบต์สร้างบัญชีได้ · verify 6/6 |
| AUDIT-003    | ค้น audit ด้วยชื่อผู้ใช้ได้จริง — `q` เดิมค้นแค่ `action_type` + `payload::text` แต่ placeholder หน้า `/audit` บอกว่าค้น `somchai` ได้ ⇒ พิมพ์ชื่อคนแล้วได้ผลว่างเสมอ (payload ไม่มี username) · เพิ่มเงื่อนไข `user.username contains (insensitive)` เป็น OR กับผล raw search และคง `actionPrefix`/`from`/`to` เป็น AND · `q` ว่าง = ไม่ยิง query | คำสั่งเจ้าของ (ตรวจย้อนได้/ใช้งานง่าย) | done 2026-11-11 | `d0ec4d3` · PR #76 (squash) · `tests/auditSearchUsername.test.ts` 8/8 · แดง 6 เคส (ไม่มีเงื่อนไข username ทั้งรายการและ export, id hit ไม่ถูกส่งต่อ) · audit suites 18/18 · verify 6/6 |
| SEC-004      | IP spoofing ผ่าน `X-Forwarded-For`: `app.set('trust proxy', 1)` ตายตัว ⇒ `req.ip` มาจาก header ที่ client ใส่เอง(หลบ rate limit login/MFA, ปลอม IP ใน audit) และเปิดให้ผ่านด่าน loopback ของ `POST /api/client-monitor/synthetic-round`โดยไม่ต้องมี `SYNTHETIC_ROUND_TOKEN` — ยัด PASS รัว ๆ เพื่อกลบ FAIL จริงได้ · แก้: env `TRUST_PROXY` (ไม่ตั้ง = ไม่เชื่อ header,ค่าที่ไม่รู้จัก = ปิด), `src/lib/net.ts` (`resolveTrustProxy`/`isLoopbackPeer`/`isLoopbackClient`), ด่าน loopback ตัดสินจาก peer ของ TCP และปิดเองเมื่อเปิด proxy | คำสั่งเจ้าของ (ลองเจาะระบบ + ปิดจุดอ่อน) | done 2026-11-11 | `bc3caf0` · PR #81 (squash) · `tests/trustProxySpoof.test.ts` 10/10 · backend 1958 pass / 0 fail · verify 6/6 |
| SEC-005      |`GET /api/util/qr` เป็น endpoint สาธารณะ (ไม่ต้องล็อกอิน ไม่แตะ DB) แต่ทุกคำขอคือการเข้ารหัส QR + เรนเดอร์ PNG ถึง 1024px ⇒ ใครไม่มีบัญชีก็ยิงวนเผา CPU ได้ไม่จำกัด · แก้: เพดานต่อ IP 240/นาที (`rateLimit`, คีย์เป็น IP ที่เชื่อถือได้หลัง SEC-004) + ตอบ 429 พร้อม `Retry-After` | คำสั่งเจ้าของ (ลองเจาะระบบ + ปิดจุดอ่อน) | done 2026-11-11 | `bc3caf0` · PR #81 (squash) · `tests/qrRateLimit.test.ts` 4/4 · verify 6/6 |
| SEC-006      |`callerIp()` ของ `agent-machines` อ่าน `x-forwarded-for` ตัวแรกเอง ⇒ IP ที่โชว์ในหน้า HUB ปลอมได้เสมอ(และผิดความหมายเมื่อเปิด TRUST_PROXY เพราะ Express เลือก hop ที่ควรเชื่อให้แล้ว) · แก้: ใช้ `req.ip` + `normalizePeerAddress()` จาก `src/lib/net.ts` — ลบโค้ดเดา header ทิ้ง 4 บรรทัดเหลือ 1 | คำสั่งเจ้าของ (ลองเจาะระบบ + ทำโค้ดเรียบง่าย) | done 2026-11-11 | `5985826` · PR #83 (squash) · `tests/machineCallerIp.test.ts` 5/5 · `agentMachinesRoutes`+`agentMachines`+`machineEnroll` 85/85 · verify 6/6 · ไฟล์ routes 992 → 646 บรรทัด |
| SEC-007      |ตรวจแล้วพบ SQL ที่ประกอบสตริงเองใน `$queryRawUnsafe`: `learning-engine.service.ts` (`INTERVAL '${days} days'`) และ `wan-monitor.service.ts` (`'${deviceId}'`, `'${metric}'`) — วันนี้ค่าเหล่านี้มาจากค่าคงที่ภายใน แต่ยังไม่มีอะไรกันไม่ให้ค่าจาก request/router ไหลเข้ามาในอนาคต · เป้าหมาย: เปลี่ยนเป็น `$queryRaw` แบบ parameter ทุกจุดที่ค่าไม่ใช่ค่าคงที่ + เทสต์จับ SQL/parameter ที่ส่งจริง | คำสั่งเจ้าของ (หาจุดโจมตีและปิดจุดอ่อนเชิงรุก) | done 2026-11-11 | `8994a0e` · PR #82 (squash) · `tests/sqlParams.test.ts` 4/4 · backend 1958 pass / 0 fail · verify 6/6 |
| SEC-008      |ช่องควบคุมเครื่องผ่าน Socket.IO ตรวจแค่ role: `control:join` ไม่เรียก `userCanControl()` เลย (HTTP `/machine-control/frame/:id` + `/command` ตรวจทั้ง role และการผูกเครื่อง) ⇒ SUPERADMIN ที่ไม่ได้ผูกเครื่องเข้าห้องได้ รับภาพจอ และสั่ง `control:input`/`control:fs` (อ่าน/เขียน/ลบไฟล์) ได้ · `control:fs`/`control:snapshot`/`control:fps` ก็ไม่บังคับให้ join ก่อนเหมือน `control:input` · แก้: join ต้องผ่าน `canControlMachine()` (ค่าเริ่มต้น = `userCanControl`, เทสต์แทนที่ได้ด้วย `__setControlAuthz`) และทุกคำสั่ง ต้อง join ห้องที่ผ่านการตรวจแล้วก่อน | คำสั่งเจ้าของ (ลองเจาะระบบควบคุม + ปิดจุดอ่อน) | done 2026-11-11 | `dd1d285` · PR #84 (squash) · `tests/machineControlSocket.test.ts` 17/17 (เพิ่มเคส "ไม่ได้ผูกเครื่อง = เข้าห้องไม่ได้" และ "ยังไม่ join = สั่ง fs ไม่ได้") · `machineControl`+`machineControlRoutes`+`machineAccess`+`machineAccessRoutes` 69/69 · verify 6/6 |
| SEC-009      |`POST /api/machine-control/result` รับผลตาม `commandId` โดยไม่เทียบว่าเครื่องที่ส่งคือเครื่องที่ได้รับคำสั่ง ⇒ runner ที่มี token ของเครื่อง A ปลอมผล/เนื้อหาไฟล์ของคำสั่งที่ออกให้เครื่อง B ได้ และปิดคำสั่งนั้นทิ้งก่อนเครื่องจริงจะรับ (ปฏิเสธงาน + ข้อมูลปลอมขึ้นหน้าผู้ควบคุม) · แก้: `peekCommandMachine()` (อ่านอย่างเดียว) ตรวจเจ้าของคำสั่งก่อนรับผล — เครื่องอื่นได้ 403 และคำสั่งยังอยู่ในคิวของเครื่องจริง | คำสั่งเจ้าของ (ลองเจาะระบบ + ปิดจุดอ่อน) | done 2026-11-11 | `cccf057` · PR #85 (squash) · `tests/machineControlRoutes.test.ts` 21/21 (เคสใหม่ล้มก่อนแก้: ผลปลอมถูกปิดคำสั่งจริง) · `machineControlRoutes`+`machineControlSocket` 38/38 · verify 6/6 |
| SEC-010      |OTA (`src/modules/ota/ota.routes.ts`): (1) `GET /firmwares/:file` เปิดให้ใครก็ได้เมื่อไม่ได้ตั้ง `OTA_TOKEN` (ค่าเริ่มต้น) ⇒ ดาวน์โหลดเฟิร์มแวร์ทั้งคลังได้; (2) เทียบ token ด้วย `!==` และส่ง token ทาง query string (ติด log/MQTT/browser history); (3) `/deploy` ประกอบ URL ที่ฝัง token แล้วให้ ESP ดาวน์โหลดผ่าน http — ไม่มีลายเซ็น/HTTPS บังคับ ⇒ ฝั่งบนเส้นทางเสิร์ฟ .bin ปลอมให้อุปกรณ์แฟลชได้; (4) `/events` เปิดให้ทุก role ที่ล็อกอินดูประวัติ OTA ทั้งฟลีต · เป้าหมาย: ตัวเทียบ timing-safe (มีแบบอย่างที่ `isMetricsAuthorized`) + ทางเลือกที่ไม่ฝัง token ใน URL (header/one-time path) + ปิด/จำกัด `/events` ตาม role + เทสต์ | คำสั่งเจ้าของ (ลองเจาะระบบ + ปิดจุดอ่อน) | done 2026-11-11 | `eb3b0d2` · PR #86 (squash) · `tests/otaAccess.test.ts` 4/4 (เขียนก่อนแก้: ล้มเพราะยังไม่มีโมดูล) + `tests/ota.test.ts` 9/9 = 13/13 · verify 6/6 |
| SEC-011      |`GET /api/agent-machines/screenshots/:file` ตรวจแค่ว่าล็อกอิน (comment ในไฟล์เองบอกว่า "ภาพหน้าจอของเครื่องเป็นข้อมูลส่วนตัวของผู้ใช้") ⇒ ผู้ใช้ role ใดก็ได้ที่ล็อกอินและรู้ชื่อไฟล์เปิดภาพจบงานของเครื่องคนอื่นได้ · ชื่อไฟล์มี jobId อยู่ (`job-<jobId>-<เวลา>-<สุ่ม8>.png`) ⇒ แก้: `jobIdFromScreenshotFile()` ดึง jobId → `jobMachineId()` → `userCanControl()` ก่อนเสิร์ฟ (ไม่ตรงรูปแบบ/ไม่พบงาน/ไม่ได้ผูกเครื่อง = 403) | คำสั่งเจ้าของ (ลองเจาะระบบ + ปิดจุดอ่อน) | done 2026-11-11 | `c46d68a` · PR #87 (squash) · `tests/agentMachineScreenshots.test.ts` ใหม่ (แยกเพราะ file-budget 800) + `agentMachinesRoutes`+`machineControlRoutes`+`machineControlSocket` 77/77 · verify 6/6
| SEC-012      |`POST /api/knowledge/import` เรียก `axios.get(url)` กับ URL ที่ผู้ใช้ส่งมาตรง ๆ (ไม่มีด่าน outbound เลย ขณะที่ `/api/vision/analyze-url` ใช้ `outbound-url-guard` ครบ) ⇒ ผู้ใช้ที่ล็อกอินคนเดียวสั่งให้เซิร์ฟเวอร์ยิง `http://127.0.0.1:<port>/api/...`, `169.254.169.254` metadata หรือ `localhost` ได้ แล้วเนื้อหาที่ตอบกลับถูกเก็บเป็น `content` ของ item (อ่านย้อนหลังได้) = อ่าน API ภายใน/credential metadata ผ่านเซิร์ฟเวอร์ · แก้: `assertSafeOutboundUrl()` + `createGuardedLookup()` (กัน DNS rebinding) + `maxRedirects: 0` (302 ไม่ใช่ทางวกกลับ) + เพดานขนาด 8 MB + 3xx/EBLOCKEDADDRESS → 400 | คำสั่งเจ้าของ (ลองเจาะระบบ + ปิดจุดอ่อน) | done 2026-11-11 | `4923a15` · PR #88 (squash) · `tests/knowledgeImportSsrf.test.ts` 2 เคส (ล้มก่อนแก้: loopback ได้ 500) + `knowledgeRoutes` 28/28 = 30/30 · tsc สะอาด · verify 6/6
| SEC-013      |`GET /api/agent-machines` และ `GET /api/agent-machines/queue` ตรวจแค่ `authenticate` แล้วคืน **ทุกเครื่อง** (พร้อม IP ล่าสุด) และ **ทุกงาน** (prompt/ผลลัพธ์/ชื่อผู้สั่ง) ทั้งฟลีต ขณะที่ `/mine` ใช้ `listMachinesForUser()` และช่องควบคุมใช้ `userCanControl()` ⇒ ผู้ใช้ role ที่ไม่ใช่เจ้าของเครื่องเห็นเครื่อง/IP/งานของคนอื่น · เป้าหมาย: กรองด้วยเครื่องที่ผู้ใช้คุมได้ (แบบเดียวกับ `/mine` + `controlStateForUser`) หรือบังคับ SUPERADMIN ถ้า UI เปิดให้เฉพาะ role นั้น + เทสต์ red-first | คำสั่งเจ้าของ (ลองเจาะระบบ + ปิดจุดอ่อน) | done 2026-11-11 | `1f2e571` · PR #89 (squash) · `tests/agentMachinesFleetScope.test.ts` 3 เคส (ล้มก่อนแก้: OPERATOR เห็นเครื่อง/งานของคนอื่น) + `agentMachinesRoutes` + `agentMachineScreenshots` = 42/42 · verify 6/6
| SEC-014      |Upload hardening ยังมีสองช่อง: (1) `verifyUploadedContent()` จับเฉพาะ magic ของ MZ/ELF ⇒ ไฟล์ **Mach-O** (macOS/iOS), **Java class** (0xCAFEBABE) และ **WebAssembly** ผ่านด่านได้ถ้านามสกุลอยู่ใน whitelist ที่ไม่ตรวจ magic (เช่น `.txt`/`.md`) — เนื้อหาเป็นโค้ดที่รันได้บนเครื่องปลายทาง; (2) knowledge upload เป็น disk mode ⇒ ถ้า `prisma.knowledgeItem.create` ล้ม ไฟล์ที่ multer เขียนไว้แล้วค้างบนดิสก์ (ไม่มีแถวอ้างถึง แต่ยังถูกเสิร์ฟถ้ารู้ path และกินที่ไม่มีใครลบ) · แก้: เพิ่มตาราง magic ของโค้ด + cleanup ใน catch | คำสั่งเจ้าของ (ลองเจาะระบบ + ปิดจุดอ่อน) | done 2026-11-11 | `9a54f1c` · PR #90 (squash) · `tests/uploadMagicCleanup.test.ts` 2 เคส (ล้มก่อนแก้ทั้งคู่: magic ผ่านด่าน + ไฟล์ค้างบนดิสก์) + `harden-upload-routes`+`knowledgeRoutes`+`agentMachineScreenshots` = 58/58 · verify 6/6
| SEC-015      |`POST /api/agent-machines/jobs/pull` → `pullJobs()` อ่านงาน `status=queued` แล้ว `prisma.agentJob.update({ where: { id } })` โดย**ไม่ตรวจสถานะเดิม** ⇒ สองคำขอที่ดึงพร้อมกัน (หรือเครื่องเดียวยิงซ้อน) เห็นงานเดียวกันแล้วต่างก็ได้งานไปรัน = งานเดียวถูกสั่งทำสองรอบ (ผลข้างเคียงซ้ำ: เขียนไฟล์/ยิง API/โอนเงินซ้ำ) · แก้: จองด้วย `updateMany({ where: { id, status: 'queued' } })` แล้ว `continue` เมื่อ `count === 0` | คำสั่งเจ้าของ (ลองเจาะระบบ + ปิดจุดอ่อน) | done 2026-11-11 | `4ee6c6d` · PR #91 (squash) · `tests/jobPullClaim.test.ts` 2 เคส (ล้มก่อนแก้ทั้งคู่) + `agentMachines` + `mesh-lite` = 45/45 · verify 6/6
| SEC-016      |ส่วนที่เหลือของ `SEC-010` (คำสั่งเจ้าของ: timing-safe + ไม่ฝัง token ใน URL + จำกัด `/events` ตาม role): (1) `/deploy` ยังประกอบ URL เป็น `...?token=<OTA_TOKEN>` ⇒ token ติดไปใน log ของ proxy/ประวัติ URL/MQTT payload ที่ใครบนวงอ่านได้; (2) `GET /firmwares/:file` รับ token ทาง query เท่านั้น; (3) `GET /events` ตรวจแค่ `authenticate` ⇒ ทุก role เห็นประวัติ OTA ทั้งฟลีต · แก้: รับ `x-ota-token` ทาง header (คง `?token=` ให้อุปกรณ์รุ่นเดิม), deploy ส่ง URL เปล่า + `headers: { x-ota-token }` ใน payload, `/events` = `requireRole('SUPERADMIN')` + frontend ไม่ยิงเมื่อไม่ใช่ SUPERADMIN | คำสั่งเจ้าของ (ปิด SEC-010 ให้ครบ) | done 2026-11-11 | `72dd7e2` · PR #92 (squash) · `tests/otaDeployToken.test.ts` 3 เคส (ล้มก่อนแก้ครบทั้ง 3) + `otaAccess` + `ota` = 16/16 · verify 6/6
| SEC-017      |สวิตช์ปิดการรับ `?token=` ของ OTA (ต่อจาก `SEC-016`): หลัง `SEC-016` อุปกรณ์รุ่นเดิมยังใช้ query token ได้ตลอดไป ⇒ token ยังวนอยู่ใน log/ประวัติ URL ของเครื่องที่ยังไม่อัปเดต · ต้องมีสวิตช์ที่ **ค่าเริ่มต้น = ปฏิเสธ query** และผู้ดูแลเปิดชั่วคราวได้ระหว่างทยอยอัปเดตเฟิร์มแวร์ · แก้: `OTA_ALLOW_QUERY_TOKEN` (เปิดเฉพาะ `1/true/yes/on`), `parseAllowQueryToken()` + `resolveDownloadToken()` แยกเป็นฟังก์ชันล้วน, route อ่านค่าต่อ request, 401 มี hint บอกทางออก | คำสั่งเจ้าของ (ปิดทาง query token) | done 2026-11-11 | `291dd71` · PR #93 (squash) · `tests/otaQueryTokenSwitch.test.ts` 5 เคส (ล้มก่อนแก้: query token ได้ 200 ตามค่าเริ่มต้น) + `otaDeployToken`+`otaAccess`+`ota` = 21/21 · verify 6/6
| SEC-018      |หลัง `SEC-017` (ปฏิเสธ `?token=` เป็นค่าเริ่มต้น) ผู้ดูแลไม่มีทางรู้ว่าอุปกรณ์ตัวไหนยังพยายามใช้ query token อยู่ ⇒ ปิดสวิตช์เร็วเกินอาจทำให้เครื่องค้างรออัปเดต · เพิ่มตัวนับในหน่วยความจำ (`ota.legacy.ts`): นับเฉพาะคำขอที่ส่ง token ทาง query (ไม่บันทึกค่า token), แยก accepted/rejected ตาม ip+user-agent, จำกัด 200 รายการ, และ `GET /api/ota/legacy-clients` (SUPERADMIN, `no-store`) คืน `readyToDisable` อิงการใช้งานใน 24 ชม. | คำสั่งเจ้าของ (รายงาน migration query token) | done 2026-11-11 | `eb39667` · PR #94 (squash) · `tests/otaLegacyClients.test.ts` 4 เคส (ล้มก่อนแก้: ไม่มีโมดูล + endpoint ยังไม่มี) + กลุ่ม ota = 25/25 · verify 6/6 |
| REL-001      |`release.yml` หยุดทันทีถ้า tag ไม่ตรง version และปล่อยรุ่นที่ CHANGELOG ไม่มีหัวข้อ ⇒ รู้ตอน build รอบ 10–20 นาทีเสียไป · และ root/core-api ยังเป็น `1.0.0` ขณะ frontend `1.3.0` (drift จริง) · เพิ่ม `tools/release-check.mjs` + `npm run release:check`: ตรวจ version ตรงกันทุก package, มีหัวข้อ `## [vX.Y.Z] — วันที่`, `[Unreleased]` ว่าง และเขียนแผนปล่อย v1.3.1 (`docs/RELEASE-PLAN-v1.3.1.md`) | คำสั่งเจ้าของ (วางแผนอัพแพท + อัพระบบ) | done 2026-11-11 | `b077f5c` · PR #95 (squash) · `tools/test/release-check.test.mjs` 4/4 (ล้มก่อนแก้: ไม่มีโมดูล; รอบแรกพังเพราะ regex escape เขียนผิดแล้วแก้ให้ผ่านจริง) · verify 6/6 · ตรวจกับรีโปจริง: ฟ้อง drift root/api 1.0.0 + [Unreleased] 11 รายการ |
| REL-002      |ปล่อยแพทช์ `v1.3.1` ที่รวมชุด SEC-008…SEC-018: version ไม่ตรงกัน (root/core-api `1.0.0`, frontend `1.3.0`) และ `[Unreleased]` มี 11 รายการ ⇒ workflow จะปฏิเสธ tag หรือปล่อยรุ่นที่ไม่มีบันทึก · bump ทั้งสาม package เป็น `1.3.1`, ย้ายบล็อก `[Unreleased]` เป็น `## [v1.3.1] — 2026-11-11` (12 รายการ รวม REL-001), regen `changelog.json` · `npm run release:check` exit 0 | คำสั่งเจ้าของ (เตรียม branch release v1.3.1) | done 2026-11-11 | `4a7e87e` · PR #96 (squash) · `release:check` exit 0 (ก่อนแก้ฟ้อง 3 จุด) · verify 6/6 · ยังไม่ push tag `v1.3.1` (รออนุมัติเจ้าของ) |
| REL-003      |`SHA256SUMS.txt` ของ Release `v1.3.1` ใช้ตรวจไฟล์ที่ดาวน์โหลดไม่ได้: manifest เขียน `Sovereign OS-1.3.1-win.zip` (เว้นวรรค) แต่ GitHub เปลี่ยนชื่อ asset เป็น `Sovereign.OS-1.3.1-win.zip` ⇒ `sha256sum -c` ล้มทั้งที่ hash ถูก · เพิ่ม `githubAssetName()` แปลงอักขระที่ใช้ไม่ได้เป็น `.` และใช้ชื่อนั้นตอน stage (ชื่อไฟล์ + ชื่อใน manifest ตรงกับ asset จริง) | คำสั่งเจ้าของ (ตรวจ asset/SHA256SUMS ของ v1.3.1) | done 2026-11-11 | `015477f` · PR #97 (squash) · `release-asset-names` 2/2 + `release-build` 11/11 (ล้มก่อนแก้: ไม่มี export) · verify 6/6 · หลักฐานจริงจาก Release v1.3.1: zip hash ตรง manifest แต่ชื่อไม่ตรง ⇒ `sha256sum -c` ล้ม |
| REL-004      |ปล่อย `v1.3.2` เพื่อให้ `SHA256SUMS.txt` ตรวจ asset ได้ครบ (แก้จาก REL-003 มีผลตั้งแต่ tag ถัดไป): bump สาม package เป็น `1.3.2`, เพิ่มหัวข้อ `## [v1.3.2] — 2026-11-11`, regen `changelog.json` และยืนยันด้วย `sha256sum -c` จาก asset ที่ดาวน์โหลดจริง | คำสั่งเจ้าของ (ออก v1.3.2 + ยืนยัน checksum) | done 2026-11-11 | `04fdc10` · PR #98 (squash) + tag `v1.3.2` · `release:check` exit 0 · verify 6/6 · Release Desktop run `43119537472` success · ดาวน์โหลด asset จริงแล้ว `sha256sum -c`: exe OK, zip OK (exit 0) |
| REL-005      |ยืนยันว่า binary ที่ปล่อย `v1.3.2` รันแล้วรายงาน version ตรงกับ tag (ขั้น 7 ของ `docs/RELEASE-PLAN-v1.3.1.md`): รัน `Sovereign-OS-1.3.2-portable.exe` ด้วย `--user-data-dir` แยก (ไม่แตะข้อมูล/โปรเซสที่ติดตั้งอยู่ 1.2.0) แล้วอ่าน `desktop-shell.log`; ตรวจ `resources/app.asar` package.json ใน zip ด้วย | คำสั่งเจ้าของ (ติดตั้ง + ตรวจ version) | done 2026-11-12 | exe metadata `FileVersion=1.3.2` · asar `package.json` version `1.3.2` · รันจริง log `desktop-shell loaded — version 1.3.2` · ปิดโปรเซสทดสอบครบ 5 ตัว ไม่กระทบอินสแตนซ์เดิม |
| REL-006      |สลับตัวติดตั้งจริงบนเครื่องทดสอบจาก `1.2.0` → `1.3.2`: `find-shadow-installs` ไม่พบสำเนาเงา, ตัวที่รันอยู่คือ `dist-portable/`, ปิดแอปเดิม (4 โปรเซส), ย้ายโฟลเดอร์เดิมเป็น `dist-portable.bak-1.2.0` (rollback), แตก `Sovereign.OS-1.3.2-win.zip` ลง `dist-portable` แล้วเปิดใหม่ด้วย userData เดิม | คำสั่งเจ้าของ (สลับติดตั้ง + ปิด/เปิดแอป) | done 2026-11-12 | exe `FileVersion=1.3.2` · รันจริง `desktop-shell loaded — version 1.3.2` (2026-11-12T09:49:42Z) · `boot: frontend true, api true, packaged true` · 3 โปรเซสจาก `dist-portable` · ของเดิมสำรองที่ `dist-portable.bak-1.2.0` |
| REL-007      |ตรวจว่าแอป `v1.3.2` ที่เพิ่งสลับติดตั้งทำงานครบ (API health, endpoint ใหม่ `ota/legacy-clients`, หน้าจอหลัก): `GET :3001/healthz`, `/api/health`, `/api/ota/legacy-clients` (ไม่ส่ง token = ต้อง 401 ไม่ใช่ 404) และเปิด `localhost:3000` ดู console/network | คำสั่งเจ้าของ (ตรวจแอปหลังอัปเดต) | done 2026-11-12 | `/healthz` 200 `{ok:true}` · `/api/health` 200 `build.fingerprint=ee83dfcfaaf93ed7, files=273, migrationHead=20261110120000_telegram_updates_slot` · `/api/ota/legacy-clients` 401 `Missing token` — แต่ **401 ไม่ได้พิสูจน์ว่ามี route** เพราะ path ที่ไม่มีจริงก็ได้ 401 (auth มาก่อน 404) จึงยืนยันด้วยโค้ดที่ติดตั้งแทน: `dist-portable/resources/core-api/dist/modules/ota/ota.routes.js` มี `legacy-clients` และ `resources/core-api/package.json` = `1.3.2` · UI 200, login gate เรนเดอร์ครบ, console ไม่มี error, asset/health 200 ทั้งหมด |

**ข้อจำกัดที่ยังเปิดอยู่ (ห้ามลบ):** `SYSTEM_AI` ยังถือ JWT ได้ตามปกติ — การกันอยู่ที่ route ที่สั่ง actuator ต้องขยายไปทุก endpoint ที่แตะฮาร์ดแวร์เมื่อเพิ่ม endpoint ใหม่; recovery ของเจ้าของที่ล็อก MFA ต้องทำที่เครื่อง/คอนเทนเนอร์ (ยังไม่มี UI สำหรับ recovery ระดับเครื่อง)

### 2.3 คุณภาพและโครงสร้างพื้นฐาน (QA)

| ID     | รายการ                                                                                                 | ที่มา                        | สถานะ           | หลักฐาน                                                   |
| ------ | ------------------------------------------------------------------------------------------------------ | ---------------------------- | --------------- | --------------------------------------------------------- |
| QA-001 | ทำให้ tools tests เป็น hermetic: offsite/backup ข้ามเฉพาะเมื่อยังไม่ติดตั้งไปป์ไลน์; update-bundle ใช้ ephemeral Ed25519 key | รัน `npm run verify` บนเครื่อง dev | done 2026-11-10 | PR #65 · `3246dd1` · CI `42862080560` (ubuntu + windows) |
| QA-002 | ติดตั้ง/กู้ไปป์ไลน์สำรองนอกเครื่อง (03:00 DB + ~20:30 offsite) บนเครื่อง operational                          | `machine-health` แจ้ง critical | blocked — ต้องทำบนเครื่องที่มี DB/creds จริง                     | —                                                         |
| QA-003 | ปิด tools tests ที่ยังผูกกับไฟล์ local: `tools/*.cmd` (gitignored), Ollama bundle, autostart task           | QA-001 ต่อยอด               | done 2026-11-10 | PR #70 · `npm run verify` ผ่าน 6/6 (exit 0) · tools 1369 pass / 0 fail |

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

- 2026-11-11 — ตั้ง `SEC-016` เก็บส่วนที่เหลือของ `SEC-010` (token ใน URL + `/events` เปิดทุก role) และปิดครบ
- 2026-11-12 — ปิด `REL-007` (ตรวจแอป v1.3.2 ที่ติดตั้ง: API/UI/endpoint ใหม่)
- 2026-11-12 — ปิด `REL-006` (สลับติดตั้งเป็น v1.3.2 บนเครื่องทดสอบ)
- 2026-11-12 — ปิด `REL-005` (ยืนยัน v1.3.2 รันแล้วรายงาน 1.3.2)
- 2026-11-11 — ปิด `REL-004` (ปล่อย v1.3.2 + ยืนยัน SHA256SUMS) ด้วย `04fdc10` + PR #98 + tag `v1.3.2` — ตรวจ asset จริงผ่านทั้ง 2 ไฟล์
- 2026-11-11 — ตั้ง `REL-004` (ปล่อย v1.3.2 + ยืนยัน SHA256SUMS)
- 2026-11-11 — ปิด `REL-003` (ชื่อ asset ↔ SHA256SUMS) ด้วย `015477f` + PR #97 — มีผลตั้งแต่ tag ถัดไป
- 2026-11-11 — ตั้ง `REL-003` (ชื่อ asset ↔ SHA256SUMS ไม่ตรงกัน)
- 2026-11-11 — ปิด `REL-002` (เตรียม release v1.3.1) ด้วย `4a7e87e` + PR #96 — เหลือเฉพาะ push tag
- 2026-11-11 — ตั้ง `REL-002` (เตรียม release v1.3.1)
- 2026-11-11 — ปิด `REL-001` (ด่านพร้อมปล่อย + แผน v1.3.1) ด้วย `b077f5c` + PR #95
- 2026-11-11 — ตั้ง `REL-001` (ด่านพร้อมปล่อย + แผนแพทช์ v1.3.1)
- 2026-11-11 — ปิด `SEC-018` (รายงานผู้ที่ยังใช้ `?token=`) ด้วย `eb39667` + PR #94
- 2026-11-11 — ตั้ง `SEC-018` (ตัวนับ/รายงานผู้ที่ยังใช้ `?token=`) และปิดในรอบเดียวกัน
- 2026-11-11 — ปิด `SEC-017` (ค่าเริ่มต้นปฏิเสธ query token + สวิตช์ชั่วคราว) ด้วย `291dd71` + PR #93
- 2026-11-11 — ตั้ง `SEC-017` (สวิตช์ปิด query token, ค่าเริ่มต้นปลอดภัย) และปิดในรอบเดียวกัน
- 2026-11-11 — ปิด `SEC-016` (ปิดส่วนที่เหลือของ `SEC-010`) ด้วย `72dd7e2` + PR #92
- 2026-11-11 — ปิด `SEC-015` (จองงานไม่ atomic) ด้วย `4ee6c6d` + PR #91
- 2026-11-11 — ตั้ง `SEC-015` (จองงานไม่ atomic ⇒ งานเดียวถูกดึงซ้ำ) และปิดด้วย conditional claim
- 2026-11-11 — ปิด `SEC-014` (magic bytes ไม่ครบ + ไฟล์ค้างเมื่อ DB ล้ม) ด้วย `9a54f1c` + PR #90
- 2026-11-11 — ตั้ง `SEC-014` (magic bytes ไม่ครบ + ไฟล์ค้างเมื่อ DB ล้ม) และปิดทั้งสองจุด
- 2026-11-11 — ปิด `SEC-013` (รายการเครื่อง/คิวงานทั้งฟลีต) ด้วย `1f2e571` + PR #89
- 2026-11-11 — เริ่มแก้ `SEC-013`: กรองรายการเครื่อง/คิวงานด้วย `machineScopeFor()` (SUPERADMIN เห็นทั้งฟลีตเพื่อผูกเครื่องใหม่, role อื่นเห็นเฉพาะเครื่องที่ผูกกับตัวเอง)
- 2026-11-11 — ตั้ง `SEC-013` (รายการเครื่อง/คิวงานทั้งฟลีตเปิดให้ทุก role ที่ล็อกอิน) เป็นคิวถัดไป
- 2026-11-11 — ปิด `SEC-012` (SSRF ที่ knowledge import) ด้วย `4923a15` + PR #88
- 2026-11-11 — ตั้ง `SEC-012` (knowledge import ไม่มีด่าน outbound = SSRF) และปิดด้วย guard ตัวเดียวกับ vision
- 2026-11-11 — ปิด `SEC-011` (ภาพหน้าจอข้ามเครื่อง) ด้วย `c46d68a` + PR #87
- 2026-11-11 — ตั้ง `SEC-011` (ภาพหน้าจอข้ามเครื่อง: ตรวจแค่ล็อกอิน) และแก้ให้ตรวจเจ้าของภาพผ่าน `userCanControl()`
- 2026-11-11 — ปิด `SEC-010` (OTA: ดาวน์โหลดเปิดโล่ง/token เทียบไม่คงเวลา/deploy ผ่าน http สาธารณะ) ด้วย `eb3b0d2` + PR #86
- 2026-11-11 — ตั้ง `SEC-010` (OTA: ดาวน์โหลดเปิดโล่ง, token ใน query, ไม่มีการตรวจลายเซ็น, `/events` เปิดกว้าง) เป็นคิวถัดไป
- 2026-11-11 — ปิด `SEC-009` (ผลคำสั่งข้ามเครื่อง) ด้วย `cccf057` + PR #85
- 2026-11-11 — ปิด `SEC-008` (ช่องควบคุมเครื่องผ่าน socket ตรวจแค่ role) ด้วย `dd1d285` + PR #84; ตั้ง `SEC-009` (รับผลข้ามเครื่อง) เป็นคิวถัดไปของสายความปลอดภัย

- 2026-11-10 — สร้างไฟล์; บันทึก M1/M2 ของ `sovereign-vault` พร้อมหลักฐาน commit/CI; ตั้งกฎ append-only เป็นข้อปฏิบัติหลักใน `AGENTS.md` ข้อ 9
- 2026-11-10 — เพิ่ม §2.3 งาน core security (`SEC-001`, `SEC-002`) และความจริงของหน้า `/system` (`SYSTRUTH-001`) หลังเจ้าของสั่งโฟกัสความปลอดภัย/ใช้งานง่ายก่อนปิด Cold Soak
- 2026-11-10 — ปิด `VAULT-008` (streaming), ตั้ง `VAULT-009` (GC orphan chunk) เป็นคิวถัดไปของสาย vault — แถวเดิมไม่ถูกแก้หรือลบ
- 2026-11-10 — ปิด `VAULT-009` (GC orphan blob) — คิว vault ที่ตั้งไว้ตอนปิด `VAULT-008` ปิดครบแล้ว
- 2026-11-11 — ปิด `USERS-002` (ด่านกันล็อกตัวเองออกจากระบบอยู่ที่ API ไม่ใช่ปุ่มที่ UI disable) พร้อมหลักฐาน commit `5578852` + PR #75; คิวในไฟล์นี้ยังคง append-only — เติมเฉพาะช่องสถานะ/หลักฐานของแถวเดิม
- 2026-11-11 — ปิด `AUDIT-003` (ค้น audit ด้วยชื่อผู้ใช้) ด้วย `d0ec4d3` + PR #76; ตรวจตอน merge แล้วว่าแถว `USERS-002`/`AUTH-001` ที่ main ได้มาระหว่างทางไม่ถูกตัด และแถว `AUDIT-003` อยู่ในตาราง §2.3 ไม่ใช่หลังบรรทัดว่าง
- 2026-11-11 — ปิด `SEC-004` (IP spoofing ผ่าน `X-Forwarded-For` + ด่าน loopback จาก `req.ip`) และ `SEC-005` (QR endpoint สาธารณะไม่มีเพดาน) ด้วย `bc3caf0` + PR #81;
  `SEC-006` (IP ใน HUB) ถูกบันทึกเป็น `blocked` เพราะ `agent-machines.routes.ts` 998 บรรทัด แตะแล้ว `file-budget` ของ arch-gate ล้ม — ต้องแยกโมดูลก่อน;
  ตั้ง `SEC-007` เป็นคิวถัดไป (SQL ที่ยังประกอบสตริงเอง) ตามคำสั่งเจ้าของให้หาจุดเจาะเชิงรุกต่อ

- 2026-11-11 — ปิด `SEC-007` ด้วย `8994a0e` + PR #82: `metricSeriesQuery`/`metricInsertQuery` สร้าง `Prisma.sql` แทนการต่อสตริง ⇒ ค่าเดินทางเป็น parameter ทั้งหมด (เทสต์ยิง payload `DROP TABLE` แล้วเห็นเฉพาะใน `values`)

- 2026-11-11 — ปิด `SEC-006` ด้วย `5985826` + PR #83: แยก `agent-machines` เป็น shared/updates/routes (992 → 646) เพื่อให้ผ่าน `file-budget` แล้วเปลี่ยน `callerIp()` มาใช้ `req.ip` — IP ใน HUB และตัวนับล้มเหลวของ `/enroll` ปลอมไม่ได้อีก · ด่าน static 2 ตัว (fleet-control-plane, desktop-kit) เปลี่ยนไปอ่านทั้งโฟลเดอร์โมดูลเพื่อไม่ให้การแยกไฟล์ปิดด่านเงียบ ๆ## 6. บันทึกการวินิจฉัย (append-only)

- 2026-11-10 — `npm run verify` บนเช็คเอาต์นี้: Architecture Gate, Frontend Gate, backend build+test, frontend typecheck+build **ผ่าน**;
  `tools: unit tests` เหลือ fail 5 จาก 1389 (pass 1367, skipped 17) โดยทั้งหมดผูกกับเครื่อง operational:
  `tools/cleanup-finish.cmd` + `tools/repair-shell.cmd` (ถูก gitignore ตาม `tools/*` จึงไม่มีใน clone),
  Ollama bundle ของ `build-node-kit --with-ollama`, และ autostart task ที่ `doctor` ต้องเห็น
- 2026-11-10 — เหตุที่ offsite backup ไม่มีหลักฐานบนเครื่องนี้: `tools/verify/offsite-push.mjs`  hardcode
  `ROOT = 'E:/My work/Project Sovereign Origin'` และ `backups/postgres`, `sovereign-os/infra/offsite` ไม่มีอยู่จริง
  ⇒ เครื่องนี้เป็นเช็คเอาต์พัฒนา ไม่ใช่เครื่องที่รันไปป์ไลน์สำรอง; `QA-002` ต้องทำบนเครื่อง operational เท่านั้น

- 2026-11-10 — ปิด `QA-003`: `doctor` อ่าน `process.env.APPDATA` แทน `env` ที่ถูก inject (Startup entry จริงของเครื่องรั่วเข้าเทสต์)
  ⇒ ใช้ `env.APPDATA`; `batch-codepage` ข้ามเฉพาะ launcher ที่ยังไม่ติดตั้ง (ไฟล์ `tools/*.cmd` ถูก gitignore) แต่ยังบังคับกฎเดิมกับไฟล์ที่มีอยู่;
  `build-node-kit --with-ollama` ข้ามเฉพาะเมื่อไม่มีโฟลเดอร์ `Ollama/` ในเครื่อง — ผลคือ `npm run verify` ผ่านครบ 6/6 ขั้น (9.2 นาที, exit 0),
  tools tests 1369 pass / 0 fail / 20 skipped

- 2026-11-10 — ปิด `VAULT-005` ที่ฝั่ง `sovereign-rule-engine`: `src/persistence/engine-store.ts` เก็บ rule table + `engine.getState()`
  เป็น snapshot มี version ในตัว ผ่าน key `rule-engine/state`; `captureEngineState`/`applyEngineState` เป็น pure (เทสต์ได้โดยไม่ต้องมี vault),
  `saveEngineState`/`loadEngineState` รับเฉพาะ `has`/`get`/`put` (structural) ⇒ `Vault` ของ `sovereign-vault` ใช้ได้ทันทีโดยไม่ต้องเพิ่ม dependency
  (ตัดสินใจไม่ใช้ `file:`/GitHub dependency เพราะ vault ไม่มี `prepare` build และจะทำให้ `npm ci` ของ CI พัง)

- 2026-11-10 — ปิด `VAULT-007` ที่ฝั่ง `sovereign-vault` (`0.3.0`): `checkpointAnchor(vault, log, { maxAgeMs?, now? })`
  เป็น helper ที่ไม่ถือ timer เอง — scheduler (Task Scheduler/cron) เรียกได้บ่อยเท่าที่ต้องการ,
  append เฉพาะเมื่อ root เปลี่ยนหรือ head เก่ากว่า `maxAgeMs` (default 20h) ⇒ รันซ้ำ/รันช้าไม่ทำให้ chain แตก,
  `maxAgeMs` ที่ผิดรูป (ติดลบ/NaN) โยน `RangeError` แทนการเขียน anchor เงียบ ๆ; ข้อจำกัด: ไม่มี cross-process lock
  (สองรอบพร้อมกันจะได้สอง entry ที่ถูกต้องทั้งคู่) — ใช้ scheduler ตัวเดียวต่อ anchor log, 70 tests

- 2026-11-10 — ปิด `VAULT-006` ที่ฝั่ง `sovereign-vault` (`0.4.0`): เพิ่ม `Keyring` (ต้องระบุ active key เมื่อมีหลายกุญแจ),
  `Vault.open({ keyring })`, `rotateKey()`, `rekey()` (re-seal ทุก object + index, plaintext/root ไม่เปลี่ยน ⇒ anchor เดิมยังใช้ได้),
  `revokeKey()` (ปฏิเสธ active key และ key ที่ยัง seal object อยู่ — ต้อง `rekey()` ก่อน) และ `envelopeKeyId()` ให้เลือกกุญแจจาก header;
  ข้อจำกัด: การแจกจ่ายกุญแจข้ามเครื่องยังต้องทำนอกระบบ (ไม่มี key exchange/membership list), `rekey`/`revoke` เป็นงาน offline O(n)

- 2026-11-10 — ปิด `VAULT-008` ที่ฝั่ง `sovereign-vault` (`0.5.0`): `putStream(key, source, { chunkSize? })` / `getStream(key)`
  แบ่งค่าเป็น chunk (default 1 MiB) แล้ว seal/ตรวจแยกทีละก้อน ⇒ ไฟล์ใหญ่ไม่ต้องอยู่ในหน่วยความจำทั้งก้อน,
  index entry เก็บ `chunks: [{ hash, size }]` และ hash ของ entry คือ SHA-256 ของ chunk hash ต่อกัน (single-blob คงเป็น digest ของ plaintext),
  `get`/`delete`/`rekey`/`revokeKey`/`verifyAll` รู้จัก chunk และลบ chunk เก่าเมื่อ overwrite/delete;
  ข้อจำกัด: crash ระหว่างเขียนทำได้แค่ทิ้ง orphan blob (ยังไม่มี GC — ตั้งเป็น `VAULT-009`), chunk boundary ไม่ได้ content-defined
  (แทรกไบต์ต้นไฟล์ทำให้ chunk ที่ตามมาทั้งหมดเปลี่ยน), `get()` ยังโหลดทั้งก้อน (ใช้ `getStream()`), 95 tests cov 97.71/91.51/98.36/97.95

- 2026-11-10 — ปิด `VAULT-009` ที่ฝั่ง `sovereign-vault` (`0.6.0`): `pruneOrphans({ dryRun? })` สแกน `objects/` + `chunks/` แล้วลบเฉพาะ path ที่ index ไม่ได้อ้างถึง
  (index เป็นแหล่งความจริง ⇒ ค่าที่ใช้งานอยู่ไม่ถูกลบ; chunk ที่ *หาย* ยังเป็นเรื่องของ `verifyAll()` ไม่ใช่การลบ),
  ทำงานผ่าน write queue ของ vault และคืน `{ paths, bytes }`; `dryRun` ใช้ตรวจก่อนลบ; เทสต์จำลอง crash กลาง `putStream` (index commit ล้ม) แล้วเปิด vault ใหม่ → GC เก็บ chunk ที่ค้างและข้อมูลเดิมยังถอดได้,
  ข้อจำกัด: ยังไม่มีตัวเรียกอัตโนมัติ (ต้องตั้ง scheduler เอง) และถือว่ามี writer เดียวต่อ store, 99 tests cov 97.95/91.72/98.38/98.18
