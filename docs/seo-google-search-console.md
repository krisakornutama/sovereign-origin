# Google Search Console — ผูกโดเมนกับ "กฤษกรณ์ อุตมะ" (P20, 1/10/69)

เป้าหมาย: ให้ Google เชื่อมโดเมน `sovereignoriginshop.dpdns.org` กับชื่อผู้ก่อตั้ง
(เว็บไซต์เตรียมฝั่งโค้ดครบแล้ว: JSON-LD `founder` + meta author บน /about · sitemap.xml · robots.txt)

## ขั้นตอน (ผู้ใช้ทำเอง ~10 นาที — ต้องใช้บัญชี Google ของเจ้าของ)

1. เปิด https://search.google.com/search-console → **เพิ่มพร็อพเพอร์ตี** → เลือก **โดเมน (Domain)**
2. กรอก: `sovereignoriginshop.dpdns.org`
3. Google ให้ **ระเบียน TXT** มา 1 บรรทัด (รูปแบบ `google-site-verification=xxxx`)
4. เปิด **Cloudflare Dashboard** → โดเมน → **DNS → Records → Add record**
   - Type: `TXT` · Name: `@` · Content: วางระเบียนจากข้อ 3 · TTL: Auto
5. กลับหน้า Search Console กด **Verify** (ถ้ายังไม่ผ่าน รอ DNS propagate 5-15 นาทีแล้วกดซ้ำ)

## หลังยืนยันสำเร็จ

6. เมนู **Sitemaps** → กรอก `sitemap.xml` → Submit (ที่อยู่จริง = https://sovereignoriginshop.dpdns.org/sitemap.xml)
7. **URL Inspection** → ใส่ `https://sovereignoriginshop.dpdns.org/shop` → กด "Request Indexing" — ทำซ้ำกับ /about /partners /demo
8. (แนะนำ) โปรไฟล์ Google ของเจ้าของ: เพิ่มเว็บไซต์เป็นลิงก์ในส่วน "เว็บไซต์/ลิงก์สังคม" ของโปรไฟล์ Google บัญชีเดียวกับที่ JSON-LD อ้าง

## ทางเลือกถ้าไม่อยากแตะ DNS

- เลือกวิธียืนยันแบบ **HTML file** ใน Search Console → ได้ชื่อไฟล์ `googleXXXX.html`
- วางไฟล์นั้นที่ `sovereign-frontend/public/` แล้วบอกผู้ช่วย → deploy 1 รอบ (build + SW bump) แล้วกด Verify

## เช็คว่าทำงาน

- `curl -s https://sovereignoriginshop.dpdns.org/sitemap.xml | head -5` → เห็น XML
- ใน Search Console: Sitemaps แสดง "Success" + จำนวน URL ที่ค้นพบ
