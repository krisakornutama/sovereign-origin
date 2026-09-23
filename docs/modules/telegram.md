# โมดูล telegram

## เจตนา

_(เจ้าของโมดูลเติม — 1–3 บรรทัด: โมดูลนี้มีอยู่เพื่ออะไร ใครใช้)_

## ข้อห้าม / ระวัง

_(เจ้าของโมดูลเติม — อะไรที่ห้ามแตะ/ต้องระวังเป็นพิเศษ)_
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
_(ยังไม่มีตารางใน owners map)_

### Routes
- `telegram/telegram.routes.ts` (252 บรรทัด)

### Endpoints (จาก router)
```
GET /config
PUT /config
DELETE /config
GET /updates
POST /test
POST /notify
POST /photo
```

### Services ที่ทำงานให้โมดูลนี้
`telegram-agent-bot.service` · `telegram-alert.service` · `telegram-credentials.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- telegram → auth(users)

<!-- auto:end -->
