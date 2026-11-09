---
id: license-activation-wiring
title: ต่อไลเซนส์ออฟไลน์เข้า API + UI (สถานะ/เปิด-ปิดฟีเจอร์)
priority: 2
status: todo
owner: null
created: 2026-11-09
depends_on: []
gate: npm run verify
tests_first: true
scope:
  - sovereign-os/core-api/src/routes.ts
  - sovereign-os/core-api/src/modules/license/
  - sovereign-frontend/src/pages/system.tsx
---

## ทำไม

`license.service.ts` (เพิ่ม 9 พ.ย. 69) ตรวจ token ได้แล้ว แต่ยังไม่มีใครเรียกใช้ →
ยังไม่มีการบังคับสิทธิ์จริง สินค้าจึงยัง "ขายไม่ได้" ในความหมายที่ลูกค้าจ่ายแล้วได้ของตาม tier

## Acceptance

- [ ] `GET /api/license` (auth แล้ว) คืน `{valid, reason, tier, features, expiresAt, daysLeft}` — ห้ามคืน token
- [ ] ฟีเจอร์ที่อยู่นอก `features` ถูกปฏิเสธที่ middleware (403) ไม่ใช่ซ่อนแค่ UI
- [ ] ไลเซนส์ไม่ผ่าน = ระบบยังรันโหมด CE (ไม่ล็อกเอาต์ผู้ใช้ ไม่ทำให้ข้อมูลหาย)
- [ ] หน้า `/system` แสดงสถานะไลเซนส์ + วันหมดอายุ
- [ ] เทสต์: valid / expired / wrong-machine / ไม่มีไลเซนส์ (4 เคส) + 403 สำหรับฟีเจอร์นอกสิทธิ์

## หลักฐานที่ต้องแนบตอนปิดงาน

`curl` output ของ 4 เคส + เลข PR
