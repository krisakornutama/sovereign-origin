// Security headers ทุกเส้นทาง (ปิดรอยรั่วจากการทดสอบระบบ 19 ก.ย. 2569: หน้าเว็บไม่มี headers เลย
// ขณะที่ backend มีครบผ่าน helmet) · HSTS ไร้ผลบน http แต่คุ้มไว้สำหรับตอนขึ้น https/ reverse proxy
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // CSP (เติมตามผล security-audit): ปลดล็อกเฉพาะที่แอปใช้จริง —
  //   style ผ่าน Google Fonts + inline (Next hydration) · font จาก gstatic ·
  //   img: data/blob (QR/ภาพในเว็บ) + QR generator + สแนปชอตกล้องใน LAN ·
  //   connect: API/WS ที่ตั้งได้ในหน้า settings (localhost + IP เครื่องนี้ใน LAN) ·
  //   frame: YouTube/Vimeo embed ที่มีในหน้าต่าง ๆ
  { key: 'Content-Security-Policy', value: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://api.qrserver.com http://192.168.1.50",
    "media-src 'self' blob:",
    "connect-src 'self' http://localhost:3001 http://127.0.0.1:3001 http://192.168.1.102:3001 ws://localhost:3001 ws://127.0.0.1:3001 ws://192.168.1.102:3001 http://localhost:3101 http://127.0.0.1:3101 ws://localhost:3101 ws://127.0.0.1:3101",
    "frame-src 'self' https://www.youtube.com https://player.vimeo.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ') },
];

const nextConfig = {
  reactStrictMode: true,
  // หยุดรั่วเทคโนโลยีที่ header ตอบกลับ (Next.js ตั้งค่าเริ่มต้นเป็นจริง)
  poweredByHeader: false,
  // Static export สำหรับ desktop shell (electron โหลด out/index.html ตรง) — เปิดเฉพาะตอน
  // SOVEREIGN_STATIC_EXPORT=1 (build:static / electron:build) เพื่อไม่บังคับ npm start
  // (`next start` ต้องการ server build ปกติ — ถ้า force export จะ error "output: export")
  ...(process.env.SOVEREIGN_STATIC_EXPORT === '1'
    ? { output: 'export', distDir: 'out' }
    : { distDir: '.next' }),
  images: { unoptimized: true },
  trailingSlash: true,
  // จำกัด worker ขั้น "Collecting page data" — เดิม spawn ตามจำนวน CPU (เครื่องนี้ 15 ตัว) ซึ่งพังแบบ
  // exit 134 (Zone Allocation / native OOM) เมื่อแรมว่างน้อย (prod server + docker รันคู่กัน) · CI บน
  // GitHub แรมโล่งจึงไม่เคยเจอ — cap ที่ 3 ทำให้ build ผ่านทั้งเครื่องพร้อมงานและไม่ช้ากว่าเดิมมาก
  experimental: { cpus: 3 },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;