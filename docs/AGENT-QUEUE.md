# AGENT QUEUE — คิวงานที่ agent หยิบไปทำได้

> เป้าหมาย: ให้ "งานที่ต้องทำ" เป็นไฟล์ที่ commit ได้ — ใครทำ อะไร เมื่อไร หลักฐานอะไร
> อยู่ใน git ทั้งหมด · ไม่มีฐานข้อมูล ไม่มี daemon ไม่มี SaaS

## 1. โครงสร้าง

```
queue/tasks/<id>.md      ← งาน 1 ไฟล์ (front-matter + body)
tools/queue/queue.mjs    ← CLI (list/next/claim/done/block/validate)
tools/test/queue.test.mjs← เทสต์ของ CLI (อยู่ใน test:tools)
```

front-matter ที่บังคับ (validate จะฟ้องถ้าขาด):

| ฟิลด์ | ค่า | ความหมาย |
|---|---|---|
| `id` | `a-z0-9-` 3–64 ตัว | ชื่อไฟล์ = `<id>.md` |
| `title` | ข้อความ | สิ่งที่ต้องได้ |
| `priority` | 1–5 | 1 = ด่วนสุด (ใช้เรียงคิว) |
| `status` | `todo`/`doing`/`done`/`blocked` | สถานะ |
| `created` | `YYYY-MM-DD` | ใช้ตัดสินเมื่อ priority เท่ากัน |
| `gate` | คำสั่ง | ด่านที่ต้องผ่านก่อนปิดงาน (ปกติ `npm run verify`) |
| `tests_first` | `true`/`false` | งานโค้ดต้อง `true` (red-first) |
| `depends_on` | list ของ id | หยิบงานนี้ไม่ได้จนกว่างานนั้น `done` |
| `scope` | list ของ path | ไฟล์ที่คาดว่าจะแตะ (กัน agent ไปแก้ที่อื่น) |

## 2. วงจรของ agent 1 รอบ

```bash
node tools/queue/queue.mjs next            # งานถัดไป (todo + deps ปิดครบ)
node tools/queue/queue.mjs claim <id> --owner buffy
# ... เขียนเทสต์ให้แดงก่อน (tests_first=true) → implement → รัน gate ...
npm run verify                             # ต้อง exit 0
node tools/queue/queue.mjs done <id> --report "gate: npm run verify = 0 · PR #123"
```

ปิดงานไม่ได้ (เช่น รอ credential) → `block <id> --reason "..."` ไม่ใช่ปล่อยค้าง `doing`

## 3. กติกาที่ห้ามละเมิด

1. **ห้าม `done` ถ้า gate ยังไม่เขียว** — report ต้องมีคำสั่ง + exit code จริง
2. **1 งาน 1 เจ้าของ** — `claim` ซ้ำจะถูกปฏิเสธ; ถ้าเจ้าของหาย ให้ `block` แล้วเปิดงานใหม่
3. **ห้ามแก้ `scope` ให้กว้างขึ้นเพื่อให้ผ่าน** — ถ้าจำเป็นต้องแตะไฟล์นอก scope ให้ block และขออนุมัติ
4. **red-first** — `tests_first: true` แปลว่าต้องแนบหลักฐานว่าเทสต์ล้มก่อนแก้ (exit 1)
5. **คิวคือความจริง ไม่ใช่แชท** — งานที่ตกลงกันในแชทแต่ไม่อยู่ใน `queue/tasks/` = ยังไม่เกิด

## 4. เพิ่มงานใหม่ (เจ้าของทำ)

```bash
# คัดลอกงานที่มีอยู่เป็นแม่แบบ แล้วแก้ id/title/priority/scope
cp queue/tasks/install-uninstall-clean.md queue/tasks/<id>.md
node tools/queue/queue.mjs validate        # ต้องผ่านก่อน commit
```

## 5. ความสัมพันธ์กับ CI

- `queue.mjs` และเทสต์ของมันอยู่ใน `npm run test:tools` → รันใน `arch-gate` ทุก PR
- งานที่ปิดแล้ว **ไม่ต้องลบไฟล์** — Report ในไฟล์คือหลักฐานย้อนหลัง (git history ไม่ใช่ที่เก็บเดียว)
- ถ้าเจ้างานค้างนานกว่า 2 สัปดาห์ ให้เปลี่ยนเป็น `blocked` พร้อมเหตุผล เพื่อไม่ให้คิวโกหก

## 6. ตัวอย่างที่ seed ไว้

| id | เรื่อง |
|---|---|
| `queue-retention-sweep` | ตัดคิวออฟไลน์เกิน 30 วัน + audit ก่อนลบ (P1 จากแผน P0) |
| `install-uninstall-clean` | ติดตั้งจบครั้งเดียว + ถอนสะอาด (D1) |
| `license-activation-wiring` | ต่อไลเซนส์ออฟไลน์เข้า API/UI ให้บังคับสิทธิ์จริง |
