# STATUS — สถานะปัจจุบัน

> ไฟล์นี้สร้างโดย `node tools/status-doc.mjs --write` — **ห้ามแก้มือ** (แก้ที่ข้อมูลต้นทางแล้ว gen ใหม่)
> สร้างเมื่อ: 2026-11-07T07:04:09.867Z
> ประวัติงานย้อนหลัง: [docs/history/status-journal-2026-10.md](docs/history/status-journal-2026-10.md)
> คิวงาน / สิ่งที่ต้องทำต่อ: [QUEUE.md](QUEUE.md)

## สรุป
- Quality gate: ❌ ไม่ผ่าน (5/6) — 2026-11-07 02:03
- Nightly: ❌ ไม่ผ่าน — tools: unit tests (node --test), backup restore-check — 2026-11-07 02:03
- ประวัติ nightly: ✅ ครบ 7 วัน
- เครื่อง: ✅ ปกติ — แรมว่าง 1.9 GB · ดิสก์ว่าง 76 GB
- Task scheduler: ❌ ล้ม 3 งาน — Synthetic Check, Verify 02:00, ShipShop 23:59

## Quality gate — `npm run verify`

ผลล่าสุด: ❌ ไม่ผ่าน · 5/6 ขั้น · 2026-11-07 02:03

| ขั้น | ผล |
| --- | --- |
| backend: clean dist (stale-output sweep) | ✅ |
| frontend: typecheck (tsc) | ✅ |
| backend: build (tsc) | ✅ |
| frontend: build (next) | ✅ |
| backend: test | ✅ |
| tools: unit tests (node --test) | ❌ |

## Nightly — รอบล่าสุด

- ผล: ❌ ไม่ผ่าน (4 นาที)
- เวลา: 2026-11-07 02:03
- เกตในรอบนั้น: ❌ · โค้ดตรงกับ dist: ✅
- migration head: `20261104120000_invite_codes`
- ขั้นเสริมที่ล้ม: backup restore-check
- consent smoke: ✅ OK · 6/7 · ⚠️ 1 คำเตือน
- ขั้นที่ข้าม: IndexNow, SEO pre-flight, GSC coverage

## ประวัติ nightly — 7 วันล่าสุด

| วัน | ผล | นาที |
| --- | --- | --- |
| 2026-10-31 | ❌ | 5 |
| 2026-11-01 | ❌ | 4 |
| 2026-11-02 | ❌ | 1 |
| 2026-11-03 | ❌ | 5 |
| 2026-11-04 | ❌ | 1 |
| 2026-11-05 | ❌ | 4 |
| 2026-11-06 | ❌ | 4 |

## เครื่อง

- สถานะ: ✅ ปกติ
- แรมว่าง: 1.9 GB · ดิสก์ว่าง: 76 GB
- วัดเมื่อ: 2026-11-07 14:03
- ปัญหา: —

## Task scheduler

| งาน | ล่าสุด | ผล |
| --- | --- | --- |
| Offsite 03:30 | 7/11/2569 03:30:30 | ✅ OK |
| Gate 03:20 | 7/11/2569 03:20:20 | ✅ OK |
| Machine Watch | 7/11/2569 14:03:03 | ✅ ยังไม่เคยรัน (0x41303) |
| Digest 08:00 | 7/11/2569 08:00:00 | ✅ OK |
| Synthetic Check | 7/11/2569 14:01:01 | ❌ 0x00000001 |
| Docker Watch | 7/11/2569 14:03:03 | ✅ OK |
| Verify 02:00 | 7/11/2569 02:00:00 | ❌ 0x00000001 |
| DB Backup 03:00 | 7/11/2569 03:00:00 | ✅ OK |
| ShipShop 23:59 | 6/11/2569 23:59:59 | ❌ 0x00000001 |

## ต้องดู (4)

- nightly verify พัง: tools: unit tests (node --test), backup restore-check
- task "ShipShop 23:59" 0x00000001
- task "Verify 02:00" 0x00000001
- task "Synthetic Check" 0x00000001

## ที่มา

| ข้อมูล | เวลา | ไฟล์ |
| --- | --- | --- |
| Quality gate | 2026-11-07 02:03 | `sovereign-os/core-api/data/system-truth.json` |
| Nightly | 2026-11-07 02:03 | `logs/nightly/status.json` |
| เครื่อง / task | 2026-11-07 14:03 | `sovereign-os/core-api/data/ops-status.json` |
| ประวัติ nightly | 2026-11-06 | `sovereign-os/core-api/data/nightly-history.json` |

---
_snapshot นี้ไม่ใช่ real-time — ตัวเลขสดอยู่ที่หน้า `/system-health` · อัปเดตด้วย `node tools/status-doc.mjs --write`_
