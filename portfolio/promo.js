/* promo.js — ข้อความโปร EARLY20 ผูกกับ portfolio/pricing.json (แหล่งความจริงเดียว)
 *
 * ใช้: <script src="promo.js" defer></script> ใน order.html และ buy.html
 *
 * ทำงาน: อ่าน pricing.json → ถ้า promo.gumroadUrl มีค่า = "โค้ดบัตรพร้อมใช้"
 *   เขียนป้ายโปร + โน้ตราคาบัตรใหม่ และชี้ลิงก์ Gumroad ไปที่ URL ที่มีโค้ด (ราคาลดขึ้นเอง)
 * ถ้า promo.gumroadUrl เป็น null หรือโหลด JSON ไม่ได้ → คงข้อความ static เดิม
 *   (ข้อความ static = "ใช้ได้เฉพาะการโอน" ซึ่งจริงเสมอเมื่อยังไม่มีโค้ด จึงไม่โฆษณาส่วนลดที่ยังใช้ไม่ได้)
 *
 * ราคาบน buy.html: เขียนทุกจุด [data-price="usd:<tier>" | "thb:<tier>" | "renewal:usd" | "renewal:thb"]
 *   จาก tiers[].usd / tiers[].thb / renewal แล้วปัดราคาบาทตาม display.approxThbRoundTo
 *   (HTML เก็บค่า fallback ไว้ให้ crawler/no-JS อ่าน และ pricing:check บังคับให้ค่าพวกนั้นตรงกับ JSON)
 *
 * สูตรจัดรูปแบบราคา (usdPrice/baht/approxThb) อยู่ใน price-format.js ที่เดียว — pricing-check.mjs
 * เรียกไฟล์เดียวกัน ⇒ วันหลังแก้สูตรที่เดียว หน้าเว็บกับด่านตรวจไม่มีทางเพี้ยนจากกัน
 */
(function () {
  'use strict';

  var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  function thaiDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    var day = Number(m[3]);
    var month = Number(m[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return '';
    return day + ' ' + MONTHS[month - 1] + ' ' + Number(m[1]);
  }

  function usd(n) {
    return '$' + Number(n).toFixed(2);
  }

  /* ราคาบัตรหลังหักส่วนลด — ปัดเป็นสตางค์ (เช่น $59 − 20% = $47.20) */
  function cardPrice(tier, percent) {
    return Math.round((Number(tier.usd) * (100 - percent)) / 100 * 100) / 100;
  }

  /* สูตรราคาร่วม (usdPrice/baht/approxThb/priceTexts) — price-format.js โหลดก่อนไฟล์นี้ */
  var PRICE_FORMAT = typeof SovereignPriceFormat !== 'undefined' ? SovereignPriceFormat : null;

  /* เขียนราคาทุกจุดบนหน้าเว็บ — ทำงานแม้ยังไม่มีโค้ดโปร (ราคาไม่ขึ้นกับโปร) */
  function applyPrices(pricing) {
    if (!PRICE_FORMAT) return; // ไม่มี price-format.js → คงค่า fallback ที่ pricing:check บังคับให้ตรง JSON
    var values = PRICE_FORMAT.priceTexts(pricing);

    Array.prototype.forEach.call(document.querySelectorAll('[data-price]'), function (el) {
      var key = String(el.getAttribute('data-price') || '').trim();
      if (Object.prototype.hasOwnProperty.call(values, key)) el.textContent = values[key];
    });
  }

  function strong(text) {
    var el = document.createElement('strong');
    el.className = 'mono';
    el.textContent = text;
    return el;
  }

  function apply(pricing) {
    var promo = pricing.promo || {};
    var url = typeof promo.gumroadUrl === 'string' ? promo.gumroadUrl.trim() : '';
    if (!url) return; // ยังไม่มีโค้ดในหลังร้าน → เก็บข้อความ static (การโอนอย่างเดียว)

    var code = promo.code || '';
    var percent = Number(promo.percent) || 0;
    var until = thaiDate(promo.expires);
    var tiers = Array.isArray(pricing.tiers) ? pricing.tiers : [];
    var prices = tiers.map(function (t) {
      return t.name + ' ' + usd(cardPrice(t, percent));
    }).join(' · ');
    var cheapest = tiers.length ? usd(cardPrice(tiers[0], percent)) : '';

    var label = document.querySelector('[data-promo-label]');
    if (label && code && percent > 0) {
      label.textContent = 'ใช้โค้ด ';
      label.appendChild(strong(code));
      label.appendChild(document.createTextNode(
        ' (ลด ' + percent + '% — ใช้ได้ทั้งการโอนในประเทศและการจ่ายบัตรที่ Gumroad' +
        (until ? ' ถึง ' + until : '') + ')'
      ));
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-promo-note]'), function (el) {
      var kind = el.getAttribute('data-promo-note');
      el.textContent = '';
      if (kind === 'buy') {
        el.appendChild(document.createTextNode(
          'โค้ด ' + code + ' ลด ' + percent + '%: ' + prices +
          (until ? ' (ถึง ' + until + ')' : '') +
          ' — ใช้ได้ทั้งบัตรที่ Gumroad และการโอนเข้าบัญชีด้านล่าง'
        ));
      } else {
        el.appendChild(document.createTextNode(
          'ราคาบาทถูกกว่าราคาบัตรที่ Gumroad เล็กน้อยเพราะไม่มีค่าธรรมเนียมร้าน · ' +
          'ต้องการจ่ายด้วยบัตรและดาวน์โหลดทันที (ใช้โค้ด ' + code + ' ได้): '
        ));
        var a = document.createElement('a');
        a.href = url;
        a.textContent = 'หน้าร้าน Gumroad' + (cheapest ? ' — ' + cheapest : '');
        el.appendChild(a);
      }
      el.hidden = false;
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-gumroad]'), function (a) {
      a.href = url;
    });
  }

  fetch('pricing.json', { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (json) {
      if (!json) return;
      applyPrices(json);
      apply(json);
    })
    .catch(function () { /* ออฟไลน์/ถูกบล็อก → คงข้อความ static ที่ปลอดภัยไว้ */ });
})();
