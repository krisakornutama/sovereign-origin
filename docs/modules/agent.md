# โมดูล agent

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`agent_jobs` · `agent_roles`

### Routes
- `agent/agent.routes.ts` (122 บรรทัด)

### Endpoints (จาก router)
```
GET /roles
POST /roles/seed
POST /roles
PUT /roles/:id
DELETE /roles/:id
POST /roles/:id/run
GET /jobs
GET /jobs/:id
POST /jobs/:id/cancel
DELETE /jobs/:id
```

### Services ที่ทำงานให้โมดูลนี้
`agent-actions.service` · `agent-policy.service` · `agent-team.service` · `agent-workspace.service` · `business-agent-executor.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- agent → devices(devices)
- agent → farm(farm_plots)
- agent → health(health_flags)
- agent → infrastructure(water_quality_readings)
- agent → inventory(inventory_items)
- agent → knowledge(knowledge_items)
- agent → risk(risk_headlines)
- agent → teach-kids(kid_profiles)

<!-- auto:end -->
