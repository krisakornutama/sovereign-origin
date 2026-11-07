# STATUS — สถานะปัจจุบัน

> ไฟล์นี้สร้างโดย `node tools/status-doc.mjs --write` — **ห้ามแก้มือ** (แก้ที่ข้อมูลต้นทางแล้ว gen ใหม่)
> สร้างเมื่อ: 2026-11-07T14:21:23.613Z
> ประวัติงานย้อนหลัง: [docs/history/status-journal-2026-10.md](docs/history/status-journal-2026-10.md)
> คิวงาน / สิ่งที่ต้องทำต่อ: [QUEUE.md](QUEUE.md)

## สรุป
- Quality gate: ✅ ผ่าน 6/6 — 2026-11-07 21:21
- Nightly: ✅ ผ่าน — 2026-11-07 21:15
- ประวัติ nightly: ✅ ครบ 7 วัน
- เครื่อง: ✅ ปกติ — แรมว่าง 4.5 GB · ดิสก์ว่าง 83 GB
- Task scheduler: ✅ ปกติ (10 งาน)

## Quality gate — `npm run verify`

ผลล่าสุด: ✅ ผ่าน · 6/6 ขั้น · 2026-11-07 21:21

| ขั้น | ผล |
| --- | --- |
| backend: clean dist (stale-output sweep) | ✅ |
| frontend: typecheck (tsc) | ✅ |
| tools: unit tests (node --test) | ✅ |
| backend: build (tsc) | ✅ |
| frontend: build (next) | ✅ |
| backend: test | ✅ |

## Nightly — รอบล่าสุด

- ผล: ✅ ผ่าน (3 นาที)
- เวลา: 2026-11-07 21:15
- เกตในรอบนั้น: ✅ · โค้ดตรงกับ dist: ❌
- migration head: `20261104120000_invite_codes`
- consent smoke: ✅ OK · 6/7 · ⚠️ 1 คำเตือน
- ขั้นที่ข้าม: IndexNow, SEO pre-flight, GSC coverage

## ประวัติ nightly — 7 วันล่าสุด

| วัน | ผล | นาที |
| --- | --- | --- |
| 2026-11-01 | ❌ | 4 |
| 2026-11-02 | ❌ | 1 |
| 2026-11-03 | ❌ | 5 |
| 2026-11-04 | ❌ | 1 |
| 2026-11-05 | ❌ | 4 |
| 2026-11-06 | ❌ | 4 |
| 2026-11-07 | ✅ | 3 |

## เครื่อง

- สถานะ: ✅ ปกติ
- แรมว่าง: 4.5 GB · ดิสก์ว่าง: 83 GB
- วัดเมื่อ: 2026-11-07 21:21
- ปัญหา: —

## Task scheduler

| งาน | ล่าสุด | ผล |
| --- | --- | --- |
| ShipShop 23:59 | 6/11/2569 23:59:59 | — ปิดอยู่ (ตั้งใจ) |
| DB Backup 03:00 | 7/11/2569 03:00:00 | ✅ OK |
| Docker Watch | 7/11/2569 21:21:21 | ✅ OK |
| Machine Watch | 7/11/2569 21:13:13 | ✅ OK |
| Deadman 03:30 | — | ✅ ยังไม่เคยรัน (0x41303) |
| Gate 03:20 | 7/11/2569 03:20:20 | ✅ OK |
| Verify 02:00 | 7/11/2569 21:12:12 | ✅ OK |
| Offsite 03:30 | 7/11/2569 03:30:30 | ✅ OK |
| Digest 08:00 | 7/11/2569 08:00:00 | ✅ OK |
| Synthetic Check | 7/11/2569 21:16:16 | ✅ OK |

## ที่มา

| ข้อมูล | เวลา | ไฟล์ |
| --- | --- | --- |
| Quality gate | 2026-11-07 21:21 | `sovereign-os/core-api/data/system-truth.json` |
| Nightly | 2026-11-07 21:15 | `logs/nightly/status.json` |
| เครื่อง / task | 2026-11-07 21:21 | `sovereign-os/core-api/data/ops-status.json` |
| ประวัติ nightly | 2026-11-07 | `sovereign-os/core-api/data/nightly-history.json` |

---
_snapshot นี้ไม่ใช่ real-time — ตัวเลขสดอยู่ที่หน้า `/system-health` · อัปเดตด้วย `node tools/status-doc.mjs --write`_
