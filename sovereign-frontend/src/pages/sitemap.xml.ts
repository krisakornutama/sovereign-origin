// src/pages/sitemap.xml.ts
// P21 ต่อ (2/10/69): sitemap แบบ dynamic — ตอบตาม host ที่เข้ามา จบปัญหา URL ข้าม host
// (เดิม static public/sitemap.xml มี URL สอง host รวมกัน — Google ข้าม URL คนละ host ทิ้ง)
//  - เข้าจากโดเมนจริง → คืน URL ของโดเมนนั้น (แต่ละ GSC property ได้ของตัวเองครบ)
//  - host แปลก/localhost → คืนชุดของโดเมนหลัก (กัน host header injection)
// รูปแบบ canonical ของ Pages Router: เขียน response ใน getServerSideProps (บังคับ dynamic
// ไม่ให้ build prerender) — component หลักคืน null (response จบก่อน render)
import type { GetServerSidePropsContext, NextPage } from 'next';
import { PUBLIC_PATHS } from '../lib/publicAccess';

const ALLOWED_HOSTS = new Set(['sovereignoriginshop.dpdns.org', 'sovereign-shop.dpdns.org']);
const FALLBACK_HOST = 'sovereignoriginshop.dpdns.org';

// รายการหน้าสาธารณะอยู่ที่ lib/publicAccess.ts จุดเดียว (import ตรง ๆ ไม่ก๊อป)
// หมายเหตุ 3/10/69: รายการนี้ใช้ทางเดียวคือ "ประกาศให้ Google" แล้วเท่านั้น
// มันไม่ได้คุมการซ่อน Sidebar/เมนูภายในอีกต่อไป (ซ่อนด้วยสิทธิ์ = ต้องล็อกอินไหม — ดู useHideInternalNav.ts)
// เคยมีบั๊กจริงจากการใช้รายการนี้สองทาง: ประกาศแต่ไม่ซ่อน (เปิดโครงสร้างภายในให้บอท) และซ่อนแต่หลุด sitemap

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
