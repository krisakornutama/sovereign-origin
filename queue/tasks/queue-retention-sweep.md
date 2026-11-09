---
id: queue-retention-sweep
title: Offline queue retention sweep (ตัดคิวเกิน 30 วัน + audit ก่อนลบ)
priority: 1
status: doing
owner: buffy
claimed: 2026-11-09T16:26:46.274Z
created: 2026-11-09
depends_on: []
gate: npm run verify
tests_first: true
scope:
  - sovereign-frontend/src/lib/offline/queue-retention.ts
  - sovereign-frontend/src/lib/offlineQueue.ts
  - sovereign-frontend/src/pages/settings.tsx
---

## ทำไม

คิวออฟไลน์ที่ flush ไม่สำเร็จจะถูก retry ตลอดกาล และคิว legacy (ก่อน P0) อยู่ในสถานะ Dormant
โดยไม่มีใครเห็น → ข้อมูลโตไม่มีขอบเขตและผู้ใช้ไม่มีทางรู้ว่าอะไรถูกลบไปแล้ว

แผนฉบับเต็มพร้อม invariants R1–R7 อยู่ใน `docs/OFFLINE-QUEUE-RETENTION-PLAN.md`

## Acceptance

- [ ] `splitByAge()` ตัดสินจาก `queuedAt` เท่านั้น (30 วันพอดี = เก็บ, เกิน = ตัด)
- [ ] เขียน audit ลง store ใหม่ **ก่อน** ลบ — เขียนล้ม = ไม่มีการลบ (write-ahead)
- [ ] audit cap 50 รายการล่าสุด เรียงใหม่→เก่า
- [ ] removables ว่าง = ไม่เขียนบันทึกเปล่า
- [ ] คิวที่เหลือ (kept) ลำดับ FIFO เดิมไม่เปลี่ยน
- [ ] หน้า settings แสดงบรรทัดสรุปรอบล่าสุด
- [ ] เทสต์แดงก่อน implement (exit 1) แล้วเขียวครบ · `npm run verify` = 0

## หลักฐานที่ต้องแนบตอนปิดงาน

คำสั่งที่รัน + exit code + เลข PR/commit
