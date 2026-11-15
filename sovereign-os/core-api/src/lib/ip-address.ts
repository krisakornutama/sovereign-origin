// รับเฉพาะ "IP เดี่ยว" (IPv4/IPv6) — ไม่รับ CIDR, ช่วง, ชื่อโฮสต์ หรือข้อความอื่น
//
// เหตุผล: `POST /api/security/firewall/block` ส่งค่านี้ต่อไปยัง netsh/iptables
// โดยตรง · `0.0.0.0/0` คือ "บล็อกทุกทราฟฟิกขาเข้า" = ล็อกตัวเองออกจากระบบทั้งเครื่อง
// และค่าแปลก ๆ (มี ; $ ช่องว่าง) ไม่ควรถูกตีความโดยเครื่องมือ OS เลย
// ตรวจครั้งเดียวตรงนี้ ใช้ร่วมกันทั้ง route, executor และ threat-detection
import net from 'node:net';

/** คืน IP ที่ trim แล้วถ้าเป็น IP เดี่ยวจริง, คืน null ถ้าไม่ใช่ */
export function normalizeSingleIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  // 45 = ความยาวสูงสุดของ IPv6 แบบเต็ม (IPv4-mapped) — กันสตริงยาวผิดปกติ
  if (!ip || ip.length > 45) return null;
  return net.isIP(ip) === 0 ? null : ip;
}
