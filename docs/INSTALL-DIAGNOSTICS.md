# INSTALL-DIAGNOSTICS — "ติดตั้งไม่จบ แล้วบอกเราได้"

> ที่มา: เจ้าของ 27/10/69 — *"ผมไม่รู้ความต้องการของลูกค้า ผมรู้แค่ว่าอยากพัฒนา"*
> ⇒ งานที่ไม่ regrettable ที่สุดคือ ทำให้ **คนอื่นติดตั้งเองได้** และเมื่อไม่จบ เขาส่ง **ใบตรวจ** กลับมาได้
> โดยไม่ต้องส่งรหัส/ความลับให้ใคร

## ใครเรียกอะไร

| ผู้เรียก | คำสั่ง | ตรวจอะไร |
|---|---|---|
| คนติดตั้ง (เครื่องลูก) | ดับเบิลคลิก `INSTALL-CHECK.cmd` | Node · ไฟล์ชุดติดตั้ง · แผนติดตั้ง · สิทธิ์เขียน · ดิสก์ · วิธีลงทะเบียน · HUB `/api/health` · Docker (warn) · ของเดิม |
| คนติดตั้ง (หลังติดตั้ง) | `INSTALL-CHECK.cmd --post` | เพิ่ม: autostart task · runner process · heartbeat ถึง HUB (อ่าน `last_heartbeat`) |
| ตัวติดตั้งเครื่องแม่ | `tools/install/install.mjs` (อัตโนมัติ) | เรียก `runDoctor({ profile: 'hub' })` ใน preflight — compose + template + สิทธิ์ + ดิสก์ + Docker (fail ถ้าขาด) + env เดิม |
| CI / สคริปต์ | `node tools/agent-pack/doctor.mjs [--profile=hub] [--post] [--dry-run]` | อย่างเดียวกับข้างบน แต่คุมด้วย flag ได้ |

`--dry-run` = **ห้าม exec / ห้ามยิงเน็ต / ห้ามเขียนไฟล์ทดสอบ** ใช้ตอน installer ทำ dry-run (preflight ต้องบริสุทธิ์)

## ผลลัพธ์ที่คนอื่นอ่าน

```
[ok]   Node.js — v24.15.0
[warn] แผนติดตั้ง (install-plan.json) — ไม่มีไฟล์
       ↳ จะติดตั้งเฉพาะ core — ...
[FAIL] วิธีลงทะเบียน — ไม่มี join.json และไม่มีรหัสเชิญ
       ↳ แพ็กชุดใหม่จากเครื่องแม่ (ได้ join.json) หรือใช้ชุดสากล + รหัสเชิญจากหน้า /fleet
[ok]   Docker — Docker version 29.7.2
  สรุป: ผ่าน 6 · เตือน 2 · ไม่ผ่าน 1
```

- `[ok]` ผ่าน · `[warn]` ติดตั้งได้แต่ควรรู้ · `[FAIL]` ต้องแก้ก่อน · `[skip]` ข้ามเพราะโหมด (`--dry-run`/ไม่ใช่ Windows)
- **exit 0** = ไม่มีข้อที่บล็อก · **exit 1** = มี `[FAIL]` (สคริปต์ใช้ตัดสินใจได้)
- ทุก `[FAIL]`/`[warn]` มีบรรทัด `↳` เป็นวิธีแก้ภาษาคน

## `SUPPORT.txt` — ไฟล์ที่ส่งต่อได้

เขียนไว้ข้างชุดติดตั้ง (ทับไฟล์เดิมทุกครั้งที่รัน) ประกอบด้วย เวลา/os/โฟลเดอร์/ผลตรวจทุกข้อ

**ไม่มีทางหลุดความลับ** เพราะผ่าน `redact()` ก่อนเขียนทุกครั้ง:
- machine token (hex 64 ตัว) → `***token***`
- รหัสเชิญ (`enr_` + hex 48) → `enr_***`
- ค่าของ `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*` → `***`

สิ่งที่ *ไม่* เก็บ: เนื้อไฟล์ `.env`, header/body ของ request, query string, ข้อมูลธุรกิจ

## สิ่งที่ doctor ยังไม่ตรวจ (อย่าคิดว่าผ่านแล้วจบ)

- คุณภาพของ firewall/เราเตอร์ในวง LAN (ตรวจได้แค่ว่า "ต่อ HUB ได้/ไม่ได้")
- สิทธิ์ของ Task Scheduler เมื่อเครื่องมีหลายบัญชีผู้ใช้
- ฐานข้อมูลบนเครื่องแม่เสียหาย (ดู `/system-health` + `/api/metrics`)
- macOS/Linux: ตรวจ autostart/process ยังเป็น `[skip]` (มีแค่ Windows)

## เทสต์ที่คุมพฤติกรรมนี้

`tools/test/doctor.test.mjs` (41 เทสต์) — ครอบ redaction, hub profile, dry-run purity, post-install, และการต่อสายเข้า installer
mutation ที่เคยพิสูจน์แล้วว่าทำให้แดง: ถอด redact 64-hex · บังคับ heartbeat ตลอดเวลา · ถอดการกัน dry-run · ปิดการตรวจหลังติดตั้ง · ลด Docker ของเครื่องแม่เป็น warn
