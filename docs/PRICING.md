# ราคา — แหล่งความจริงเดียว และคำสั่งที่ต้องรันเมื่อแก้ราคา

สรุปสั้น: **ตัวเลขราคาทุกตัวบนเว็บมาจาก `portfolio/pricing.json`** ชั้นที่ยังเป็น HTML นิ่ง
(head ของ `buy.html`) ถูก **สร้าง** จากไฟล์นั้นด้วย `npm run pricing:head` — ไม่ได้พิมพ์มือ
และ CI บังคับว่าไฟล์ที่ commit ต้องตรงกับผลของคำสั่งนี้

---

## 1. ทำไมไม่เขียน head ด้วย JavaScript ตอนเปิดหน้า

ตัวอ่านลิงก์และบอทเก็บข้อมูล (Facebook, X/Twitter, LinkedIn, Slack, Discord, LINE) **ไมรัน JavaScript**
มันอ่าน `<meta>` และ JSON-LD จาก HTML ดิบเท่านั้น ถ้าให้ `promo.js` เติมตัวเลขใน `<title>`/meta ทีหลัง
ตัวอย่างลิงก์ (OG card) จะโชว์ราคาเก่าหรือว่าง — เสียช่องฟรีที่คนอื่นแชร์ลิงก์ให้เรา

ทางเดียวที่ได้ทั้ง "แหล่งเดียว" และ "scraper อ่านได้" คือ **สร้างตอน build แล้ว commit HTML ที่นิ่ง**
(ทางเลือกอื่นที่พิจารณาแล้วและไม่เอา: Cloudflare Worker แทรกที่ขอบ — Pages เป็น static, เพิ่มจุดพัง
และทำให้ HTML ในเครื่องไม่ตรงกับที่เสิร์ฟ; JSON-LD ที่สร้างด้วย JS — บอทหลักรัน JS ได้แต่ตัวอ่านลิงก์ไม่ได้)

## 2. ชั้นของตัวเลขบนหน้าเว็บ

| ชั้น | อยู่ที่ | ใครอ่าน | วิธีอัปเดต |
|---|---|---|---|
| ตัวเลขจริง | `portfolio/pricing.json` | ทุกอย่าง | แก้มือ (ไฟล์เดียว) |
| head ของ `buy.html` (meta description, og/twitter title, JSON-LD `offers`) | HTML นิ่งใน `portfolio/buy.html` | scraper, Google Rich Results, ตัวอ่านลิงก์ | **`npm run pricing:head`** (ห้ามแก้มือ) |
| ตัวเลขในเนื้อหน้า (`data-price` บน `buy.html`, ป้ายโปร) | เขียนตอนโหลดจาก `promo.js` + `price-format.js` | มนุษย์ (JS เปิด) | อัตโนมัติจาก `pricing.json` |
| ค่า fallback ในเนื้อหน้า (ตอน JS ปิด/crawler) | HTML ใน `buy.html` | crawler, ผู้ใช้ที่ปิด JS | `npm run pricing:check` บังคับให้ตรง JSON |

สูตรจัดรูปแบบ (`usdPrice` / `baht` / `approxThb`) อยู่ที่ `portfolio/price-format.js` ที่เดียว
หน้าเว็บกับตัวตรวจเรียกไฟล์เดียวกัน — ดู `tools/test/portfolio-promo.test.mjs`

## 3. ขั้นตอนเปลี่ยนราคา (ทำตามลำดับ)

```bash
# 1) แก้ตัวเลขที่เดียว
#    portfolio/pricing.json  → tiers[].usd / tiers[].thb / renewal / display.approxThbRoundTo

# 2) สร้าง head ใหม่จาก JSON (เขียน buy.html)
npm run pricing:head

# 3) ตรวจทั้งหน้า (ราคา, โปร, เลขบัญชี, head ตรงตัวสร้าง)
npm run pricing:check

# 4) ตรวจข้อความ/ตัวสะกด
npm run check:copy

# 5) commit ทั้ง pricing.json + buy.html แล้ว push
```

หมายเหตุ: `npm run pricing:head` เขียนทับเฉพาะ 4 จุดใน `<head>` — รายการราคาใน meta description,
`og:title`, `twitter:title` และก้อน `offers` ของ JSON-LD ที่เหลือ (title, canonical, og:image,
og:description, ฟิลด์อื่นของ JSON-LD) ไม่ถูกแตะ ราคาไม่เปลี่ยน = ไฟล์ไม่เปลี่ยนแม้แต่ไบต์เดียว

## 4. ด่านที่กันการหลุด (อัตโนมัติ)

| ด่าน | รันที่ | จับอะไร |
|---|---|---|
| `npm run pricing:head -- --check` | CI `Audit site` (required) | head ที่ commit ไม่ตรงกับผลของตัวสร้าง (ลืมรันหลังแก้ราคา / แก้ head มือ) |
| `npm run pricing:check` | มือ + ก่อน commit | `renderHead(buy.html, pricing) === buy.html` ทั้งก้อน · ค่า fallback ทุกช่อง · ราคาบาทเทียบ USD · ไม่มีเลขบัญชีอื่น · โปร EARLY20 ตรง JSON |
| `tools/test/portfolio-promo.test.mjs` | `node --test` | head จริง = ผลตัวสร้าง · เปลี่ยนราคาแล้ว head เปลี่ยนตาม · ตัวสร้างรันซ้ำได้ผลเท่าเดิม · สูตรราคาไม่ถูกเขียนซ้ำสองฝั่ง |

ถ้า CI ฟ้อง `buy.html head ไม่ตรงกับ pricing.json` → รัน `npm run pricing:head` แล้ว commit `buy.html`

## 5. ข้อจำกัดที่ยังเปิด

- `README.md` / `README.en.md` / `marketing/quotation.md` / หน้า `procurement.html` ยังพิมพ์ราคาเป็นข้อความ
  (ไม่ได้ผูกกับ JSON) — `pricing:check` ตรวจ `procurement.html` ให้แล้ว ส่วน README/marketing ยังต้องแก้มือ
- JSON-LD เก็บราคาเป็น USD ตามที่ Gumroad ขาย; ราคาบาท (โอนในประเทศ) อยู่ในเนื้อหน้าและ `order.html`
- ตัวสร้างจับรูปแบบรายการราคา `"<ชื่อแพ็กเกจ> $<ราคา>"` คั่นด้วย ` · ` หรือ `, ` — ถ้าเปลี่ยนชื่อแพ็กเกจ/โครง head
  จนรูปแบบนี้หาย ตัวสร้างจะ **ล้มทันที** (ไม่ปล่อยผ่านเงียบ ๆ) พร้อมบอกให้แก้ regex ใน `tools/order/sync-head.mjs`
