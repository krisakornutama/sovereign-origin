# โมดูล risk

## เจตนา
เครื่องจำลอง "ถ้า-แล้ว" และเรดาร์ความเสี่ยง (หน้า /scenarios ใช้โมดูลนี้) — เก็บเหตุการณ์ DEFCON, พาดหัวความเสี่ยง (risk_headlines) และเปิด `/api/risk-monitor` ให้ฝั่งซีนาริโอดึงไปคำนวณพยากรณ์

## ข้อห้าม / ระวัง
- ผลซีนาริโอเป็น **การคาดการณ์ ไม่ใช่ข้อมูลจริง** — UI ต้องระบุชัดว่าเป็นแบบจำลอง ห้ามผสมเข้าหน้าข้อมูลจริง (dashboard/trace)
- ตาราง `defcon_events` / `risk_headlines` เป็นของโมดูลนี้ — ห้ามเขียนจากโมดูลอื่นนอกเหนือที่ baseline รับไว้
- ห้าม hardcode ค่าความเสี่ยงในโค้ด — ต้องมาจากเหตุการณ์/แหล่งข้อมูลจริงของโมดูล
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`defcon_events` · `risk_headlines`

### Routes
- `risk/risk.routes.ts` (212 บรรทัด)

### Endpoints (จาก router)
```
GET /overview
GET /headlines
GET /history
POST /refresh
POST /defcon/drill
POST /stress-test
POST /scenarios
GET /scenarios/history
GET /scenarios/latest
GET /defcon
```

### Services ที่ทำงานให้โมดูลนี้
`aladdin-risk.service` · `defcon-actions.service` · `defcon-engine.service` · `risk-monitor.service`

<!-- auto:end -->
