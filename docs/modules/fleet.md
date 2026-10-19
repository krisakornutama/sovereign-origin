# โมดูล fleet — Fleet Control Plane v1

## เจตนา

รวมเครื่องที่ลงทะเบียนกับ HUB ให้เจ้าของเห็นและควบคุมเป็น “ฝูง” ไม่ใช่ทีละเครื่อง:
เครื่องไหนออนไลน์/ออฟไลน์ อยู่สาขาไหน อยู่ช่องทางอัปเดตไหน ควรได้อัปเดตหรือยัง
และใครถือรหัสเชิญที่ยังใช้ได้

เวอร์ชันนี้เป็น **file-backed** โดยเจตนา — ไม่เพิ่มตาราง/คอลัมน์ และไม่ต้อง migration
ระหว่าง Cold Soak ข้อมูลอยู่ใต้ volume เดียวกับ manifest อัปเดต:

```
core-api/data/fleet/policy.json
core-api/data/fleet/enrollment-tokens.json
```

> เป้าหมายของ v1 คือ “ควบคุมได้จริงและตรวจสอบย้อนหลังได้” ไม่ใช่ระบบ SaaS หลายองค์กรเต็มรูปแบบ
> ข้อจำกัดที่ยังไม่ทำอยู่ในหัวข้อ [ยังไม่ทำใน v1](#ยังไม่ทำใน-v1)

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `src/services/fleet-store.service.ts` | อ่าน/เขียน JSON แบบ atomic, lock ภายในโปรเซส, sanitizer พื้นฐาน |
| `src/services/fleet-policy.service.ts` | นโยบายช่องทาง, override ต่อเครื่อง, rollout bucket, compliance, ด่านอัปเดต |
| `src/services/fleet-enrollment.service.ts` | รหัสเชิญแบบ hash + วันหมดอายุ + จำนวนเครื่อง + เพิกถอน |
| `src/services/fleet-overview.service.ts` | ประกอบภาพรวมสำหรับหน้า `/fleet` (อ่านจากแหล่งเดิมทั้งหมด) |
| `src/modules/fleet/fleet.routes.ts` | API `/api/fleet/*` — SUPERADMIN เท่านั้น |
| `sovereign-frontend/src/pages/fleet.tsx` | หน้า Fleet Console |
| `sovereign-frontend/src/components/fleet/*` | แผงนโยบาย/รหัสเชิญ/ตารางเครื่อง |

## สถานะที่เก็บ (ไม่มี DB)

### `policy.json`

```json
{
  "version": 1,
  "updatedAt": "2026-10-19T00:00:00.000Z",
  "updatedBy": "user-id หรือ null",
  "defaultChannel": "stable",
  "channels": {
    "stable": { "label": "Stable", "rolloutPercent": 100 },
    "beta":   { "label": "Beta",   "rolloutPercent": 25 },
    "canary": { "label": "Canary", "rolloutPercent": 5 }
  },
  "requireLanVerification": true,
  "notes": null,
  "machines": {
    "<machine-id>": {
      "channel": "beta",
      "site": "สาขาเชียงใหม่",
      "group": "ครัว",
      "tags": ["pos"],
      "notes": "ชั้น 2",
      "updatedAt": "...",
      "updatedBy": "..."
    }
  }
}
```

- `rolloutPercent` เป็นจำนวนเต็ม 0–100
- ช่องทางที่รองรับมีสามค่าเท่านั้น: `stable`, `beta`, `canary`
- `machines` เป็น override รายเครื่อง; ไม่มีรายการ = ใช้ค่าเริ่มต้น
- ไฟล์หาย/เสีย → ใช้ค่าเริ่มต้นแบบ fail-closed (ไม่ throw ทำให้ API ล่ม)

### `enrollment-tokens.json`

```json
{
  "version": 1,
  "tokens": [
    {
      "id": "uuid",
      "label": "สาขาเชียงใหม่",
      "prefix": "enr_ab12cd34",
      "tokenHash": "<sha256 64 hex>",
      "createdAt": "...",
      "createdBy": "user-id",
      "expiresAt": "...",
      "maxUses": 5,
      "usedCount": 0,
      "lastUsedAt": null,
      "lastMachineId": null,
      "lastMachineName": null,
      "revokedAt": null
    }
  ]
}
```

- รหัสจริงรูปแบบ `enr_` + hex 48 ตัว (24 ไบต์สุ่ม) แสดงครั้งเดียวตอนสร้าง
- เก็บเฉพาะ `sha256(token)` — ห้ามเก็บรหัสจริง
- ใช้ได้ไม่เกิน `maxUses` (1–1000) และไม่เกิน `expiresInHours` (1–8760)
- เพิกถอนแล้วใช้ไม่ได้ทันที; รายการที่ใช้ครบ/หมดอายุ/เพิกถอนยังดูย้อนหลังได้
- ถ้าเขียนไฟล์ไม่ได้ ให้ถือว่าสร้างรหัสไม่สำเร็จ (ไม่ตอบ token ที่ใช้ไม่ได้)

## API

ทุก route ผ่าน `authenticate` + `requireRole('SUPERADMIN')`

| Method | Path | ความหมาย |
|---|---|---|
| GET | `/api/fleet/overview` | ภาพรวม + summary + ช่องทาง + เวอร์ชันที่เผยแพร่ + เครื่องทั้งหมด |
| GET | `/api/fleet/policy` | นโยบายสำหรับหน้าเว็บ (ไม่มี override ดิบทั้งก้อน) |
| PUT | `/api/fleet/policy` | แก้ `defaultChannel`, `channels.*.rolloutPercent`, `requireLanVerification` |
| GET | `/api/fleet/enroll-tokens` | รายการรหัสเชิญ (ไม่คืนรหัสจริง/hash) |
| POST | `/api/fleet/enroll-tokens` | สร้างรหัส — คืน `token` จริงครั้งเดียว |
| POST | `/api/fleet/enroll-tokens/:id/revoke` | เพิกถอน |
| PUT | `/api/fleet/machines/:id` | ตั้ง `channel` / `site` / `group` / `tags` / `notes` |
| POST | `/api/fleet/machines/:id/rotate-token` | หมุน machine token — คืน token ใหม่ครั้งเดียว |

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

- ทุก route ของ `/api/fleet` เป็น SUPERADMIN
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

## ข้อจำกัด / ยังไม่ทำใน v1

- ไม่มีตาราง DB — ไม่ query ย้อนหลังแบบ SQL, ไม่มี foreign key กับ `AgentMachine`
- สิทธิ์เป็นระดับ HUB ทั้งฝูง ยังไม่มี “ผู้ดูแลเฉพาะสาขา”
- ยังไม่มี signed manifest (ใช้ SHA-256 ตรวจไฟล์เทียบ manifest)
- ยังไม่มี automatic rollback / health-gated rollout
- ยังไม่มี fleet-wide job orchestration (ใช้ Agent Queue เดิม)
- ยังไม่มี HUB client mode — shell ตรวจ `localhost` เท่านั้น
- ตัวเลข rollout เป็นเปอร์เซ็นต์ของเครื่องในช่องทาง ไม่ใช่เปอร์เซ็นต์ของ artifact

## การใช้งานหลัง Cold Soak

1. `docker restart sovereign-core-api` — ให้ route `/api/fleet` ถูกโหลด
2. rebuild frontend ตามขั้นตอนปกติ — ให้เมนู/หน้า `/fleet` ปรากฏ
3. เปิด `/fleet` ด้วยบัญชี SUPERADMIN
4. สร้างรหัสเชิญสำหรับสาขาใหม่ แล้วนำไปใส่ในตัวติดตั้งเครื่องใหม่
5. ตั้ง `site` / `group` ให้เครื่องที่ลงทะเบียนแล้ว
6. ปรับ rollout: canary น้อย → beta → stable 100

> ระหว่าง Cold Soak: ห้าม restart/migrate/deploy — หน้า `/fleet` จะตอบ 404
> จนกว่าจะ restart ตามขั้นตอนข้างบน และหน้าเว็บจะยังไม่เห็นจนกว่า rebuild

## เทสต์

- `sovereign-os/core-api/tests/fleetPolicy.test.ts` — validation, rollout, compliance, override, store
- `sovereign-os/core-api/tests/fleetEnrollment.test.ts` — token lifecycle, hash-only, expiry, revoke, release
- `tools/test/fleet-control-plane.test.mjs` — หน้า/เมนู/route wiring/ด่านอัปเดต/กัน token_hash รั่ว
