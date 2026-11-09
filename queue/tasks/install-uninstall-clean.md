---
id: install-uninstall-clean
title: ติดตั้งจบครั้งเดียว + ถอนสะอาด (ไม่มีเศษค้าง)
priority: 2
status: done
owner: buffy
claimed: 2026-11-09T17:25:49.439Z
completed: 2026-11-09T17:50:03.394Z
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

## Report — 2026-11-09T17:50:03.394Z

Uninstall plan now lists what stays on the machine (volume, backups, images, install dir, .env) and prints it again after the run; acceptance tests U1-U8 cover no-volume-delete by default, --purge-data volume+backup removal with an unrecoverable warning, tolerateFailure on every executable step (re-runnable), no schtasks on Linux/macOS, manual --remove-files per OS, and the kept list matching the flags. Found and fixed a shipping bug: .gitignore allowed install.* but not uninstall.mjs/.sh/.cmd, so the uninstaller never reached a clone or customer bundle. Evidence: tools/test/uninstall-clean.test.mjs 8/8; real run on Windows = dry-run exit 0 with before/after identical (no 'Sovereign Agent Runner' task, 6 sovereign containers still up); --yes was NOT run because this machine hosts live containers. npm run verify 6/6; CI 8/8 green on 4542513.
