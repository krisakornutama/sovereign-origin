# ข้อความเปิดตัว Sovereign Seal — พร้อมก๊อปวาง

> ไฟล์นี้เตรียมไว้ให้เจ้าของบัญชีโพสต์เอง (LinkedIn / X) — ผมโพสต์แทนบัญชีคุณไม่ได้
> ลิงก์ที่ใช้: ไทย https://sovereignoriginshop.dpdns.org/seal.html · EN https://sovereignoriginshop.dpdns.org/seal-en.html
> ชุดดาวน์โหลด: https://github.com/krisakornutama/sovereign-origin/releases/tag/seal-v1.0.0

## 1. LinkedIn (อังกฤษ — กลุ่มนักพัฒนา/self-hosted กว้างกว่า)

> Anyone can edit a file you sent. The question is whether the recipient can tell.
>
> I built Sovereign Seal: one HTML file, no install, no account, no server. Drop a file, get its SHA-256 plus a digitally signed seal. Anyone verifies offline that these are the exact bytes you signed.
>
> The part I care about: the download set is signed by the tool itself. So the first thing a new user verifies is the tool's own integrity — run `node seal-cli-1.0.0.mjs verify SHA256SUMS.txt SHA256SUMS.txt.seal.json` and you either get exit 0 or you don't.
>
> What a seal does not do, stated on the page: it proves the bytes did not change and which key signed them. It does not prove the content is true, and the timestamp is the signer's own claim.
>
> Free, permanently: https://sovereignoriginshop.dpdns.org/seal-en.html
>
> Built in Sakon Nakhon, Thailand.

## 2. X / Twitter (5 ทวีต)

1. Anyone can edit a file you sent. Nobody can tell by looking.
2. So I built a file seal: drop a file → SHA-256 + Ed25519 signature → anyone verifies offline. One HTML file, no install, no account.
3. The download set is signed by the tool itself. Verify the verifier: `node seal-cli-1.0.0.mjs verify SHA256SUMS.txt SHA256SUMS.txt.seal.json`
4. Honest limits: it proves bytes didn't change and which key signed — not that the content is true. Timestamps are the signer's claim.
5. Free forever, no paywall: https://sovereignoriginshop.dpdns.org/seal-en.html

## 3. โพสต์ไทย (Facebook กลุ่มนักพัฒนา/เจ้าของร้าน)

> ใครก็แก้ไฟล์ที่เราส่งไปได้ แต่ปัญหาคือคนรับมองไม่ออกว่าโดนแก้
>
> ผมเขียนเครื่องมือฟรีชื่อ "ตราประทับไฟล์" — ไฟล์ HTML เดียว ดับเบิลคลิกเปิด ไม่ต้องติดตั้ง ไม่ต้องสมัคร ลากไฟล์ใส่ ได้ลายนิ้วมือ SHA-256 + ตราที่เซ็นด้วยลายเซ็นดิจิทัล แล้วใครก็ตรวจได้เองแบบออฟไลน์ว่าเป็นไบต์เดียวกันกับตอนเซ็นหรือไม่
>
> จุดที่ผมตั้งใจทำ: ชุดดาวน์โหลดของเครื่องมือนี้เองก็เซ็นด้วยเครื่องมือนี้ — คนโหลดตรวจของก่อนใช้ได้เลย
>
> สิ่งที่มัน "ไม่" ทำ (เขียนไว้บนหน้าเว็บ): ไม่ได้บอกว่าเนื้อหาจริงหรือโกหก และเวลาในตราเป็นคำอ้างของผู้เซ็น
>
> ฟรีถาวร ไม่มี paywall: https://sovereignoriginshop.dpdns.org/seal.html
> ภาษาอังกฤษ: https://sovereignoriginshop.dpdns.org/seal-en.html

## 4. Reddit — สถานะจริงและขั้นตอนปลดล็อก (เจ้าของทำ)

### สถานะจริง 26 พ.ย. 2026 (ตรวจจบแล้ว ไม่ใช่การคาดเดา)

- **r/thaithai**: ปุ่ม `Post` ยัง `disabled` เพราะซับบังคับ **USER FLAIR** — ตั้ง post flair "พูดคุย" สำเร็จแล้ว แต่ตัวเลือก user flair เปิด dialog ไม่ขึ้นเลย (คลิกทั้งปุ่มในแถบข้าง USER FLAIR และปุ่มใน composer แล้ว) ⇒ โพสต์ในซับนี้ไม่ได้จากเครื่องนี้
- **r/SideProject**: ปุ่ม `Post` **enabled** และกดโพสต์จริงแล้ว — โพสต์ถูกสร้าง (`/r/SideProject/comments/1y66kea/`) แต่ทันทีที่สร้างเสร็จ API ของบัญชีเองรายงาน `removed_by_category: "reddit"` และโพสต์เก่าทั้ง 3 ของบัญชีนี้ก็มีสถานะเดียวกันหมด ⇒ **Reddit ลบเนื้อหาทั้งบัญชีอัตโนมัติ** (ระดับบัญชี ไม่ใช่กฎซับ และไม่ใช่เนื้อหา)
- **r/selfhosted megathread** (`1y0njjb`, สัปดาห์ 19 พ.ย.): หน้ากระทู้เปิดได้ แต่ไม่มีกล่องคอมเมนต์ให้ใช้ (ปิดรับคอมเมนต์แล้ว) และถึงโพสต์ได้ก็จะโดนลบระดับบัญชีเหมือนกัน
- ระหว่างตรวจ เจอ rate limit `429` จาก Reddit ⇒ หยุดยิงซ้ำ ไม่ทำให้บัญชีแย่ลงกว่าเดิม

ข้อสรุป: เปลี่ยน "จุดโพสต์" ไม่ช่วย เพราะตัวบล็อกอยู่ที่บัญชี — ต้องให้บัญชีผ่านเกณฑ์ก่อน (ยืนยันอีเมล + มี karma/comments จริงสักระยะ) แล้วค่อยโพสต์

ขั้นตอนที่ต้องทำจากอีเมลของคุณ (3 ข้อ):
1. ยืนยันอีเมลของบัญชี `oweenhoper` (Reddit → Settings → Account → Verify email)
2. คอมเมนต์จริงในซับที่สนใจ 5–10 ครั้ง ให้ karma ขึ้น (โพสต์ลิงก์ทันทีมักถูก automod ลบ)
3. กลับไปที่ draft เดิม (แท็บ r/SideProject ยังเปิดอยู่) แล้วกด Post; ถ้า r/thaithai ยังปิด ให้ใช้ r/SideProject ก่อน

ทางเลือกที่ไม่ต้องรอ: โพสต์ LinkedIn/X ตามข้อ 1–3 ด้านบน ซึ่งไม่มีข้อจำกัดบัญชีแบบ Reddit

## 5. ผลการโพสต์จริง 26 พ.ย. 2026 (รอบสอง — ตรวจจากเซิร์ฟเวอร์ ไม่ใช่การเดา)

- **สถานะบัญชี:** `/api/me.json` = `verified: true` · `is_suspended: false` · `suspension_expiration_utc: null` · `r/thaithai/about.json` = `user_is_banned: false`
- **user flair:** ตั้งสำเร็จใน `r/thaithai` ข้อความ `นักพัฒนา` (แฟลร์ของซับเป็นแบบพิมพ์เอง ไม่มีเทมเพลต) — Toast ยืนยัน "User flair updated"
- **r/thaithai:** สร้างโพสต์ `t3_1y67jot` (post flair `พูดคุย`) ได้จริง แต่ `removed_by_category` = `reddit` ทันที ⇒ การลบยังอยู่ระดับบัญชี (เหมือน `SEAL-010`) — ลบโพสต์ที่ถูกลบแล้วออกแล้ว ไม่ทิ้งของค้าง
- **API submit ตรง ๆ** จากคอนโซลคืน `BAD_CAPTCHA` ⇒ ใช้หน้าเว็บ UI สถานเดียว
- **ทางสำรองที่ได้ผล:** คอมเมนต์ใน `r/selfhosted` New Project Megathread → `t1_19t89wt2bjr51` ยังอยู่ (`removed_by_category: null`) และอยู่ใน listing สาธารณะ
  <https://old.reddit.com/r/selfhosted/comments/1y0njjb/new_project_megathread_week_of_19_nov_2026/19t89wt2bjr51/>
- **ข้อจำกัดของซับนี้:** อิโมจิใช้ได้เมื่อ karma เกิน 40 — โพสต์ที่มีอิโมจิจะถูกลบทันที จึงตัดอิโมจิออกก่อนส่ง
- **ตรวจแบบคนนอกไม่ได้จากเครื่องนี้:** curl ไม่มีคุกกี้ = `403` "You've been blocked by network security" · อินคอกนิโต → `/login?reason=lor2`
