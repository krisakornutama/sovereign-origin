// SSRF guard — SEC-045
//
// ทุกที่ที่เซิร์ฟเวอร์ fetch URL ที่ผู้ใช้ส่งมา (เช่น import GGUF จาก ggufUrl)
// ต้องผ่านด่านนี้ก่อน ไม่งั้นผู้ใช้ที่ล็อกอินสามารถชี้ให้ backend ไปเรียก
// 127.0.0.1 / docker network / cloud metadata (169.254.169.254) แทนเรา
//
// ด่านนี้ตรวจ: scheme, hostname ที่รู้ว่าเป็นภายใน, ตัวเลข IP (IPv4/IPv6) และ DNS
// ที่ resolve ออกมาเป็น address ภายใน (กันกรณี domain ที่ชี้เข้า loopback)
import dns from 'node:dns/promises';
import net from 'node:net';

export type UrlVerdict = { ok: true; url: URL } | { ok: false; error: string };

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'metadata.google.internal',
  'instance-data',
]);

/** ตรวจตัวเลข IP ว่าเป็น address ภายใน/loopback/link-local/multicast หรือไม่ */
export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) return isPrivateV6(ip);
  return true; // ไม่ใช่ IP = ให้ผู้เรียกจัดการ
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateV6(raw: string): boolean {
  const ip = raw.toLowerCase().split('%')[0];
  if (ip === '::' || ip === '::1') return true;
  // IPv4-mapped / IPv4-compatible → ตรวจส่วน IPv4 ข้างใน
  const mapped = ip.match(/(?:::ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateV4(mapped[1]);
  // URL parser แปลง ::ffff:127.0.0.1 เป็น ::ffff:7f00:1 — ต้องแปลงกลับเพื่อตรวจ
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true; // link-local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique local
  if (ip.startsWith('ff')) return true; // multicast
  return false;
}

/** ตรวจ URL แบบไม่แตะ DNS (ใช้ทดสอบและใช้เป็นด่านแรก) */
export function analyzeUrl(raw: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return { ok: false, error: 'URL ไม่ถูกต้อง' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'รองรับเฉพาะ http(s) เท่านั้น' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'URL ต้องไม่มี username/password' };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, error: 'URL ไม่มี host' };
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, error: 'ที่อยู่นี้เป็นเครือข่ายภายใน' };
  }
  if (net.isIP(host) && isPrivateAddress(host)) {
    return { ok: false, error: 'ที่อยู่นี้เป็นเครือข่ายภายใน' };
  }
  return { ok: true, url };
}

/**
 * ด่านเต็ม: ตรวจรูปแบบ + resolve DNS แล้วปฏิเสธถ้ามี address ภายในแม้แต่ตัวเดียว
 * (ตัวเรียกใช้กับ URL ที่ผู้ใช้ส่งมาเสมอ — อย่าเชื่อ redirect จากปลายทาง)
 */
export async function assertPublicHttpUrl(raw: string): Promise<UrlVerdict> {
  const base = analyzeUrl(raw);
  if (!base.ok) return base;
  const host = base.url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return base; // ตรวจไปแล้วใน analyzeUrl

  let addresses: string[];
  try {
    const results = await dns.lookup(host, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch {
    return { ok: false, error: 'resolve host ไม่ได้' };
  }
  if (addresses.length === 0) return { ok: false, error: 'resolve host ไม่ได้' };
  if (addresses.some((a) => isPrivateAddress(a))) {
    return { ok: false, error: 'ที่อยู่นี้ชี้เข้าเครือข่ายภายใน' };
  }
  return base;
}
