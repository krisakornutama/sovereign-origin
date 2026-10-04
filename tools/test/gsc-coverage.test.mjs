// เทสต์ตรรกะ "เทียบ sitemap กับสิ่งที่ Google เห็น" ของ tools/verify/gsc-coverage.mjs
// เหตุผลที่ต้องมี: ส่วนนี้คือหัวใจของการเฝ้าดู index — ถ้าจับ "หน้าหลุดวง" ไม่ได้
// ระบบจะเงียบตอนที่ควรร้อง (เคยเป็นบั๊กที่ไม่มีใครเห็น) · และถ้าร้องผิดทุกคืนก็แย่กว่าไม่ร้อง
import { compareCoverage, norm } from '../verify/gsc-coverage.mjs';

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (d ? ' — ' + d : '')); if (!ok) fails++; };

const map = (obj) => new Map(Object.entries(obj));

// 1) ปกติ — ทุกหน้าใน sitemap มี impression และไม่มีอะไรหลุด
{
  const sitemap = new Set(['sovereignoriginshop.dpdns.org/', 'sovereignoriginshop.dpdns.org/about/']);
  const cur = map({
    'https://sovereignoriginshop.dpdns.org/': { clicks: 12, impressions: 300 },
    'https://sovereignoriginshop.dpdns.org/about/': { clicks: 3, impressions: 40 },
  });
  const prev = map({
    'https://sovereignoriginshop.dpdns.org/': { clicks: 9, impressions: 250 },
    'https://sovereignoriginshop.dpdns.org/about/': { clicks: 2, impressions: 30 },
  });
  const r = compareCoverage(sitemap, cur, prev);
  check('ปกติ = ไม่มีปัญหา', r.problems.length === 0, JSON.stringify(r.problems));
  check('ปกติ = ไม่มีหน้าหลุดวง', r.dropped.length === 0 && r.orphans.length === 0);
}

// 2) หน้าที่เคยติด index แล้วหายไป = ต้องจับได้ (นี่คือเคสที่ SEO pre-flight มองไม่เห็น)
{
  const sitemap = new Set(['a.com/', 'a.com/about/']);
  const cur = map({ 'https://a.com/': { clicks: 5, impressions: 100 } });
  const prev = map({ 'https://a.com/': { clicks: 4, impressions: 90 }, 'https://a.com/about/': { clicks: 1, impressions: 25 } });
  const r = compareCoverage(sitemap, cur, prev);
  check('หน้าหายวง = จับได้', r.dropped.length === 1 && r.dropped[0].includes('about'), JSON.stringify(r.dropped));
  check('หน้าหายวง = อยู่ใน problems', r.problems.some((p) => p.includes('หายไป')));
}

// 3) Google เข้ามาหน้าที่ไม่อยู่ใน sitemap (orphan) = ต้องเตือน
{
  const sitemap = new Set(['a.com/']);
  const cur = map({ 'https://a.com/': { clicks: 1, impressions: 10 }, 'https://a.com/old-page/': { clicks: 2, impressions: 55 } });
  const prev = map({ 'https://a.com/': { clicks: 1, impressions: 9 }, 'https://a.com/old-page/': { clicks: 2, impressions: 50 } });
  const r = compareCoverage(sitemap, cur, prev);
  check('orphan = จับได้', r.orphans.length === 1 && norm(r.orphans[0]) === 'a.com/old-page', JSON.stringify(r.orphans));
}

// 4) หน้าใหม่ใน sitemap ที่ยังไม่เคยมี impression = ปกติ ห้ามร้อง (เว็บใหม่ยังไม่มี traffic)
{
  const sitemap = new Set(['a.com/', 'a.com/shop/']);
  const cur = map({ 'https://a.com/': { clicks: 1, impressions: 10 } });
  const prev = map({ 'https://a.com/': { clicks: 1, impressions: 8 } });
  const r = compareCoverage(sitemap, cur, prev);
  check('หน้าใหม่ที่ยังไม่ติด index = ไม่ต้องร้อง', r.problems.length === 0, JSON.stringify(r.problems));
  check('หน้าใหม่ = อยู่ใน unseen สำหรับดูด้วยตา', r.unseen.length === 1 && r.unseen[0] === 'a.com/shop');
}

// 5) หน้าที่มี clicks แต่ไม่มี impressions ไม่ถือว่าหลุด (clicks ≤ impressions เสมอ แต่ข้อมูลบางแถวอาจมี 0)
{
  const sitemap = new Set(['a.com/', 'a.com/x/']);
  const cur = map({ 'https://a.com/': { clicks: 0, impressions: 5 }, 'https://a.com/x/': { clicks: 0, impressions: 0 } });
  const prev = map({ 'https://a.com/': { clicks: 0, impressions: 4 }, 'https://a.com/x/': { clicks: 0, impressions: 7 } });
  const r = compareCoverage(sitemap, cur, prev);
  check('impressions ลดเหลือ 0 = ถือว่าหลุดวง (จับได้)', r.dropped.length === 1 && r.dropped[0].includes('/x'), JSON.stringify(r.dropped));
}

// 6) trailing slash / โปรโตคอลต่างกัน = ต้องถือเป็นหน้าเดียวกัน (ไม่งั้นร้อง false alarm ทุกคืน)
{
  const sitemap = new Set(['a.com/about']);
  const cur = map({ 'https://a.com/about/': { clicks: 1, impressions: 20 } });
  const prev = map({ 'http://a.com/about': { clicks: 1, impressions: 18 } });
  const r = compareCoverage(sitemap, cur, prev);
  check('normalize URL = ไม่เกิด false alarm', r.problems.length === 0, JSON.stringify(r.problems));
}

console.log(fails ? `\n❌ ล้ม ${fails} เคส` : '\n✅ ผ่านทุกเคส');
process.exitCode = fails ? 1 : 0;
