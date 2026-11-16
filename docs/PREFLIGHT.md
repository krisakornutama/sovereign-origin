# PREFLIGHT — รันด่านหลักในเครื่องก่อน push

ด่านที่รันในเครื่องได้ในหลักวินาที ไม่ควรถูกค้นพบครั้งแรกบน GitHub หลัง push ไปแล้ว
(เคสจริง 16/11/69: push ขึ้น `main` แล้ว `Audit site` แดงเพราะคำว่า `โปรเจ็ก` ตก `ต์`
ในคิว — ต้อง push รอบสอง)

## ใช้

```bash
node tools/preflight.mjs                  # ทั้งหมด (range = origin/main..HEAD ถ้ามี origin/main)
node tools/preflight.mjs --only copy,secrets
node tools/preflight.mjs --skip frontend-gate
node tools/preflight.mjs --range origin/main..HEAD
node tools/preflight.mjs --no-prod         # ไม่แตะ production เลย
node tools/preflight.mjs --strict-prod     # prod รัน build เก่ากว่า HEAD = ล้มการรัน
node tools/preflight.mjs --quiet           # เอาไว้ใช้กับ hook/สคริปต์
```

**exit code เดียว:** `0` = ผ่านทุกขั้น · `1` = มีขั้นล้ม · `2` = ใช้คำสั่งผิด (เช่น `--only` ที่ไม่มีขั้นนั้น)

## ขั้นที่รัน (เรียงตามลำดับ)

| ขั้น | คำสั่งจริง | จับอะไร |
|---|---|---|
| `copy` | `portfolio/scripts/check-copy.mjs` | คำไทยผิด/ตกการันต์/ไทยติดละติน/`&` ดิบ ใน `docs/*.md` และหน้าโชว์ (ตัวเดียวกับ `Audit site` บน CI) |
| `secrets` | `git log -p <range>` (stream) | คีย์ `sk_live_`/`sk_test_`/`ghp_`/`xoxb-`/`AKIA`/`PRIVATE KEY` — **นับอย่างเดียว ไม่พิมพ์ค่าลง log/terminal** |
| `arch-gate` | `node tools/arch-gate.mjs` | file-budget · env-truth · module-boundary · tool-files-tracked |
| `frontend-gate` | `node tools/frontend-gate.mjs` | import-layers · เพดานบรรทัด · ทุกหน้าต้องมี Sidebar |
| `host-smoke` | `node tools/host-smoke.mjs` | API/DB/เว็บ/docker/scheduled tasks (READ-ONLY, ไม่แก้เครื่อง) |
| `prod-build` | `node tools/prod-build-check.mjs --warn` | prod รัน build รุ่นเดียวกับ HEAD ไหม (`health.build.commit` vs `git rev-parse HEAD`) — **เตือน** เป็นค่าเริ่มต้น, ใส่ `--strict-prod` เพื่อให้ **ล้ม** |
| `promote-web` | `node tools/promote-web.mjs --check` | chunk 404 บน prod `:3000` — **ข้ามอัตโนมัติ** ถ้าเครื่องนี้ไม่มี prod ตอบ |

## หมายเหตุที่เจอจริง

- **`git log -p HEAD` ทั้ง repo ใหญ่เกิน `maxBuffer` ของ `spawnSync`** (124 MB → `ENOBUFS` อ่าน range ไม่ได้)
  ⇒ ตัวสแกนความลับจึงอ่านแบบ **stream** และนับเฉพาะ match ที่จบในก้อนใหม่ (กันนับซ้ำบริเวณ overlap)
- **default range = `origin/main..HEAD`** (เฉพาะที่ยังไม่ขึ้น remote) — ถ้าต้องการทั้งประวัติให้ระบุ `--range HEAD` เอง
  (ทั้งประวัติจะมีตัวอย่างคีย์ปลอมในเทสต์เก่า ⇒ จะรายงานว่าเจอ ซึ่งถูกต้องตามจริง)
- `promote-web` ต้องมี production รันอยู่; ถ้าไม่มีจะขึ้น `○` = ข้าม ไม่ทำให้ทั้งชุดล้ม

## เทสต์

`node --test tools/test/preflight.test.mjs` — ปักหมุดว่า
(1) จับคีย์ปลอมครบทุกชนิด (2) **รายงานไม่มีค่าคีย์อยู่ข้างใน** (3) copy gate จับคำไทยผิด/ไทยติดละตินได้จริง
และไม่กล่าวหาข้อความที่ถูกต้อง (4) ขั้นทั้ง 6 มีครบ (5) `--only` ที่ไม่มีขั้นจริง = exit 2
