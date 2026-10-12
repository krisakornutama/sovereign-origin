@echo off
REM ============================================================================
REM  Sovereign OS - install this machine as a full node
REM
REM  Double-click this file. That is the whole procedure.
REM
REM  This file is ASCII only on purpose. Thai text inside a .cmd breaks
REM  cmd.exe (it reads files using the console code page). Thai messages come
REM  from install-node.ps1, which is downloaded from the HUB as UTF-8.
REM
REM  No secret is stored in this file, so it is safe to copy anywhere.
REM  Optional: put install-node.txt next to it with HUB_URL / MACHINE_ENROLL_CODE
REM  Optional args:  "%~nx0" HUB_URL  ENROLL_CODE  MACHINE_NAME
REM ============================================================================
chcp 65001 >nul 2>&1
setlocal EnableExtensions DisableDelayedExpansion

net session >nul 2>&1
if not errorlevel 1 goto :isadmin
if defined SOV_NO_ELEVATE goto :isadmin
echo.
echo   Opening with administrator permission ...
if "%*"=="" goto :elevate_noargs
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
exit /b 0
:elevate_noargs
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 0
:isadmin

set "SOV_DIR=%~dp0"

set "SOV_SELF=%~f0"

set "SOV_HUB="
set "SOV_CODE="
set "SOV_NAME="
set "SOV_DRYRUN="
set "SOV_I=0"
:parseargs
if "%~1"=="" goto :parsedone
if /i "%~1"=="-DryRun" set "SOV_DRYRUN=1" & shift & goto :parseargs
if "%SOV_I%"=="0" set "SOV_HUB=%~1" & set "SOV_I=1" & shift & goto :parseargs
if "%SOV_I%"=="1" set "SOV_CODE=%~1" & set "SOV_I=2" & shift & goto :parseargs
if "%SOV_I%"=="2" set "SOV_NAME=%~1" & set "SOV_I=3" & shift & goto :parseargs
shift
goto :parseargs
:parsedone

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: PowerShell not found. This should never happen on Windows.
  echo        Cannot continue - nothing was changed.
  pause
  exit /b 9
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=$env:SOV_SELF;$t=[IO.File]::ReadAllText($f);$i=$t.LastIndexOf('#####PSPAYLOAD#####');if($i -lt 0){exit 8};iex $t.Substring($i+19)"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" goto :doneerr
echo.
echo   Done. Open http://localhost:3000 on this machine.
echo.
pause
exit /b 0

:doneerr
echo.
echo   Finished with errors. Exit code %RC%. Nothing was left half-installed.
echo   Log: logs\install-node.log
echo.
pause
exit /b %RC%

#####PSPAYLOAD#####
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Die($m, $code) {
  Write-Host ''
  Write-Host ('  FAILED: ' + $m) -ForegroundColor Red
  Write-Host '  Nothing was installed. Full details: logs\install-node.log'
  exit $code
}

Write-Host ''
Write-Host '==========================================================='
Write-Host '  Sovereign OS - install this machine as a node'
Write-Host '==========================================================='
Write-Host ''

# --- where is the HUB? arg > preset file > env > default ---
$hub = $env:SOV_HUB
$code = $env:SOV_CODE
$name = $env:SOV_NAME

$preset = Join-Path $env:SOV_DIR 'install-node.txt'
if (Test-Path $preset) {
  $txt = Get-Content $preset -Raw -Encoding utf8
  if ($txt -match '(?m)^\s*HUB_URL\s*=\s*(.+)$') { $hub = $Matches[1].Trim() }
  if (-not $code -and $txt -match '(?m)^\s*MACHINE_ENROLL_CODE\s*=\s*(.+)$') { $code = $Matches[1].Trim() }
  if (-not $name -and $txt -match '(?m)^\s*MACHINE_NAME\s*=\s*(.+)$') { $name = $Matches[1].Trim() }
}
if (-not $hub) { $hub = 'http://192.168.1.102:3000' }
$hub = $hub.TrimEnd('/')
if ($hub -notmatch '^https?://') { Die ("Bad HUB address: $hub") 1 }
Write-Host ('  HUB : ' + $hub)
Write-Host ('  This machine : ' + $env:COMPUTERNAME)
Write-Host ''

# --- ask the HUB what to download ---
$manifestUrl = $hub + '/api/agent-machines/node-kits/manifest/'
try {
  $m = Invoke-RestMethod -Uri $manifestUrl -TimeoutSec 25
} catch {
  Die ("Cannot reach the HUB at $manifestUrl - check that it is on and you are on the same network.") 2
}

if (-not $m.bootstrapSha256) {
  Write-Host '  This HUB has not published the single-file installer yet.' -ForegroundColor Yellow
  Write-Host '  Ask the owner to run:  node tools/build-node-kit.mjs --publish'
  exit 3
}

# --- download the real installer ---
$tmp = Join-Path $env:TEMP 'sovereign-install.ps1'
Write-Host '  Downloading the installer script ...'
$ProgressPreference = 'SilentlyContinue'
try {
  Invoke-WebRequest -Uri ($hub + '/api/agent-machines/node-kits/bootstrap/') -OutFile $tmp -TimeoutSec 120 -UseBasicParsing
} catch {
  Die ("Download failed: " + $_.Exception.Message) 4
}

# --- verify before running anything that came over the network ---
$got = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()
if ($got -ne $m.bootstrapSha256.ToLower()) {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  Die "The downloaded installer does not match the hash the HUB published. Refusing to run it (file deleted)." 5
}
Write-Host '  Verified against the hash published by the HUB.'
Write-Host ''

# --- hand over: this is where the Thai messages live ---
$p = @{
  HubUrl = $hub
  Code   = $code
  Name   = $name
}
if ($env:SOV_DRYRUN -eq '1') { $env:COV_DRYRUN = '1' }
$rc = 0
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp @p
  $rc = $LASTEXITCODE
} catch {
  Write-Host $_.Exception.Message
  $rc = 9
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
exit $rc
