# Security Lab — OWASP Juice Shop (ฝึกเจาะแบบถูกกฎหมาย)

> **กติกาเหล็ก:** เจาะได้เฉพาะ `http://127.0.0.1:3002` (bind localhost เท่านั้น) — เว็บนี้ถูกสร้างมาให้เจาะโดยเฉพาะ
> ห้ามใช้เทคนิคที่ฝึกที่นี่กับเว็บอื่นเด็ดขาด (ผิด พ.ร.บ. คอมฯ) — Sovereign ของเราเองเจาะได้เพราะเป็นของเรา
> และระบบเรามี `tools/verify/security-audit.mjs` คอยวัดกลับว่ากันได้จริงหรือไม่

## เปิด / รีเซ็ต / ปิด

```bash
docker start juice-shop        # เปิด (ตั้ง restart unless-stopped ไว้แล้ว — บูตเครื่องแล้วขึ้นเอง)
docker restart juice-shop      # รีเซ็ตความคืบหน้าทั้งหมด (DB อยู่ใน container)
docker stop juice-shop         # ปิดชั่วคราว · docker rm -f juice-shop = ลบถาวร
```

## หลักฝึก 3 ชั้น

1. **Recon ก่อนเสมอ** — เปิด DevTools (F12): ดู Network จับ API ที่หน้าเรียก, ดู `main.js` หา endpoint ซ่อน, ดู console log
2. **แก้ request แล้วสังเกต** — ใช้ curl/DevTools "Copy as fetch" แล้วเปลี่ยนพารามิเตอร์ (id, token, role)
3. **ถ้าติด อย่าเบรา** — ดู hint ในเกม (score-board) หรือชาเลนจ์ข้างล่าง แล้วค่อยลองใหม่

## ชาเลนจ์ชุดแรก 10 ข้อ (เรียงจากง่าย → ยาก) + แผนที่สู่ Sovereign

| # | ชาเลนจ์ | แนวคิด (hint ไม่ใช่เฉลย) | Sovereign กันอยู่แล้วไหม |
|---|---|---|---|
| 1 | Score Board | หา route ที่ไม่มีลิงก์ในหน้าเว็บ — ค้นใน `main.js` | ui-sweep เราไล่ทุก mount — แต่ "route ไม่มีในโค้ด" ต้องเตือนได้ไหม |
| 2 | Confidentiality Incident | หาไฟล์ที่พลาดเก็บไว้ใน public dir (ftp/backup) | ตรวจ `docker exec` เนื้อไม่มี secret ตอน build image (.dockerignore) |
| 3 | Error Handling | พิมพ์อีเมลรูปแบบแปลกในหน้า register ให้ stack trace โชว์ | SQLi probe ของเราเช็ค SQLERR ใน body — ต้องรมือ error ไม่รั่ว |
| 4 | Login Admin | SQL injection ที่ฟอร์ม login | **กันแล้ว** — พิสูจน์ด้วย security-audit §2 (Prisma parameterized ตอบ 401 ทุก payload) |
| 5 | Password strength | สมัคร user ที่รหัสอ่อน กับกรอกที่มีอยู่ | เทียบ: users.routes บังคับความแข็งรหัสไหม — ถ้าไม่ เป็น finding ใหม่ |
| 6 | Login Jim/Bender | SQLi แบบเจาะบัญชีเฉพาะ | เดียวกับ #4 — และ rate limit (429×13) จำกัดจำนวนลอง |
| 7 | Forged Feedback | ส่ง feedback โดยปลอม userId ใน payload | **กันแล้ว** — IDOR probe §4: server ห้ามเชื่อ userId จาก client (auth จาก token) |
| 8 | View Basket | เปลี่ยน basket id ใน URL เป็นของคนอื่น | IDOR รูปแบบเดียวกับ §4 — เทียบว่า cart ของ shop มี owner check ไหม |
| 9 | Forged Review | แก้ review ของคนอื่นผ่าน API โดยตรง | หลักเดียวกัน — ทุก write ต้อง auth และเช็ค owner |
| 10 | JWT Issues (ยาก) | token ที่ sign ด้วย alg=none / key อ่อน | **กันแล้วครึ่ง** — JWT_SECRET จาก env (ไม่ hardcode) · ทดสอบเพิ่มได้: ส่ง token alg=none ให้ API ต้องปฏิเสธ |

## เชื่อมกลับระบบจริง

เจอช่องโหว่อะไรใน Juice Shop ที่ Sovereign **ยังไม่มีตัวตรวจ** → เพิ่มเป็น check ใน `security-audit.mjs`
(ตอนนี้ครอบ: headers · CORS · SQLi login/search · rate-limit · IDOR 5 เส้น — ขาด: JWT tampering, file upload, XSS storage)

## ทรัพยากร

- Cheat sheet ชาเลนจ์ทั้งหมด (อย่าเปิดก่อนคิดเอง!): https://pwning.owasp-juice.shop
- Score board ในเกม: ค้นหา route จาก #1 แล้วเปิดเพื่อดูความคืบหน้า
