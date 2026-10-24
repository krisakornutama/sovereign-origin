# Enterprise Readiness — Sovereign OS

> สถานะ: 24/10/69 · ระหว่าง Cold Soak
> เอกสารนี้เป็นแผนยกระดับผลิตภัณฑ์ให้พร้อมใช้หลายเครื่อง/หลายสาขาในระดับองค์กร
> **Phase 1 + Phase 2 live แล้ว**; **Phase 3A (signed runner manifest) deploy แล้ว 24/10/69** —
> HUB ตรวจ manifest ที่เซ็นด้วย `fleet-update-v1` ก่อนตอบเครื่องลูก (restart container ตามที่เจ้าของอนุมัติ)
> **Phase 3B (`SITE_ADMIN` อ่านอย่างเดียว จำกัดสาขา) deploy แล้ว 24/10/69** —
> migration `20261024130000_site_admin_role` apply บน production + restart core-api แล้ว

## 1. เป้าหมาย

Sovereign OS ต้องตอบคำถามเหล่านี้ได้จากที่เดียว:

1. **เห็น** — มีเครื่องทั้งหมดกี่เครื่อง ออนไลน์กี่เครื่อง อยู่สาขาไหน เวอร์ชันอะไร
2. **ควบคุม** — กำหนดช่องทางอัปเดตและเปอร์เซ็นต์การปล่อยแบบคุมความเสี่ยงได้
3. **ตรวจสอบ** — ใครเปลี่ยนนโยบาย ใครสร้าง/เพิกถอนรหัส ใครหมุน token เมื่อไร
4. **ขยาย** — เพิ่มเครื่องใหม่ได้โดยไม่ต้องแจก token ส่วนกลาง และเพิกถอนรายเครื่องได้
5. **ไม่พังของเดิม** — เครื่อง/runner/desktop updater เวอร์ชันเก่ายังทำงานได้

## 2. สิ่งที่มีอยู่ก่อน Phase 1

| ความสามารถ | สถานะ |
|---|---|
| ลงทะเบียนเครื่อง + machine token | มี (`agent-machines`) |
| heartbeat + สถานะ online/offline | มี |
| ผูกเครื่องกับผู้ใช้ + LAN pairing | มี (`agent-machine-hub`) |
| สั่งงานผ่าน Agent Queue | มี |
| OTA/runner update manifest + ไฟล์ | มี |
| Desktop update manifest + asset | มี |
| Node kit สำหรับเครื่องที่สอง | มี (35.1 MB, hash ตรวจได้) |
| Audit log กลาง | มี |
| Feature grants รายหน้า | มี |
| DB migration | มี (Fleet Phase 2 — `fleet_*` + `fleet_audit_view`) |

ช่องว่างหลัก: ไม่มีมุมมองฝูงเครื่อง, ไม่มี site/group, ไม่มี staged rollout,
รหัสเชิญเป็นค่าเดี่ยวใน env, ไม่มีเพิกถอนรายเครื่องจาก UI, และ
`GET /api/agent-machines` เคยส่ง `token_hash` ออกไป (แก้แล้วใน Phase 1)

## 3. Phase 1 — Fleet Control Plane v1 (implemented)

### 3.1 หลักการออกแบบ

- **ไม่แตะ DB** — state เป็น JSON ใต้ volume `core-api/data/fleet/`
- **ไม่แตะ `.env`** — ใช้ของเดิม; รหัสเชิญแบบใหม่เก็บในไฟล์
- **เข้ากันได้ย้อนหลัง** — `MACHINE_ENROLL_CODE` เดิมยังใช้ได้
- **fail-closed** — ไฟล์เสีย/อ่านไม่ได้ = ค่าเริ่มต้น/รายการว่าง ไม่ใช่เปิดกว้าง
- **แสดงความลับครั้งเดียว** — รหัสเชิญและ machine token ไม่เก็บ plaintext
- **ทุกอย่างมี audit** — การเปลี่ยนนโยบาย/รหัส/โทเคน

### 3.2 สิ่งที่ส่งมอบ

| ของที่ส่งมอบ | ที่อยู่ |
|---|---|
| Policy + rollout + compliance | `src/services/fleet-policy.service.ts` |
| รหัสเชิญมีอายุ/โควตา/เพิกถอน | `src/services/fleet-enrollment.service.ts` |
| ภาพรวมฝูงเครื่อง | `src/services/fleet-overview.service.ts` |
| API `/api/fleet/*` (SUPERADMIN) | `src/modules/fleet/fleet.routes.ts` |
| หน้า Fleet Console | `sovereign-frontend/src/pages/fleet.tsx` |
| ด่านอัปเดตตามช่องทาง | `agent-machines.routes.ts` |
| หมุน machine token | `agent-machines.service.ts` + fleet route |
| เอกสารโมดูล | `docs/modules/fleet.md` |
| เทสต์ | `tests/fleetPolicy.test.ts`, `tests/fleetEnrollment.test.ts`, `tools/test/fleet-control-plane.test.mjs` |

### 3.3 Acceptance criteria

- [x] สร้างรหัสเชิญแล้วเห็นรหัสจริงครั้งเดียว; ไฟล์เก็บเฉพาะ SHA-256
- [x] รหัสใช้ได้ตาม `maxUses`, หมดอายุ, เพิกถอนได้
- [x] ลงทะเบียนด้วยรหัสฝูงได้แม้ไม่ได้ตั้ง `MACHINE_ENROLL_CODE`
- [x] รหัสเดิมยังใช้ได้
- [x] rollout deterministic ต่อ `(channel, machineId)`
- [x] เครื่องนอก rollout ได้ 404 `rollout_hold` ทั้ง manifest และ asset
- [x] เครื่อง disabled ได้ 403 `machine_disabled`
- [x] ตั้ง site/group/tags/channel ต่อเครื่องได้
- [x] หมุน token แล้ว token เดิมใช้ไม่ได้
- [x] ทุก mutation เขียน audit
- [x] `GET /api/agent-machines` ไม่ส่ง hash ออกไป
- [x] หน้า `/fleet` มี Sidebar, อยู่ใต้เพดาน 800 บรรทัด, component ใต้ 400
- [x] live: restart core-api + rebuild frontend (23/10/69)
- [ ] ทดสอบกับเครื่องจริง 1 เครื่อง (สร้างรหัสเชิญ + ตั้ง site/group ผ่าน UI)

## 4. Phase 2 — Persisted fleet model (implemented)

เป้าหมาย: ย้าย state จากไฟล์เข้า DB เมื่ออนุญาตให้ migrate

| งาน | สถานะ |
|---|---|
| ตาราง `fleet_sites` / `fleet_groups` | ✅ unique name + FK site |
| ตาราง `fleet_channels` / `fleet_rollouts` | ✅ ประวัติการเปลี่ยน % + ผู้เปลี่ยน |
| ตาราง `fleet_settings` | ✅ default channel / require LAN / notes (singleton) |
| ตาราง `fleet_machine_overrides` | ✅ FK `agent_machines` + cascade |
| ตาราง `fleet_enrollment_tokens` | ✅ expiry index, revoke reason, last machine |
| ตาราง `fleet_enrollment_uses` | ✅ use log + released_at |
| `fleet_audit_view` | ✅ view บน `audit_logs` + API `/api/fleet/audit` |
| migration + backfill จาก JSON | ✅ `20261023150000_fleet_persisted_model` + `scripts/fleet-backfill.mjs` (dry-run/`--apply`, idempotent) |

Acceptance:

- [x] `npm run verify` ผ่าน (backend build/test + frontend typecheck/build + tools)
- [x] DB contract test บน Postgres จริง (`tests/fleetPhase2-db.test.ts`, gated)
- [x] policy/override/enrollment ใช้ DB เป็นแหล่งความจริง; JSON ใช้เฉพาะ backfill/tests
- [x] token ยัง hash-only และมี use log
- [x] audit ค้นตาม `machineId`/`actionType`/ช่วงเวลาได้
- [x] production migration + backfill + restart (backup 23/10/69 + restore drill ผ่าน; API DB smoke 200)

## 5. Phase 3 — Supply chain และความน่าเชื่อถือของอัปเดต

### 5.1 Phase 3A — signed runner manifest (deployed 24/10/69)

- [x] manifest ของ runner ถูกเซ็น Ed25519 ที่ตัวแพ็ก; private key อยู่ `tools/agent-pack/keys/signing-key.pem` (gitignored)
- [x] public key ฝังใน runner + HUB; static test เทียบสองฝั่ง (`tools/test/update-trust-key.test.mjs`)
- [x] HUB ตรวจลายเซ็นก่อนตอบ manifest — unsigned/bad signature = 503
- [x] runner ตรวจซ้ำก่อนแตะไฟล์ — unsigned/bad signature = `untrusted-manifest`
- [x] canonical payload ครอบ `version`, `generatedAt`, `files[{path,sha256,size}]`
- [x] repack production manifest ด้วย key จริงแล้ว (23/10/69 · `ab6b8b43b256` · `fleet-update-v1` · verify ผ่าน)
- [x] restart core-api ให้โค้ด HUB รุ่น Phase 3A ขึ้นใช้งาน — **เสร็จ 24/10/69 12:32** (เจ้าของอนุมัติ)
      · พิสูจน์ที่รันจริง: `readVerifiedUpdateManifest()` = `ok:true` (`ab6b8b43b256`, ed25519, 20 ไฟล์)
- [ ] desktop updater ยังใช้ SHA-256 อย่างเดียว (Phase 3B)

### 5.2 งานที่ยังเหลือใน Phase 3

- แยก artifact ต่อช่องทาง (stable/beta/canary) ไม่ใช้ manifest เดียว
- เก็บผลติดตั้ง (success/fail/rollback) ต่อเครื่อง
- health-gated rollout: หยุดอัตโนมัติถ้าเครื่องในกลุ่มล้มเกิน threshold
- รองรับ rollback ไปเวอร์ชันก่อนหน้า

### 5.3 Phase 3B — `SITE_ADMIN` (จำกัดสาขา, อ่านอย่างเดียว)

เจ้าของเลือกรูปแบบ "เพิ่ม role" และมอบการออกแบบความปลอดภัยให้ผู้พัฒนา — เลือกแบบ least privilege:
บัญชีสาขา **อ่านได้อย่างเดียว** และเห็นเฉพาะเครื่องของสาขาตัวเอง (ทุกเส้นที่เขียนยังเป็น SUPERADMIN)

- [x] enum `SITE_ADMIN` + `users.assigned_site_id` (FK → `fleet_sites.id`, `ON DELETE SET NULL`)
- [x] migration `20261024130000_site_admin_role` — **apply production แล้ว 24/10/69 13:36** (backup + restore drill ผ่าน,
      66 migrations, ไม่มี drift) และ restart core-api (healthy, restarts=0)
- [x] `fleet-scope.service.ts` — fail closed: ไม่ผูกสาขา = `SITE_SCOPE_MISSING`, สาขาหาย = `SITE_SCOPE_UNKNOWN`
- [x] `/api/fleet/overview|policy|sites|groups|audit` เปิดให้ SITE_ADMIN แบบจำกัดสาขา —
      `summary`/`channels` คิดใหม่จากชุดที่กรองแล้ว, audit กรองด้วย `machineIds`
- [x] เส้นเขียน/จัดการกุญแจทั้งหมด (policy PUT, enroll-tokens, machines) ยังเป็น SUPERADMIN เท่านั้น
- [x] เทสต์: `tests/fleetScope.test.ts` (15 เคส) + `tools/test/fleet-site-scope.test.mjs` (25 เคส static wiring)
- [ ] หน้า Fleet ยังไม่รู้จัก SITE_ADMIN (ผู้ใช้ role นี้ใช้ API ได้; UI ยังเช็ค SUPERADMIN)

## 6. Phase 4 — Operations at scale

- มุมมองรายสาขาแบบเขียนได้ (site-scoped operator) — v1 อ่านอย่างเดียวทำแล้วใน Phase 3B (§5.3)
- Remote config ที่ลงนามแล้ว (poll + version)
- Drift detection: เวอร์ชัน/ไฟล์/บริการไม่ตรง manifest
- Fleet-wide job orchestration พร้อม concurrency limit ต่อเครื่อง
- Metric retention และ export (ไม่ทำให้ DB โตไม่มีขอบเขต)
- Alert rules ต่อ site/group (Telegram/email)
- Maintenance window ต่อ site

## 7. Phase 5 — Multi-tenant / partner

- แยกขอบเขตข้อมูลตามองค์กร (tenant id) ในทุกตารางที่เกี่ยวข้อง
- บทบาท `SITE_ADMIN`, `SITE_OPERATOR`, `AUDITOR` (SITE_ADMIN v1 มาก่อนแล้วใน Phase 3B — §5.3)
- SSO/OIDC (ถ้าต้องการ) โดยไม่ทำให้ local login เดิมพัง
- Per-tenant encryption keys สำหรับ field-level secrets
- Billing/entitlement (ถ้าเป็นผลิตภัณฑ์ที่ขาย)

> Phase 5 ต้องออกแบบ data model ใหม่รอบใหญ่ — ไม่ควรทำพร้อม Phase 2

## 8. Non-goals (ตอนนี้)

- ไม่ทำ HUB client mode (shell ตรวจ `localhost` ตามดีไซน์)
- ไม่ทำ auto-deploy โดยไม่มีคนอนุมัติ
- ไม่ทำ multi-region / HA cluster
- ไม่เปลี่ยน public shop (`sovereignoriginshop.dpdns.org`) — คนละ repo
- ไม่แตะ `sovereign-os/infra/.env`
- ไม่ restart/migrate ระหว่าง Cold Soak

## 9. ความเสี่ยงและมาตรการ

| ความเสี่ยง | มาตรการ |
|---|---|
| ไฟล์ policy/token เขียนพร้อมกันแล้วหาย | atomic write + in-process lock + copy fallback บน Windows |
| ไฟล์เสียทำให้ API ล่ม | read แบบ fail-closed, คืนค่าเริ่มต้น/รายการว่าง |
| token รั่วจาก log/response | เก็บ hash, แสดง plaintext ครั้งเดียว, ไม่ log ค่ารหัส |
| เครื่องถูกกักแต่ยังโหลดไฟล์ได้ | gate ทั้ง manifest และ asset |
| หมุน token แล้วเครื่องหลุด | confirm ใน UI + คำเตือนใน response + audit |
| รหัสเชิญถูกเดา | `enr_` 192-bit, rate limit ต่อ IP, hash compare |
| หน้า Fleet โตเกิน gate | แยก component, มี tools test คุมบรรทัด |
| API ใหม่ 404 ระหว่าง Cold Soak | หน้าแสดงข้อความบอกให้ restart หลัง Cold Soak |

## 10. แผนปล่อยจริง (หลัง Cold Soak)

1. ตรวจว่า backup/restore ล่าสุดผ่าน
2. `npm run verify` ที่ MAIN (ต้องเขียว)
3. merge branch งาน → `main`
4. ตรวจว่ามี `tools/agent-pack/keys/signing-key.pem` แล้ว repack:
   `node -e "import('./tools/agent-pack/pack.mjs').then(m => m.publishUpdateBundle())"`
5. `docker restart sovereign-core-api` (โหลด route ใหม่ + manifest ที่เซ็นแล้ว)
6. rebuild frontend ตามขั้นตอนปกติ (ให้เมนู/หน้าใหม่ขึ้น)
7. เปิด `/fleet` ด้วย SUPERADMIN
8. สร้างรหัสเชิญทดสอบ 1 ใบ ติดตั้งเครื่องทดสอบ 1 เครื่อง
9. ตั้งเครื่องทดสอบเป็น canary 5% → beta → stable ตามผล
10. ตรวจ audit log ว่ามีรายการครบ
11. ประกาศใช้กับเครื่องจริง

## 11. คำถามที่ต้องตัดสินใจก่อน Phase 2

- ต้องการ site-scoped operator หรือ SUPERADMIN อย่างเดียวก่อน?
- ใช้ `audit_logs` เดิมหรือแยกตาราง fleet audit?
- ต้องการเก็บประวัติ rollout ทุกครั้งหรือแค่ค่าล่าสุด?
- ใครมีสิทธิ์หมุน token — SUPERADMIN เท่านั้นหรือ site admin ด้วย?
- นโยบาย `requireLanVerification` ควรบังคับจริงหรือเป็นแค่คำแนะนำ?
- Phase 3A ใช้ signed manifest กับ runner แล้ว; จะขยายไป desktop updater เมื่อไร?

---

**สรุป:** Phase 1 ทำให้ “ฝูงเครื่อง” ควบคุมได้จริงโดยไม่เพิ่มความเสี่ยงระหว่าง Cold Soak
สิ่งที่เหลือคือพิสูจน์กับเครื่องจริงหลังพ้น Cold Soak แล้วค่อยย้าย state เข้า DB ใน Phase 2
