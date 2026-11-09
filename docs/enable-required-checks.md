# คู่มือเปิด Required Checks จริงบน main (5 นาที หลังแพลนพร้อม)

> เป้าหมาย: ทำให้ `Core API tests / test-db` (ชุด real-Postgres) และเช็คอื่น ๆ เป็น**เงื่อนไขบังคับ**ก่อน merge เข้า main
> สถานะปัจจุบัน (7 พ.ย. 69): **ตั้งจริงแล้ว 7 contexts** — branch protection API ตอบอ่าน/เขียนได้บนแพลนนี้แล้ว
> (เดิม: script พร้อมครบ 6 contexts แต่**ตั้งจริงไม่ได้บนแพลนฟรี + repo private** (GitHub ตอบ HTTP 403 ทั้ง rulesets และ branch protection — ทดสอบด้วย `gh api` ล่าสุด 17 ก.ย. 2026)

## ทางเลือก A — อัปเกรด GitHub Pro (repo ยัง private ได้) — เหมาะกับ repo นี้

1. เปิด https://github.com/pricing → **GitHub Pro** (~4  USD/เดือน) → Subscribe ด้วยบัญชี `krisakornutama`
2. รอสถานะแพลนเปลี่ยน (หน้า Settings → Billing จะขึ้น Pro)
3. เช็คสิทธิ์ว่าหายแล้ว (ต้องไม่โดน 403):
   ```bash
   gh api repos/krisakornutama/sovereign-origin/rulesets --jq 'length'
   ```
4. ตั้ง required checks จริง — คำสั่งเดียวจบ:
   ```bash
   bash tools/set-required-checks.sh --apply
   ```
   script จะ PUT `required_status_checks` ครบ **7 contexts**: `Audit site / audit` · `File size guard / size` · `Deploy portfolio / publish` · `Core API tests / test (ubuntu-latest)` · `Core API tests / test (windows-latest)` · **`Core API tests / test-db`** · **`Architecture Gate / arch-gate`** (ตัวหลังนี้รัน gate ชุดใหม่ no-db-push + ci-ddl-sync ด้วย) แล้วพิมพ์รายการที่ตั้งสำเร็จกลับมาให้เห็น
5. **ยืนยันผลจริง** (อ่านกลับจาก API — อย่าเชื่อข้อความ success ของ script อย่างเดียว):
   ```bash
   gh api repos/krisakornutama/sovereign-origin/branches/main/protection --jq '.required_status_checks.contexts'
   ```
   ต้องเห็นครบ 7 แถวรวม `Core API tests / test-db` และ `Architecture Gate / arch-gate`
6. ทดสอบพฤติกรรมจริง: ยิง PR จำลอง (สาขาเล็ก ๆ แก้ README) → หน้า PR ต้องบล็อก Merge จนเช็คเขียวครบ + ถ้า push เข้า main โดยข้าม (direct push) ตัว protection `strict=true` จะบังคับอัปเดตสาขาก่อนเสมอ

## ทางเลือก B — เปลี่ยน repo เป็น public (ไม่เสียเงิน)

1. Settings → General → Danger Zone → **Change repository visibility** → Make public (ตั้งชื่อ confirm)
2. ⚠️ **ก่อนกด ตรวจ 3 อย่าง** (repo นี้เคยเป็นของส่วนตัวทั้งระบบ):
   - Secrets ไม่รั่ว: ตัวเดียวคือ `PAGES_TOKEN` (fine-grained, จำกัด repo) — ถือว่าปลอดภัย แต่พิจารณาหมุนก่อนเปิด
   - ประวัติไม่มีไฟล์ลับ: เคยกวาด credentials ครบแล้ว (token-hygiene test รันใน gate ทุกครั้ง)
   - issue/PR เก่าจะเปิดให้คนทั้งโลกอ่านได้
3. รัน `bash tools/set-required-checks.sh --apply` + ยืนยันตามขั้น 5-6 ของทางเลือก A (เหมือนกันทุกอย่าง)
4. ของแถมที่ได้จาก public: **Secret scanning + push protection** (§๘ ของ runbook จาก "ไม่พร้อมใช้" กลายเป็นเปิดได้ทันที: Settings → Advanced Security)

## ปัญหาที่เจอได้และวิธีแก้

| อาการ | เหตุ | แก้ |
|---|---|---|
| `--apply` โดน HTTP 403 | แพลนยังฟรี / token ไม่มีสิทธิ์ admin | ยืนยันแพลน Pro แล้ว + ยืนยันว่า `gh auth status` ใช้บัญชีเจ้าของ repo |
| ตั้งแล้ว PR ค้าง "Expected — Waiting for status" | ชื่อ context ไม่ตรงกับ check จริง (พิมพ์ผิด/ชื่อ job เปลี่ยน) | ดูชื่อจริงจาก `gh api repos/krisakornutama/sovereign-origin/commits/<sha>/check-runs --jq '.check_runs[].name'` แล้วแก้ `CONTEXTS` ใน `tools/set-required-checks.sh` ให้ตรง |
| `test-db` ไม่ขึ้นเป็น check เลย | workflow ยังไม่เคยรันบน main (trigger ยิงเฉพาะเมื่อไฟล์ที่กำหนดเปลี่ยน) | ยิงมือครั้งเดียว: `gh workflow run core-api-tests.yml -R krisakornutama/sovereign-origin` แล้วค่อย apply |
| ต้องการเปลี่ยนรายชื่อ checks | — | แก้ array `CONTEXTS` ที่หัวไฟล์ `tools/set-required-checks.sh` (แหล่งเดียวจบ) |

> หลังตั้งสำเร็จ: อัปเดตแถว "Required checks บน main" ใน `docs/ops-runbook.md` §๘ จาก "พร้อมตั้ง 6 — apply ไม่ได้ (403)" เป็น "บังคับจริง 6 contexts ตั้งเมื่อ <วันที่>" — และบรรทัด "รอเจ้าของ" ใน STATUS.md

## บันทึกผลทดสอบจริง — PR #55 (9 พ.ย. 69)

ยิง PR ทดสอบเพื่อยืนยันว่า protection บังคับใช้จริง (ไม่ใช่แค่ตั้งค่าไว้):

| หลักฐาน | ผลที่เห็น |
|---|---|
| `gh pr checks 55` | ขึ้นครบ 7 required contexts — `Architecture Gate / arch-gate` · `Audit site / audit` · `File size guard / size` · `Deploy portfolio / publish` · `Core API tests / test (ubuntu-latest)` · `test (windows-latest)` · `test-db` (มี `test-integration` และ `boundary` เพิ่มมาด้วยแต่ไม่บังคับ) |
| `gh pr view 55 --json mergeStateStatus` ขณะเช็คยัง pending | `BLOCKED`/`BEHIND` — ปุ่ม Merge กดไม่ได้จนกว่าจะเขียวครบ |
| arch-gate แดง (ตอนลองให้รัน suite เต็มชุด) | PR ยัง merge ไม่ได้ → required check บล็อกจริง ไม่ใช่แค่โชว์สถานะ |

> **ทำไม arch-gate จึงยังรันเฉพาะ 2 gate ไฟล์** (`no-db-push-gate`, `ci-ddl-sync`): tools suite เต็มชุดจบได้แล้ว
> (แก้เหตุค้างใน #51 — keep-alive socket ในเทสต์ + `--test-force-exit`) แต่ยังมีเทสต์ที่ผูกกับ Windows
> (`tools/*.cmd`, `*.ps1`, launcher dry-run) และ suite ของ frontend ที่ต้องลง deps ของ `sovereign-frontend`
> ก่อน — ถ้าจะย้ายมาเป็น required check บน ubuntu ต้องทำ platform guard ให้ครบก่อน (งานแยก)
