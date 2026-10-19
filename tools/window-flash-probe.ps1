<#
  tools/window-flash-probe.ps1 — นับ "หน้าต่าง console ที่มองเห็นได้จริง" ในช่วงเวลาหนึ่ง

  ใช้ทำอะไร: พิสูจน์ว่าคำสั่งระบบเปิดหน้าต่างเด้งหรือไม่ (ไม่ต้องเชื่อคำอธิบายในโค้ด)
  พื้นฐาน: นับเฉพาะหน้าต่างที่ IsWindowVisible = true และ class = ConsoleWindowClass
    (หน้าต่างที่ถูกซ่อนด้วย wscript/windowsHide จะไม่ถูกนับ — ถูกต้องตามที่ต้องการ)

  วิธีใช้:
    powershell -NoProfile -ExecutionPolicy Bypass -Command `
      "& 'tools\window-flash-probe.ps1' -Seconds 15 -Out 'probe.log'"
    แล้วค่อยรันคำสั่งที่จะทดสอบ (ระหว่างนั้น) · เปิด probe.log ดูว่ามีหน้าต่างอะไรโผล่

  เคสจริง 20/10/69 (ต้นตอของไฟล์นี้): เจ้าของเห็นหน้าต่าง
    `powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri http://localhost:3001/api/health …`
  เด้งเองระหว่างเริ่มระบบ — probe ตัวนี้จับได้ว่าเกิดจาก
    spawn(cmd, …, { detached: true, windowsHide: true })
  และพิสูจน์ว่าการส่งผ่าน wscript + tools/run-hidden.vbs ไม่เปิดหน้าต่างเลย

  หมายเหตุ: ไฟล์นี้ต้องเป็น ASCII เท่านั้น (เป็น .ps1 ที่ถูกอ่านด้วย PowerShell ซึ่งอ่าน UTF-8 ได้
  แต่โปรเจ็กต์นี้กันปัญหาการเข้ารหัสด้วยการบังคับ ASCII สำหรับเครื่องมือที่รันบน cmd/wscript)
#>
param(
  [int]$Seconds = 10,
  [string]$Out = 'window-flash-probe.log'
)

$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class SovereignWindowProbe {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
}
'@
Add-Type -TypeDefinition $code

$global:hits = New-Object System.Collections.ArrayList
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt $Seconds) {
  $t = [string]([math]::Round($sw.Elapsed.TotalSeconds, 2))
  $cb = [SovereignWindowProbe+EnumProc]{
    param($h, $l)
    if ([SovereignWindowProbe]::IsWindowVisible($h)) {
      $cls = New-Object System.Text.StringBuilder 256
      [void][SovereignWindowProbe]::GetClassName($h, $cls, 256)
      if ($cls.ToString() -eq 'ConsoleWindowClass') {
        $ttl = New-Object System.Text.StringBuilder 1024
        [void][SovereignWindowProbe]::GetWindowText($h, $ttl, 1024)
        [void]$global:hits.Add($t + ' | ' + $ttl.ToString())
      }
    }
    return $true
  }
  [void][SovereignWindowProbe]::EnumWindows($cb, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 25
}
$global:hits | Sort-Object -Unique | Set-Content -Path $Out -Encoding utf8
