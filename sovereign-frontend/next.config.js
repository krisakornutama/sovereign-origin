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
};

module.exports = nextConfig;