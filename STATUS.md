# STATUS — สถานะปัจจุบัน

> ไฟล์นี้สร้างโดย `node tools/status-doc.mjs --write` — **ห้ามแก้มือ** (แก้ที่ข้อมูลต้นทางแล้ว gen ใหม่)
> สร้างเมื่อ: 2026-11-03T16:06:03.398Z
> ประวัติงานย้อนหลัง: [docs/history/status-journal-2026-10.md](docs/history/status-journal-2026-10.md)
> คิวงาน / สิ่งที่ต้องทำต่อ: [QUEUE.md](QUEUE.md)

## สรุป
- Quality gate: ✅ ผ่าน 6/6 — 2026-11-03 23:05
- Nightly: ❌ ไม่ผ่าน — 2026-11-03 02:00
- ประวัติ nightly: ✅ ครบ 7 วัน
- เครื่อง: ✅ ปกติ — แรมว่าง 3.7 GB · ดิสก์ว่าง 50 GB
- Task scheduler: ❌ ล้ม 2 งาน — ShipShop 23:59, Verify 02:00

## Quality gate — `npm run verify`

ผลล่าสุด: ✅ ผ่าน · 6/6 ขั้น · 2026-11-03 23:05

| ขั้น | ผล |
| --- | --- |
| backend: clean dist (stale-output sweep) | ✅ |
| frontend: typecheck (tsc) | ✅ |
| tools: unit tests (node --test) | ✅ |
| backend: build (tsc) | ✅ |
| frontend: build (next) | ✅ |
| backend: test | ✅ |

## Nightly — รอบล่าสุด

- ผล: ❌ ไม่ผ่าน (1 นาที)
- เวลา: 2026-11-03 02:00
- เกตในรอบนั้น: ❌ · โค้ดตรงกับ dist: ❌
- migration head: `20261103120000_add_user_consents`
- ขั้นที่ข้าม: IndexNow, SEO pre-flight, GSC coverage

## ประวัติ nightly — 7 วันล่าสุด

| วัน | ผล | นาที |
| --- | --- | --- |
| 2026-10-27 | ✅ | 13 |
| 2026-10-28 | ✅ | 18 |
| 2026-10-29 | ✅ | 17 |
| 2026-10-30 | ✅ | 15 |
| 2026-10-31 | ❌ | 5 |
| 2026-11-01 | ❌ | 4 |
| 2026-11-02 | ❌ | 1 |

## เครื่อง

- สถานะ: ✅ ปกติ
- แรมว่าง: 3.7 GB · ดิสก์ว่าง: 50 GB
- วัดเมื่อ: 2026-11-03 23:03
- ปัญหา: —

## Task scheduler

| งาน | ล่าสุด | ผล |
| --- | --- | --- |
| ShipShop 23:59 | 2/11/2569 23:59:59 | ❌ 0x00000001 |
| DB Backup 03:00 | 3/11/2569 03:00:00 | ✅ OK |
| Docker Watch | 3/11/2569 23:03:03 | ✅ OK |
| Machine Watch | 3/11/2569 23:03:03 | ✅ ยังไม่เคยรัน (0x41303) |
| Gate 03:20 | 3/11/2569 03:20:20 | ✅ OK |
| Verify 02:00 | 3/11/2569 02:00:00 | ❌ 0x00000001 |
| Digest 08:00 | 3/11/2569 08:00:00 | ✅ OK |
| Offsite 03:30 | 3/11/2569 03:30:30 | ✅ OK |
| Synthetic Check | 3/11/2569 23:01:01 | ✅ OK |

## ต้องดู (3)

- nightly verify พัง: ขั้นนอก steps — ดู logs/nightly/last-run.log
- task "ShipShop 23:59" 0x00000001
- task "Verify 02:00" 0x00000001

## ที่มา

| ข้อมูล | เวลา | ไฟล์ |
| --- | --- | --- |
| Quality gate | 2026-11-03 23:05 | `sovereign-os/core-api/data/system-truth.json` |
| Nightly | 2026-11-03 02:00 | `logs/nightly/status.json` |
| เครื่อง / task | 2026-11-03 23:03 | `sovereign-os/core-api/data/ops-status.json` |
| ประวัติ nightly | 2026-11-02 | `sovereign-os/core-api/data/nightly-history.json` |

---
_snapshot นี้ไม่ใช่ real-time — ตัวเลขสดอยู่ที่หน้า `/system-health` · อัปเดตด้วย `node tools/status-doc.mjs --write`_
