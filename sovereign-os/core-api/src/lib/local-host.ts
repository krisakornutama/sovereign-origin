// P18-hardening — ตรวจว่า request มาจาก host ภายใน (localhost/LAN) หรือไม่
// ใช้ร่วมกันทุก router: business.routes (guard ชั้น 2) · partners.routes (gate devCode OTP)
// เหตุผล: NODE_ENV=development บนเครื่องนี้ ทำให้ devCode (รหัส OTP) รั่วออกสาธารณะได้ —
// ต้อง gate ด้วย host ต้นทางด้วยเสมอ (ป้องกันสองต่อ)
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|\[::ffff:127\.0\.0\.1\]|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|host\.docker\.internal)$/i;

export function isLocalRequestHost(h: string): boolean {
  const host = String(h || '').split(':')[0];
  if (!host) return true; // ไม่มี header (internal call/เทสต์) = ยอมรับเหมือนเดิม
  return LOCAL_HOST_RE.test(host);
}

/** host ต้นทางของ request — ใช้ x-forwarded-host ก่อน (ทางผ่าน tunnel/proxy) แล้วค่อย host ตรง */
export function requestHost(req: { headers: Record<string, unknown> }): string {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '');
}

/** คำขอสาธารณะแน่นอน? — Cloudflare ใส่ cf-connecting-ip ทุกคำขอผ่าน tunnel เสมอ (LAN ไม่มีทางมี)
 *  ใช้เป็นลายเซ็นหลักกันการแอบอ้าง Host header แล้วเสริมด้วยการตรวจ host */
export function isPublicRequest(req: { headers: Record<string, unknown> }): boolean {
  if (req.headers['cf-connecting-ip']) return true; // ผ่าน Cloudflare = สาธารณะเสมอ
  return !isLocalRequestHost(requestHost(req));
}
