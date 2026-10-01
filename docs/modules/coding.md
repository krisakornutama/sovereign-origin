# โมดูล coding

## เจตนา
สนามเขียนโค้ดในระบบ — IDE (อ่าน/เขียนไฟล์ + terminal), คิวงานโค้ด (jobs) และ "skill" ที่บันทึกวิธีทำงานซ้ำ ๆ ไว้รันได้

## ข้อห้าม / ระวัง
- **`/terminal` รันคำสั่งจริงบนเครื่อง** — ต้องผ่าน auth + เช็คบทบาททุกครั้ง ห้ามเปิดให้บทบาทต่ำ และห้ามยอมรับ path นอก workspace
- skill ที่รันมีผลต่อโค้ดจริง — การแก้นิยาม skill ต้องรีวิวเหมือนรีวิวโค้ด
- ห้ามให้ job/skill แก้ไฟล์ config ระบบ (.env, schema, เกต tools/*) ผ่านช่องทางนี้
<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`coding_jobs`

### Routes
- `coding/coding.routes.ts` (74 บรรทัด)
- `coding/skills.routes.ts` (65 บรรทัด)
- `coding/workspace.routes.ts` (64 บรรทัด)

### Endpoints (จาก router)
```
POST /jobs
GET /jobs
DELETE /jobs/:id
POST /jobs/:id/apply
POST /suggest
GET /skills
POST /skills
POST /skills/:id/run
POST /skills/run-queue
DELETE /skills/:id
GET /workspace
PUT /workspace
GET /files
GET /file
POST /terminal
```

### Services ที่ทำงานให้โมดูลนี้
`coding-agent.service`

<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`coding_jobs`

### Routes
- `coding/coding.routes.ts` (74 บรรทัด)
- `coding/skills.routes.ts` (65 บรรทัด)
- `coding/workspace.routes.ts` (64 บรรทัด)

### Endpoints (จาก router)
```
POST /jobs
GET /jobs
DELETE /jobs/:id
POST /jobs/:id/apply
POST /suggest
GET /skills
POST /skills
POST /skills/:id/run
POST /skills/run-queue
DELETE /skills/:id
GET /workspace
PUT /workspace
GET /files
GET /file
POST /terminal
```

### Services ที่ทำงานให้โมดูลนี้
`coding-agent.service`

<!-- auto:end -->
