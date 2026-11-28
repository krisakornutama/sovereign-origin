/* price-format.js — สูตรจัดรูปแบบราคา "จุดเดียว" ของโปรเจกต์ (เบราว์เซอร์ + Node)
 *
 * ที่มา: portfolio/promo.js (หน้าเว็บ) กับ tools/order/pricing-check.mjs (ด่านกันราคาหลุด)
 * เคยเขียน usdPrice / approxThb / baht ซ้ำกันเองสองที่ — แก้ข้างเดียวแล้วอีกข้างเพี้ยน
 * โดยไม่มีใครรู้ (เช่น เปลี่ยนขั้นปัดใน promo.js แต่ pricing:check ยังใช้ 100)
 * ตอนนี้ทั้งสองฝั่งเรียกไฟล์นี้ ⇒ สูตรเดียว ค่าเดียว
 *
 * เบราว์เซอร์: <script src="price-format.js" defer></script> ต้องมาก่อน promo.js
 *   → window.SovereignPriceFormat
 * Node: import priceFormat from '../../portfolio/price-format.js'  (CommonJS → default import)
 *
 * ค่าที่รับ/คืน:
 *   usdPrice(59)          → "$59"        (ตัด .00 แต่เก็บสตางค์เมื่อมีจริง)
 *   baht(2000)            → "2,000"      (คั่นหลักพันแบบ en-US ทุกหลัก)
 *   approxThb(1990, 100)  → 2000         (ปัดตามขั้น ไม่คูณ/ไม่แปลงสกุล)
 *   priceTexts(pricing)   → { 'usd:home': '$59', 'thb:home': '2,000', … }
 *                            แผนที่เดียวของคีย์ [data-price] ที่ promo.js เขียน
 *                            และ pricing-check ใช้เทียบกับค่า fallback ใน HTML
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.SovereignPriceFormat = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ค่าตั้งต้นเมื่อ pricing.json ไม่ได้ระบุ display.approxThbRoundTo */
  var DEFAULT_ROUND_TO = 100;

  /* ราคาเต็ม: ตัด .00 ทิ้ง ($59 ไม่ใช่ $59.00) แต่ยังเก็บสตางค์เมื่อมีจริง */
  function usdPrice(n) {
    var v = Math.round(Number(n) * 100) / 100;
    return '$' + (v % 1 === 0 ? String(v) : v.toFixed(2));
  }

  /* ตัวเลขบาทแบบมีหลักพันคั่น — ใช้ทั้งราคาจริง (order/procurement) และราคาโดยประมาณ */
  function baht(n) {
    return new Intl.NumberFormat('en-US').format(n);
  }

  /* ขั้นปัดราคาบาทโดยประมาณจาก pricing.json (display.approxThbRoundTo) — ค่าเสีย/ไม่ระบุ = 100 */
  function roundTo(pricing) {
    var raw = pricing && pricing.display ? Number(pricing.display.approxThbRoundTo) : NaN;
    return raw > 0 ? raw : DEFAULT_ROUND_TO;
  }

  /* ราคาบาท "โดยประมาณ" ตามขั้นที่กำหนด (ไม่ใช่ยอดโอนจริง — ยอดจริงใช้ tiers[].thb เต็มจำนวน) */
  function approxThb(n, step) {
    var s = Number(step) > 0 ? Number(step) : DEFAULT_ROUND_TO;
    return Math.round(Number(n) / s) * s;
  }

  /* แผนที่ data-price="…" → ข้อความ: แหล่งเดียวของทั้งฝั่งเขียน (promo.js) และฝั่งตรวจ (pricing-check) */
  function priceTexts(pricing) {
    var p = pricing || {};
    var tiers = Array.isArray(p.tiers) ? p.tiers : [];
    var renewal = p.renewal || {};
    var step = roundTo(p);
    var values = {};

    tiers.forEach(function (t) {
      if (!t || typeof t.id !== 'string' || t.id === '') return;
      values['usd:' + t.id] = usdPrice(t.usd);
      if (t.thb != null) values['thb:' + t.id] = baht(approxThb(t.thb, step));
    });
    if (renewal.usd != null) values['renewal:usd'] = usdPrice(renewal.usd);
    if (renewal.thb != null) values['renewal:thb'] = baht(approxThb(renewal.thb, step));

    return values;
  }

  return {
    usdPrice: usdPrice,
    baht: baht,
    approxThb: approxThb,
    roundTo: roundTo,
    priceTexts: priceTexts,
    DEFAULT_ROUND_TO: DEFAULT_ROUND_TO,
  };
}));
