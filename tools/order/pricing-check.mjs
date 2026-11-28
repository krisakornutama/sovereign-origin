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

if (failures.length > 0) {
  process.stderr.write(`\n✗ pricing:check ไม่ผ่าน ${failures.length} ข้อ\n`);
  process.exit(1);
}
process.stdout.write('\n✓ pricing:check ผ่าน — ราคาบนเว็บตรงกับ pricing.json\n');
