# โมดูล knowledge

## เจตนา
คลังความรู้ของระบบ — จัดการไอเทมความรู้ (CRUD + import/upload) และไฟล์เนื้อหาแบบเปิดอ่านตรง พร้อมโหมด "สอนลูก" (teach) ที่เล่าเนื้อหาแบบเหมาะเด็ก

## ข้อห้าม / ระวัง
- endpoints `/file/:file` และ `/uploads/:file` เสิร์ฟไฟล์จากชื่อที่ผู้ใช้ส่งมา — **ห้ามยอมให้ path หลุดออกนอกไดเรกทอรี uploads** (path traversal) ตรวจ normalize ทุกครั้งก่อนเปิดไฟล์
- ตาราง `knowledge_items` เป็นของโมดูลนี้ — โมดูลอื่นอ่านได้แต่แตะเขียนต้องผ่าน service ของโมดูลนี้
- การ import จำนวนมากต้องไม่ลบข้อมูลเดิมทิ้งทั้งชุดโดยไม่มีตัวเลือกยืนยัน
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`knowledge_embeddings` · `knowledge_items`

### Routes
- `knowledge/knowledge-files.routes.ts` (61 บรรทัด)
- `knowledge/knowledge.routes.ts` (349 บรรทัด)
- `knowledge/teach.routes.ts` (676 บรรทัด)

### Endpoints (จาก router)
```
GET /files
GET /file/:file
POST /file/:file
GET /items
GET /items/:id
POST /items
PUT /items/:id
DELETE /items/:id
POST /import
POST /upload
GET /uploads/:file
POST /teach/generate
POST /teach/save
GET /teach/models
GET /teach/dashboard
GET /teach/report/weekly
PUT /teach/kids/:id/savings
POST /teach/kids/:id/piggy
PUT /teach/kids/:id/pin
GET /teach/allowance/history
POST /teach/kids/:id/allowance/pay-now
GET /teach/daily-summary
GET /teach/stocks
POST /teach/kids/:id/stocks/buy
POST /teach/kids/:id/stocks/sell
PUT /teach/kids/:id/piggy-target
GET /teach/kids/:id/audit
PUT /teach/kids/:id/allowance
POST /teach/kids/:id/coupons
POST /teach/kids/:id/coupons/:couponId/redeem
DELETE /teach/kids/:id/coupons/:couponId
GET /teach/kids/:id/home
POST /teach/kids/:id/chores
DELETE /teach/kids/:id/chores/:choreId
POST /teach/kids/:id/chores/:choreId/complete
POST /teach/kids/:id/chores/:choreId/reopen
POST /teach/kids/:id/bills
DELETE /teach/kids/:id/bills/:billId
POST /teach/kids/:id/bills/:billId/pay
POST /teach/kids/:id/wallet
… อีก 18 เส้น
```

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- knowledge → teach-kids(kid_lesson_progress)

<!-- auto:end -->
