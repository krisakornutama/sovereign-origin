# ติดตั้ง Sovereign OS บนเครื่องอื่น (Desktop Distribution)

> **ขอบเขต**: เอกสารนี้พูดถึง **แอปเดสก์ท็อป** เท่านั้น — เว็บสาธารณะ (ร้าน/catalog) อยู่ที่ repo
> `Sovereign-Web-Standalone` และโดเมน `https://sovereignoriginshop.dpdns.org`
> แอปเดสก์ท็อปเป็น **thin shell**: เปิดหน้าต่างแล้วชี้ไปที่ Dashboard `:3000` → Launcher `:4100` → offline
> พร้อมสตาร์ท sidecar API (`resources/core-api/dist/server.js`) ให้เองถ้าเครื่องมี Node.js

---

## 1) ชุดติดตั้งอยู่ที่ไหน

ชุดที่พร้อมก๊อปไปเครื่องอื่น (สร้างโดย `PACK-DESKTOP.mjs`):

```
E:\My work\Project Sovereign Origin Install\
├─ INSTALL-DESKTOP.cmd          ← ดับเบิลคลิกที่เครื่องปลายทาง
├─ PACK-DESKTOP.mjs             ← ตัวประกอบชุด (อยู่ในเครื่องนี้)
└─ desktop\
   ├─ Sovereign-OS\             ← runtime + overlay + sidecar API + หน้า static
   ├─ Sovereign-OS-1.1.1-portable.exe   ← ไฟล์เดียว (ไม่ต้องติดตั้ง)
   └─ DESKTOP-INFO.json         ← version / sha256 / ขนาด / ชิ้นส่วนที่ครบ
```

และใน repo มี **ชั้นส่งมอบ** ที่ตั้งชื่อชัดเจน + มีแฮชให้ตรวจ:

```
E:\My work\Project Sovereign Origin\release\Sovereign-OS-<version>-win-x64\
├─ Sovereign-OS-<version>-portable.exe
├─ Sovereign OS-<version>-win.zip
├─ DESKTOP-INFO.json
├─ README-INSTALL.md            ← สำเนาเอกสารนี้
└─ SHA256SUMS.txt
```

> ไฟล์ `.exe` / `.zip` ถูก gitignore — ตัวติดตั้งไม่ขึ้น GitHub (ใหญ่เกิน) แต่ **สคริปต์ + เอกสาร** ขึ้นครบ
> เพื่อให้ agent ตัวอื่นประกอบชุดเองได้

---

## 2) ประกอบชุดใหม่ (บนเครื่องนี้)

```powershell
cd "E:\My work\Project Sovereign Origin Install"
node PACK-DESKTOP.mjs
```

ลำดับที่สคริปต์ทำ:

1. `npm run electron:build` ใน `sovereign-frontend`
   - `build:static` → Next static export ลง **`out/`** (ไม่แตะ `.next` ที่ `:3000` ใช้อยู่ — ปลอดภัย)
   - `electron-builder --win --x64` → `dist-electron/` (portable exe + zip)
2. `node tools/build-desktop.mjs`
   - คัด runtime → `dist-portable/`
   - เขียน overlay จาก `sovereign-frontend/electron/` (ตรวจตรงซอร์ส 100% ก่อนผ่าน)
   - คัด sidecar → `resources/core-api/`
3. ถ้า **แอปเปิดอยู่** จะเขียนลง `dist-portable-staging/` แทน (ไม่ทับโฟลเดอร์ที่กำลังรัน)
4. คัดสำเนา → `Install\desktop\Sovereign-OS\` + portable exe + `DESKTOP-INFO.json`

ตัวเลือก:

| คำสั่ง | ผล |
|---|---|
| `node PACK-DESKTOP.mjs --check` | ตรวจว่าชุดใน `desktop/` ตรงกับ `dist-portable/` ปัจจุบันไหม (exit 1 = ล้าสมัย) |
| `node PACK-DESKTOP.mjs --skip-build` | ใช้ `dist-portable/` เดิม ไม่ build ใหม่ |
| `node PACK-DESKTOP.mjs --publish` | เผยแพร่ไฟล์อัปเดตให้เครื่องอื่นดึงผ่าน HUB (`data/desktop-updates/`) |
| `node tools/stage-release.mjs` | รวมไฟล์ติดตั้งไปที่ `release/Sovereign-OS-<version>-win-x64/` + SHA256SUMS |

---

## 3) ติดตั้งที่เครื่องปลายทาง

### วิธี A — ไฟล์เดียว (เร็วที่สุด)
1. คัด `Sovereign-OS-<version>-portable.exe` ไปเครื่องปลายทาง (USB/เน็ตเวิร์ก)
2. ดับเบิลคลิก — แอปจะแตกตัวเองไป temp แล้วเปิด (ไม่ต้องติดตั้ง)
3. เปิดครั้งแรกจะเจอ Setup Wizard (ตั้งค่า + เช็คอัปเดต)

### วิธี B — คัดทั้งชุด (แนะนำถ้าต้องการให้อยู่ถาวร)
1. คัดโฟลเดอร์ `Project Sovereign Origin Install` ทั้งก้อนไปเครื่องปลายทาง
2. ดับเบิลคลิก `INSTALL-DESKTOP.cmd`
   - คัด `desktop\Sovereign-OS` → `E:\SovereignOS`
   - สร้าง shortcut บน Desktop
   - ถ้ามี `join.json` (จาก `machines/<ชื่อเครื่อง>/`) จะเขียน `sovereign-hub.json` ให้อัตโนมัติ
3. เปิดแอปจาก shortcut

> **กฎโปรเจกต์**: ห้ามติดตั้งลง `C:` — สคริปต์บังคับ `E:\SovereignOS`
> (ถ้าเครื่องปลายทางไม่มี E: ให้ระบุพาธอื่น: `INSTALL-DESKTOP.cmd "D:\SovereignOS"`)

---

## 4) เครื่องปลายทางต้องมีอะไร

| ระดับ | ต้องมี | ได้อะไร |
|---|---|---|
| Shell-only | ไม่มีอะไรเพิ่ม | เปิดหน้าต่างได้ แต่ถ้าไม่มี Dashboard `:3000` จะเห็นหน้า offline/Setup Wizard |
| ต่อกับ HUB / เครื่องหลัก | เครือข่ายถึง HUB | ใช้ Dashboard/API ของเครื่องหลักผ่าน LAN |
| Full node (ทั้งระบบ) | **Node.js 20+**, **Docker Desktop**, Postgres (compose) | Dashboard `:3000` + API `:3001` + DB ครบ — ใช้ `INSTALL-SOVEREIGN-NODE.cmd` จาก HUB |

`INSTALL-SOVEREIGN-NODE.cmd` คือเส้นติดตั้งเครื่องลูกแบบเต็ม (ดาวน์โหลด node kit ~36 MB จาก HUB,
ตรวจ SHA-256 แบบ fail-closed) — ใช้เมื่อต้องการให้เครื่องนั้นรันระบบเองทั้งหมด

---

## 5) ตรวจสอบก่อนก๊อปไปเครื่องอื่น

```powershell
# 1) ชุดตรงกับ dist-portable ล่าสุดไหม
cd "E:\My work\Project Sovereign Origin Install"
node PACK-DESKTOP.mjs --check

# 2) ตรวจแฮชของไฟล์ที่จะก๊อป (เทียบกับ SHA256SUMS.txt)
Get-FileHash "desktop\Sovereign-OS-1.1.1-portable.exe" -Algorithm SHA256

# 3) ดูว่าในชุดมีชิ้นส่วนครบ (overlay / sidecar / static)
Get-Content "desktop\DESKTOP-INFO.json" -Raw
```

`DESKTOP-INFO.json` ฟิลด์ที่ต้องดู: `parts.overlay`, `parts.sidecarApi`, `parts.staticExport`
ต้องเป็น `true` ทั้งสาม (ถ้า `sidecarApi:false` แอปจะไปใช้ API ของเครื่องนั้นแทน)

---

## 6) ความปลอดภัย

- ชุดติดตั้ง **ไม่มี `.env` และไม่มี token** — token ของแต่ละเครื่องอยู่ใน
  `Install\machines\<ชื่อเครื่อง>\join.json` (ห้ามแชร์/ห้าม commit)
- `sovereign-frontend/electron/youtube-client.json` (Google OAuth client ของแอป) เป็นไฟล์
  **gitignored** แต่ถูก bundle เข้าแอปตามดีไซน์ zero-setup — ห้ามอัปขึ้น repo สาธารณะ
- ไม่มีการ restart runtime / migration ระหว่างประกอบชุด — เป็นแค่การ build artifact

---

## 7) แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| `PACK-DESKTOP` เขียน `dist-portable` ไม่ได้ (EPIPE/EBUSY) | แอปเปิดค้างอยู่ → สคริปต์จะสลับไป `dist-portable-staging` ให้เอง; หรือปิดแอปแล้วรันใหม่ |
| เปิดแอปแล้วจอดำ/offline | ไม่มี Dashboard `:3000` — เปิด stack (`docker compose up -d`) หรือชี้ไป HUB |
| `--check` ขึ้น "ต้องประกอบใหม่" | `dist-portable` ใหม่กว่าชุดใน `desktop/` → รัน `node PACK-DESKTOP.mjs` |
| เครื่องปลายทางไม่มี `node` | sidecar API สตาร์ทไม่ได้ แต่ shell ยังเปิดได้ (ไปใช้ API ของเครื่องหลัก) |
