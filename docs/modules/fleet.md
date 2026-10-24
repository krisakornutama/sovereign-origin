# โมดูล fleet — Fleet Control Plane v2 (Phase 2)

## เจตนา

รวมเครื่องที่ลงทะเบียนกับ HUB ให้เจ้าของเห็นและควบคุมเป็น “ฝูง” ไม่ใช่ทีละเครื่อง:
เครื่องไหนออนไลน์/ออฟไลน์ อยู่สาขาไหน อยู่ช่องทางอัปเดตไหน ควรได้อัปเดตหรือยัง
และใครถือรหัสเชิญที่ยังใช้ได้

Phase 2 ย้าย state จาก JSON เข้า **PostgreSQL** เพื่อให้ query/audit/FK ทำงานได้จริง:

- policy, channel rollout, site/group, machine override → ตาราง `fleet_*`
- enrollment token เก็บเฉพาะ hash + **use log** (`fleet_enrollment_uses`)
- audit ของ Fleet อ่านจาก `audit_logs` (มี `fleet_audit_view` สำหรับ SQL read-only)

ไฟล์ JSON เดิมยังอยู่เพื่อ **backfill เท่านั้น** และโค้ดทดสอบ/file fallback ยังอ่านได้:

```
core-api/data/fleet/policy.json
core-api/data/fleet/enrollment-tokens.json
```

> เป้าหมายของ Phase 2 คือ “state อยู่ที่เดียวและตรวจย้อนหลังได้” ไม่ใช่ระบบ SaaS หลายองค์กรเต็มรูปแบบ
> สิทธิ์รายสาขา/tenant แยกอยู่ใน Phase 4–5

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `src/services/fleet-persistence.service.ts` | อ่าน/เขียน policy, override, site/group จาก DB (+ UUID guard) |
| `src/services/fleet-policy.service.ts` | นโยบายช่องทาง, override, rollout bucket, compliance, ด่านอัปเดต |
| `src/services/fleet-enrollment.service.ts` | รหัสเชิญแบบ hash + expiry/โควตา + use log + เพิกถอน |
| `src/services/fleet-overview.service.ts` | ประกอบภาพรวมสำหรับหน้า `/fleet` จาก DB + agent machines |
| `src/services/fleet-store.service.ts` | legacy JSON atomic store — ใช้โดย tests/backfill |
| `src/modules/fleet/fleet.routes.ts` | API `/api/fleet/*` — SUPERADMIN เท่านั้น |
| `scripts/fleet-backfill.mjs` | backfill JSON → DB (idempotent, dry-run เป็นค่าเริ่มต้น) |
| `sovereign-frontend/src/pages/fleet.tsx` | หน้า Fleet Console |
| `sovereign-frontend/src/components/fleet/*` | แผงนโยบาย/รหัสเชิญ/ตารางเครื่อง |

## สถานะที่เก็บ (DB)

| ตาราง | เก็บอะไร | กุญแจ/ความสัมพันธ์ |
|---|---|---|
| `fleet_settings` | default channel, require LAN, notes (singleton id=1) | `id` |
| `fleet_channels` | label + rollout % ต่อช่องทาง | `channel` (stable/beta/canary) |
| `fleet_rollouts` | ประวัติการเปลี่ยน % + ผู้เปลี่ยน | `id`, index `(channel, created_at)` |
| `fleet_sites` | ชื่อสาขา unique + notes | `id`, `name` unique |
| `fleet_groups` | กลุ่ม unique + สังกัดสาขา | `id`, `site_id → fleet_sites` |
| `fleet_machine_overrides` | channel/site/group/tags/notes ต่อเครื่อง | `machine_id → agent_machines` (cascade) |
| `fleet_enrollment_tokens` | hash-only token + expiry/โควตา/revoke | `id`, `token_hash` unique |
| `fleet_enrollment_uses` | log ทุกครั้งที่ใช้ token + release | `token_id → fleet_enrollment_tokens` |

- `rolloutPercent` เป็นจำนวนเต็ม 0–100
- ช่องทางที่รองรับมีสามค่าเท่านั้น: `stable`, `beta`, `canary`
- ไม่มี override = ใช้ค่าเริ่มต้น; ค่าใน DB ผิดรูปจะถูก normalize แบบ fail-closed
- `fleet_audit_view` เป็น read-only view บน `audit_logs` (`action_type LIKE 'FLEET_%'`)

### รูปแบบ JSON เดิม (ใช้เฉพาะ backfill)

`policy.json` มี `defaultChannel`, `channels.*.rolloutPercent`, `requireLanVerification`, `notes`,
และ `machines.<id>` ที่มี `channel/site/group/tags/notes`; `enrollment-tokens.json` มี
`label/prefix/tokenHash/expiresAt/maxUses/usedCount/revokedAt` — backfill จะ upsert ตามชื่อ/hash
และข้าม override ที่ machine ไม่มีอยู่ใน DB

- รหัสจริงรูปแบบ `enr_` + hex 48 ตัว (24 ไบต์สุ่ม) แสดงครั้งเดียวตอนสร้าง
- เก็บเฉพาะ `sha256(token)` — ห้ามเก็บรหัสจริง
- ใช้ได้ไม่เกิน `maxUses` (1–1000) และไม่เกิน `expiresInHours` (1–8760)
- เพิกถอนแล้วใช้ไม่ได้ทันที; use log ยังดูย้อนหลังได้

## API

ทุก route ผ่าน `authenticate` แล้วแยกสิทธิ์รายเส้น (ไม่ใช้ `requireRole` ทั้งโมดูล):

- **อ่านอย่างเดียว** → `SUPERADMIN` + `SITE_ADMIN` (SITE_ADMIN ถูกจำกัดสาขา — ดูหัวข้อถัดไป)
- **เขียน / จัดการกุญแจ** → `SUPERADMIN` เท่านั้น

| Method | Path | สิทธิ์ | ความหมาย |
|---|---|---|---|
| GET | `/api/fleet/overview` | SUPERADMIN · SITE_ADMIN (scoped) | ภาพรวม + summary + ช่องทาง + เวอร์ชันที่เผยแพร่ + เครื่องทั้งหมด |
| GET | `/api/fleet/policy` | SUPERADMIN · SITE_ADMIN | นโยบายสำหรับหน้าเว็บ (ไม่มี override ดิบทั้งก้อน) |
| PUT | `/api/fleet/policy` | SUPERADMIN | แก้ `defaultChannel`, `channels.*.rolloutPercent`, `requireLanVerification` |
| GET | `/api/fleet/sites` | SUPERADMIN · SITE_ADMIN (เฉพาะสาขาตัวเอง) | รายชื่อสาขา + notes |
| GET | `/api/fleet/groups` | SUPERADMIN · SITE_ADMIN (เฉพาะกลุ่มในสาขา) | รายชื่อกลุ่ม + สาขาที่สังกัด |
| GET | `/api/fleet/audit` | SUPERADMIN · SITE_ADMIN (เฉพาะเครื่องในสาขา) | audit ของ Fleet (`limit`, `before`, `actionType`, `machineId`) |
| GET | `/api/fleet/enroll-tokens` | SUPERADMIN | รายการรหัสเชิญ (ไม่คืนรหัสจริง/hash) |
| POST | `/api/fleet/enroll-tokens` | SUPERADMIN | สร้างรหัส — คืน `token` จริงครั้งเดียว |
| POST | `/api/fleet/enroll-tokens/:id/revoke` | SUPERADMIN | เพิกถอน (รับ `reason` ได้) |
| PUT | `/api/fleet/machines/:id` | SUPERADMIN | ตั้ง `channel` / `site` / `group` / `tags` / `notes` |
| POST | `/api/fleet/machines/:id/rotate-token` | SUPERADMIN | หมุน machine token — คืน token ใหม่ครั้งเดียว |

### บทบาท `SITE_ADMIN` — ผู้ดูแลสาขา (อ่านอย่างเดียว, จำกัดสาขา)

เพิ่มใน Phase 3B เพราะก่อนหน้านี้สิทธิ์เป็นระดับ HUB ทั้งฝูงเท่านั้น

- ผูกบัญชีกับสาขาด้วย `users.assigned_site_id` (FK → `fleet_sites.id`, `ON DELETE SET NULL`)
  — migration `20261024130000_site_admin_role` **apply production แล้ว 24/10/69** (66 migrations, ไม่มี drift)
- **fail closed:** ไม่ได้ผูกสาขา → `403 SITE_SCOPE_MISSING` · สาขาถูกลบ/ไม่ตรงกับที่โหลดมา →
  `403 SITE_SCOPE_UNKNOWN` · role อื่นทั้งหมด → `403 ROLE_NOT_ALLOWED` (ไม่ใช่ "เห็นทั้งฝูง")
- เครื่องถูกจับคู่ด้วย **ชื่อสาขา** จาก `fleet_machine_overrides → fleet_sites.name`
  เครื่องที่ยังไม่ระบุสาขา (หรือสาขาอื่น) จึงมองไม่เห็นจากบัญชีนี้
- `/overview` คิด `summary` และ `channels` ใหม่จากชุดที่กรองแล้ว — ตัวเลขของสาขาอื่นไม่รั่วผ่าน API
  (ส่วน `policy` / `published` / `enrollment` คงเดิม เพราะไม่มี id ของเครื่อง)
- `/audit` ส่ง `machineIds` ของสาขาลง `AuditService.listFleetEvents` — เหตุการณ์ระดับระบบ
  (เช่น `FLEET_POLICY_UPDATE` ที่ไม่มี `machineId`) จะไม่โผล่ให้บัญชีนี้ และสาขาที่ยังไม่มีเครื่องได้ชุดว่าง
- `assigned_site_id` เปลี่ยนเมื่อไหร่ `token_version` ถูก bump → token เก่าตายทันที (เหมือนเปลี่ยน role)
- ตรรกะทั้งหมดอยู่ใน `src/services/fleet-scope.service.ts` (pure — เทสต์ได้โดยไม่ต้องมี DB)


### ตัวอย่างสร้างรหัสเชิญ

```http
POST /api/fleet/enroll-tokens
Content-Type: application/json

{ "label": "สาขาเชียงใหม่", "maxUses": 5, "expiresInHours": 168 }
```

```json
{
  "token": "enr_0123456789abcdef...",
  "tokenRecord": {
    "id": "...",
    "label": "สาขาเชียงใหม่",
    "prefix": "enr_01234567",
    "maxUses": 5,
    "usedCount": 0,
    "usesRemaining": 5,
    "expiresAt": "...",
    "usable": true
  }
}
```

### ตัวอย่างตั้งค่าต่อเครื่อง

```http
PUT /api/fleet/machines/<machine-id>
Content-Type: application/json

{ "channel": "beta", "site": "สาขาเชียงใหม่", "group": "ครัว", "tags": ["pos"] }
```

ส่ง `null` ในฟิลด์ที่ต้องการล้าง; ถ้าทุกฟิลด์ว่าง จะลบ override ของเครื่องนั้น

## Rollout และ compliance

### Rollout bucket

```
bucket = sha256(`${channel}:${machineId}`) → UInt32BE ตัวแรก → % 100
```

- เครื่องเดิม + ช่องทางเดิม = bucket เดิมเสมอ (ไม่สุ่มใหม่ทุก request)
- `rolloutPercent = 100` → ทุกเครื่อง; `0` → ไม่มีเครื่อง
- การเปลี่ยนช่องทางทำให้ bucket เปลี่ยน (เพราะ channel อยู่ใน hash) — เป็นเจตนา
  เพื่อไม่ให้เครื่องที่เพิ่งย้ายไป canary ถูกจัดกลุ่มด้วยค่าเก่า

### สถานะ compliance

| สถานะ | ความหมาย |
|---|---|
| `ok` | heartbeat สด, ยืนยัน LAN แล้ว, เวอร์ชันตรงกับ manifest |
| `update` | มี manifest ใหม่กว่า และเครื่องอยู่ใน rollout |
| `held` | มี manifest ใหม่กว่า แต่ยังอยู่นอกเปอร์เซ็นต์ rollout |
| `offline` | heartbeat เก่ากว่าเกณฑ์ (แม้ DB ยังบอก online) |
| `disabled` | ถูกปิดใช้งาน — ชนะทุกสถานะ |
| `unverified` | ยังไม่ยืนยัน LAN จึงยังไม่ถือว่าพร้อม |
| `unknown-version` | ยังไม่รู้เวอร์ชัน แต่ HUB มี manifest เผยแพร่แล้ว |

`requireLanVerification` ใน policy ถูกเก็บไว้เป็นนโยบายขององค์กร
แต่การคิด compliance ใช้ `lan_confirmed_at` ของเครื่องเป็นหลัก

## ด่านอัปเดต

ด่านถูกใช้ทั้ง manifest และไฟล์จริง เพื่อไม่ให้เครื่องที่ถูกกักดาวน์โหลดโค้ดได้:

- `GET /api/agent-machines/update/manifest`
- `GET /api/agent-machines/update/file`
- `GET /api/agent-machines/desktop-update/manifest`
- `GET /api/agent-machines/desktop-update/asset`

พฤติกรรม:

| กรณี | HTTP | body/header |
|---|---|---|
| ผ่าน | 200 | body มี `channel`, `rolloutPercent`; header `X-Fleet-Channel`, `X-Fleet-Rollout` |
| ถูกกัก | 404 | `reason: "rollout_hold"` + header `X-Fleet-Hold: rollout` |
| เครื่องถูกปิด | 403 | `reason: "machine_disabled"` |

เหตุที่ใช้ 404 สำหรับ “ถูกกัก” เพราะ runner/desktop updater เดิมตีความ 404 ว่า
“ยังไม่มีชุดอัปเดต” อยู่แล้ว — client เก่าจึงไม่พังและไม่ต้องแก้พร้อมกัน

`GET /api/agent-machines/node-kits/manifest` และ `/node-kits/asset` คงเป็นสาธารณะ
เพราะเครื่องใหม่ยังไม่มี machine token; manifest ระบุ `channel: "stable"` เสมอ

## ลายเซ็น manifest ของ runner (Phase 3A)

manifest ของ runner ถูกเซ็นด้วย **Ed25519** ก่อนเผยแพร่ และถูกตรวจสองชั้น:

1. `tools/agent-pack/pack.mjs` เซ็น `{version, generatedAt, files:[{path,sha256,size}]}`
   ด้วย private key ที่ `tools/agent-pack/keys/signing-key.pem`
   (gitignored — ห้าม commit และต้องสำรองแยกจาก repo)
2. `GET /api/agent-machines/update/manifest` ตรวจลายเซ็นก่อนตอบ — manifest ที่ไม่ได้เซ็น
   หรือลายเซ็นไม่ตรงตอบ **503** (ไม่ส่งต่อให้ runner)
3. runner ตรวจซ้ำใน `src/updateTrust.mjs` ก่อนอ่าน/ติดตั้งไฟล์ใด ๆ — manifest ที่ไม่ผ่าน
   จะได้ `status: "untrusted-manifest"` และไม่แตะไฟล์เดิม

public key ฝังที่ `sovereign-os/agent-runner/src/updateTrust.mjs` และ
`src/services/update-manifest-trust.service.ts` — มี static test
`tools/test/update-trust-key.test.mjs` เทียบว่า PEM/keyId ตรงกัน

### หลัง merge (ยังไม่ทำระหว่าง Cold Soak)

0. ถ้ายังไม่มี private key (ทำครั้งเดียว; เก็บให้ปลอดภัย):
   ```bash
   node -e "const c=require('node:crypto'),f=require('node:fs');const {publicKey,privateKey}=c.generateKeyPairSync('ed25519');f.mkdirSync('tools/agent-pack/keys',{recursive:true});f.writeFileSync('tools/agent-pack/keys/signing-key.pem',privateKey.export({type:'pkcs8',format:'pem'}));console.log(publicKey.export({type:'spki',format:'pem'}))"
   ```
   แล้วนำ public key ที่พิมพ์ออกมาไปแทนใน `updateTrust.mjs` และ
   `update-manifest-trust.service.ts` **ทั้งสองไฟล์** ก่อน repack
1. ตรวจว่ามี private key ที่ `tools/agent-pack/keys/signing-key.pem`
2. repack เพื่อเซ็น manifest ปัจจุบัน:
   `node -e "import('./tools/agent-pack/pack.mjs').then(m => m.publishUpdateBundle())"`
3. restart `sovereign-core-api` ตามขั้นตอน deploy ปกติ
4. ตรวจ `GET /api/agent-machines/update/manifest` ด้วย machine token ว่าได้ `signature.alg = "ed25519"`

ถ้า private key หาย: ต้องสร้าง keypair ใหม่, แก้ public key ทั้งสองไฟล์, repack และ
แจก runner ชุดใหม่ — เครื่องที่ถือ public key เก่าจะปฏิเสธ manifest ใหม่จนกว่าจะได้ runner ใหม่

## การลงทะเบียนเครื่องใหม่

`POST /api/agent-machines/enroll` รับได้สองทาง:

1. **รหัสเดิม** `MACHINE_ENROLL_CODE` (ถ้าตั้งไว้) — ยังใช้ได้เหมือนเดิม
2. **รหัสฝูง** `enr_...` จาก Fleet Console — ใช้ได้แม้ไม่ได้ตั้ง `MACHINE_ENROLL_CODE`

ลำดับการตัดสิน:

1. ถ้าไม่ได้ตั้งรหัสเดิมและรหัสที่ส่งมาไม่ใช่รูปแบบ `enr_` → 404 `disabled`
2. เกินจำนวนครั้งที่ล้มเหลวต่อ IP → 429 `rate_limited`
3. ชื่อว่าง/ยาวเกิน → 400 `bad_request` (ไม่นับเป็นครั้งล้ม)
4. รหัสเดิมตรง หรือรหัสฝูงใช้ได้ → สร้างเครื่อง
5. ไม่ตรง/หมดอายุ/เพิกถอน/ใช้ครบ → 400 `bad_code` และนับครั้งล้ม

หลังสร้างเครื่องสำเร็จ ระบบจะผูก `machineId` กลับไปที่รหัสฝูง
ถ้าสร้างเครื่องล้มเหลว จะคืนสิทธิ์การใช้รหัส (ไม่เผาโควตาเปล่า)

## ความปลอดภัย

- `/api/fleet` ทุกเส้นต้องล็อกอิน; เส้นอ่านเปิดให้ `SITE_ADMIN` แบบจำกัดสาขา ที่เหลือ `SUPERADMIN` เท่านั้น
- `GET /api/agent-machines` ถูกแก้ให้คัดฟิลด์แล้ว — ไม่ส่ง `token_hash` / `pair_code_hash`
- รหัสเชิญและ machine token แสดงครั้งเดียว; เก็บเฉพาะ hash
- ทุกการเปลี่ยนนโยบาย/สร้างหรือเพิกถอนรหัส/หมุน token เขียน audit log:
  - `FLEET_POLICY_UPDATE`
  - `FLEET_ENROLL_TOKEN_CREATE`
  - `FLEET_ENROLL_TOKEN_REVOKE`
  - `FLEET_MACHINE_POLICY_UPDATE`
  - `FLEET_MACHINE_TOKEN_ROTATE`
- หมุน token แล้ว token เดิมใช้ไม่ได้ทันที — เครื่องนั้นจะหลุดจาก HUB จนกว่าจะตั้งค่าใหม่
  (route ไม่ได้ส่ง token เก่าออกมา และเตือนใน response)

## ข้อจำกัด / ยังไม่ทำใน Phase 2

- สิทธิ์ระดับสาขาทำแล้วใน Phase 3B (`SITE_ADMIN` อ่านอย่างเดียว + จำกัดสาขา); ยังไม่มีผู้ดูแลสาขาแบบเขียนได้
- signed manifest ของ runner ทำแล้วใน Phase 3A; desktop updater ยังใช้ SHA-256 อย่างเดียว (Phase 3B)
- ยังไม่มี automatic rollback / health-gated rollout (Phase 3)
- ยังไม่มี fleet-wide job orchestration (ใช้ Agent Queue เดิม)
- ยังไม่มี HUB client mode — shell ตรวจ `localhost` เท่านั้น
- ตัวเลข rollout เป็นเปอร์เซ็นต์ของเครื่องในช่องทาง ไม่ใช่เปอร์เซ็นต์ของ artifact
- `fleet_audit_view` เป็น view อ่านอย่างเดียว; การเขียน audit ยังผ่าน `AuditService`

## การใช้งานหลัง Cold Soak

1. backup DB และทดสอบ restore (ตาม `docs/BACKUP-RESTORE.md` ถ้ามี)
2. `npx prisma migrate deploy` ใน `sovereign-os/core-api` — สร้างตาราง `fleet_*` + view
3. `node scripts/fleet-backfill.mjs` (dry-run) แล้ว `--apply` ถ้ามี JSON เดิม
4. `docker restart sovereign-core-api` — ให้ route `/api/fleet` ใช้ DB-backed services
5. เปิด `/fleet` ด้วยบัญชี SUPERADMIN
6. สร้างรหัสเชิญสำหรับสาขาใหม่ แล้วนำไปใส่ในตัวติดตั้งเครื่องใหม่
7. ตั้ง `site` / `group` ให้เครื่องที่ลงทะเบียนแล้ว
8. ปรับ rollout: canary น้อย → beta → stable 100

> สถานะ 23/10/69: migration + backfill + restart production เรียบร้อยแล้ว — `/fleet` และ API ตอบ 200
> (backup/restore drill ผ่าน) · หากต้อง migrate ครั้งถัดไปให้ทำ backup + restore test ทุกครั้ง

> **Incident 23/10/69 (แก้แล้ว):** full verify เคยรัน `agent-pack.test.mjs` แล้ว `runPack` ที่ไม่ได้ส่ง
> `updateDataDir` ไปเผยแพร่ทับ `core-api/data/agent-updates/` ด้วย key ของเทสต์ (`agent-pack-test-key`)
> ทำให้ HUB เห็น manifest ที่ runner จริงไม่ trust · แก้โดยให้ทุก `runPack` ในเทสต์ส่ง `updateDataDir`
> ลง sandbox + เพิ่ม guard ใน `afterEach` ห้าม production manifest เปลี่ยน · repack production ใหม่ด้วย
> key `fleet-update-v1` เป็นเวอร์ชัน `ab6b8b43b256` (ตรวจลายเซ็นผ่าน) — **ยังไม่ restart ในรอบนั้น**
> (โค้ด API ยังเป็นรุ่นก่อน Phase 3A) · **24/10/69 12:32 เจ้าของอนุมัติ → restart แล้ว** และพิสูจน์ที่รันจริง:
> `readVerifiedUpdateManifest()` = `ok:true` (`ab6b8b43b256`, ed25519, 20 ไฟล์) · container healthy, restarts=0

## เทสต์

- `sovereign-os/core-api/tests/fleetPolicy.test.ts` — validation, rollout, compliance, override, file store
- `sovereign-os/core-api/tests/fleetEnrollment.test.ts` — token lifecycle, hash-only, expiry, revoke, release
- `sovereign-os/core-api/tests/fleetPhase2-db.test.ts` — DB tables/view/policy/override/token/use log/audit (gated `RUN_DB_TESTS=1`)
- `sovereign-os/core-api/tests/fleetScope.test.ts` — SITE_ADMIN scope: fail closed, กรองเครื่อง/summary/channels, machineIds
- `tools/test/fleet-site-scope.test.mjs` — static wiring: enum/FK/index/migration, guard รายเส้น, auth select, audit machineIds, users ผูกสาขา
- `tools/test/fleet-control-plane.test.mjs` — หน้า/เมนู/route wiring/ด่านอัปเดต/กัน token_hash รั่ว
- `tools/test/fleet-phase2-persistence.test.mjs` — migration/schema/owners/routes/backfill guards
- `sovereign-os/core-api/tests/agentUpdate.test.ts` — manifest/ลายเซ็น Ed25519 + route 503 เมื่อไม่ผ่าน trust
- `sovereign-os/agent-runner/test/selfUpdate.test.mjs` — runner ตรวจลายเซ็นก่อนแตะไฟล์
- `tools/test/update-trust-key.test.mjs` — public key/keyId ตรงกันสองฝั่ง
- `tools/test/migration-bom.test.mjs` — กัน BOM ใน migration (เคสจริง 23/10/69)
- `tools/test/agent-pack.test.mjs` — ชุดแพ็ก + guard กันเทสต์เขียน production `agent-updates/manifest.json` (incident 23/10/69)

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`fleet_channels` · `fleet_enrollment_tokens` · `fleet_enrollment_uses` · `fleet_groups` · `fleet_machine_overrides` · `fleet_rollouts` · `fleet_settings` · `fleet_sites`

### Routes
- `fleet/fleet.routes.ts` (248 บรรทัด)

### Endpoints (จาก router)
```
GET /overview
GET /policy
PUT /policy
GET /sites
GET /groups
GET /audit
GET /enroll-tokens
POST /enroll-tokens
POST /enroll-tokens/:id/revoke
PUT /machines/:id
POST /machines/:id/rotate-token
```

### Services ที่ทำงานให้โมดูลนี้
`fleet-enrollment.service` · `fleet-overview.service` · `fleet-persistence.service` · `fleet-policy.service`

<!-- auto:end -->
