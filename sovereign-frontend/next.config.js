const nextConfig = {
  reactStrictMode: true,
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
};

module.exports = nextConfig;