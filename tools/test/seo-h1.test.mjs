// เทสต์ตรรกะ "หน้าที่ประกาศใน sitemap แต่ไม่มีเนื้อหาจริง" ของ tools/verify/seo-preflight.mjs
//
// เหตุผลที่ต้องมี: เคยเจอ /sensors/ + /shop/ ตอบ 200 มี title/canonical/description ครบ
// แต่ h1=0 เพราะหน้ารอ hydrate → Google ได้ metadata ล้วน ไม่มีเนื้อหา
// และเช็คเดิม "ผ่าน" เพราะไม่เคยถามว่าหน้ามีเนื้อหาจริงไหม
// → กติกานี้คือกันไม่ให้เกิดซ้ำ ถ้าไม่มีเทสต์ คนแก้ regex พลาดจะเงียบเหมือนเดิม
import { checkPage } from '../verify/seo-preflight.mjs';

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + n + (d ? ' — ' + d : '')); if (!ok) fails++; };

const U = 'https://sovereignoriginshop.dpdns.org/sensors/';
const good = (h1 = '<h1>เนื้อหา</h1>') => ({
  status: 200,
  text: `<html><head><title>t</title><meta name="description" content="d"/>`
    + `<link rel="canonical" href="${U}"/><meta name="robots" content="index,follow"/>`
    + `</head><body>${h1}</body></html>`,
});

// 1) หน้าปกติ = ผ่านทุกข้อ
{
  const r = checkPage(good(), U);
  check('หน้าปกติ = ไม่มีปัญหา', r.bad.length === 0, JSON.stringify(r.bad));
  check('หน้าปกติ = นับ h1 ได้ 1', r.h1 === 1, `h1=${r.h1}`);
}

// 2) เคสจริงที่เคยพลาด: metadata ครบหมด แต่ไม่มี h1 → ต้องถูกจับ (บั๊กนี้คือเหตุผลที่มีเทสต์นี้)
{
  const r = checkPage(good(''), U);
  check('หน้าว่าง (metadata ครบ แต่ไม่มี h1) = ถูกจับ', r.bad.some((b) => /ไม่มี <h1>/.test(b)), JSON.stringify(r.bad));
  check('หน้าว่าง = ไม่มีข้ออื่นติด (จับเฉพาะเรื่องตัวเอง)', r.bad.length === 1, JSON.stringify(r.bad));
}

// 3) h1 ซ้ำ = สัญญาณโครงสร้างผิด ต้องจับ (Google ชอบหน้าที่มีหัวข้อเดียว)
{
  const r = checkPage(good('<h1>a</h1><h1>b</h1>'), U);
  check('h1 ซ้ำ = ถูกจับ', r.bad.some((b) => /<h1> 2 อัน/.test(b)), JSON.stringify(r.bad));
}

// 4) กันการนับพลาด: <h1class=... หรือ <h1foo ไม่ใช่ h1 → ต้องไม่ถูกนับ
{
  const r = checkPage(good('<h1class="x">ปลอม</h1class><h1bar>y</h1bar>'), U);
  check('<h1class=... ไม่ถูกนับเป็น h1', r.h1 === 0 && r.bad.some((b) => /ไม่มี <h1>/.test(b)), `h1=${r.h1}`);
}

// 5) กติกาเดิมต้องยังทำงานอยู่ (กันการ refactor ทำของเดิมหาย)
{
  const noTitle = { status: 200, text: `<html><body><h1>x</h1></body></html>` };
  const r = checkPage(noTitle, U);
  check('ไม่มี title = ถูกจับ', r.bad.some((b) => /<title>/.test(b)), JSON.stringify(r.bad));
  check('ไม่มี description = ถูกจับ', r.bad.some((b) => /description/.test(b)), JSON.stringify(r.bad));
  check('ไม่มี canonical = ถูกจับ', r.bad.some((b) => /canonical/.test(b)), JSON.stringify(r.bad));
}

// 6) canonical ผิดโฮสต์/ผิดเส้นทาง = ต้องจับ (ป้องกันเนื้อหาซ้ำสองโดเมน)
{
  const wrong = { status: 200, text: good().text.replace(U, 'https://other.example/sensors/') };
  const r = checkPage(wrong, U);
  check('canonical ไม่ตรง URL = ถูกจับ', r.bad.some((b) => /canonical ไม่ตรง/.test(b)), JSON.stringify(r.bad));
}

// 7) noindex ซ้อนกับการอยู่ใน sitemap = ต้องจับ (GSC เตือนตรงนี้)
{
  const noindex = { status: 200, text: good().text.replace('index,follow', 'noindex') };
  const r = checkPage(noindex, U);
  check('noindex + อยู่ใน sitemap = ถูกจับ', r.bad.some((b) => /noindex/.test(b)), JSON.stringify(r.bad));
}

// 8) หน้าตาย
{
  const dead = checkPage({ status: 0, text: '' }, U);
  check('ไม่ตอบ/ตาย = ถูกจับ', dead.bad.some((b) => /ตอบ/.test(b)), JSON.stringify(dead.bad));
}

console.log(fails === 0 ? '\nผ่านทั้งหมด' : `\nFAIL ${fails} เคส`);
process.exitCode = fails === 0 ? 0 : 1;