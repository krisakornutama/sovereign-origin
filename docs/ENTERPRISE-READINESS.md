# Enterprise Readiness — Sovereign OS

> สถานะ: 19/10/69 · ระหว่าง Cold Soak
> เอกสารนี้เป็นแผนยกระดับผลิตภัณฑ์ให้พร้อมใช้หลายเครื่อง/หลายสาขาในระดับองค์กร
> **Phase 1 ถูก implement แล้วบน branch `ai/enterprise-fleet`** แต่ยังไม่ live
> จนกว่าจะ restart `sovereign-core-api` และ rebuild frontend หลัง Cold Soak

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
| DB migration | **ห้ามระหว่าง Cold Soak** |

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
- [ ] live หลัง Cold Soak: restart core-api + rebuild frontend + ทดสอบกับเครื่องจริง

## 4. Phase 2 — Persisted fleet model (หลัง Cold Soak)

เป้าหมาย: ย้าย state จากไฟล์เข้า DB เมื่ออนุญาตให้ migrate

| งาน | เหตุผล |
|---|---|
| ตาราง `fleet_sites` / `fleet_groups` | query ตามสาขา, unique name, ลบแล้วไม่กระทบเครื่อง |
| ตาราง `fleet_channels` / `fleet_rollouts` | ประวัติการเปลี่ยน %, ผูกกับผู้เปลี่ยน |
| ตาราง `fleet_machine_overrides` | FK ไป `AgentMachine`, cascade |
| ตาราง `fleet_enrollment_tokens` | expiry index, revoke reason, use log |
| ตาราง `fleet_audit_view` (หรือใช้ `audit_logs`) | ค้นย้อนหลังตามเครื่อง/สาขา |
| migration + backfill จาก JSON | idempotent, rollback ได้ |

**ยังไม่ทำ** จนกว่าจะพ้น Cold Soak และมี backup/restore test ที่ผ่าน

## 5. Phase 3 — Supply chain และความน่าเชื่อถือของอัปเดต

- เซ็น manifest ด้วยคีย์ (Ed25519) และฝัง public key ใน runner/desktop
- แยก artifact ต่อช่องทาง (stable/beta/canary) ไม่ใช้ manifest เดียว
- บังคับ SHA-256 + size + signature ก่อนติดตั้ง
- เก็บผลติดตั้ง (success/fail/rollback) ต่อเครื่อง
- health-gated rollout: หยุดอัตโนมัติถ้าเครื่องในกลุ่มล้มเกิน threshold
- รองรับ rollback ไปเวอร์ชันก่อนหน้า

## 6. Phase 4 — Operations at scale

- มุมมองรายสาขา (site-scoped operator) โดยไม่ให้เห็นข้ามสาขา
- Remote config ที่ลงนามแล้ว (poll + version)
- Drift detection: เวอร์ชัน/ไฟล์/บริการไม่ตรง manifest
- Fleet-wide job orchestration พร้อม concurrency limit ต่อเครื่อง
- Metric retention และ export (ไม่ทำให้ DB โตไม่มีขอบเขต)
- Alert rules ต่อ site/group (Telegram/email)
- Maintenance window ต่อ site

## 7. Phase 5 — Multi-tenant / partner

- แยกขอบเขตข้อมูลตามองค์กร (tenant id) ในทุกตารางที่เกี่ยวข้อง
- บทบาท `SITE_ADMIN`, `SITE_OPERATOR`, `AUDITOR`
- SSO/OIDC (ถ้าต้องการ) โดยไม่ทำให้ local login เดิมพัง
- Per-tenant encryption keys สำหรับ field-level secrets
- Billing/entitlement (ถ้าเป็น produkต์ขาย)

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
3. merge `ai/enterprise-fleet` → `main`
4. `docker restart sovereign-core-api` (โหลด route ใหม่)
5. rebuild frontend ตามขั้นตอนปกติ (ให้เมนู/หน้าใหม่ขึ้น)
6. เปิด `/fleet` ด้วย SUPERADMIN
7. สร้างรหัสเชิญทดสอบ 1 ใบ ติดตั้งเครื่องทดสอบ 1 เครื่อง
8. ตั้งเครื่องทดสอบเป็น canary 5% → beta → stable ตามผล
9. ตรวจ audit log ว่ามีรายการครบ
10. ประกาศใช้กับเครื่องจริง

## 11. คำถามที่ต้องตัดสินใจก่อน Phase 2

- ต้องการ site-scoped operator หรือ SUPERADMIN อย่างเดียวก่อน?
- ใช้ `audit_logs` เดิมหรือแยกตาราง fleet audit?
- ต้องการเก็บประวัติ rollout ทุกครั้งหรือแค่ค่าล่าสุด?
- ใครมีสิทธิ์หมุน token — SUPERADMIN เท่านั้นหรือ site admin ด้วย?
- นโยบาย `requireLanVerification` ควรบังคับจริงหรือเป็นแค่คำแนะนำ?
- ต้องการ signed manifest ใน Phase 3 หรือใช้ SHA-256 ต่อ?

---

**สรุป:** Phase 1 ทำให้ “ฝูงเครื่อง” ควบคุมได้จริงโดยไม่เพิ่มความเสี่ยงระหว่าง Cold Soak
สิ่งที่เหลือคือพิสูจน์กับเครื่องจริงหลังพ้น Cold Soak แล้วค่อยย้าย state เข้า DB ใน Phase 2
