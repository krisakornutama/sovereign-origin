# AGENTS.md — กฎเหล็กสำหรับ AI ทุกตัวที่เข้ามาแก้โค้ดในโปรเจ็ก Sovereign Origin

---

## กฎสากล (ทุก AI ต้องทำตาม)

### 1. GIT SAFETY — ห้ามแก้โค้ดโดยไม่มี backup
- **ก่อนแก้ทุกครั้ง** ต้อง `git add -A && git commit -m "backup: <คำอธิบายสั้นๆ>"` ก่อนเสมอ
- ถ้าแก้แล้วพัง → `git diff` ดูว่าแก้อะไรไป แล้ว `git checkout -- <ไฟล์>` คืนเฉพาะส่วนที่พัง
- **ห้าม force push** 除非ได้รับอนุญาตจากผู้ใช้

### 2. BUILD BEFORE COMMIT — ต้องผ่าน quality gate ก่อน commit
- หลังแก้โค้ดทุกครั้ง รัน `npm run verify` ที่ **root ของ repo** (สคริปต์เดียวครบ: backend build+test, frontend typecheck+build)
- ถ้า verify ไม่ผ่าน **ห้าม commit** ต้องแก้ให้ผ่านก่อน
- แก้อะไรที่กระทบหน้าเว็บ/UI ให้รัน `npm run verify:full` (เพิ่ม E2E Playwright — ต้องมี backend+DB รันอยู่)
- ถ้า error จำนวนมาก ให้ย้อนกลับไป backup แล้วแก้ทีละจุด

### 3. BRANCH WORKFLOW — ทำงานบน branch แยก
- สร้าง branch ใหม่สำหรับแต่ละ feature: `git checkout -b ai/<feature-name>`
- ทำงานบน branch นั้น ทดสอบจนแน่ใจ แล้วค่อย merge กลับ main
- ห้าม commit ตรง main โดยไม่ทดสอบ

### 4. ห้ามแตะไฟล์ critical โดยไม่จำเป็น
ไฟล์ต่อไปนี้ **ห้ามแก้** เว้นแต่ผู้ใช้สั่งโดยตรง:
- `src/pages/_app.tsx` — layout หลักของแอป
- `src/pages/_document.tsx` — HTML structure
- `src/styles/globals.css` — design system ทั้งหมด
- `src/lib/navigation.ts` — เมนูนำทาง
- `src/stores/useLanguageStore.ts` — i18n store
- `src/stores/useAuthStore.ts` — auth store
- `package.json` — ต้องถามผู้ใช้ก่อนเพิ่ม dependency ใหม่

### 5. ห้ามลบ/เปลี่ยนฟังก์ชันที่มีอยู่
- ห้ามลบฟังก์ชัน หรือเปลี่ยน signature ของฟังก์ชันที่มีอยู่แล้ว
- ห้ามเปลี่ยน interface/type ที่ใช้ร่วมกันหลายไฟล์ โดยไม่บอกผู้ใช้
- ถ้าต้องการเปลี่ยน ให้สร้างฟังก์ชันใหม่แทน แล้วให้ผู้ใช้ตัดสินใจลบของเก่า

### 6. MINIMAL CHANGE — แก้เท่าที่จำเป็น
- ห้าม refactor โค้ดที่ไม่เกี่ยวข้องกับงานที่ได้รับมอบหมาย
- ห้ามเปลี่ยน code style (indentation, quoting, formatting) ของไฟล์ทั้งหมด
- แก้เฉพาะจุดที่ต้องแก้เท่านั้น

### 7. PROJECT DRIVE ONLY — ห้ามเอาโปรเจ็กลง drive C: เด็ดขาด (คำสั่งจากเจ้าของ)
- โปรเจ็กทั้งหมดต้องอยู่บน **drive ของโปรเจ็ก (E:)** เช่น `E:\My work\Project Sovereign Origin` — **ห้าม** copy/clone/download/extract โปรเจ็กหรือไฟล์ของโปรเจ็กไปไว้ที่ **drive C:** เพราะ C: มีพื้นที่น้อย
- ครอบคลุมทุกอย่างที่ AI สร้าง/ดาวน์โหลด: worktrees, node_modules, build output, backups, dumps, logs, ไฟล์ชั่วคราวขนาดใหญ่ — ให้อยู่บน E: เสมอ
- ห้ามใช้ `C:\Users\...\Temp` หรือ `/tmp` ที่ map ไป C: เป็นที่เก็บไฟล์ถาวรของโปรเจ็ก (ไฟล์ชั่วคราวเล็กที่ตายใน session เดียวยังโอเค แต่ของสำคัญ/งานที่ต้องเก็บไว้ต้องเป็น E:)
- เวลาตั้ง scheduled task / script backup / ติดตั้งอะไรเพิ่ม ให้ target เป็น path บน E: เท่านั้น
- ถ้าเครื่องมือบังคับให้เขียน C: และเลี่ยงไม่ได้ ต้องแจ้งผู้ใช้ก่อน แล้วหาทางทำบน E: แทนเสมอ

---

## โครงสร้างโปรเจ็ก

### Frontend (`sovereign-frontend/`)
- **Framework**: Next.js 16.3 (Pages Router + Turbopack)
- **CSS**: TailwindCSS 3.4 + custom globals.css
- **State**: Zustand (stores in `src/stores/`)
- **i18n**: `useLanguageStore` — th/en, ใช้ `t('key', 'fallback')` เสมอ
- **หน้าทั้งหมด**: อยู่ใน `src/pages/` — ทุกหน้าต้อง import `<Sidebar />`
- **Layout pattern**: `<div><Sidebar /><main>...</main></div>` เหมือนกันทุกหน้า

### Backend (`sovereign-os/core-api/`)
- **Runtime**: Node.js + Express
- **Database**: Prisma + SQLite
- **Port**: 3001
- **Routes**: `src/modules/*/`
- **Services**: `src/services/`

---

## โฟลว์ทำงานที่ถูกต้อง

```
1. git add -A && git commit -m "backup: before <task>"
2. git checkout -b ai/<task-name>
3. แก้โค้ด
4. npm run verify (ที่ root — ครอบ build+test ทั้งสองฝั่ง)
5. ถ้า build ไม่ผ่าน → แก้ หรือ git checkout -- ไฟล์ที่พัง
6. ถ้า build ผ่าน → git add -A && git commit -m "<task description>"
7. git checkout main && git merge ai/<task-name>
8. ถ้า merge แล้วพัง → git revert HEAD
```

---

## ตัวอย่างไฟล์ที่ต้องระวัง

| ไฟล์ | เหตุผล |
|---|---|
| `src/pages/property.tsx` | มี JSX nesting ซับซ้อน, แก้ผิดจุดเดียวพังทั้งหน้า |
| `src/pages/_app.tsx` | Layout หลัก, hydration logic, SPA navigation |
| `src/components/layout/Sidebar.tsx` | ทุกหน้าใช้ร่วมกัน |
| `src/stores/*.ts` | State management ทั้งระบบ |
| `package.json` | Dependency อาจ conflict กัน |

---

## แผนสำรองเมื่อ AI ทำพัง

```bash
# ดูว่าแก้อะไรไป
git diff

# คืนไฟล์เดียว
git checkout -- src/pages/property.tsx

# คืนทุกอย่าง
git checkout -- .

# ย้อน commit ล่าสุด (เก็บ history ไว้)
git revert HEAD

# ย้อนหลาย commit
git reset --soft HEAD~3
```
