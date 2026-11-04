# Open-Core: เส้นแบ่ง Community Edition กับ Pro

> สถานะ 04/11/69: **แยกโค้ดแล้ว (Clean Hard Cut)** — CE ใน repo นี้ไม่มีโมดูล Pro แล้ว
> (Pro อยู่ที่ private repo `project-sovereign-pro`) ด่านกันถอยหลัง: `node tools/verify/open-core-boundary.mjs --check`

## หลักคิด

- **CE (public, AGPL-3.0)** = สิ่งที่ทำให้คนลองแล้ว "ว้าว" ได้ใน 10 นาที: วัดค่า · แจ้งเตือน · ดูย้อนหลัง
- **Pro (private, ขายบน Gumroad)** = สิ่งที่ธุรกิจยอมจ่ายเพราะประหยัดเวลา/เงิน: งานขาย การเงิน ฟลีต
- ถ้าไม่แน่ใจ ให้อยู่ CE — ชุมชนช่วยหาบั๊กฟรี ซึ่งมีค่ามากกว่ายอดขายที่เสียไปจากการให้ฟรีเกิน

## เส้นแบ่ง

| อยู่ CE (public) | อยู่ Pro (private) |
|---|---|
| telemetry / sensors / MQTT ingest | business (ร้านค้า/ออเดอร์/ใบกำกับ) |
| alerts + fanout (Telegram/Discord/LINE) | shop / storefront / checkout |
| dashboard สภาพแวดล้อม + alert history | treasury (กระทบยอด/บัญชี) |
| health / machine-health / backup พื้นฐาน | POS เต็มรูปแบบ + เครื่องพิมพ์ใบเสร็จ |
| auth พื้นฐาน (login, role) | fleet control plane (rollout/ช่องทาง/compliance) |
| consent / privacy (PDPA) — *ต้องอยู่ CE* | e-Tax / CA integration |
| docker compose + installer | multi-tenant / SSO องค์กร |

**ห้ามตัดออกจาก CE:** consent, privacy policy, audit พื้นฐาน — สองอย่างแรกเป็นสิทธิ์ตามกฎหมายของผู้ใช้
การซ่อนไว้หลัง paywall จะทำให้ CE ใช้ในองค์กรไม่ได้เลย

## สิ่งที่ต้องทำตอนแยกจริง

1. ย้ายโมดูล Pro ไป repo `sovereign-pro` (ประวัติ git แยก ไม่ใช่ subtree ที่ยังหลุด)
2. `ENABLED_MODULES` ใน CE ต้องไม่มีชื่อโมดูล Pro — ถ้ามีโค้ดอ้างถึง ต้องมี fallback ที่อ่านง่าย ไม่ใช่ 500
3. `module-owners.json` + boundary baseline ต้องผ่าน arch-gate หลังตัด
4. เพิ่มด่านเทสต์: CE ต้อง build/รันได้โดยไม่มีโฟลเดอร์ Pro (พิสูจน์ด้วย CI ที่ checkout เฉพาะ CE)
5. ตรวจว่า docs/tests ของ CE ไม่อ้างเส้น API ของ Pro

## License

- CE: AGPL-3.0 (ดู `LICENSE`) — กันบริษัทนำไปทำ SaaS ปิดโค้ดแข่ง
- Pro: สัญญาเชิงพาณิชย์รายปี/ตลอดชีพ + license key (Ed25519, ตรวจแบบออฟไลน์ได้ — ใช้โครง signed manifest ที่มีอยู่)
