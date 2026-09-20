#!/usr/bin/env node
// tools/verify/network-map.mjs — แผนที่ WiFi บ้านตัวเอง (read-only): ping sweep /24 + ARP + เทียบ snapshot ครั้งก่อน
//  เจออุปกรณ์ที่ไม่เคยเห็น = รายงาน 🆕 · snapshot เก็บที่ .freebuff/network-map-last.json
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const pExecFile = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SNAPSHOT = path.join(ROOT, '.freebuff', 'network-map-last.json');
const VENDORS = { // OUI ยอดนิยมบ้าน (แค่บางส่วน — ไม่รู้จักก็ไม่เป็นไร)
  '3c:5a:b4': 'Google', 'f4:f5:d8': 'Google', 'd8:3a:dd': 'Raspberry Pi', 'b8:27:eb': 'Raspberry Pi',
  'dc:a6:32': 'Raspberry Pi', 'e4:5f:01': 'Raspberry Pi', '2c:cf:67': 'Espressif (IoT)',
  '5c:cf:7f': 'Espressif (IoT)', '24:0a:c4': 'Espressif (IoT)', 'bc:dd:c2': 'Espressif (IoT)',
  '00:1a:11': 'Google', 'ac:de:48': 'Apple', 'f0:18:98': 'Apple', 'a4:83:e7': 'Apple',
  '40:9f:38': 'AzureWave (IoT/แล็ป)', '00:0c:29': 'VMware', '08:00:27': 'VirtualBox',
};

const gw = (() => {
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    "$c = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway }; if ($c) { $c[0].IPv4Address.IPAddress + '|' + $c[0].IPv4DefaultGateway.NextHop }"],
    { encoding: 'utf8', timeout: 20_000, windowsHide: true }).trim();
  const [ip, g] = out.split('|');
  return { ip, gw: g };
})();
if (!gw.ip) { console.error('FATAL หา IP/gateway ไม่เจอ (ต่อ WiFi/LAN อยู่ไหม)'); process.exit(2); }
const base = gw.ip.split('.').slice(0, 3).join('.');
console.log(`เครื่องนี้: ${gw.ip} · gateway: ${gw.gw} · สแกน ${base}.1-254 ...`);

// ping sweep — ยิงคู่ขนานทีละเวฟ (ไม่ใช่ทีละลูก)
const alive = new Set([gw.gw, gw.ip]);
const targets = [];
for (let i = 1; i <= 254; i++) targets.push(`${base}.${i}`);
for (let i = 0; i < targets.length; i += 60) {
  await Promise.all(targets.slice(i, i + 60).map(async (ip) => {
    try {
      const { stdout } = await pExecFile('ping', ['-n', '1', '-w', '250', ip], { timeout: 4_000, windowsHide: true });
      if (/TTL=/i.test(stdout)) alive.add(ip);
    } catch { /* ไม่ตอบ */ }
  }));
}

// ARP → MAC (กรองเอาเฉพาะที่ alive)
const arp = execFileSync('arp', ['-a'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
const macs = {};
for (const l of arp.split(/\r?\n/)) {
  const m = l.trim().match(/^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f-]{17})\s+/i);
  if (m && alive.has(m[1])) macs[m[1]] = m[2].replace(/-/g, ':').toLowerCase();
}
const vendor = (mac) => { const p = mac?.slice(0, 8); return VENDORS[p] || 'ไม่รู้จัก'; };

const prev = fs.existsSync(SNAPSHOT) ? JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')) : {};
const now = {};
console.log(`\nพบ ${alive.size} อุปกรณ์:`);
for (const ip of [...alive].sort((a, b) => a.split('.').pop() - b.split('.').pop())) {
  const mac = macs[ip] || '?';
  now[ip] = mac;
  const isNew = prev && !(ip in prev) && ip !== gw.ip;
  console.log(`  ${ip.padEnd(16)} ${mac.padEnd(20)} ${vendor(mac).padEnd(18)} ${ip === gw.gw ? '← gateway' : ''}${isNew ? '  🆕 ใหม่ (ไม่เคยเห็น)' : ''}`);
}
fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
fs.writeFileSync(SNAPSHOT, JSON.stringify(now, null, 2));
console.log(`\nsnapshot บันทึกแล้ว → .freebuff/network-map-last.json (รันครั้งหน้าจะจับอุปกรณ์ใหม่)`);
