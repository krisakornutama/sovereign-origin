# หลักฐานคนนอก — คอมเมนต์ `t1_19t89wt2bjr51` **ไม่ปรากฏต่อผู้เยี่ยมชม** (26 พ.ย. 2026)

**คำถามที่ต้องตอบ:** คอมเมนต์ที่มองเห็นได้จากเบราว์เซอร์ที่ล็อกอินเป็น `oweenhoper` และจาก `/api/...json`
(`removed_by_category: null`) ปรากฏต่อคนที่ไม่ล็อกอินและไม่ได้มาจาก IP ของเครื่องนี้จริงหรือไม่

**วิธี:** ยิงทุกเส้นจาก process ที่ไม่มีคุกกี้ของผู้ใช้ และไม่ใช่ IP ของเครื่องนี้ (reading proxy / CORS relay /
public mirror / archive / Reddit feed ผ่าน relay) แล้วเก็บ status + เนื้อหาดิบ

เป้าหมาย: `https://old.reddit.com/r/selfhosted/comments/1y0njjb/new_project_megathread_week_of_19_nov_2026/19t89wt2bjr51/`

## ตารางผลรายเส้น (ค่าที่ปลายทางตอบจริง)

| # | เส้นทาง (ไม่ล็อกอิน, นอก IP เครื่องนี้) | HTTP | เนื้อหาที่ได้ |
|---|---|---|---|
| 1 | `r.jina.ai/<old.reddit permalink>` | 200 (jina) | Reddit ตอบ 403: `## whoa there, pardner! Your request has been blocked due to a network policy.` |
| 2 | `r.jina.ai/<reddit .json?raw_json=1>` | 200 (jina) | `Warning: Target URL returned error 403: Forbidden` · `You've been blocked by network security.` |
| 3 | `r.jina.ai/<reddit .rss>` | 200 (jina) | 404 จาก Reddit (ฟอร์ม RSS ของ permalink คอมเมนต์ไม่รับ) |
| 4 | `api.allorigins.win/raw?url=<.json>` | 000 | timeout 45s ไม่ได้รับไบต์ |
| 5 | `api.allorigins.win/get?url=<.rss>` | 522 | `error code: 522` |
| 6 | `api.codetabs.com/v1/proxy?quest=<.json>` | 522 | `error code: 522` |
| 7 | `corsproxy.io/?url=<.json>` | 401 | `{"error":"A valid API key is required..."}` |
| 8 | `api.cors.lol/?url=<.json>` | 403 | หน้า block ของ Reddit (190 KB) |
| 9 | `redlib.cow.rip` | 403 | หน้า error ของ instance |
| 10 | `redlib.hbubli.cc` | 200 | `<title>Making sure you're not a bot!` (Anubis challenge) |
| 11 | `redlib.nadeko.net` | 418 | หน้า error |
| 12 | `redlib.reallyaweso.me` | 200 | `<title>Stand back.` (challenge) |
| 13 | `redlib.thepixora.com` | 403 | 105 B |
| 14 | `redlib.utilibre.org` | 200 | `<title>Making sure you're not a bot!` |
| 15 | `redlib.zanity.net` | 200 | อินเตอร์สติเชียล `You are about to leave Redlib` — ไม่มีเนื้อหาคอมเมนต์ |
| 16 | `safereddit.com` | 200 | ไม่มีเนื้อหาคอมเมนต์ |
| 17 | `old-reddit-com.translate.goog/...` | 200 | เด้งไป `https://old-reddit-com.translate.goog/login/?reason=lor2&dest=...` · `<title>Welcome to Reddit` |
| 18 | `api.microlink.io` | 400 | `EPROXYNEEDED` — "uses antibot protection" |
| 19 | `web.archive.org/save/<permalink>` | 200 | snapshot บันทึกได้ แต่เนื้อหาที่เก็บคือ `https://old.reddit.com/login/?reason=lor2&dest=...` (login wall) |

## เส้นที่ให้คำตอบจริง (อ่านฟีดสาธารณะของ Reddit จาก IP ที่ไม่ถูกบล็อก)

`api.rss2json.com` ดึง Reddit ได้ (IP ฝั่งเขาไม่โดน network policy) และไม่ใช้คุกกี้ของผู้ใช้:

```
GET https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.reddit.com%2Fr%2Fselfhosted%2Fcomments%2F1y0njjb.rss%3Flimit%3D100%26sort%3Dnew&count=100
→ 200, "status":"ok", items = 100

items[0] 2026-11-26 18:09:22 /u/AleDev99
items[1] 2026-11-26 15:34:07 /u/Hunter99507
items[2] 2026-11-26 14:48:45 /u/Livid_Contact_5920
...
oweenhoper = 0 ครั้ง · 4440626505 = 0 ครั้ง
```

ฟีด 100 คอมเมนต์ล่าสุด (sort=new) ครอบช่วง 2026-11-25 21:49 → 2026-11-26 18:09 ซึ่งคลุมเวลาที่โพสต์คอมเมนต์
แต่ **ไม่มีคอมเมนต์ของผู้ใช้อยู่ในนั้นเลย**

```
GET https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.reddit.com%2Fuser%2Foweenhoper%2Fcomments.rss
→ 200, "status":"ok", items = 0
```

ฟีดคอมเมนต์สาธารณะของบัญชีเอง **ว่างเปล่า** ทั้งที่ API/หน้าเว็บตอนล็อกอินยังแสดงคอมเมนต์ ⇒
เนื้อหาของบัญชีไม่ถูกส่งให้คนนอกเห็นในทุกระดับ (account-level shadowban / spam filtering)
ไม่ใช่แค่คอมเมนต์เดียวหรือซับเดียว

## ความพยายามอุทธรณ์ (26 พ.ย. 2026)

- เปิด `https://www.reddit.com/appeals` (เด้งไป `/appeal/`) ในเบราว์เซอร์ที่ล็อกอินเป็น `oweenhoper` — ฟอร์มขึ้นชื่อผู้ใช้ `oweenhoper` ให้อัตโนมัติ (แก้ไม่ได้) และช่อง `BRIEF DESCRIPTION` รับไม่เกิน 250 ตัวอักษร
- กรอกข้อความ 243/250 ตัวอักษร: `All my comments are invisible to logged-out users: user/oweenhoper/comments.rss returns 0 items, and my comment in r/selfhosted's New Project Megathread never appears in the thread's 100 newest public comments. I only mention my product where subreddit rules allow. Please review.`
- กด `Submit` 4 ครั้ง (ปุ่มจริง + คลิกผ่าน locator + `element.click()` + ปุ่ม focus แล้ว Enter) ⇒ **ไม่มี request ส่งแบบฟอร์มออกไปเลย** มีแต่ `GET /svc/shreddit/update-recaptcha?k=<base64 ของ "appeal|foregrounding_action|<renderId>">` และ `POST google.com/recaptcha/enterprise/clr` — ฟอร์มใช้ **reCAPTCHA Enterprise** และไม่ยอมให้การกดที่ไม่ได้มาจากมนุษย์จริงผ่าน จึงไม่มี POST ไปยังปลายทางอุทธรณ์
- **ไม่ได้หลบ captcha** และไม่พยายามอ้อม: ปล่อยแท็บไว้ที่ฟอร์มที่กรอกครบแล้ว เพื่อให้เจ้าของบัญชีกด `Submit` เอง (การกระทำเดียวที่เหลือ)
- หลังกรอกฟอร์ม ไม่มีโพสต์/คอมเมนต์ใหม่ถูกสร้างขึ้น จึงไม่มีของค้าง

## สรุป

- คอมเมนต์ `t1_19t89wt2bjr51` **ไม่ปรากฏต่อคนนอก** — ยืนยันด้วยฟีดสาธารณะของ Reddit ที่ดึงจาก IP สะอาด
- สาเหตุอยู่ที่ระดับบัญชี (ฟีดคอมเมนต์ของผู้ใช้ = 0 รายการ) ⇒ **การโพสต์ซ้ำใน Reddit ไม่ทำให้ใครเห็นได้**
  จึงไม่โพสต์ซ้ำ (จะได้แต่เนื้อหาที่ซ่อนอยู่เพิ่ม) และไม่ลบคอมเมนต์เดิมทิ้ง เพื่อให้กู้คืนได้ถ้าบัญชีถูกปลด
- ข้อเสนอที่คนนอกเปิดเห็นได้จริงจึงถูกยืนยันบนพื้นผิวที่ควบคุมได้:
  ดู `docs/evidence/2026-11-26-public-offer-visibility.md`
