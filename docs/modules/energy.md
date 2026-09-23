# โมดูล energy — พลังงาน/มิเตอร์/เกณฑ์เตือน

## เจตนา
บันทึกการใช้ไฟ ตั้งเกณฑ์เตือน และรายงานสรุป — migration `add_energy_full` (23 ก.ย.) คือโครงชุดเต็ม

## ตารางที่เป็นเจ้าของ
- `energy_readings` — ค่ามิเตอร์ตามเวลา (Timescale hypertable)
- `energy_thresholds` — เกณฑ์เตือนต่อจุดวัด

## Endpoints (mounted ที่ `/api/energy`)
- `GET /summary` · `POST|GET /readings`
- เกณฑ์: `GET|POST /thresholds` · `PATCH|DELETE /thresholds/:id` · `POST /check`

## กลไกสำคัญ
- ⚠️ เคสจริง 23-09: migration `add_energy_full` ถูกเขียนไว้ใน repo แต่ไม่เคยลง prod — ตารางหายจนวันนั้น ปัจจุบัน `prisma migrate status` สะอาดแล้ว
- Service: `energy.service.ts`

## ห้ามแตะ / ระวัง
- การอ่านมิเตอร์เป็นข้อมูล append-only — ห้ามแก้ค่าย้อนหลัง ให้เพิ่ม reading ใหม่แทน
