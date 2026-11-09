---
id: queue-retention-sweep
title: Offline queue retention sweep (ตัดคิวเกิน 30 วัน + audit ก่อนลบ)
priority: 1
status: done
owner: buffy
claimed: 2026-11-09T16:26:46.274Z
completed: 2026-11-09T16:53:20.211Z
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

## Report — 2026-11-09T16:53:20.211Z

Sweep runs on boot and on settings mount; queue rows older than 30 days are removed only after the audit record is written (write-ahead), audit store capped at 50, last sweep summarised in settings. Evidence: queue-retention.test.ts 11/11, npm run verify 6/6 (arch + frontend gate), arch-gate now runs tools/test/frontend-queue-retention.test.mjs, CI 8/8 green on 0dcee0f.
