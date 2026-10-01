# Google Search Console — ผูกโดเมนกับ "กฤษกรณ์ อุตมะ" (P20, 1/10/69)

เป้าหมาย: ให้ Google เชื่อมโดเมนกับชื่อผู้ก่อตั้ง — โดเมนใช้งาน: `sovereignoriginshop.dpdns.org` (ACTIVE 30/9) + `sovereign-shop.dpdns.org` (ชื่อสั้น จด 1/10 — รอ NS/Active ตาม ops-runbook §สิบ "โซนที่สอง")
(เว็บไซต์เตรียมฝั่งโค้ดครบแล้ว: JSON-LD `founder` + meta author บน /about · sitemap.xml · robots.txt)

## ⚠️ บล็อกที่ต้องแก้ก่อน (ตรวจ live 1/10/69)

`https://sovereignoriginshop.dpdns.org/sitemap.xml` และ `/robots.txt` ตอบ **403 จาก WAF** (ไม่อยู่ใน allowlist ที่ลงไว้ 30/9) — **Google ดึง sitemap ไม่ได้ จนกว่าจะเพิ่ม 2 path นี้ใน expression** (แก้ใน Cloudflare dashboard ทั้งสองโซน — expression เวอร์ชันใหม่จดใน ops-runbook §สิบ ขั้น 6) — ทำเป็นคิวแรกสุดของงาน SEO นี้ ก่อน Submit sitemap ทุกกรณี

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

## โซนที่สอง: `sovereign-shop.dpdns.org` (หลังโซน Active ตาม ops-runbook §สิบ "โซนที่สอง")

1. ทำขั้นตอนเดียวกับด้านบนทั้งหมดแต่ใช้ชื่อ `sovereign-shop.dpdns.org` (TXT verify บนโซนใหม่ · Submit `sitemap.xml` · Request Indexing /shop /about)
2. sitemap.xml ใน repo มี **URL สอง host อยู่รวมกันแล้ว** (คู่ขนาน 1/10) — แต่ละ property หยิบ URL ของ host ตัวเอง · ถ้าตัดสินใจใช้โดเมนใหม่เป็นหลักภายหลัง: ตัดชุด host เก่าออก + สลับ canonical (JSON-LD `url` / og) บน /about ให้เป็นโดเมนใหม่ แล้วแจ้ง agent deploy
