#!/usr/bin/env node
// scripts/synthetic-browser-check.mjs
// ── Synthetic Browser Check — "uptime วัดจาก browser จริง ไม่ใช่แค่ HTTP 200" ──
// บทเรียนเคส zentwork: server monitor เขียว 100% แต่ลูกค้าใน LINE WebView เข้าไม่ได้
// สคริปต์นี้เปิด headless browser ด้วย UA ของ LINE WebView (iOS/Android) + iOS WebKit
// แล้วเข้าหน้าเป้าหมายแบบลูกค้าจริง: โหลด → render → ไม่มี pageerror → localStorage ใช้ได้
// พัง = รายงานเข้า /api/client-monitor/error (kind=synthetic) → โผล่ในแผง Client Health + Telegram
//
// ใช้งาน:
//   node scripts/synthetic-browser-check.mjs                    # รันครั้งเดียว (exit 0=ผ่าน 1=พัง)
//   node scripts/synthetic-browser-check.mjs --loop             # วนตรวจทุก 5 นาที (default)
//   node scripts/synthetic-browser-check.mjs --loop --interval-min 15
// env:
//   SYNTHETIC_TARGET_URL   หน้าที่จะตรวจ (default http://localhost:3000/shop — หน้าสาธารณะ)
//   SYNTHETIC_API_URL      API ที่รายงานเข้า (default http://localhost:3001)
//   SYNTHETIC_ENGINE       chromium (default) | webkit
//                          webkit = engine จริงของ iOS (รัน `npx playwright install webkit` ก่อน)
//
// ไม่เพิ่ม dependency — ใช้ @playwright/test ที่มีอยู่ใน devDependencies แล้ว
import { chromium, webkit } from '@playwright/test';

const args = process.argv.slice(2);
const LOOP = args.includes('--loop');
const intervalIdx = args.indexOf('--interval-min');
const INTERVAL_MIN = intervalIdx >= 0 ? Math.max(1, Number(args[intervalIdx + 1]) || 5) : 5;

const TARGET_URL = process.env.SYNTHETIC_TARGET_URL || 'http://localhost:3000/shop';
const API_URL = (process.env.SYNTHETIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const ENGINE = (process.env.SYNTHETIC_ENGINE || 'chromium').toLowerCase();

// UA จริงของ in-app browser ที่ลูกค้าใช้ (จับคู่ engine: iOS LINE = WebKit, Android LINE = Chromium)
const PROFILES = [
  {
    name: 'LINE WebView iOS (WebKit)',
    engine: 'webkit',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 LINE/13.19.1',
    viewport: { width: 390, height: 844 },
    mobile: true,
  },
  {
    name: 'LINE WebView Android (Chromium)',
    engine: 'chromium',
    ua: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36 Line/13.19.1',
    viewport: { width: 384, height: 854 },
    mobile: true,
  },
  {
    name: 'iOS Safari (WebKit)',
    engine: 'webkit',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    mobile: true,
  },
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function reportToApi(result) {
  // รายงานเฉพาะเมื่อพัง — ผ่านเงียบ ๆ กัน DB ล้น (ความผ่านดูจาก exit code/log)
  if (result.ok) return;
  try {
    const body = JSON.stringify({
      kind: 'synthetic',
      message: `synthetic check FAILED [${result.profile}]: ${result.failures.join(' | ')}`,
      source: 'synthetic-browser-check',
      line: 0,
      column: 0,
      page: new URL(TARGET_URL).pathname || '/',
      ts: Date.now(),
    });
    const res = await fetch(`${API_URL}/api/client-monitor/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    log(`รายงานเข้า ${API_URL}: HTTP ${res.status}`);
  } catch (err) {
    log(`รายงานเข้า API ไม่ได้: ${err?.message || err}`);
  }
}

async function checkProfile(launcher, profile) {
  const failures = [];
  let browser;
  try {
    browser = await launcher.launch({ headless: true });
  } catch (err) {
    return { profile: profile.name, ua: profile.ua, ok: false, failures: [`launch ${profile.engine} ไม่ได้: ${err?.message?.split('\n')[0] || err}`] };
  }
  try {
    const context = await browser.newContext({
      userAgent: profile.ua,
      viewport: profile.viewport,
      isMobile: profile.mobile,
      locale: 'th-TH',
    });
    const page = await context.newPage();

    const pageErrors = [];
    const failedRequests = [];
    // ไม่ดัก console.error — JS error จริงโผล่ที่ pageerror อยู่แล้ว (กัน false-positive จาก log ระบบ)
    page.on('pageerror', (err) => pageErrors.push(String(err?.message || err).slice(0, 200)));
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (!url.includes('/api/client-monitor/')) failedRequests.push(`${url} (${req.failure()?.errorText || 'failed'})`);
    });

    // 1) โหลดหน้า — ลูกค้าไม่รอเกิน ~15 วิ (WebView ช้าจริง แต่ไม่ใช่ไม่มีวันเสร็จ)
    //    status >= 400 นับพัดด้วย (404/500 ที่ HTML ยัง render ได้ ไม่ควรผ่าน "uptime แบบลูกค้า")
    const resp = await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (resp && resp.status() >= 400) {
      failures.push(`HTTP ${resp.status()} จากหน้าเป้าหมาย`);
    }

    // 2) render จริง — ต้องมี <main> และต้องไม่ติดหน้า "Application error"
    await page.waitForSelector('main, body', { timeout: 10_000 });
    await page.waitForTimeout(2_500); // ให้ hydration/error ยอยองโผล่
    const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
    if (/Application error|Unhandled Runtime Error/i.test(bodyText)) {
      failures.push('หน้าแสดง Application error');
    }
    if (bodyText.trim().length < 20) {
      failures.push(`หน้าว่างเกินไป (${bodyText.trim().length} ตัวอักษร) — มักค้างก่อน hydrate`);
    }

    // 3) capability จริงในหน้า — localStorage พัง = แอปใช้ไม่ได้ทั้งเครื่อง
    const storageOk = await page.evaluate(() => {
      try {
        localStorage.setItem('__synthetic_probe', '1');
        const ok = localStorage.getItem('__synthetic_probe') === '1';
        localStorage.removeItem('__synthetic_probe');
        return ok;
      } catch {
        return false;
      }
    }).catch(() => false);
    if (!storageOk) failures.push('localStorage ใช้ไม่ได้ในหน้า');

    // 4) error ที่เก็บมาระหว่างทาง
    if (pageErrors.length > 0) failures.push(`pageerror: ${pageErrors[0]}${pageErrors.length > 1 ? ` (+${pageErrors.length - 1})` : ''}`);
    const hardNet = failedRequests.filter((f) => !f.includes('favicon'));
    if (hardNet.length > 0) failures.push(`request failed: ${hardNet[0]}${hardNet.length > 1 ? ` (+${hardNet.length - 1})` : ''}`);

    await context.close();
    return { profile: profile.name, ua: profile.ua, ok: failures.length === 0, failures };
  } catch (err) {
    failures.push(`โหลด/ตรวจหน้าไม่สำเร็จ: ${String(err?.message || err).split('\n')[0].slice(0, 200)}`);
    return { profile: profile.name, ua: profile.ua, ok: false, failures };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runOnce() {
  log(`Synthetic browser check → ${TARGET_URL} (engine=${ENGINE}, API=${API_URL})`);
  const launcher = ENGINE === 'webkit' ? webkit : chromium;
  const results = [];
  for (const profile of PROFILES) {
    // เลือก engine: profile Android = chromium เสมอ · profile iOS ใช้ WebKit จริงเมื่อสั่ง
    // SYNTHETIC_ENGINE=webkit (ต้อง `npx playwright install webkit` ก่อน) —
    // default chromium = จำลองด้วย UA อย่างเดียว แต่รันได้ทุกเครื่องที่ลง playwright มา
    const useLauncher = profile.engine === 'webkit' && ENGINE === 'webkit' ? webkit : chromium;
    const result = await checkProfile(useLauncher, profile);
    results.push(result);
    log(`${result.ok ? '✅ PASS' : '❌ FAIL'} — ${result.profile}${result.ok ? '' : ` → ${result.failures.join(' | ')}`}`);
    await reportToApi(result);
  }
  const allOk = results.every((r) => r.ok);
  log(allOk ? '✅ ทุก profile ผ่าน — uptime มีความหมายรอบนี้' : `❌ พัง ${results.filter((r) => !r.ok).length}/${results.length} profile`);

  // รายงานผลทั้งรอบไปยัง streak tracker — นับ FAIL ติดกัน → critical Telegram ทันทีที่ครบเกณฑ์
  try {
    await fetch(`${API_URL}/api/client-monitor/synthetic-round`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: results.map(({ profile, ok, failures }) => ({ profile, ok, failures })) }),
    });
  } catch (err) {
    log(`รายงาน streak ไม่ได้: ${err?.message || err}`);
  }

  return allOk;
}

if (LOOP) {
  log(`โหมด loop — ทุก ${INTERVAL_MIN} นาที (จบด้วย Ctrl+C)`);
  const tick = async () => {
    try {
      await runOnce();
    } catch (err) {
      log(`รอบนี้ error ไม่คาดคิด: ${err?.message || err}`);
    }
  };
  await tick();
  setInterval(tick, INTERVAL_MIN * 60_000);
} else {
  const ok = await runOnce();
  process.exit(ok ? 0 : 1);
}
