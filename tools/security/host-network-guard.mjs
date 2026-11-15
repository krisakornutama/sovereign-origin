// ─────────────────────────────────────────────────────────────────────────────
//  host-network-guard — ด่านกัน "โค้ดโปรเจ็กแก้เน็ต/พร็อกซีระดับเครื่อง"
//
//  เหตุการณ์จริง (2026-11-15): หลังรีบูต เครื่องหลักใช้งานอินเทอร์เน็ตไม่ได้
//  เพราะมีคนไปตั้ง HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
//  -> ProxyEnable / ProxyServer ชี้ไปที่ 127.0.0.1:<port ที่ตายแล้ว> ซึ่งมีผลกับ
//  "ทุกแอป" บนเครื่อง (WinINET/WinHTTP) ไม่ใช่แค่โปรเจ็กนี้
//
//  กติกา: โปรเจ็กนี้ห้ามเขียนค่าพร็อกซี/เน็ตของ Windows เด็ดขาด
//  ถ้าต้องกรองทราฟฟิก ให้ทำในระดับ middleware ของแอป หรือผ่าน env ของโปรเจ็กเอง
//  ไฟล์เดียวที่ได้รับอนุญาตให้แตะคีย์นี้คือ tools/security/repair-host-network.ps1
//  (ไว้คืนค่าให้เครื่องกลับมาปกติ — ไม่ใช่ตั้งค่าใหม่)
//
//  ใช้:  node tools/security/host-network-guard.mjs
//        exit 0 = สะอาด · exit 1 = พบโค้ดที่แตะเน็ตระดับเครื่อง
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, '..', '..');

/** ไฟล์ที่ได้รับอนุญาตให้พูดถึงคีย์เน็ตของ Windows (ตัวซ่อมค่า + ด่านเอง) */
export const ALLOWED_PATHS = [
  'tools/security/repair-host-network.ps1',
  'tools/security/host-network-guard.mjs',
  'tools/test/host-network-guard.test.mjs',
];

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', '.freebuff', 'dist', 'dist-portable',
  'release', 'coverage', 'out', 'build', '_imported', 'layers-test', 'vendor',
]);

const SCAN_EXT = new Set(['.ps1', '.psm1', '.cmd', '.bat', '.mjs', '.cjs', '.js', '.ts', '.sh', '.vbs', '.reg']);

/** รูปแบบที่ถือว่า "แก้เน็ต/พร็อกซี/autorun ระดับเครื่อง" */
export const RULES = [
  {
    id: 'internet-settings',
    why: 'เขียนค่าพร็อกซีของ Windows (มีผลกับทุกแอป + ติดไปหลังรีบูต)',
    re: /Internet\s+Settings/i,
  },
  {
    id: 'proxy-values',
    why: 'แตะค่า ProxyEnable / ProxyServer / AutoConfigURL / DefaultConnectionSettings',
    re: /\b(ProxyEnable|ProxyServer|AutoConfigURL|DefaultConnectionSettings)\b/,
  },
  {
    id: 'winhttp-proxy',
    why: 'เปลี่ยนพร็อกซีระดับเครื่องผ่าน WinHTTP',
    re: /netsh\s+winhttp\s+(set|import|reset)\s+proxy/i,
  },
  {
    id: 'firewall-global-policy',
    why: 'เปลี่ยนนโยบายไฟร์วอลล์เริ่มต้นของทุกโพรไฟล์ = ตัดเน็ตทั้งเครื่อง',
    re: /advfirewall\s+set\s+allprofiles\s+firewallpolicy/i,
  },
  {
    id: 'block-outbound',
    why: 'บล็อก outbound ทั้งเครื่อง (DefaultOutboundAction=Block) = เน็ตตายทั้งตัว',
    re: /(DefaultOutboundAction\s+(Block|block))|(-DefaultOutboundAction\s+Block)/,
  },
  {
    id: 'interface-disable',
    why: 'ปิดอแดปเตอร์เครือข่ายของเครื่อง',
    re: /netsh\s+interface\s+set\s+interface[^\r\n]*(disabled|admin\s*=\s*disabled)/i,
  },
  {
    id: 'run-key-autostart',
    why: 'ฝัง autorun ใน HKCU/HKLM Run (สคริปต์จะรันเองทุกครั้งที่เข้า Windows)',
    re: /(reg(\.exe)?\s+add|New-ItemProperty|Set-ItemProperty)[^\r\n]*\\CurrentVersion\\Run\b/i,
  },
];

/** คืนรายการที่พบในข้อความหนึ่งก้อน (path ใช้แค่รายงาน + allowlist) */
export function scanText(text, filePath = '<inline>') {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        hits.push({ file: filePath, line: i + 1, rule: rule.id, why: rule.why, text: line.trim().slice(0, 200) });
      }
    }
  }
  return hits;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile() && SCAN_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

/** สแกนทั้ง repo — ข้ามไฟล์ที่อนุญาตตาม ALLOWED_PATHS */
export function scanRepo(root = DEFAULT_ROOT) {
  const hits = [];
  for (const file of walk(root, [])) {
    const relPath = rel(root, file);
    if (ALLOWED_PATHS.includes(relPath)) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    hits.push(...scanText(text, relPath));
  }
  return hits;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = scanRepo();
  if (hits.length === 0) {
    console.log('✅ host-network-guard: ไม่มีโค้ดที่แตะเน็ต/พร็อกซีระดับเครื่อง');
    process.exit(0);
  }
  console.error(`❌ host-network-guard: พบ ${hits.length} จุดที่แตะเน็ต/พร็อกซีระดับเครื่อง`);
  for (const h of hits) console.error(`  ${h.file}:${h.line} [${h.rule}] ${h.why}\n      ${h.text}`);
  console.error('  ⇒ ลบทิ้ง หรือย้ายไปทำใน middleware ของแอป / env ของโปรเจ็กเอง');
  process.exit(1);
}
