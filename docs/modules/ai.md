# โมดูล ai

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`chat_messages`

### Routes
- `ai/ai-chat.routes.ts` (35 บรรทัด)
- `ai/ai.routes.ts` (707 บรรทัด)

### Endpoints (จาก router)
```
POST /chat
GET /local-status
PUT /enabled
PUT /model
GET /status
GET /policy
PUT /policy
GET /approvals
POST /approvals/:id/approve
POST /approvals/:id/reject
GET /history
DELETE /history
DELETE /history/:id
POST /advisor
POST /advisor/what-if
POST /voice-command
GET /voice-query
POST /voice-history
GET /voice-history
```

### Services ที่ทำงานให้โมดูลนี้
`ai-analyst.service` · `ai-kill-switch.service` · `ai-model-manager.service` · `ai-router.service` · `AiAgentService` · `chat-memory.service` · `local-llm.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- ai → farm(farm_plots)
- ai → inventory(inventory_items)
- ai → knowledge(knowledge_items)
- ai → relay(relays)
- ai → teach-kids(kid_chores)
- ai → teach-kids(kid_investments)
- ai → teach-kids(kid_lesson_progress)
- ai → teach-kids(kid_piggy_txs)
- ai → teach-kids(kid_profiles)
- ai → treasury(asset_positions)

<!-- auto:end -->
