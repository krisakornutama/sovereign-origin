# Portfolio — Project Sovereign

เว็บโชว์ผลงานแบบ static หลายหน้า (`index.html` = ทัวร์ทั้งระบบ + `education.html` = โมดูล AI สอนลูก) — ไม่มี build step ไม่มี dependency โฮสต์ฟรีด้วย GitHub Pages

## วิธีขึ้น GitHub Pages (เลือกทางใดทางหนึ่ง)

### ทางที่ 1 — อัปโหลดผ่านหน้าเว็บ GitHub (ง่ายสุด ไม่ต้องใช้ git)

1. สมัคร/ล็อกอิน GitHub แล้วสร้าง repository ใหม่ ตั้งชื่อเช่น `project-sovereign` → **Public**
2. กด **uploading an existing file** แล้วลากไฟล์จากโฟลเดอร์ `portfolio/` **ทั้ง 4 ไฟล์** ขึ้นไป (`index.html`, `education.html`, `.nojekyll`, `README.md`)
   - ถ้าหาไฟล์ `.nojekyll` ไม่เจอใน Explorer (เป็นไฟล์ที่ขึ้นต้นจุด) ให้ข้ามก่อน — ดูขั้น 4
3. กด **Commit changes**
4. ถ้ายังไม่ได้ใส่ `.nojekyll`: ใน repo กด **Add file → Create new file** ตั้งชื่อว่า `.nojekyll` (เนื้อหาว่าง) → Commit
5. ไปที่ **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` + `/ (root)` → Save
6. รอ 1–2 นาที แล้วเปิดลิงก์ที่หน้า Settings→Pages บอก (รูปแบบ `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/`)

### ทางที่ 2 — git (คุ้มเคยใช้ command line)

```bash
# ในโฟลเดอร์ portfolio/
git init
git add index.html education.html .nojekyll README.md
git commit -m "portfolio: Project Sovereign showcase — self-hosted commerce OS with Thai tax engine + AI kids education"
git branch -M main
# สร้าง repo เปล่าบน GitHub ก่อน (ชื่อ project-sovereign) แล้วแก้ชื่อผู้ใช้ด้านล่าง:
git remote add origin https://github.com/<ชื่อผู้ใช้>/project-sovereign.git
git push -u origin main
```

แล้วเปิด **Settings → Pages → Deploy from a branch → main / (root)** เหมือนทางที่ 1

## อัปเดตหน้าเว็บภายหลัง

แก้ไฟล์ `index.html` แล้ว commit+push ใหม่ (หรืออัปโหลดทับ) — Pages จะ deploy เองใน 1–2 นาที

## หมายเหตุ

- ทุกอย่างในไฟล์เดียว: CSS/JS ฝังใน `index.html`, ฟอนต์โหลดจาก Google Fonts CDN (ถ้าออฟไลน์จะ fallback เป็น system font — หน้ายังใช้ได้)
- ไม่มีข้อมูลจริงในหน้า — ตัวเลขบนหน้าเป็นข้อมูลสาธิต
- `.nojekyll` ทำให้ GitHub Pages เสิร์ฟไฟล์ตรง ๆ ไม่ผ่าน Jekyll (จำเป็นเฉพาะเมื่ออัปโหลดเป็น repo แยก)
- ถ้า push repo นี้เป็นโฟลเดอร์ย่อยของ repo ใหญ่ ให้ตั้ง Pages source เป็น branch `main` + โฟลเดอร์ `/portfolio`
