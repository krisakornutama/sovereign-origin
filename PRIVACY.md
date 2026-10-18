# Privacy Policy — Sovereign OS

**Last updated:** 19 October 2026

Sovereign OS is a **local desktop application**. It runs on your own computer and keeps your data on your own computer. This policy explains the one optional integration that talks to a third party: uploading videos to YouTube.

---

## 1. What the app does by default

Out of the box, Sovereign OS does **not** send your data anywhere. Business records, inventory, serial numbers, warranty data and post drafts are stored locally on your machine (browser local storage and the local database that ships with the app).

We do not run analytics, telemetry, crash reporting or advertising SDKs.

---

## 2. YouTube upload (optional, opt-in)

If you choose to connect a YouTube account, the app uses **Google OAuth 2.0** with exactly one permission:

```
https://www.googleapis.com/auth/youtube.upload
```

This permission allows the app to upload a video file to your own YouTube channel. It does **not** allow the app to read your private videos, your subscribers, your comments, your analytics, or your Google account profile beyond the public channel name used to confirm which channel you connected.

### What is transmitted

Only what you explicitly start an upload with:

- the video file you selected,
- the title, description and tags you typed in the app,
- the privacy setting you chose (private / unlisted / public).

The file is sent **directly from your computer to Google's YouTube Data API** (`www.googleapis.com`). It does not pass through any server operated by this project.

### What is stored, and where

| Item | Where | Protection |
|---|---|---|
| OAuth client ID and secret | Your computer only | Encrypted with the operating system's credential protection (Windows DPAPI via Electron `safeStorage`) |
| Refresh token / access token | Your computer only | Same encryption |
| Connected channel name | Your computer only | Same file |

The file lives at:

```
%APPDATA%\Sovereign OS\youtube-oauth.bin
```

It is never written to this repository, never uploaded to us, and never included in any backup we operate (we operate none).

---

## 3. Revoking access

You can remove the app's access at any time, in either way:

1. In the app: **ธุรกิจของฉัน → 📣 โพสต์ → ตัดการเชื่อมต่อ**
2. At Google: <https://myaccount.google.com/permissions> → select the app → **Remove access**

Revoking at Google takes effect immediately and does not require the app.

---

## 4. Data we collect

**None.** This project has no server that receives your data, no accounts database, and no analytics endpoint. There is nothing for us to sell, share, or lose.

---

## 5. Children

The app is a business tool and is not directed at children.

---

## 6. Changes

Material changes to this policy will be committed to this repository, so the full history is publicly auditable.

---

## 7. Contact

Open an issue at <https://github.com/krisakornutama/sovereign-origin/issues>.

---

# นโยบายความเป็นส่วนตัว (ภาษาไทย)

**ปรับปรุงล่าสุด:** 19 ตุลาคม 2569

Sovereign OS เป็น **โปรแกรมเดสก์ท็อปที่ทำงานในเครื่องของคุณเอง** ข้อมูลทั้งหมดจึงอยู่บนเครื่องของคุณ ไม่มีเซิร์ฟเวอร์ของโปรเจ็กที่รับข้อมูลของคุณ

## ข้อมูลที่โปรแกรมเก็บ

ข้อมูลธุรกิจ สต๊อก เลขซีเรียล ประกัน และร่างโพสต์ ถูกเก็บไว้ในเครื่องคุณเท่านั้น (local storage และฐานข้อมูลที่ติดมากับแอป)

โปรเจ็ก**ไม่มี**ระบบ analytics, telemetry, crash report หรือโฆษณา

## การอัปโหลด YouTube (ไม่บังคับ — ต้องกดเชื่อมต่อเอง)

เมื่อคุณเชื่อมต่อบัญชี YouTube แอปจะขอสิทธิ์เพียงอย่างเดียวคือ `youtube.upload` (อัปโหลดวิดีโอเข้าช่องของคุณเอง) — ไม่สามารถอ่านวิดีโอส่วนตัว ผู้ติดตาม คอมเมนต์ หรือข้อมูลวิเคราะห์ของคุณได้

สิ่งที่ส่งออกไปมีเพียง: ไฟล์วิดีโอที่คุณเลือก, ชื่อ/คำอธิบาย/แฮชแท็กที่คุณพิมพ์, และระดับความเป็นส่วนตัวที่คุณเลือก — ส่ง**ตรงจากเครื่องคุณไปยัง Google** ไม่ผ่านเซิร์ฟเวอร์ของโปรเจ็ก

สิ่งที่เก็บในเครื่อง (เข้ารหัสด้วย Windows DPAPI ผ่าน Electron `safeStorage`):

```
%APPDATA%\Sovereign OS\youtube-oauth.bin
```

ไฟล์นี้ไม่ถูกเขียนลง repository, ไม่ถูกส่งให้ใคร และไม่ถูกใส่ใน backup ใด ๆ (โปรเจ็กไม่มี backup บนเซิร์ฟเวอร์)

## การยกเลิกสิทธิ์

ทำได้ 2 ทาง:

1. ในแอป: **ธุรกิจของฉัน → 📣 โพสต์ → ตัดการเชื่อมต่อ**
2. ที่ Google: <https://myaccount.google.com/permissions> → เลือกแอป → **Remove access**

## ข้อมูลที่เราเก็บ

**ไม่มีเลย** — โปรเจ็กไม่มีเซิร์ฟเวอร์ที่รับข้อมูล ไม่มีฐานข้อมูลผู้ใช้ และไม่มีปลายทาง analytics

## ติดต่อ

เปิด issue ที่ <https://github.com/krisakornutama/sovereign-origin/issues>
