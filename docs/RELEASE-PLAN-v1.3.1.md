# แผนปล่อยแพทช์ v1.3.1

> สถานะ: **พร้อมเมื่อ PR #94 (SEC-018) merge** — เอกสารนี้คือลำดับงานจริง ไม่ใช่ข้อเสนอ
> เจ้าของต้องอนุมัติก่อน `git push origin v1.3.1` เพราะเป็นการเผยแพร่ GitHub Release สาธารณะ

## 1. สถานะตั้งต้น (ตรวจเมื่อ 2026-11-11)

| รายการ | ค่า |
|---|---|
| tag ล่าสุด | `v1.3.0` (2026-11-10) |
| `sovereign-frontend/package.json` | `1.3.0` |
| `package.json` (root) / `core-api` | `1.0.0` ← **drift** |
| `CHANGELOG.md` | มี `[Unreleased]` 12 รายการ |
| image ที่ติดตั้งจริง | `1.2.0` (ยังตามหลังรีโป) |

## 2. ขอบเขตของ v1.3.1 (patch — ไม่มี migration, ไม่มี breaking change)

ชุดปิดช่องโหว่ที่ merge เข้า `main` แล้ว:

- **การควบคุมเครื่อง**: socket `control:join` ต้องมีสิทธิ์เจ้าของ (SEC-008), ผลคำสั่งผูกกับเครื่องที่ได้รับคำสั่ง (SEC-009), ภาพหน้าจอตรวจเจ้าของเครื่อง (SEC-011)
- **OTA**: เทียบ token แบบคงเวลา + จำกัด peer เมื่อไม่ตั้ง token (SEC-010), token ออกจาก URL ไป header (SEC-016), ปฏิเสธ `?token=` เป็นค่าเริ่มต้นพร้อมสวิตช์ชั่วคราว (SEC-017), ตัวนับ/รายงานผู้ที่ยังใช้ query token (SEC-018)
- **ขาเข้า/ขาออก**: knowledge import ผ่าน `outbound-url-guard` กัน SSRF (SEC-012), upload ปฏิเสธ Mach-O/Java/Wasm และลบไฟล์เมื่อ DB ล้ม (SEC-014)
- **ข้อมูล/งาน**: รายการเครื่องและคิวงานกรองตามเจ้าของ (SEC-013), `pullJobs()` จองงานแบบมีเงื่อนไขกัน double dispatch (SEC-015)

## 3. ด่านก่อนปล่อย (ใหม่ — `npm run release:check`)

`tools/release-check.mjs` ตรวจสามอย่างที่ทำให้ workflow ปล่อยรุ่นล้มหรือปล่อยของที่อธิบายไม่ได้:

1. **version ตรงกันทุก package** (root / core-api / frontend) — กัน drift แบบข้อ 1
2. **CHANGELOG มีหัวข้อ `## [vX.Y.Z] — YYYY-MM-DD`** ของรุ่นที่จะปล่อย
3. **`[Unreleased]` ว่าง** — กันงานที่ยังไม่ปิดหลุดเข้าไปในบันทึกของรุ่น

```
npm run release:check              # ใช้ version จาก sovereign-frontend
npm run release:check -- --version=1.3.1 --json
```

exit 1 = ยังไม่พร้อม พร้อมรายการที่ต้องแก้ครบทุกจุด

## 4. ลำดับงาน

1. **ปิดคิวค้าง**: PR #94 (SEC-018) เขียว → squash-merge → ปิดคิว `SEC-018` พร้อม sha/PR/ตัวเลขเทสต์
2. **bump**: `version` ทั้งสาม package → `1.3.1` (สคริปต์เดียว, ไม่แก้ด้วยมือทีละไฟล์)
3. **ย้ายบันทึก**: ตัดบล็อก `[Unreleased]` ไปเป็น `## [v1.3.1] — <วันที่> (released)` แล้ว `node tools/gen-changelog-data.mjs`
4. **ด่านในเครื่อง**: `npm run release:check` (ต้อง exit 0) + `npm run verify` (ต้อง 6/6)
5. **PR รวม**: `release/v1.3.1` → `main`, รอ CI 11 ด่านเขียว แล้ว squash-merge
6. **tag**: `git tag -a v1.3.1 -m "v1.3.1"` → `git push origin v1.3.1` → `.github/workflows/release.yml` build portable exe/zip + `SHA256SUMS.txt` แล้วแนบ GitHub Release
7. **ตรวจของจริง**: ดาวน์โหลด asset จาก Release, เทียบ SHA256, ติดตั้งบนเครื่องทดสอบ, เปิดแอปแล้วดู `about`/version
8. **ปิดรอบใน `docs/LIVING-QUEUE.md`** §5 history: sha ของ merge, tag, ตัวเลขเทสต์, เวลาที่ release workflow จบ

## 5. ถอยกลับ (rollback)

- workflow ล้มกลางทาง: แก้แล้ว `gh run rerun <id> --failed` — ไม่ต้อง push tag ใหม่ (tag เดิมชี้ commit เดิม)
- tag ผิด commit: `git tag -d v1.3.1 && git push origin :refs/tags/v1.3.1` **ก่อน** ที่จะปล่อยให้ผู้ใช้โหลด
- ของที่ปล่อยแล้วมีปัญหา: ออก `v1.3.2` ที่ revert เฉพาะ commit — ไม่ลบ tag ที่มีคนโหลดไปแล้ว

## 6. สิ่งที่ "ดีขึ้นกว่าเดิม" ในรอบนี้

- **ตาข่ายกันความผิดพลาดก่อน tag**: เดิมเจอ drift/ changelog ไม่ครบตอน workflow กำลัง build (เสีย 10–20 นาที) ตอนนี้รู้ใน <1 วินาที และบอกครบทุกจุดพร้อมกัน
- **ปิดช่อง image ตามหลังรีโป**: เพิ่มขั้นตรวจ 7 ให้เทียบ version ที่ติดตั้งจริงกับ tag — เคส `1.2.0` vs `1.3.0` จะถูกจับได้ทันทีแทนที่จะเจอตอนผู้ใช้ถาม
- **บันทึกของรุ่นต้องอธิบายได้**: gate บังคับให้ `[Unreleased]` ว่าง ⇒ ทุกอย่างที่ผู้ใช้ได้รับต้องมีที่มาใน CHANGELOG
- **ทดสอบของเครื่องมือเอง**: `tools/test/release-check.test.mjs` (4 เคส) รันใน `npm run test:tools` ซึ่งอยู่ใน `verify` ⇒ gate พังไม่ได้เงียบ ๆ
