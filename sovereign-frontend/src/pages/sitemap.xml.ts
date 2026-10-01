// src/pages/sitemap.xml.ts
// P21 ต่อ (2/10/69): sitemap แบบ dynamic — ตอบตาม host ที่เข้ามา จบปัญหา URL ข้าม host
// (เดิม static public/sitemap.xml มี URL สอง host รวมกัน — Google ข้าม URL คนละ host ทิ้ง)
//  - เข้าจากโดเมนจริง → คืน URL ของโดเมนนั้น (แต่ละ GSC property ได้ของตัวเองครบ)
//  - host แปลก/localhost → คืนชุดของโดเมนหลัก (กัน host header injection)
import type { NextApiRequest, NextApiResponse } from 'next';

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
  { path: '/hover-cards', changefreq: 'monthly', priority: '0.3' },
];

export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  const site = ALLOWED_HOSTS.has(host) ? host : FALLBACK_HOST;
  const lastmod = new Date().toISOString().slice(0, 10);
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- dynamic: ตอบตาม host ที่เข้ามา (P21 2/10/69) -->\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    PUBLIC_PATHS.map(
      (p) =>
        `  <url><loc>https://${site}${p.path}</loc><lastmod>${lastmod}</lastmod>` +
        `<changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`
    ).join('\n') +
    `\n</urlset>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.status(200).send(body);
}
