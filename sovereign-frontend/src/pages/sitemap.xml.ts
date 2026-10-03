// src/pages/sitemap.xml.ts
// P21 ต่อ (2/10/69): sitemap แบบ dynamic — ตอบตาม host ที่เข้ามา จบปัญหา URL ข้าม host
// (เดิม static public/sitemap.xml มี URL สอง host รวมกัน — Google ข้าม URL คนละ host ทิ้ง)
//  - เข้าจากโดเมนจริง → คืน URL ของโดเมนนั้น (แต่ละ GSC property ได้ของตัวเองครบ)
//  - host แปลก/localhost → คืนชุดของโดเมนหลัก (กัน host header injection)
// รูปแบบ canonical ของ Pages Router: เขียน response ใน getServerSideProps (บังคับ dynamic
// ไม่ให้ build prerender) — component หลักคืน null (response จบก่อน render)
import type { GetServerSidePropsContext, NextPage } from 'next';

const ALLOWED_HOSTS = new Set(['sovereignoriginshop.dpdns.org', 'sovereign-shop.dpdns.org']);
const FALLBACK_HOST = 'sovereignoriginshop.dpdns.org';

const PUBLIC_PATHS: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/shop', changefreq: 'weekly', priority: '0.9' },
  { path: '/about', changefreq: 'monthly', priority: '0.8' },
  { path: '/partners', changefreq: 'weekly', priority: '0.8' },
  { path: '/partners/guide', changefreq: 'monthly', priority: '0.6' },
  { path: '/community', changefreq: 'weekly', priority: '0.7' },
  { path: '/demo', changefreq: 'monthly', priority: '0.7' },
  { path: '/mbti', changefreq: 'monthly', priority: '0.5' },
  { path: '/sensors', changefreq: 'daily', priority: '0.5' },
  // P24 ต่อ 4 (3/10/69): เพิ่ม /trace เพราะแก้หน้าให้เรนเดอร์เนื้อหาจริงตอน SSR + ใส่ SeoHead แล้ว
  //   (ก่อนหน้านี้ h1=0 ไม่มี title/canonical/description = ห้ามประกาศ เพราะเป็นหน้าว่างสำหรับบอท)
  { path: '/trace', changefreq: 'weekly', priority: '0.6' },
  { path: '/hover-cards', changefreq: 'monthly', priority: '0.3' },
];

function buildXml(host: string): string {
  const site = ALLOWED_HOSTS.has(host) ? host : FALLBACK_HOST;
  const lastmod = new Date().toISOString().slice(0, 10);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- dynamic: ตอบตาม host ที่เข้ามา (P21 2/10/69) -->\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    PUBLIC_PATHS.map(
      (p) =>
        // trailing slash ต้องตรงกับ next.config (trailingSlash: true) และ canonical ใน SeoHead
        // — ถ้าไม่ใส่ Google เจอ 308 ทุก URL แล้วถือว่า sitemap ไม่ตรงหน้าจริง (พบตอน pre-flight 2/10)
        `  <url><loc>https://${site}${p.path === '/' ? '/' : `${p.path}/`}</loc><lastmod>${lastmod}</lastmod>` +
        `<changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`
    ).join('\n') +
    `\n</urlset>`
  );
}

export async function getServerSideProps({ req, res }: GetServerSidePropsContext): Promise<{ props: Record<string, never> }> {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.end(buildXml(host));
  return { props: {} };
}

const SitemapPage: NextPage = () => null;

export default SitemapPage;
