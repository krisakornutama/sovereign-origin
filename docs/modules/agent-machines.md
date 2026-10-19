# โมดูล agent-machines

## เจตนา

HUB กลางรับคำสั่งงานจากหน้าเว็บ Agent Queue / Telegram ส่งไปให้ runner บนเครื่องคอมเครื่องอื่น
ดึงงานผ่าน LAN แบบ pull — รวมคิวงาน, ด่านอนุมัติงานเสี่ยง, ภาพหน้าจอตอนจบงาน,
และระบบแจ้งเตือน (text / voice / call)

## ข้อห้าม / ระวัง

- ตาราง `agent_jobs` มีเจ้าของเป็นโมดูล `agent` — ชั้น routes ห้ามเรียก `prisma` ตรง
  ให้เขียนผ่าน service (agent-machines · orchestrator-approval · orchestrator-queue)
  ที่ประกาศไว้ใน `tools/boundary-baseline.json` แล้วเท่านั้น (เขียนตรง = arch-gate fail)
- route ใหม่จะตอบ 404 จนกว่า `docker restart sovereign-core-api` — container mount `src` จาก MAIN
- งานเสี่ยง (`awaiting_approval`) ห้ามปล่อยให้ runner ดึงไปทำเอง ไม่ว่ากรณีใด
> **Fleet Control Plane (19/10/69):** `GET /update/manifest`, `GET /update/file`,
> `GET /desktop-update/manifest`, `GET /desktop-update/asset` ผ่านด่านช่องทาง/rollout
> (404 `rollout_hold` หรือ 403 `machine_disabled`) — ดู `docs/modules/fleet.md`
> `GET /node-kits/manifest` และ `/node-kits/asset` ยังสาธารณะและระบุ `channel: "stable"`

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `agent-machines/agent-machines.routes.ts` (373 บรรทัด)

### Endpoints (จาก router)
```
GET /
POST /register
POST /:id/status
POST /jobs
GET /queue
GET /call-status
PUT /call-phone
DELETE /call-phone
POST /call-test
GET /screenshots/:file
POST /queue/:id/cancel
POST /queue/:id/approve
POST /queue/:id/reject
POST /queue/:id/repeat
POST /heartbeat
POST /jobs/pull
POST /jobs/:id/result
```

<!-- auto:end -->
