import Head from 'next/head';

// P22 (2/10/69) — metadata กลางของหน้าสาธารณะ: title · description · canonical · robots · OG · JSON-LD
//  เหตุผลที่ทำเป็น component ใหม่แทนการแก้ _app: _app เป็นไฟล์ห้ามแตะ (AGENTS.md ข้อ 4) และแต่ละหน้า
//  ต้องการคนละ title/canonical อยู่ดี — ทุกหน้าเรียก <SeoHead /> จุดเดียวจบ ไม่ให้ tag ขัดกันเอง
// กติกา canonical: ชี้กลับ "โดเมนหลัก" เสมอ (สอง host เนื้อหาเดียวกัน = Google นับซ้ำถ้าปล่อยสองชุด)
//  และต้องลงท้าย / เพราะ next.config เปิด trailingSlash: true — sitemap ต้องใช้รูปเดียวกัน
//  (ถ้าไม่ตรง Google จะเจอ URL sitemap → 308 → canonical แล้วนับว่า sitemap ไม่ตรงหน้าจริง)

export const SITE_ORIGIN = 'https://sovereignoriginshop.dpdns.org';

/** canonical ของ path ใด ๆ — เพิ่ม trailing slash ให้ตรง trailingSlash: true */
export function canonicalUrl(path: string): string {
  const p = path === '/' || path === '' ? '/' : path.endsWith('/') ? path : `${path}/`;
  return `${SITE_ORIGIN}${p}`;
}

export interface SeoHeadProps {
  title: string;
  description?: string;
  path: string; // pathname ของหน้า เช่น '/shop' (ไม่ต้องใส่โดเมน)
  noindex?: boolean;
  ogType?: string;
  jsonLd?: Record<string, unknown>;
}

export default function SeoHead({ title, description, path, noindex = false, ogType = 'website', jsonLd }: SeoHeadProps) {
  const canonical = canonicalUrl(path);
  return (
    <Head>
      <title>{title}</title>
      {description ? <meta name="description" content={description} /> : null}
      <link rel="canonical" href={canonical} />
      <meta name="robots" content={noindex ? 'noindex' : 'index,follow'} />
      <meta property="og:site_name" content="Sovereign Origin" />
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={title} />
      {description ? <meta property="og:description" content={description} /> : null}
      <meta property="og:url" content={canonical} />
      <meta name="twitter:card" content="summary" />
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} /> : null}
    </Head>
  );
}
