#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// tools/order/pricing-check.mjs — กันราคาบนหน้าเว็บหลุดจาก pricing.json
//
// ที่มา: ราคาอยู่ 3 ที่ (pricing.json, order.html, procurement.html) — ถ้าแก้ที่เดียว
// ลูกค้าจะเห็นยอดโอนไม่ตรงกับที่เครื่องมือ fulfill ตรวจ ราคาผิด = โอนผิด = ต้องคืนเงิน
//
// ตรวจ: ราคาใน pricing.json สมเหตุสมผล (เทียบ USD) + ตัวเลขที่โชว์บนหน้าเว็บตรงกับ JSON
// exit: 0 = ตรงกัน · 1 = มีจุดที่หลุด
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pricing = JSON.parse(readFileSync(path.join(ROOT, 'portfolio', 'pricing.json'), 'utf8'));

const thb = (n) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(n);
const promoPrice = (list) => Math.floor((list * (100 - pricing.promo.percent)) / 100 / 10) * 10;

const pages = {
  'portfolio/order.html': readFileSync(path.join(ROOT, 'portfolio', 'order.html'), 'utf8'),
  'portfolio/procurement.html': readFileSync(path.join(ROOT, 'portfolio', 'procurement.html'), 'utf8'),
  'portfolio/buy.html': readFileSync(path.join(ROOT, 'portfolio', 'buy.html'), 'utf8'),
};

const failures = [];
function check(ok, message) {
  process.stdout.write(`${ok ? '✓' : '✗'} ${message}\n`);
  if (!ok) failures.push(message);
}

for (const tier of pricing.tiers) {
  const impliedUsd = tier.thb / pricing.usdPerThb;
  const drift = Math.abs(impliedUsd - tier.usd) / tier.usd;
  check(drift < 0.08, `${tier.name}: ฿${thb(tier.thb)} เทียบ $${tier.usd} คลาดเคลื่อน ${(drift * 100).toFixed(1)}% (< 8%)`);
}

for (const tier of pricing.tiers) {
  const promo = promoPrice(tier.thb);
  const orderHtml = pages['portfolio/order.html'];
  check(orderHtml.includes(`data-thb="${tier.thb}"`), `order.html: data-thb ของ ${tier.name} = ${tier.thb}`);
  check(
    orderHtml.includes(`฿${thb(tier.thb)}`) && orderHtml.includes(`฿${thb(promo)}`),
    `order.html: แสดง ${tier.name} ฿${thb(tier.thb)}→฿${thb(promo)}`
  );
  check(
    pages['portfolio/procurement.html'].includes(thb(tier.thb)) &&
      pages['portfolio/procurement.html'].includes(thb(promo)),
    `procurement.html: แสดง ${tier.name} ${thb(tier.thb)} / ${thb(promo)}`
  );
}

check(pages['portfolio/order.html'].includes(pricing.promo.code), `order.html: มีโค้ด ${pricing.promo.code}`);
check(
  pages['portfolio/procurement.html'].includes(String(pricing.renewal.thb).replace(/\B(?=(\d{3})+(?!\d))/g, ',')),
  `procurement.html: ราคาต่ออายุ ฿${thb(pricing.renewal.thb)}`
);
check(pages['portfolio/order.html'].includes('4440626505'), 'order.html: มีเลขบัญชี 4440626505');
check(pages['portfolio/procurement.html'].includes('4440626505'), 'procurement.html: มีเลขบัญชี 4440626505');
check(pages['portfolio/buy.html'].includes('4440626505'), 'buy.html: มีเลขบัญชี 4440626505');

// ไม่มีเลขบัญชีอื่นนอกจาก 4440626505 บนหน้าขาย
for (const [name, html] of Object.entries(pages)) {
  const numbers = html.match(/\b\d{10}\b/g) ?? [];
  const foreign = numbers.filter((n) => n !== '4440626505');
  check(foreign.length === 0, `${name}: ไม่มีเลข 10 หลักอื่น (พบ ${foreign.join(', ') || 'ไม่มี'})`);
}

/* ── โปร EARLY20: หน้าเว็บต้องผูกกับ pricing.json ไม่ใช่แก้มือหลายหน้า ──
   order.html/buy.html มีจุดเสียบ (data-promo-note) + โหลด promo.js ซึ่งอ่าน promo.gumroadUrl
   ถ้า URL ยังเป็น null (ยังไม่สร้างโค้ดในหลังร้าน) หน้าเว็บต้องคงข้อความ "โอนอย่างเดียว" */
const promo = pricing.promo ?? {};
const promoJs = readFileSync(path.join(ROOT, 'portfolio', 'promo.js'), 'utf8');
const GUMROAD_PRODUCT = 'https://oweenhoper.gumroad.com/l/sovereign-os';
const gumroadNull = promo.gumroadUrl === null;

check(gumroadNull || typeof promo.gumroadUrl === 'string', 'promo.gumroadUrl เป็น null (ยังไม่มีโค้ด) หรือ URL เต็ม');

for (const name of ['portfolio/order.html', 'portfolio/buy.html']) {
  check(pages[name].includes('data-promo-note'), `${name}: มีจุดเสียบข้อความโปร (data-promo-note)`);
  check(pages[name].includes('src="promo.js"'), `${name}: โหลด promo.js`);
  check(!pages[name].includes(`${GUMROAD_PRODUCT}/${promo.code}`), `${name}: ไม่ hardcode ลิงก์โค้ด (ต้องมาจาก pricing.json)`);
}
check(promoJs.includes("fetch('pricing.json'"), 'promo.js: อ่าน pricing.json เป็นแหล่งความจริง');
check(promoJs.includes('data-promo-note'), 'promo.js: เขียนโน้ตโปรลงจุดเสียบ');
check(/^\d{4}-\d{2}-\d{2}$/.test(String(promo.expires)) && !Number.isNaN(Date.parse(promo.expires)),
  `promo.expires เป็นวันที่จริงรูปแบบ YYYY-MM-DD (${promo.expires})`);

if (gumroadNull) {
  check(promo.channel === 'bank-transfer', 'promo.channel = bank-transfer ขณะที่ยังไม่มีโค้ด Gumroad');
} else {
  check(promo.gumroadUrl === `${GUMROAD_PRODUCT}/${promo.code}`, `promo.gumroadUrl ชี้สินค้า+โค้ดเดียวกัน (${GUMROAD_PRODUCT}/${promo.code})`);
  check(/gumroad/.test(String(promo.channel)), 'promo.channel ระบุ gumroad แล้วเมื่อมีโค้ด');
  check(Number.isInteger(promo.percent) && promo.percent > 0 && promo.percent < 100, `promo.percent = ${promo.percent}% (ต้องเป็นจำนวนเต็ม 1–99)`);
}

if (failures.length > 0) {
  process.stderr.write(`\n✗ pricing:check ไม่ผ่าน ${failures.length} ข้อ\n`);
  process.exit(1);
}
process.stdout.write('\n✓ pricing:check ผ่าน — ราคาบนเว็บตรงกับ pricing.json\n');
