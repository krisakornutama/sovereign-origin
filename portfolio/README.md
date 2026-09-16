# Portfolio — Project Sovereign

เว็บโชว์ผลงานแบบ static หลายหน้า (`index.html` = ทัวร์ทั้งระบบ + `projects.html` = ผลงานทีละชิ้น + ฟอร์มติดต่อ + `livestock.html` = ปศุสัตว์ + `fishery.html` = แบบแปลนการประมง + `farm.html` = เกษตร&สมุนไพร + `iot.html` = บ้าน IoT + `education.html` = โมดูล AI สอนลูก + `water.html` = ชัยภูมิน้ำ (แนวคิดรางน้ำ-บ่อ-พื้นที่เพาะปลูกแบบค่ายกล 8 ทิศ) + `books.html` = คลังหนังสือของนักเขียน: ผลงานที่ลงพิมพ์+ลิงก์แหล่งเดิม และชั้นหนังสือที่อ่าน + `search.html` = ค้นหาทั้งเว็บจากช่องเดียว + `en.html` = หน้าแรกภาษาอังกฤษ + `me.html` = หน้ารวมช่องทางผู้เขียน (Person schema + link-in-bio สำหรับ SEO ชื่อ "กฤษกรณ์ อุตมะ / Krisakorn Utama") + `sitemap.xml`/`robots.txt` = ให้ bot ทุกตัว crawl ครบทุกหน้า) — ไม่มี build step ไม่มี dependency โฮสต์ฟรีด้วย GitHub Pages

## วิธีขึ้น GitHub Pages (เลือกทางใดทางหนึ่ง)

### ทางที่ 1 — อัปโหลดผ่านหน้าเว็บ GitHub (ง่ายสุด ไม่ต้องใช้ git)

1. สมัคร/ล็อกอิน GitHub แล้วสร้าง repository ใหม่ ตั้งชื่อเช่น `project-sovereign` → **Public**
2. กด **uploading an existing file** แล้วลากไฟล์จากโฟลเดอร์ `portfolio/` ขึ้นไปให้ครบทุกไฟล์ที่เว็บใช้ — หน้าเว็บ 12 ไฟล์ (`index.html`, `projects.html`, `livestock.html`, `fishery.html`, `farm.html`, `iot.html`, `education.html`, `water.html`, `books.html`, `search.html`, `en.html`, `me.html`) + `nav.css` + `nav.js` (เมนูหมวดฝั่งซ้าย + drawer มือถือ — ทุกหน้าโหลดสองไฟล์นี้) + `sitemap.xml` + `robots.txt` + **`og.png` (การ์ดแชร์เวลาแปะลิงก์ — ทุกหน้ามี meta ชี้ไฟล์นี้)** + **ไฟล์คีย์ IndexNow (`.txt` ชื่อ 32 ตัวอักษรอังกฤษ-ตัวเลข เนื้อหาในไฟล์ = ชื่อไฟล์เอง — ต้องอยู่ root เว็บ ไม่งั้นการยิง IndexNow จะถูกปฏิเสธ)** + `.nojekyll` + `README.md`
   - ถ้าหาไฟล์ `.nojekyll` ไม่เจอใน Explorer (เป็นไฟล์ที่ขึ้นต้นจุด) ให้ข้ามก่อน — ดูขั้น 4
3. กด **Commit changes**
4. ถ้ายังไม่ได้ใส่ `.nojekyll`: ใน repo กด **Add file → Create new file** ตั้งชื่อว่า `.nojekyll` (เนื้อหาว่าง) → Commit
5. ไปที่ **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` + `/ (root)` → Save
6. รอ 1–2 นาที แล้วเปิดลิงก์ที่หน้า Settings→Pages บอก (รูปแบบ `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/`)

### ทางที่ 2 — git (ถ้าคุ้นเคยใช้ command line)

```bash
# ในโฟลเดอร์ portfolio/
git init
# og.png + ไฟล์คีย์ IndexNow (.txt 32 ตัวอักษร) ต้องขึ้นไปด้วย ไม่งั้นการ์ดแชร์กับการยิง IndexNow ใช้ไม่ได้
git add *.html nav.css nav.js sitemap.xml robots.txt og.png .nojekyll README.md
git commit -m "portfolio: Project Sovereign showcase — self-hosted commerce OS with Thai tax engine + AI kids education"
git branch -M main
# สร้าง repo เปล่าบน GitHub ก่อน (ชื่อ project-sovereign) แล้วแก้ชื่อผู้ใช้ด้านล่าง:
git remote add origin https://github.com/<ชื่อผู้ใช้>/project-sovereign.git
git push -u origin main
```

แล้วเปิด **Settings → Pages → Deploy from a branch → main / (root)** เหมือนทางที่ 1

## อัปเดตหน้าเว็บภายหลัง

แก้ไฟล์ `index.html` แล้ว commit+push ใหม่ (หรืออัปโหลดทับ) — Pages จะ deploy เองใน 1–2 นาที

หรือใช้สคริปต์ publish คำสั่งเดียวจากโฟลเดอร์โปรเจกต์ (sync → commit → push → ยิง IndexNow แจ้งเครื่องมือค้นหาให้บอทมาเก็บหน้าใหม่ทันที):

```bash
node tools/publish-portfolio.mjs --watch        # --watch = รอ CI จนจบ · --no-indexnow = ข้ามการยิง IndexNow
```

> ถ้า publish ด้วยมือ (push เอง) ให้ยิง IndexNow เองด้วย `node tools/indexnow-notify.mjs` — เครื่องมือค้นหา (Bing/Yandex/Seznam/Naver) จะได้คิวมา crawl หน้าใหม่ทันทีแทนที่จะรอเป็นเดือน

## ให้ Google จัดทำดัชนีเว็บ (ทำครั้งเดียว ~10 นาที)

ทำใน Google Search Console ด้วยบัญชี Google ของเจ้าของ — แท็กยืนยันวางรอบนหน้าแรกแล้ว ทำตามคู่มือทีละคลิก: [`docs/google-search-console-guide.md`](../docs/google-search-console-guide.md)

## ตั้งค่าฟอร์มติดต่อให้ส่งเข้าอีเมลจริง (สมัครฟรี 1 ครั้ง ~3 นาที)

ฟอร์มใน `projects.html` ทำงานได้ทันทีแม้ไม่ตั้งค่า (กดส่ง = เปิดแอปอีเมลของผู้ใช้) แต่ถ้าอยากให้ส่งเข้าอีเมลคุณตรง ๆ:

1. สมัครฟรีที่ [formspree.io](https://formspree.io) → สร้าง **New form** → ตั้งชื่อว่า Project Sovereign
2. คัดลอก **endpoint** ที่ได้ (หน้าตาแบบนี้: `https://formspree.io/f/abcd1234`)
3. เปิดไฟล์ `projects.html` หาบรรทัด `var FORM_ENDPOINT = '';` แล้วใส่ endpoint ไว้ในเครื่องหมายคำพูด
4. ใน Formspree → Settings → ใส่อีเมลคุณเป็นปลายทางรับ
5. อัปโหลดไฟล์ทับขึ้น GitHub — เสร็จ ฟอร์มจะส่งเข้าอีเมลคุณจริง (ฟรี 50 ข้อความ/เดือน พอสำหรับเว็บโชว์)

## หมายเหตุ

- ทุกหน้าเป็น static HTML ไฟล์เดียวจบในตัวเอง: CSS/JS ฝังในไฟล์นั้น ๆ อยู่แล้ว (ไม่มี build step ไม่มี dependency), ฟอนต์โหลดจาก Google Fonts CDN (ถ้าออฟไลน์จะ fallback เป็น system font — หน้ายังใช้ได้)
- ไม่มีข้อมูลจริงในหน้า — ตัวเลขบนหน้าเป็นข้อมูลสาธิต
- `.nojekyll` ทำให้ GitHub Pages เสิร์ฟไฟล์ตรง ๆ ไม่ผ่าน Jekyll (จำเป็นเฉพาะเมื่ออัปโหลดเป็น repo แยก)
- ถ้า push repo นี้เป็นโฟลเดอร์ย่อยของ repo ใหญ่ ให้ตั้ง Pages source เป็น branch `main` + โฟลเดอร์ `/portfolio`
