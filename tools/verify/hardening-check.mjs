#!/usr/bin/env node
// tools/verify/hardening-check.mjs — ตรวจความแข็งแรงเครื่องตัวเอง (Windows host, read-only)
//  ทุก probe ผ่าน PowerShell — ข้อที่ต้องสิทธิ์ admin จะรายงาน "ต้อง admin" แยกหมวด ไม่นับ fail
//  exit 1 เฉพาะเมื่อมี FAIL (กันระบบชั้นแรกปิด: Defender/Firewall/UAC/SMBv1)
import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0, warnCount = 0, adminNeeded = 0;
const ok = (n, e = '') => { console.log(`PASS  ${n}${e ? ' — ' + e : ''}`); pass++; };
const bad = (n, e = '') => { console.log(`FAIL  ${n}${e ? ' — ' + e : ''}`); fail++; };
const warn = (n, e = '') => { console.log(`WARN  ${n}${e ? ' — ' + e : ''}`); warnCount++; };
const needAdmin = (n) => { console.log(`SKIP  ${n} — ต้องรันใน terminal ที่เป็น admin`); adminNeeded++; };
const ps = (script) => {
  try { return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 25_000, windowsHide: true }).trim(); }
  catch { return null; }
};

console.log('── Defender ──');
const rtp = ps('(Get-MpComputerStatus).RealTimeProtectionEnabled');
rtp === 'True' ? ok('Real-time protection เปิด') : rtp === 'False' ? bad('Real-time protection ปิด!') : needAdmin('Real-time protection');
const tamper = ps('(Get-MpComputerStatus).IsTamperProtected');
tamper === 'True' ? ok('Tamper protection เปิด') : tamper === null ? needAdmin('Tamper protection') : warn('Tamper protection ปิด', 'เปิดผ่าน Windows Security');

console.log('── Firewall / UAC ──');
const fwOff = ps('(Get-NetFirewallProfile | Where-Object { -not $_.Enabled }).Name');
fwOff === '' || fwOff === null && ps('(Get-NetFirewallProfile).Enabled').includes('True') === false ? null : null;
if (fwOff === '') ok('Firewall ทั้ง 3 profile เปิด');
else if (fwOff === null) needAdmin('Firewall profiles');
else bad('Firewall profile ปิด: ' + fwOff.replace(/\r?\n/g, ', '));
const uac = ps("(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System').EnableLUA");
uac === '1' ? ok('UAC เปิด') : uac === null ? needAdmin('UAC') : bad('UAC ปิด!');

console.log('── Remote access / โปรโตคอลเก่า ──');
const rdpDeny = ps("(Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server').fDenyTSConnections");
if (rdpDeny === '1') ok('RDP ปิด (ไม่มี remote desktop)');
else if (rdpDeny === '0') {
  const nla = ps("(Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp').UserAuthentication");
  nla === '1' ? ok('RDP เปิด + NLA บังคับ') : warn('RDP เปิดแต่ไม่บังคับ NLA');
} else needAdmin('RDP status');
const smb1 = ps('(Get-SmbServerConfiguration).EnableSMB1Protocol');
smb1 === 'False' ? ok('SMBv1 ปิด') : smb1 === null ? needAdmin('SMBv1') : bad('SMBv1 เปิด! (ช่องโหว่ ransomware คลาสสิก)');

console.log('── อัปเดต / เข้ารหัสลับ ──');
const last = ps('(Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn');
if (last) {
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
  days <= 45 ? ok(`Windows Update ล่าสุด ${days} วันก่อน`) : warn(`Windows Update เก่า ${days} วัน`);
} else warn('อ่านประวัติ Windows Update ไม่ได้');
const bl = ps(`(Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop).ProtectionStatus`);
bl === 'On' ? ok('BitLocker ปิดล็อก drive ระบบ') : bl === null ? needAdmin('BitLocker status') : warn('BitLocker ยังไม่เปิด', 'ควรเปิดผ่าน Settings > Privacy & security');

console.log('── พอร์ตที่เปิดรับจากข้างนอก (LAN) ──');
{
  const KNOWN = new Map([['3000', 'Sovereign web'], ['3001', 'Sovereign API'], ['3002', 'Juice Shop (lab)'], ['1883', 'EMQX MQTT'], ['8083', 'EMQX WS'], ['18083', 'EMQX dashboard'], ['5432', 'Postgres']]);
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    const rows = out.split(/\r?\n/).filter((l) => l.includes('LISTENING') && /\s(0\.0\.0\.0|\[::\]):/.test(l));
    const ports = [...new Set(rows.map((l) => l.trim().split(/\s+/)[1].split(':').pop()))];
    if (ports.length === 0) ok('ไม่มีพอร์ตเปิดรับ LAN');
    else for (const p of ports) console.log(`NOTE  :${p} เปิดรับ LAN — ${KNOWN.get(p) || 'ไม่รู้จัก (ตรวจว่าใช่อะไร)'}`);
  } catch { warn('อ่าน netstat ไม่ได้'); }
}

console.log(`\n${pass} passed, ${fail} failed, ${warnCount} warn, ${adminNeeded} ต้อง admin${fail ? ' — exit 1' : ''}`);
process.exit(fail ? 1 : 0);
