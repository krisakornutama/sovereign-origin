# build.ps1 — คอมไพล์ SovereignOS-Setup.exe (ตัว Launcher GUI)
# ใช้ Go ≥ 1.22 (ติดตั้ง: https://go.dev/dl)
#
#   powershell -ExecutionPolicy Bypass -File tools\sovereign-launcher\build.ps1
#
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $dir
try {
  Write-Host '→ go build SovereignOS-Setup.exe …'
  go build -trimpath -ldflags "-s -w -H windowsgui" -o SovereignOS-Setup.exe .
  if ($LASTEXITCODE -ne 0) { throw 'go build ล้มเหลว' }
  $size = [math]::Round((Get-Item SovereignOS-Setup.exe).Length / 1MB, 1)
  Write-Host "✔ สร้างสำเร็จ: $dir\SovereignOS-Setup.exe ($size MB)"
  Write-Host '  รันได้เลย:  double-click SovereignOS-Setup.exe   (หรือ .\SovereignOS-Setup.exe --headless)'
} finally {
  Pop-Location
}
