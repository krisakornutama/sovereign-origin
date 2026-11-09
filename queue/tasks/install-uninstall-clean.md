---
id: install-uninstall-clean
title: ติดตั้งจบครั้งเดียว + ถอนสะอาด (ไม่มีเศษค้าง)
priority: 2
status: todo
owner: null
created: 2026-11-09
depends_on: []
gate: npm run verify
tests_first: true
scope:
  - tools/install/
  - sovereign-os/infra/
---

## ทำไม

`docs/PRODUCT-DIRECTION.md` D1 ล็อกไว้ว่า "ขายให้คนอื่นติดตั้งเอง" แต่ข้อ 5 "ถอน/uninstall ได้สะอาด"
ยังไม่มี · ถ้าถอนแล้วเหลือ service / scheduled task / shortcut / volume ค้าง = ลูกค้าเสียเครื่อง
และเราเสียคำพูด (ตรงกับ no-regret list ที่ต้องทำเลย)

## Acceptance

- [ ] `uninstall` หยุด scheduled task + container แต่ **ไม่ลบ volume** เว้นแต่ `--purge-data`
- [ ] `--purge-data` ลบ volume + backup พร้อมคำเตือน "กู้คืนไม่ได้"
- [ ] ถอนซ้ำได้ (คำสั่งที่ล้มเหลวถูกทำเครื่องหมาย tolerateFailure)
- [ ] Linux/macOS ไม่แตะ schtasks
- [ ] รายการสิ่งที่ "ไม่ถอน" (ข้อมูลผู้ใช้) ถูกพิมพ์บอกก่อนจบ
- [ ] เทสต์ครอบทุกข้อข้างบน และรันได้บน Windows + Linux (ข้ามเทสต์ที่ผูก OS เท่านั้น)

## หลักฐานที่ต้องแนบตอนปิดงาน

ผลรันบนเครื่องจริง 1 รอบ (ก่อน/หลัง) + exit code
