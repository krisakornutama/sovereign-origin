// เทสต์ tools/verify/seo-publish-audit.mjs — ตัวจำแนกว่าหน้าไหน "ประกาศว่าเปิดให้ index"
// เหตุผลที่ต้องมี: กติกานี้คือกัน "หน้าประกาศว่าเปิด แต่หลุด sitemap" ซึ่งไม่มีอะไรมาจับ
// ถ้าไม่มีเทสต์ คนแก้ regex พลาดจะทำให้ gate ผ่านตลอดโดยที่ตรวจอะไรไม่ได้เลย
import { classify } from '../verify/seo-publish-audit.mjs';

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (d ? ' — ' + d : '')); if (!ok) fails++; };

// 1) หน้าที่ใช้ SeoHead โดยไม่ส่ง noindex = index (ค่าเริ่มต้นของ SeoHead คือ index,follow)
check('SeoHead ปกติ = index', classify('<SeoHead title="t" description="d" path="/x" />') === 'index');

// 2) หน้าที่ใช้ meta ตรง ๆ (about/partners ใช้ next/head) = index
check('meta index,follow = index', classify('<Head><meta name="robots" content="index,follow" /></Head>') === 'index');

// 3) noindex แบบ SeoHead prop → ต้องไม่ถูกนับเป็น index (กรณีที่เคยพลาด: regex แรก match noindex ไม่ทัน)
check('SeoHead noindex prop = noindex',
  classify('<SeoHead title="t" path="/x" noindex />') === 'noindex');

// 4) noindex แบบ meta ตรง (partners/me) = noindex
check('meta noindex = noindex', classify('<Head><meta name="robots" content="noindex" /></Head>') === 'noindex');

// 5) หน้าในระบบที่ไม่มี metadata เลย = none (ไม่ต้องไปตีความว่าเป็นหน้าสาธารณะ)
check('หน้าธรรมดา = none', classify('export default function Dashboard() { return <div/>; }') === 'none');

// 6) หน้าที่มีทั้ง index และ noindex คนละจุด → noindex ต้องชนะ (ปลอดภัยกว่า: ประกาศเกินจริงเสียยิ่งกว่าประกาศขาด)
check('มีทั้งสองแบบ = noindex (ตัวที่เข้มกว่าชนะ)',
  classify('<meta name="robots" content="noindex" /><SeoHead path="/x" />') === 'noindex');

console.log(fails === 0 ? '\nผ่านทั้งหมด' : `\nFAIL ${fails} เคส`);
process.exitCode = fails === 0 ? 0 : 1;