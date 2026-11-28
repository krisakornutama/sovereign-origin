// tools/test/portfolio-promo.test.mjs — promo.js ต้องเขียนข้อความโปรจาก pricing.json จริง
//
// ที่มา: ข้อความ EARLY20 เคยแก้มือ 4 จุด (order.html, buy.html และป้าย/ลิงก์ Gumroad)
// แก้พลาดจุดเดียว = เว็บโฆษณาส่วนลดที่ใช้ไม่ได้ หรือลิงก์ไปสินค้าที่ไม่มีโค้ด
// เทสต์ชั่วคราวที่เคยใช้ (Playwright) ถูกลบไปแล้ว ⇒ ไฟล์นี้กันการถอยกลับถาวร
//
// วิธีทดสอบ: รัน promo.js ตัวจริงใน "DOM ปลอม" ขนาดเล็ก + fetch ปลอม
//   · gumroadUrl = null        → ต้องไม่แตะหน้าเว็บ (คงข้อความ static “โอนอย่างเดียว”)
//   · gumroadUrl มีค่า         → ป้ายโปร/โน้ต/ลิงก์ ต้องมาจาก JSON (ไม่ใช่ค่าฝังในโค้ด)
//   · โหลด pricing.json ไม่ได้ → ต้องไม่แตะหน้าเว็บ (ข้อความ static ยังจริง)
//   · เปลี่ยน percent/tiers ใน JSON → ตัวเลขบนหน้าเว็บต้องเปลี่ยนตาม
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROMO_JS = fs.readFileSync(path.join(ROOT, 'portfolio', 'promo.js'), 'utf8');
const REAL_PRICING = JSON.parse(fs.readFileSync(path.join(ROOT, 'portfolio', 'pricing.json'), 'utf8'));
const GUMROAD_PRODUCT = 'https://oweenhoper.gumroad.com/l/sovereign-os';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thaiDate = (iso) => {
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${Number(y)}`;
};
const card = (usd, percent) => Math.round(((usd * (100 - percent)) / 100) * 100) / 100;
const money = (n) => `$${n.toFixed(2)}`;

/* ── DOM ปลอม: พอสำหรับสิ่งที่ promo.js ใช้ (textContent/children/attr/hidden/href) ── */
class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.className = '';
    this.hidden = false;
    this.href = attrs.href || '';
    this.children = [];
    this._text = '';
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  /* ตัวช่วยของเทสต์: เก็บทุก element ใต้โหนดนี้ */
  descendants() {
    return this.children.flatMap((c) => (c instanceof El ? [c, ...c.descendants()] : []));
  }
}

function makePage({ noteKinds = ['order', 'buy'], gumroadLinks = 2, priceSlots = [] } = {}) {
  const nodes = [];
  const label = new El('span', { 'data-promo-label': '' });
  label.textContent = 'ใช้ได้เฉพาะการโอนในประเทศ'; // ข้อความ static เดิมบนหน้าเว็บ
  nodes.push(label);

  const notes = noteKinds.map((kind) => {
    const el = new El('p', { 'data-promo-note': kind });
    el.hidden = true; // buy.html ซ่อนไว้โดยปริยาย
    nodes.push(el);
    return { kind, el };
  });

  const links = Array.from({ length: gumroadLinks }, (_, i) => {
    const a = new El('a', { 'data-gumroad': '', href: `${GUMROAD_PRODUCT}?ref=${i}` });
    nodes.push(a);
    return a;
  });

  // ช่องราคาบน buy.html — ค่า fallback ตั้งต้นเป็นข้อความเก่า ต้องถูกเขียนทับจาก JSON
  const prices = priceSlots.map((key) => {
    const el = new El('span', { 'data-price': key });
    el.textContent = 'เก่า';
    nodes.push(el);
    return { key, el };
  });

  const all = () => [...nodes, ...nodes.flatMap((n) => n.descendants())];
  const byAttr = (name) => nodes.filter((n) => Object.prototype.hasOwnProperty.call(n.attrs, name));

  return {
    label,
    notes,
    links,
    prices,
    document: {
      querySelector: (sel) => {
        const m = /^\[([\w-]+)\]$/.exec(sel);
        assert.ok(m, `DOM ปลอมรองรับเฉพาะ selector แบบ [attr] (ได้ ${sel})`);
        return byAttr(m[1])[0] || null;
      },
      querySelectorAll: (sel) => {
        const m = /^\[([\w-]+)\]$/.exec(sel);
        assert.ok(m, `DOM ปลอมรองรับเฉพาะ selector แบบ [attr] (ได้ ${sel})`);
        return byAttr(m[1]);
      },
      createElement: (tag) => new El(tag),
      createTextNode: (text) => ({ textContent: String(text) }),
    },
    /* ทุก element ที่ promo.js อาจเขียน (สำหรับตรวจว่า “ไม่แตะ” จริง) */
    snapshot: () =>
      nodes.map((n) => ({
        text: n.textContent,
        hidden: n.hidden,
        href: n.href,
        children: n.children.length,
      })),
    all,
  };
}

async function runPromo(pricing, { mode = 'ok' } = {}) {
  const page = makePage();
  const fetchStub = async () => {
    if (mode === 'reject') throw new Error('offline');
    if (mode === 'http-500') return { ok: false, json: async () => pricing };
    return { ok: true, json: async () => pricing };
  };
  // promo.js เป็น IIFE ที่อ่าน document/fetch จากสโคปนอก — ส่งเข้าไปเป็นพารามิเตอร์ได้ตรง ๆ
  new Function('document', 'fetch', PROMO_JS)(page.document, fetchStub);
  await new Promise((resolve) => setImmediate(resolve)); // รอ promise chain ของ promo.js
  return page;
}

const withUrl = (pricing, url = `${GUMROAD_PRODUCT}/${pricing.promo.code}`) => ({
  ...pricing,
  promo: { ...pricing.promo, gumroadUrl: url, channel: 'bank-transfer + gumroad' },
});

/* ── 1) pricing.json จริง: gumroadUrl = null ─────────────────────────────── */
test('gumroadUrl = null: ไม่แตะหน้าเว็บ (คงข้อความ static “โอนอย่างเดียว”)', async () => {
  assert.equal(REAL_PRICING.promo.gumroadUrl, null, 'เทสต์นี้ต้องรันตอนยังไม่มีโค้ดในหลังร้าน Gumroad');
  const page = await runPromo(REAL_PRICING);
  const before = makePage().snapshot();
  assert.deepEqual(page.snapshot(), before, 'ห้ามเขียนป้าย/โน้ต/ลิงก์ใด ๆ เมื่อยังไม่มีโค้ด');
  assert.match(page.label.textContent, /โอนในประเทศ/);
  for (const { el } of page.notes) {
    assert.equal(el.hidden, true, 'โน้ตโปรต้องยังซ่อนอยู่');
    assert.equal(el.textContent, '');
  }
  assert.match(page.links[0].href, new RegExp(`^${GUMROAD_PRODUCT}\\?ref=0$`), 'ลิงก์เดิมต้องไม่ถูกเขียนทับ');
});

/* ── 2) pricing.json จริง + มี URL โค้ด (สถานะหลังสร้างโค้ดในหลังร้าน) ──────── */
test('gumroadUrl มีค่า: ป้ายโปร/โน้ต/ลิงก์ มาจาก pricing.json', async () => {
  const pricing = withUrl(REAL_PRICING);
  const { promo, tiers } = pricing;
  const page = await runPromo(pricing);

  // ป้ายโปร: โค้ด + % + วันหมดอายุ แปลงจาก promo.expires (ไม่มีใน HTML)
  assert.equal(page.label.textContent,
    `ใช้โค้ด ${promo.code} (ลด ${promo.percent}% — ใช้ได้ทั้งการโอนในประเทศและการจ่ายบัตรที่ Gumroad ถึง ${thaiDate(promo.expires)})`);
  const strong = page.label.children.find((c) => c instanceof El && c.tagName === 'STRONG');
  assert.ok(strong, 'โค้ดต้องถูกเน้นด้วย <strong>');
  assert.equal(strong.textContent, promo.code);
  assert.equal(strong.className, 'mono');

  // ลิงก์การ์ด Gumroad ทุกจุดชี้ URL เดียวกับ JSON (ไม่ใช่ค่าฝังใน HTML)
  for (const a of page.links) assert.equal(a.href, promo.gumroadUrl);

  // โน้ตฝั่ง order.html: มีลิงก์ที่กดได้ + ราคาใบถูกสุด (คำนวณจาก tiers[0].usd)
  const order = page.notes.find((n) => n.kind === 'order');
  assert.equal(order.el.hidden, false, 'โน้ตต้องถูกเปิดให้เห็น');
  assert.ok(order.el.textContent.includes(promo.code));
  const anchor = order.el.children.find((c) => c instanceof El && c.tagName === 'A');
  assert.ok(anchor, 'โน้ต order ต้องมีลิงก์ร้าน Gumroad');
  assert.equal(anchor.href, promo.gumroadUrl);
  assert.equal(anchor.textContent, `หน้าร้าน Gumroad — ${money(card(tiers[0].usd, promo.percent))}`);

  // โน้ตฝั่ง buy.html: ราคาบัตรหลังลดของทุกชั้น เรียงตาม tiers ใน JSON
  const buy = page.notes.find((n) => n.kind === 'buy');
  assert.equal(buy.el.hidden, false);
  const expected = tiers.map((t) => `${t.name} ${money(card(t.usd, promo.percent))}`).join(' · ');
  assert.match(buy.el.textContent, new RegExp(expected.replace(/[.$]/g, '\\$&')));
  assert.match(buy.el.textContent, new RegExp(`ถึง ${thaiDate(promo.expires)}`));
  assert.match(buy.el.textContent, /ลด 20%/);
});

/* ── 3) ตัวเลขต้องมาจาก JSON ไม่ใช่ค่าที่ฝังใน promo.js ───────────────────── */
test('เปลี่ยน percent/tiers/expires ใน JSON → หน้าเว็บเปลี่ยนตาม (ไม่ hardcode)', async () => {
  const pricing = withUrl(
    {
      ...REAL_PRICING,
      promo: { ...REAL_PRICING.promo, percent: 35, expires: '2027-01-09' },
      tiers: [
        { name: 'Home', usd: 100 },
        { name: 'Business', usd: 250 },
      ],
    },
    'https://example.test/l/sovereign-os/TEST35'
  );
  const page = await runPromo(pricing);

  assert.equal(page.links[0].href, 'https://example.test/l/sovereign-os/TEST35');
  assert.equal(page.label.textContent,
    'ใช้โค้ด EARLY20 (ลด 35% — ใช้ได้ทั้งการโอนในประเทศและการจ่ายบัตรที่ Gumroad ถึง 9 ม.ค. 2027)');
  const buy = page.notes.find((n) => n.kind === 'buy').el.textContent;
  assert.match(buy, /Home \$65\.00 · Business \$162\.50/, 'ส่วนลด 35% ต้องคำนวณจาก tiers[].usd ใน JSON');
  assert.doesNotMatch(buy, /\$47\.20/, 'ห้ามมีราคา 20% ที่ฝังไว้หลงเหลือ');
  const anchor = page.notes.find((n) => n.kind === 'order').el.children.find((c) => c instanceof El && c.tagName === 'A');
  assert.equal(anchor.textContent, 'หน้าร้าน Gumroad — $65.00');
});

/* ── 4) โหลด pricing.json ไม่ได้ ต้องไม่ทำให้หน้าเว็บเสีย/โกหก ─────────────── */
for (const mode of ['reject', 'http-500']) {
  test(`pricing.json ใช้ไม่ได้ (${mode}): คงข้อความ static และไม่ throw`, async () => {
    const page = await runPromo(withUrl(REAL_PRICING), { mode });
    assert.deepEqual(page.snapshot(), makePage().snapshot());
    assert.equal(page.notes.every((n) => n.el.hidden), true, 'โน้ตทุกอันต้องยังซ่อนอยู่');
  });
}

/* ── 5) ราคาบน buy.html ต้องมาจาก tiers/renewal ใน pricing.json ─────────────── */
const priceKeys = [
  'usd:home', 'thb:home', 'usd:business', 'thb:business', 'usd:pro', 'thb:pro',
  'renewal:usd', 'renewal:thb',
];

async function priceTexts(pricing) {
  const page = makePage({ priceSlots: priceKeys });
  new Function('document', 'fetch', PROMO_JS)(page.document, async () => ({ ok: true, json: async () => pricing }));
  await new Promise((resolve) => setImmediate(resolve));
  return Object.fromEntries(page.prices.map((p) => [p.key, p.el.textContent]));
}

test('ราคาจริงใน pricing.json: $59/$199/$599 · ≈2,000/7,000/21,000 บาท · ต่ออายุ $79/2,800', async () => {
  assert.deepEqual(await priceTexts(REAL_PRICING), {
    'usd:home': '$59',
    'thb:home': '2,000',
    'usd:business': '$199',
    'thb:business': '7,000',
    'usd:pro': '$599',
    'thb:pro': '21,000',
    'renewal:usd': '$79',
    'renewal:thb': '2,800',
  });
});

test('เปลี่ยนราคา/ขั้นปัดใน JSON → ตัวเลขบนหน้าเว็บเปลี่ยนตาม (ไม่ hardcode)', async () => {
  const pricing = {
    ...REAL_PRICING,
    display: { approxThbRoundTo: 100 },
    tiers: [
      { id: 'home', name: 'Home', usd: 120, thb: 4250 },
      { id: 'business', name: 'Business', usd: 640.5, thb: 22750 },
    ],
    renewal: { usd: 89, thb: 3150 },
  };
  assert.deepEqual(await priceTexts(pricing), {
    'usd:home': '$120',
    'thb:home': '4,300', // 4,250 ปัดขึ้นเป็น 4,300
    'usd:business': '$640.50',
    'thb:business': '22,800', // 22,750 ปัดขึ้นเป็น 22,800
    'usd:pro': 'เก่า', // ไม่มีใน tiers = ไม่แตะ
    'thb:pro': 'เก่า',
    'renewal:usd': '$89',
    'renewal:thb': '3,200', // 3,150 ปัดขึ้นเป็น 3,200
  });
});

test('display.approxThbRoundTo เปลี่ยนขั้นปัด: 1,990 ปัดเป็น 2,000 (ขั้น 100) หรือ 1,990 (ขั้น 10)', async () => {
  const base = { ...REAL_PRICING, tiers: [{ id: 'home', name: 'Home', usd: 59, thb: 1990 }] };
  assert.equal((await priceTexts({ ...base, display: { approxThbRoundTo: 100 } }))['thb:home'], '2,000');
  assert.equal((await priceTexts({ ...base, display: { approxThbRoundTo: 10 } }))['thb:home'], '1,990');
});

/* ── 6) URL ว่าง/ไม่ใช่สตริง = ถือว่ายังไม่มีโค้ด (ไม่เขียนลิงก์เปล่า) ──────── */
test('gumroadUrl เป็นสตริงว่าง: ไม่เขียนลิงก์ที่กดแล้วพัง', async () => {
  const page = await runPromo({ ...REAL_PRICING, promo: { ...REAL_PRICING.promo, gumroadUrl: '   ' } });
  assert.deepEqual(page.snapshot(), makePage().snapshot());
});
