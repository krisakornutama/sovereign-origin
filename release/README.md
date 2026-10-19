# release/ — ชุดส่งมอบแอปเดสก์ท็อป

โฟลเดอร์นี้เป็น **ชั้นส่งมอบ** (delivery) ของแอป Sovereign OS สำหรับก๊อปไปติดตั้งอีกเครื่อง
ไม่ใช่ source code — ไฟล์ `.exe` / `.zip` ถูก `.gitignore` ไว้ (ใหญ่เกินจะขึ้น GitHub)

## สร้าง/รีเฟรช

```powershell
# 1) ประกอบแอปจากซอร์ส (static export + electron-builder + overlay + sidecar)
cd "E:\My work\Project Sovereign Origin Install"
node PACK-DESKTOP.mjs

# 2) รวมไฟล์ติดตั้ง + เขียน SHA256SUMS ลง release/
cd "E:\My work\Project Sovereign Origin"
npm run stage:release
```

ผลลัพธ์: `release/Sovereign-OS-<version>-win-x64/`

```
Sovereign-OS-<version>-portable.exe   ← ดับเบิลคลิกได้เลย (ไฟล์เดียว)
Sovereign OS-<version>-win.zip        ← แตกแล้วรัน (ชุดเต็ม)
DESKTOP-INFO.json                     ← version + sha256 + ชิ้นส่วนที่ครบ
README-INSTALL.md                     ← วิธีติดตั้ง/ข้อกำหนดเครื่องปลายทาง
SHA256SUMS.txt                        ← ตรวจก่อนก๊อป
```

## เอกสารที่เกี่ยวข้อง

- วิธีติดตั้งละเอียด: [`docs/DESKTOP-INSTALL.md`](../docs/DESKTOP-INSTALL.md)
- ตัวประกอบชุด: `Project Sovereign Origin Install/PACK-DESKTOP.mjs`
- ตัวคัดลอกเข้า release: [`tools/stage-release.mjs`](../tools/stage-release.mjs)

## ความปลอดภัย

- ชุดนี้ไม่มี `.env` และไม่มี token
- token รายเครื่องอยู่ที่ `Install/machines/<ชื่อเครื่อง>/join.json` (ห้ามแชร์)
- `youtube-client.json` ถูก bundle ในแอปตามดีไซน์ zero-setup แต่ห้าม commit ลง repo สาธารณะ
