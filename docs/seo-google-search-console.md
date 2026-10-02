# Google Search Console — ผูกโดเมนกับ "กฤษกรณ์ อุตมะ" (P20, 1/10/69)

เป้าหมาย: ให้ Google เชื่อมโดเมนกับชื่อผู้ก่อตั้ง — โดเมนใช้งาน: `sovereignoriginshop.dpdns.org` (ACTIVE 30/9) + `sovereign-shop.dpdns.org` (ชื่อสั้น จด 1/10 — รอ NS/Active ตาม ops-runbook §สิบ "โซนที่สอง")
(เว็บไซต์เตรียมฝั่งโค้ดครบแล้ว: JSON-LD `founder` + meta author บน /about · sitemap.xml · robots.txt)

## ⚠️ บล็อกที่ต้องแก้ก่อน (ตรวจ live 1/10/69)

**✅ แก้แล้ว 2/10/69 ตี 4 — พิสูจน์ 200 ทั้งคู่** (เดิมตอบ 403 จาก WAF เพราะ 2 path ไม่อยู่ใน allowlist) — แก้จริงด้วยการเติม `or http.request.uri.path in {"/robots.txt" "/sitemap.xml"}` ก่อน `)` ปิดสุดท้ายของ rule `Public-only: block admin/internal paths` ผ่าน API (PUT ruleset 200) · ตรวจซ้ำ: sitemap **200** · robots **200** · home 200 · /dashboard 403 ปกติ · คู่มือข้างล่างยังใช้ได้ถ้าต้องทำซ้ำ/โซนใหม่

## ✅ Pre-flight ก่อน Verify — ตรวจจริง 2/10/69 (P22)

ตรวจทุก URL ใน sitemap ผ่านโดเมนจริงด้วย UA ของ Googlebot: **10/10 ตอบ 200** และมีครบทุกตัว

| เช็ค | ผล |
|---|---|
| `<title>` | 10/10 มี (เดิม home + mbti + sensors + hover-cards **ไม่มีเลย**) |
| `meta description` | 10/10 มี |
| `rel=canonical` | 10/10 (เดิม **ไม่มีหน้าไหนเลย**) ทุกตัวชี้ `https://sovereignoriginshop.dpdns.org/...` + trailing slash ให้ตรง `trailingSlash: true` |
| `meta robots` | 8/10 = `index,follow` · **2 ตัวยัง `noindex`** = `/shop/` กับ `/community/` (ดูข้อค้างด้านล่าง) |
| OG (title/desc/url/site_name) | 10/10 (เดิมมีแค่ `/about`) |
| JSON-LD | `/` = WebSite · `/about` = Organization + founder (เดียวพอสำหรับ entity ของเจ้าของ ไม่ต้องใส่ทุกหน้า) |
| sitemap.xml | 10 URL **มี trailing slash แล้ว** (เดิมไม่มี → ทุก URL โดน 308 เพราะ `trailingSlash: true` = Google นับว่า sitemap ไม่ตรงหน้าจริง) |
| robots.txt | 200 · `Allow: /` + บรรทัด `Sitemap:` ถูกต้อง |
| WAF | rule เดียว `not(public …)` action=Block · **Bot Fight Mode = ปิด** · Security Level = medium · `/dashboard/` `/api/auth/login` = **403** ตามต้องการ · ไฟล์คีย์ IndexNow อยู่ใน allowlist แล้ว |

**ยังค้าง 2 อย่าง (ไม่ใช่บล็อกการ Verify):** (1) ค่า TXT จาก GSC ยังไม่ได้รับ — Verify ทำไม่ได้จนเจ้าของส่งค่ามา (2) `/shop/` กับ `/community/` ยังตั้ง `noindex` อยู่ทั้งที่อยู่ใน sitemap — ต้องตัดสินใจ (ถ้า Verify ไปแล้ว GSC จะขึ้นเตือนเรื่องนี้ในรายงาน "หน้าเว็บที่ไม่ได้ทำดัชนี")

### ให้บอทรู้ทันทีที่ URL เปลี่ยน (ผูก nightly/weekly แล้ว 2/10/69)

- **`tools/indexnow-shop-notify.mjs`** — ยิง IndexNow (`api.indexnow.org` → Bing/Yandex/Seznam/Naver) โดยอ่านคีย์จริงจาก `sovereign-frontend/public/<32hex>.txt` และ URL จริงจาก sitemap ที่เว็บตอบ · **ต้องเห็นไฟล์คีย์ตอบ 200 + เนื้อหาตรงก่อนถึงยิง** (กันยิงแล้วถูกปฏิเสธ) · fail-safe exit 0 เสมอ
- **เรียกอัตโนมัติ:** `tools/nightly-verify.mjs` (ทุกคืน 02:00 หลัง verify) + `tools/verify/visitor-digest.mjs` (รายสัปดาห์) · ผลไปโชว์ในสรุป Telegram ของ nightly และ digest · log: `logs/indexnow-shop.log` + `logs/indexnow-shop-last.json`
- **เรียกเองได้:** `node tools/indexnow-shop-notify.mjs --dry-run` (พิมพ์รายการ ไม่ยิง) · `--strict` (ล้ม = exit 1)
- **ฝั่ง Google:** endpoint ping sitemap ของ Google **ถูกปิดตั้งแต่ มิ.ย. 2023** (ยืนยันแล้ว 2/10/69) — วิธีเดียวที่เหลือคือ Submit sitemap ใน GSC + Google จะมาอ่านซ้ำเอง (IndexNow ไม่ครอบ Google)

### เฝ้าว่า Google "เห็น" หน้าไหนจริง — GSC coverage (เพิ่ม 2/10/69)

> **ค้างรอเจ้าของ:** ยังใช้ไม่ได้จนกว่าจะ (1) ได้ค่า TXT มา Verify และ (2) ใส่ credential ด้านล่าง
> ระหว่างนี้เครื่องมือ **ข้ามแบบเงียบ + exit 0** = ไม่ทำให้ nightly แดง ไม่กวนทุกคืน

ทำไมต้องมีอีก (นี่คือช่องว่างของ SEO pre-flight): pre-flight ตรวจว่า *หน้าเว็บ* พร้อม (200 + title + canonical + ไม่มี noindex) แต่ไม่รู้ว่า *Google เข้ามาแล้วหรือยัง* — เคยเจอบั๊กแบบ sitemap ประกาศ 10 หน้า แต่ Google ไม่เข้ามาเลย และเคยเจอหน้าที่มี traffic แล้วหลุดวง (canonical ผิด / noindex ซ้อน / ถูก WAF บล็อก) โดยไม่มีอะไรเตือน

- **`tools/verify/gsc-coverage.mjs`** — ถาม Search Analytics API 2 หน้าต่าง (28 วันล่าสุด vs 28 วันก่อน) แล้วเทียบกับ sitemap จริงจากโดเมน:
  1. API เข้าถึง property ได้ (ถ้าไม่ได้ = ค่า TXT หลุด/โดนลบ → แจ้งเตือน)
  2. **หน้าที่เคยมี impression แล้วหายไป** = regression → แจ้งเตือน (สำคัญที่สุด)
  3. หน้าที่ Google เข้ามาแต่ไม่อยู่ใน sitemap (orphan) → แจ้งเตือน
  4. หน้าใน sitemap ที่ยังไม่เคยมี impression = ข้อมูลเท่านั้น ไม่ร้อง (เว็บใหม่ยังไม่มี traffic = ปกติ)
- **ถ้ามีปัญหา** ส่ง Telegram เฉพาะตอนพัง (เหมือน seo-preflight) · ผลเขียน `logs/gsc-coverage.json` เสมอ
- **ผูกแล้ว:** `tools/nightly-verify.mjs` (ทุกคืน 02:00 หลัง seo-preflight) + บรรทัดในสรุป Telegram
- **เทสต์ตรรกะ:** `node tools/test/gsc-coverage.test.mjs` (9 เคส — เคยจับบั๊กจริง: เอา URL ดิบไปเทียบกับชุดที่ normalize แล้ว = ทุกหน้ากลายเป็น orphan ร้องทุกคืน)
- **เรียกเองได้:** `node tools/verify/gsc-coverage.mjs` (พิมพ์สรุป) · `--strict` (ล้ม = exit 1) · `--test` (พิมพ์ข้อความ TG ไม่ส่งจริง) · `--days 28`

**ตั้งค่า credential (ทำครั้งเดียว หลัง Verify สำเร็จ):**

1. [Google Cloud Console](https://console.cloud.google.com/) → เลือก/สร้างโปรเจกต์ → **APIs & Services → Library** → เปิด **Search Console API**
2. เมนู OAuth consent screen → ตั้งเป็น External + เติมอีเมลตัวเองเป็น Test user
3. **Credentials → Create Credentials → OAuth client ID → Application type: Desktop app**
4. รัน consent ครั้งเดียวเพื่อเอา refresh token (เปิดลิงก์นี้ในเบราว์เซอร์ แล้วเลือก scope `https://www.googleapis.com/auth/webmasters.readonly`):

```
https://accounts.google.com/o/oauth2/auth?client_id=<CLIENT_ID>&redirect_uri=urn:ietf:wg:oauth:2.0:oob&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fwebmasters.readonly&response_type=code&access_type=offline&prompt=consent
```

5. เอา `code` ที่ได้ไปแลก refresh token:

```bash
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=<CLIENT_ID>&client_secret=<CLIENT_SECRET>&code=<CODE>&grant_type=authorization_code&redirect_uri=urn:ietf:wg:oauth:2.0:oob"
```

6. ใส่ 3 ค่านั้นใน `sovereign-os/infra/.env` (`GSC_CLIENT_ID` · `GSC_CLIENT_SECRET` · `GSC_REFRESH_TOKEN` · ถ้าต้อง `GSC_SITE_URL=sc-domain:sovereignoriginshop.dpdns.org`)
7. พิสูจน์: `node tools/verify/gsc-coverage.mjs` → ต้องเห็นบรรทัด `· clicks … → … · impressions … → …` (ถ้ายังไม่มีข้อมูลจะเป็น 0 → 0 ปกติในเดือนแรก)

## คู่มือแก้ WAF โดเมนเดิม — ทำครั้งเดียวใน dashboard (~5 นาที)

เป้าหมาย: ให้ `/sitemap.xml` + `/robots.txt` ผ่าน โดย **ไม่แตะส่วนอื่นของ rule เดิม** (ห้ามวาง expression ทับทั้งก้อน — rule จริงบน zone มี /partners /about /api/track ฯลฯ เพิ่มมาแล้ว ถ้าวางทับจะเผลอปิดเส้นที่เปิดไว้)

1. Cloudflare → โดเมน `sovereignoriginshop.dpdns.org` → **Security → WAF → Custom rules**
2. กด **Edit** ที่ rule "Public-only: block admin/internal paths"
3. สลับเป็นโหมด **Edit expression** → เลื่อนไปวงเล็บปิดสุดท้าย `)` → **เติมต่อท้ายก่อนวงเล็บปิด** (บวกอย่างเดียว):
   ```
    or http.request.uri.path in {"/robots.txt" "/sitemap.xml"}
   ```
   (ถ้าเป็นโซนใหม่/ทำซ้ำ — expression **จริง** บนโซนเดิม ณ2/10/69 อยู่ใน ops-runbook §สิบ ขั้น 5 · คัดมาวางทั้งก้อนแทนการเติมบวก ก็ได้ถ้าเป็นโซนที่ยังไม่มี rule)
4. กด **Deploy**
   - ⚠️ **Deploy โดน challenge เงียบ (เจอจริง 2 ครั้ง 1/10-2/10):** ถ้า Deploy แล้วผลยัง 403 → **ทางเลือก (ง่ายกว่า):** เพิ่ม custom rule **ใหม่** ชื่อ `Allow sitemap/robots` action=**Skip** (ถ้ามี) / หรือ rule ALLOW ไว้ **บนสุดสุด** expression: `http.request.uri.path in {"/robots.txt" "/sitemap.xml"}` → Deploy rule ใหม่ (ไม่โดน rule เดิมกลืน เพราะเจอทีหลังในลำดับ) · อีกทาง: console PUT ruleset ตรง ๆ (วิธีที่เคยใช้สำเร็จ 30/9 — ดู ops-runbook §สิบ ขั้น 6)
5. พิสูจน์ (ผู้ช่วยรันได้):
   `curl -s -o /dev/null -w "%{http_code}\n" https://sovereignoriginshop.dpdns.org/sitemap.xml` → ต้อง **200** (เดิม 403) · robots.txt เช่นกัน · ถ้ายัง 403 รอ ~1 นาทีรีลอง + เช็คว่า expression บนหน้า rule เปลี่ยนจริง

## ลำดับทำ GSC ครบสองโดเมน (แต่ละโดเมน = property แยก ทำชุดเดียวกัน)

เงื่อนไขก่อน: WAF อนุญาต `/robots.txt` `/sitemap.xml` แล้ว (ด้านบน) · โดเมนนั้นเปิดได้ 200

## ขั้นตอน (ผู้ใช้ทำเอง ~10 นาที — ต้องใช้บัญชี Google ของเจ้าของ)

1. เปิด https://search.google.com/search-console → **เพิ่มพร็อพเพอร์ตี** → เลือก **โดเมน (Domain)**
2. กรอก: `sovereignoriginshop.dpdns.org`
3. Google ให้ **ระเบียน TXT** มา 1 บรรทัด (รูปแบบ `google-site-verification=xxxx`)
4. เปิด **Cloudflare Dashboard** → โดเมน → **DNS → Records → Add record**
   - Type: `TXT` · Name: `@` · Content: วางระเบียนจากข้อ 3 · TTL: Auto
5. กลับหน้า Search Console กด **Verify** (ถ้ายังไม่ผ่าน รอ DNS propagate 5-15 นาทีแล้วกดซ้ำ)

## หลังยืนยันสำเร็จ

6. เมนู **Sitemaps** → กรอก `sitemap.xml` → Submit (ที่อยู่จริง = https://sovereignoriginshop.dpdns.org/sitemap.xml)
7. **URL Inspection** → ใส่ `https://sovereignoriginshop.dpdns.org/shop/` (มี slash ท้าย ตามที่เว็บเสิร์ฟจริง) → กด "Request Indexing" — ทำซ้ำกับ /about/ /partners/ /demo/
8. (แนะนำ) โปรไฟล์ Google ของเจ้าของ: เพิ่มเว็บไซต์เป็นลิงก์ในส่วน "เว็บไซต์/ลิงก์สังคม" ของโปรไฟล์ Google บัญชีเดียวกับที่ JSON-LD อ้าง

## ทางเลือกถ้าไม่อยากแตะ DNS

- เลือกวิธียืนยันแบบ **HTML file** ใน Search Console → ได้ชื่อไฟล์ `googleXXXX.html`
- วางไฟล์นั้นที่ `sovereign-frontend/public/` แล้วบอกผู้ช่วย → deploy 1 รอบ (build + SW bump) แล้วกด Verify

## เช็คว่าทำงาน

- `curl -s https://sovereignoriginshop.dpdns.org/sitemap.xml | head -5` → เห็น XML
- ใน Search Console: Sitemaps แสดง "Success" + จำนวน URL ที่ค้นพบ

## โซนที่สอง: `sovereign-shop.dpdns.org` (หลังโซน Active ตาม ops-runbook §สิบ "โซนที่สอง")

**สถานะ 2/10/69 (ตรวจซ้ำ — แก้ข้อมูลผิดที่เคยจดว่า "เปลี่ยน NS แล้ว"):** `sovereign-shop.dpdns.org` **ยังไม่มีตัวตนใน DNS ทั้งสองระบบ** — parent DigitalPlat (ns1-4 + ns1/ns2.dpdns.org) ตอบ NXDOMAIN เทียบเท่าชื่อปลอม (control) ข้ามวันแล้ว = **ยังไม่ได้จดจริง** (มีแค่ zone ในบัญชี Cloudflare) → **ยังเข้าขั้นทำ GSC ไม่ได้** — ขั้นแรก: เจ้าของตัดสินใจว่าจะจดชื่อนี้จริง (แล้วตั้ง NS เป็น delilah+vin ตาม ops-runbook §สิบ "โซนที่สอง") หรือลบ zone ทิ้ง แล้วค่อยกลับมาทำ property นี้

1. ทำขั้นตอนเดียวกับด้านบนทั้งหมดแต่ใช้ชื่อ `sovereign-shop.dpdns.org` (TXT verify บนโซนใหม่ · Submit `sitemap.xml` · Request Indexing /shop /about)
2. sitemap.xml ใน repo มี **URL สอง host อยู่รวมกันแล้ว** (คู่ขนาน 1/10) — แต่ละ property หยิบ URL ของ host ตัวเอง · ถ้าตัดสินใจใช้โดเมนใหม่เป็นหลักภายหลัง: ตัดชุด host เก่าออก + สลับ canonical (JSON-LD `url` / og) บน /about ให้เป็นโดเมนใหม่ แล้วแจ้ง agent deploy
