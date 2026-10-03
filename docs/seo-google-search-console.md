# Google Search Console — ผูกโดเมนกับ "กฤษกรณ์ อุตมะ" (P20, 1/10/69)

เป้าหมาย: ให้ Google เชื่อมโดเมนกับชื่อผู้ก่อตั้ง — โดเมนใช้งาน: `sovereignoriginshop.dpdns.org` (ACTIVE 30/9) + `sovereign-shop.dpdns.org` (ชื่อสั้น จด 1/10 — รอ NS/Active ตาม ops-runbook §สิบ "โซนที่สอง")
(เว็บไซต์เตรียมฝั่งโค้ดครบแล้ว: JSON-LD `founder` + meta author บน /about · sitemap.xml · robots.txt)

## 🚨 งานที่ต้องให้เจ้าของทำเอง — `/mbti/compare` ตอบ 403 ทุกคน (รวม Googlebot)

> อันนี้คือข้อเดียวในเอกสารนี้ที่**ยังทำให้ผู้ใช้จริงพังอยู่ตอนนี้** ทุกอย่างอื่นข้างล่างผ่านหมดแล้ว
> ต้องใช้สิทธิ์ Cloudflare dashboard ของเจ้าของเท่านั้น · **อยู่นอกโค้ด repo · AI แก้ให้ไม่ได้**

**อาการที่คนเจอ:** `/mbti` อยู่ใน sitemap และ Google เข้ามาดูอยู่จริง · หน้านั้นลิงก์ไป `/mbti/compare` **3 จุด**
ผู้เยี่ยมชมที่กด "เปรียบเทียบผลลัพธ์" จะเจอ **หน้าบล็อก 403** ไม่ใช่หน้าเว็บ

**ต้นเหตุ:** rule ของ Cloudflare ชื่อ `Public-only: block admin/internal paths` เป็น **allowlist (default-deny)**
`/mbti/compare` ไม่ได้อยู่ในรายการ → โดน 403 **ทุกคน รวมถึง Googlebot**
(พิสูจน์แล้วว่าเป็น default-deny จริง: URL ที่ไม่อยู่ใน allowlist แม้แต่ที่ไม่มีอยู่จริงก็ตอบ 403 เหมือนกัน)

### สิ่งที่ต้องเพิ่ม — 1 บรรทัด

| | |
|---|---|
| โดเมน | `sovereignoriginshop.dpdns.org` |
| ที่ไหน | Security → WAF → Custom rules → rule `Public-only: block admin/internal paths` |
| วิธี | Edit expression → เติมต่อท้าย **ก่อนวงเล็บปิดสุดท้าย `)`** |
| **ค่าที่เติม** | `or http.request.uri.path in {"/mbti/compare*"}` |

⚠️ **เติมบวกเฉย ๆ ห้ามวาง expression ทับทั้งก้อน** — rule จริงบนโซนมี `/partners` `/about` `/api/track` ฯลฯ เพิ่มมาแล้ว ถ้าวางทับจะเผลอปิดเส้นที่เปิดไว้
วิธีเดียวกับที่เคยใช้แก้ `/robots.txt` + `/sitemap.xml` สำเร็จ 2/10/69 · คู่มือฉบับเต็มอยู่หัวข้อ "คู่มือแก้ WAF" ด้านล่าง

**พิสูจน์ว่าแก้แล้ว** (ต้องได้ **200** · ปัจจุบันได้ 403):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sovereignoriginshop.dpdns.org/mbti/compare
```

### หลังแก้ WAF แล้ว ยังประกาศไม่ได้ทันที — ต้องทำอีก 3 อย่างตามลำดับ

1. **เติม `<h1>`** — หน้านี้**ยังไม่มี h1 เลย** (หัวข้อที่เห็นเป็น h2/h3 ไม่มี h1 ที่ระดับหน้า) · `seo-preflight` บังคับ h1 = 1 อันพอดี (0 = หน้าว่าง)
2. **เติมเนื้อหาจริงให้ผ่าน 800 ตัวอักษร** — เกณฑ์ thin content นับจาก HTML จริง ตัด script/style/svg/nav/aside ทิ้งก่อน · ปรับด้วย `SEO_MIN_TEXT_CHARS`
   (ตัวเลขตอนนี้ยังวัดไม่ได้ เพราะหน้าตอบ 403 บอทดึงไม่ได้ — ต้องแก้ข้อ 1 ก่อนแล้วค่อยรัน preflight ดูตัวเลขจริง)
3. **ค่อยถอด `noindex` + ใส่ sitemap** — ตอนนี้หน้าถูกตั้ง `noindex` ไว้**โดยเจตนา** เพราะการประกาศ URL ที่ตอบ 403 คือคำสัญญาที่ผิด
   · เอา `noindex` ออกจาก `<SeoHead>` ใน [`sovereign-frontend/src/pages/mbti/compare.tsx`](../sovereign-frontend/src/pages/mbti/compare.tsx) · เพิ่ม `{ path: '/mbti/compare', ... }` ใน `PUBLIC_PATHS` ([`sovereign-frontend/src/lib/publicAccess.ts`](../sovereign-frontend/src/lib/publicAccess.ts))

**พิสูจน์ก่อน merge:** `node tools/verify/seo-preflight.mjs` (ต้องผ่าน **12/12**) · `node tools/verify/seo-publish-audit.mjs` (ต้องไม่มีข้อผิดพลาด)

> **อ้างอิงระดับโค้ด:** คอมเมนต์ใน [`sovereign-frontend/src/pages/mbti/compare.tsx`](../sovereign-frontend/src/pages/mbti/compare.tsx) ยังอธิบายเรื่องนี้ไว้ (ไม่ได้ลบ · เป็นป้ายกำกับตอนแก้โค้ด)
> แต่ **เอกสารชิ้นนี้คือที่ที่คนต้องมาทำงาน** เพราะต้องใช้สิทธิ์ dashboard ที่อยู่นอกโค้ด
> ระหว่างนี้ **ห้ามแก้หน้าเอง** — `noindex` เป็นการตั้งใจชั่วคราวที่ถูกต้อง ณ สภาพปัจจุบัน (หน้าตอบ 403 = ไม่ควรประกาศ)

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

**ยังค้าง 1 อย่าง (ไม่ใช่บล็อกการ Verify):** ค่า TXT จาก GSC ยังไม่ได้รับ — Verify ทำไม่ได้จนเจ้าของส่งค่ามา
~~ข้อ 2: `/shop/` กับ `/community/` ยังตั้ง `noindex` อยู่ทั้งที่อยู่ใน sitemap~~ — **แก้แล้ว 3/10/69** ทั้งคู่เป็น `index,follow` · `seo-publish-audit` ยืนยันว่า contradiction = 0 (ไม่มีหน้าใน sitemap ที่เป็น noindex แล้ว)

### ⚠️ Google ได้ HTML ว่างจากหน้าแรก — แก้แล้ว 3/10/69 (SSR)

**อาการที่เจอ:** ตรวจด้วย `curl -A Googlebot` พบว่า `/` ตอบ 200 แต่ **ไม่มี `<h1>` เลย และ HTML เล็กกว่าที่ควรเป็น** — แปลว่า page-view ที่ Google เห็นมีแต่ title/description ที่ฝังไว้ ไม่มีเนื้อหาจริง

**ราก:** `isPublicHostname()` (`src/lib/publicAccess.ts`) ตอบ `false` ตอน SSR เพราะยังไม่มี `window` → หน้าแรกเรนเดอร์ branch "ฟอร์มล็อกอิน" → แถว `if (!isHydrated) return Loading` ตัดทิ้งทั้ง branch สาธารณะ → **เนื้อหาโผล่หลัง JS รันเท่านั้น** ซึ่ง Googlebot ไม่รอ

**แก้แล้ว:** ธงตอน build `NEXT_PUBLIC_PUBLIC_SITE=1` (ตั้งใน `next.config.js` เปิดเฉพาะ `NODE_ENV=production` และ**ไม่ใช่** `SOVEREIGN_STATIC_EXPORT=1`) → SSR กับ client ตอบ "สาธารณะ" ตรงกัน (ไม่เกิด hydration mismatch) และเจ้าของที่เปิด `localhost` ยังเห็นฟอร์มล็อกอินตามเดิม เพราะสลับหลัง `mount` เท่านั้น

**พิสูจน์แล้วบนโดเมนจริง (3/10/69 หลัง rebuild):**

```bash
curl -s -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
  https://sovereignoriginshop.dpdns.org/ | grep -c '<h1'
```

| | ก่อน | หลัง |
|---|---|---|
| `<h1>` | **0** | **1** |
| ขนาด HTML | 33,966 ไบต์ | 36,779 ไบต์ |

### ✅ `/sensors/` + `/shop/` แก้แล้ว 3/10/69 — ทำเป็นสาธารณะจริงแบบข้อมูลตัวอย่าง (เจ้าของเลือกข้อ ข)

**อาการเดิม:** ทั้งสองหน้าอยู่ใน sitemap แต่ต้องล็อกอินก่อนถึงมีเนื้อหา (`SensorsHub` มี guard `!isHydrated || !isAuthenticated || !token` · `ShopShell` มี `mounted` guard) → Googlebot ได้ `<h1>` = **0** ทั้งคู่

**เจ้าของตัดสินใจ:** ทำเป็นสาธารณะจริงแบบข้อมูลตัวอย่าง (ไม่ใช่ตัดออกจาก sitemap) — ได้ SEO มากกว่า โดยไม่ต้องเปิดข้อมูลจริง

**วิธีทำ (สำคัญกว่าการได้ h1):** เพิ่ม “มุมมองตัวอย่าง” ที่**เรนเดอร์ได้ตอน SSR** แทนการดึงข้อมูลจริงมาแสดงตอน build
- `src/components/public/SensorsPublic.tsx` · `src/components/public/ShopPublicLanding.tsx` — **ข้อมูลสมมติ hardcode ทั้งหมด ไม่ยิง API ไม่แตะ auth store ไม่มี token** → ข้อมูลจริง/ข้อมูลลูกค้าหลุดออกไปไม่ได้ และทุกจุดที่เป็นตัวอย่างมีป้ายกำกับชัดเจน
- สลับด้วยแพตเทิร์นเดียวกับหน้าแรก (`mounted` + `isLocalHostname()`) → ไม่เกิด hydration mismatch และ **localhost ของเจ้าของยังเป็นหน้าจริงที่ต้อง login** (ยืนยันแล้ว: `/sensors/` บน localhost = “Unauthorized” · `/` = ฟอร์มล็อกอิน)
- `/shop` ยังสลับไปหน้าร้านจริงทันทีที่ฝั่ง client รู้รหัสร้าน (`?id=` / `?order=`) = พฤติกรรมเดิมทุกประการ

**พิสูจน์แล้วบนโดเมนจริงหลัง rebuild (3/10/69):**

| หน้า | `<h1>` ก่อน | `<h1>` หลัง | ขนาด HTML ก่อน → หลัง |
|---|---|---|---|
| `/sensors/` | **0** | **1** | 34,062 → 41,839 ไบต์ |
| `/shop/` | **0** | **1** | 4,248 → 9,881 ไบต์ |

**`/shop/` มีบั๊กแฝงที่ต้องรู้:** `SeoHead` อยู่ใน `ShopShell` แต่ branch หน้าแนะนำ return ออกมา**นอก** `ShopShell` → ได้ h1 แต่**หลุด title + canonical + description** (seo-preflight จับเป็นปัญหา) · แก้แล้วโดยย้าย `SeoHead` เข้า `ShopPublicLanding` เอง — **บทเรียน: หน้าที่แตกหลาย branch ต้องมี metadata ติดไปกับทุก branch ไม่ใช่ฝากไว้ที่ layout ภายในของ branch อื่น**

**หลังแก้ = ไม่เหลือหน้าไหนใน sitemap ที่ h1=0** — ยืนยันครบ 10/10 (h1 + title + canonical + description) และ `seo-preflight` ผ่าน 10/10

**เช็คเองได้ทุกครั้งที่แก้หน้าสาธารณะ:** ข้างบน — ถ้า h1 = 0 บนหน้าไหนแม้ status เป็น 200 แปลว่าเนื้อหานั้นยังไม่ถึง Google

### ✅ ปิดช่องว่างไว้แล้ว 3/10/69 — gate จับ "หน้าว่าง" ได้เอง

**ช่องว่างที่ทำให้ปัญหานี้อยู่นาน:** pre-flight เดิมถามแค่ `title` / `description` / `canonical` — **ซึ่งหน้าที่ว่างเปล่าก็มีครบทุกอย่าง** จึงไม่เคยตั้งคำถามว่า "หน้านี้มีเนื้อหาจริงไหม" ผลคือ `/sensors/` + `/shop/` ผ่านทุกข้อพร้อมกันทั้งที่ Google ได้ metadata ล้วน

**ที่แก้**
1. `tools/verify/seo-preflight.mjs` เพิ่มกติกา **`<h1>` ต้องมี 1 อันพอดี** — `0` = หน้าว่าง · `>1` = โครงสร้างหัวข้อผิด (นับด้วย `/<h1[\s>]/` เพราะ `<h1class=...` ไม่ใช่ h1)
2. แยกเป็น `checkPage()` เพื่อเทสต์ได้ + [`tools/test/seo-h1.test.mjs`](../tools/test/seo-h1.test.mjs) 11 เคส (รวมเคสจริงที่เคยพลาด: metadata ครบแต่ไม่มี h1)
3. **ผูก `npm run test:tools` เข้า `verify` เป็นสายที่ 3** — ก่อนหน้านี้เทสต์ใน `tools/` ไม่ถูกเรียกจากไหนเลย กติกาที่ปกป้องระบบจึงพังเงียบได้ถ้าไม่มีคนนึกออกมือ

⚠️ **บทเรียนเชิงโครงสร้างที่ควรจำ:** `verify.mjs` แบ่งงานเป็นสายด้วย `startsWith('backend')` / `startsWith('frontend')` — **ขั้นที่ไม่ขึ้นต้นไหนจะไม่ถูกรันเลยแบบเงียบ ๆ ไม่ใช่ error** ตอนเพิ่มขั้นใหม่ต้องเพิ่ม `toolsLine` ด้วย (พิสูจน์แล้วว่าครอบคลุม 6/6 ไม่มีขั้นหลุด)

### ✅ `/trace` เพิ่มใน sitemap 3/10/69 (10 → 11 URL)

**แก้ข้อมูลที่เคยเข้าใจผิดก่อน:** `/demo/` **อยู่ใน sitemap อยู่แล้ว** (ไม่ต้องเพิ่ม) — แต่เนื้อหาบางมาก (~1,243 ตัวอักษร · 1 h2) เป็นหน้า interactive มากกว่าเนื้อหาสำหรับอ่าน ส่วน `/trace/` **ไม่ใช่แค่ "ยังไม่ได้ประกาศ" — ยังไม่พร้อยเลย** (h1=0 ไม่มี title/canonical/description เพราะถูก `if (!isHydrated) return loading` บังตอน SSR และไม่มี `SeoHead`) จึงแก้ก่อนประกาศ

| | ก่อน | หลัง |
|---|---|---|
| `<h1>` | **0** | **1** ("ตามรอยผลผลิต") |
| ขนาด HTML | 31,162 ไบต์ | 77,590 ไบต์ |
| title / canonical / description | ไม่มีทั้งหมด | ครบ |

**กติกาที่ใช้:** *อย่าประกาศ URL ใน sitemap จนกว่าหน้านั้นจะผ่านกติกา h1 ข้างบน* — sitemap คือคำมั่นว่า "หน้านี้มีเนื้อหา" ถ้าประกาศแล้วแต่หน้าว่าง Google จะนับเป็นหน้าเสียที่ไม่มีอะไรให้อ่าน

### ✅ ซ่อนเมนูภายในจากหน้าสาธารณะ 3/10/69 — เหลือเฉพาะผู้ที่ล็อกอินแล้ว
**ปัญหาที่เจอ:** `/trace` `/mbti` `/hover-cards` ประกาศใน sitemap แต่หน้าเหล่านี้ import `<Sidebar />`
→ HTML ที่ Googlebot ดึงได้มีเมนูภายในทั้งหมด (Dashboard · Users · Settings · Backup · Audit)
พร้อมลิงก์ไปหน้าภายในของระบบ — WAF บล็อกหน้าเหล่านั้นไว้ 403 จึงไม่รั่วข้อมูล
แต่ "ไม่รั่ว" ≠ "ไม่ควรเห็น" และเปิดโครงสร้างภายในให้ crawl เกินจำเป็น

**แก้:** `lib/useHideInternalNav.ts` = กติกาเดียว `!isAuthenticated → ซ่อน` (ไม่มีรายการหน้าเลย)
ใช้กับ Sidebar · MobileNav (มือถือ) · CommandPalette (Ctrl+K — กันที่ตัว palette เพราะผู้เยี่ยมกดได้)
หน้าในระบบไม่ถูกแตะเลย → เจ้าของที่ล็อกอินแล้วเห็นเมนูครบทุกหน้าเหมือนเดิม

**บั๊กรอบแรก (เหตุผลที่ต้องเปลี่ยนเป็น "ไม่มีรายการ"):** รุ่นแรกใช้ allowlist
`isPublicPath(pathname) && !isAuthenticated` ซึ่งครอบแค่ 11 หน้าใน sitemap —
พอมีหน้าที่เรนเดอร์ได้โดยไม่ต้องล็อกอินแต่ไม่ได้อยู่ในรายการ ผู้เยี่ยมชมก็เห็นเมนูครบทันที
เกิดจริงกับ `/partners/me` (ตอบ 200 ไม่ต้องล็อกอิน ไม่อยู่ในรายการ → เห็น MobileNav พร้อมลิงก์ `/users`)
**กติกาที่ใช้แทน = "เมนูภายในมีเฉพาะผู้ที่ล็อกอินเท่านั้น" ไม่มีรายการ** ทุก URL ที่ไม่ต้องล็อกอิน
ถูกคุมโดยโครงสร้าง ไม่มีหน้าไหนหลุดได้อีก และรายการที่เคยหลุดกันก็เลิกมีโอกาสหลุด

**แยกบทบาทของรายการให้จบ:** `PUBLIC_PATHS` ใน `lib/publicAccess.ts` เหลือหน้าที่เดียวคือ
"ประกาศให้ Google เข้ามา" (`sitemap.xml.ts` import ตรง ๆ) — ไม่ใช่ allowlist ของการมองเห็นอีกต่อไป
ก่อนหน้านี้รายการนี้ถูกใช้สองทางจึงเป็นแหล่งบั๊ก (ประกาศแต่ไม่ซ่อน = เปิดโครงสร้างภายในให้บอท)

**พิสูจน์บนโดเมนจริง (UA Googlebot):** `/trace/` `/mbti/` `/hover-cards/` `/demo/` `/`
→ ลิงก์เมนูภายใน **0 รายการ** ในทุกหน้า (ก่อนแก้หน้าสาธารณะ 3 หน้านี้มี Sidebar ปนอยู่)

**พิสูจน์หลังแก้บั๊ก (เบราว์เซอร์จริง หลัง JS รัน — SSR ตรวจไม่ได้เพราะ SSR ไม่มีเมนูอยู่แล้ว):**
12 URL ที่ไม่ต้องล็อกอิน (`/` `/shop` `/about` `/partners` `/partners/guide` `/partners/me`
`/community` `/demo` `/mbti` `/trace` `/sensors` `/hover-cards`) → `<aside>` 0 · `<nav>` ภายใน 0 ·
ลิงก์ภายใน 0 เหลือแต่ลิงก์สาธารณะ (`nav` ที่เหลือบน `/demo` คือตัวเลือกโมดูลของหน้าทดลอง ไม่ใช่เมนูระบบ)
ผู้เยี่ยมชมที่พิมพ์ `/users/` เข้ามาตรง ๆ → ถูก WAF บล็อก ไม่มีเมนูหลุด

### ✅ เกณฑ์ thin content 3/10/69 — ไม่ใช่ดูแค่ h1
`h1` มี 1 อันแต่ข้อความรวมไม่ถึง **800 ตัวอักษร** = หน้าแทบไม่มีอะไรให้อ่าน (thin content · เกณฑ์เดียวกับที่ Google ใช้)
`seo-preflight.mjs` นับจาก HTML จริง โดยตัด `script/style/svg/nav/aside` ทิ้งก่อน
(สาระสำคัญ: ตัด `nav` เพราะก่อนหน้านี้ตัวเลขหน้าสาธารณะ "ดูมีเนื้อหา" เพราะนับข้อความเมนูภายในไปด้วย)

**ปรับเกณฑ์ได้:** `SEO_MIN_TEXT_CHARS=800` (env) · เปลี่ยนกติกา = แก้ที่นี่ ไม่ต้องแก้โค้ด

**เกณฑ์นี้จับอะไรได้จริงรอบแรก:** หลังซ่อน Sidebar ตัวเลขหน้าจริงลดลงทั้ง 4 หน้า
`/` 527 · `/community` 299 · `/mbti` 697 · `/trace` 267 → แก้ที่ต้นเหตุด้วยการ **เพิ่มเนื้อหาจริง**
(`components/public/PageIntro.tsx` + `DemoExplain.tsx` เรนเดอร์ตอน SSR) ไม่ลดเกณฑ์
ผลหลังแก้: `/` 1,104 · `/community` 948 · `/mbti` 1,304 · `/trace` 812 · `/demo` 3,608 ตัวอักษร → ผ่าน 11/11

**เทสต์:** `tools/test/seo-h1.test.mjs` 16 เคส (thin · ตัวแก้เกณฑ์ · ไม่นับ nav · ไม่นับซ้ำหน้าตาย) · ผูกเข้า `npm run verify` สายที่ 3

### ✅ audit กลับ: หน้าที่ประกาศ index แต่หลุด sitemap 3/10/69
`seo-preflight.mjs` ตรวจจาก sitemap ไปข้างหน้า (ประกาศแล้วต้องดี) แต่ไม่เคยตรวจกลับ
→ ถ้าหน้าใดประกาศ `index,follow` ในโค้ดแล้วลืมใส่ sitemap จะไม่มีอะไรจับเลย (ไม่ error ไม่ warning)
`tools/verify/seo-publish-audit.mjs` ตรวจจากโค้ด (เร็ว จับได้ก่อน merge):
หน้าที่ประกาศ index แต่ไม่อยู่ใน `PUBLIC_PATHS` · sitemap ที่มี URL แต่ไม่มีไฟล์จริง · noindex ที่หลุดเข้า sitemap
เทสต์ 54 เคสที่ `tools/test/seo-publish-audit.test.mjs` (`classify()` ต้องไม่พลาด SeoHead noindex prop · ไม่อ่าน `noindex={false}` เป็น noindex · ไม่พลาดคำในคอมเมนต์)

**ผลตรวจจริง 4/10/69 (สถานะล่าสุด — รันเองได้ด้วย `node tools/verify/seo-publish-audit.mjs`):**
หน้าบนดิสก์ **64 route** → ประกาศแล้ว **11** (= sitemap 11 URL ตรงกันพอดี) · หลังระบบล็อกอิน **49**
· **ตัดสินใจไม่ประกาศแล้ว 4 หน้า** (noindex โดยเจตนา = ถูกต้อง ไม่ใช่งานค้าง): `/partners/me` (พื้นที่ส่วนตัวของคู้ค้า) · `/portfolio` · `/terrain-demo` · `/mbti/compare` (รอแก้ WAF ตามหัวข้อบน)
· **ยังไม่เคยตัดสินใจ 0 หน้า** · **ข้อผิดพลาด 0** → เครื่องมือรายงาน "ผ่าน (ไม่มีหน้าค้าง)"

*(รุ่นแรกของเครื่องมือรายงานผิด — หน้าที่ยังไม่ประกาศอะไรเลยกับหน้าที่ประกาศ noindex หายไปจากการตรวจ เกิดจริงกับ `/partners/me`)*

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
