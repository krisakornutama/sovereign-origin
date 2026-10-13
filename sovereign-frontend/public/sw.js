/*
 * Sovereign OS – Service Worker v2 (offline-first)
 * - install: precache app shell จาก public/sw-precache.json (สร้างตอน build)
 * - static bundle (_next/static/*): cache-first -> เปิด offline ได้ทันที
 * - navigation: network-first -> cache -> หน้า offline
 */
// P16 (30/9/69): bump เป็น v4 — เดิม VERSION คงที่ข้าม build ทำให้ client เก่า (รวม PWA มือถือ)
// ไม่เคยรับ shell ใหม่เลยหลัง deploy (เห็นหน้าเก่าต่อได้เป็นสัปดาห์) — หลังนี้ bump ทุกครั้งที่ deploy เปลี่ยน UI
// P16 ต่อ (30/9/69 ค่ำ): bump เป็น v5 — **ห้าม cache /api/** (เดิม cache-first ครอบ GET same-origin ทุกเส้น
// ทำให้ /api/partners ถูก cache ค่าว่างไว้แล้วตอบจาก cache ตลอด = ข้อมูลสดค้างเก่าเสมอ)
const VERSION = 'sovereign-v13';

// หน้า local-first — เปิดใช้งานได้จริงแม้ออฟไลน์ (ทำแบบทดสอบ MBTI / ดู shell แดชบอร์ด)
// ข้อมูล API ไม่ mock — หน้าจะแสดงสถานะ offline ของตัวเองตามที่แอปจัดไว้
const OFFLINE_PAGES = ['/dashboard', '/mbti', '/'];

const OFFLINE_HTML = `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sovereign OS — Offline</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#030712;color:#e5e7eb;font-family:monospace;text-align:center;padding:24px}
  .card{background:#111827;border:1px solid #374151;border-radius:16px;padding:32px;max-width:420px}
  h1{color:#34d399;font-size:22px;margin:0 0 12px}
  p{color:#9ca3af;font-size:14px;line-height:1.6;margin:0}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#f59e0b;margin-right:8px;animation:pulse 1.2s infinite}
  @keyframes pulse{50%{opacity:.3}}
</style></head>
<body><div class="card">
  <div style="margin-bottom:16px"><span class="dot"></span>ออฟไลน์</div>
  <h1>📡 Sovereign OS</h1>
  <p>คุณไม่ได้เชื่อมต่ออินเทอร์เน็ต<br>เปิด WiFi/เน็ต แล้วกดโหลดใหม่ (refresh)</p>
</div></body></html>`;

/**
 * เวอร์ชัน manifest จาก network เท่านั้น (ห้ามผ่าน cache — เคยเป็นบั๊ก: sw-precache.json ถูก
 * cache-first ตัวเอง แม้ caller สั่ง cache:'no-store' ก็ยังโดนตัว SW ดักไว้
 * → ได้ manifest เก่า → precache ของเก่าซ้ำ → ลูกเห็น UI เก่าได้เป็นสัปดาห์)
 */
async function manifestVersion() {
  try {
    const res = await fetch('/sw-precache.json?ts=' + Date.now(), { cache: 'reload' });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.version ? String(j.version) : null;
  } catch {
    return null;
  }
}

/** ชื่อ cache ปัจจุบัน = VERSION + เวอร์ชัน manifest → "build ใหม่ = กลุ่ม cache ใหม่" อัตโนมัติ */
async function activeCacheName() {
  if (!ACTIVE_VERSION) ACTIVE_VERSION = (await manifestVersion()) || '0';
  return VERSION + '-' + ACTIVE_VERSION;
}

let ACTIVE_VERSION = null;

/** ล้างทุกกลุ่ม cache ที่ไม่ใช่ชุดปัจจุบัน (เรียกตอนพบว่า build เปลี่ยน) */
async function purgeStaleCaches() {
  const cur = await activeCacheName();
  const keys = await caches.keys();
  const stale = keys.filter((k) => k !== cur);
  await Promise.all(stale.map((k) => caches.delete(k)));
  return cur;
}

/** ดึง precache manifest แล้ว addAll ลง cache (ไม่บล็อก install ถ้า offline) */
async function precacheFromManifest() {
  try {
    const cache = await caches.open(await activeCacheName());
    const res = await fetch('/sw-precache.json', { cache: 'no-store' });
    if (!res.ok) return 0;
    const manifest = await res.json();
    const entries = Array.isArray(manifest.urls) ? manifest.urls : [];
    await Promise.allSettled(entries.map((u) => cache.add(u)));
    return entries.length;
  } catch {
    return 0;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheFromManifest()
      .then((n) => console.log(`[SW] precached ${n} assets`))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cur = await activeCacheName();
      const keys = await caches.keys();
      const stale = keys.filter((k) => k !== cur);
      await Promise.all(stale.map((k) => caches.delete(k)));
      await precacheFromManifest();
      await self.clients.claim();
      // ถ้ามีของค้างจาก build เก่า → สั่งหน้าต่างให้โหลดใหม่ (ได้ bundle ชุดใหม่ทันที)
      // ไม่ทำตอนไม่มี stale → ไม่เกิด reload loop
      if (stale.length) {
        const list = await self.clients.matchAll({ type: 'window' });
        for (const c of list) { try { c.navigate(c.url); } catch (_) { /* ignore */ } }
      }
    })()
  );
});

// รองรับปุ่ม "ตรวจสอบอัปเดต" ในหน้า Settings
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/** cache-first + เติม cache ล่าสุดจาก network (stale-while-revalidate) */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  const fetched = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        const copy = response.clone();
        (await caches.open(await activeCacheName())).put(request, copy);
      }
      return response;
    })
    .catch(() => cached);
  return cached || fetched;
}

/** network-first (manifest ต้องสดเสมอ) — cache เป็นแค่ทางเลือกสำรอง */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const copy = response.clone();
      (await caches.open(await activeCacheName())).put(request, copy);
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // cache เฉพาะ same-origin — ไม่ยุ่งกับ API/Ollama ข้าม origin
  if (url.origin !== location.origin) return;

  // P16: **API ห้าม cache เด็ดขาด** — ข้อมูลสด (ร้าน/คู่ค้า/ตามรอย) ต้องมาจากเครือข่ายเสมอ
  // (บั๊กจริง 30/9/69: cache-first ครอบ /api/partners ค่าว่างไว้ = แผนที่ว่างตลอดบนเครื่องที่เคยเข้าก่อนมีข้อมูล)
  if (url.pathname.startsWith('/api/')) return;

  // หน้าเว็บ: network-first -> cache -> หน้า offline
  // ก่อนเสิร์ฟทุกครั้ง: เช็คว่า build เปลี่ยนหรือยัง — ถ้าเปลี่ยนให้ล้าง cache เก่าทิ้งก่อน
  // (13/10/69: sw.js เป็นไฟล์เดิมไม่เปลี่ยน เบราว์เซอร์จึงไม่ติดตั้งใหม่ แต่ manifest เปลี่ยนทุก build
  //  → ถ้าไม่มีด่านนี้ client จะยังได้ bundle ของ build เก่าไปเรื่อย ๆ = "แก้แล้วแต่ยังเห็นของเก่า")
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        await purgeStaleCaches();
        try {
          const response = await fetch(request);
          const copy = response.clone();
          (await caches.open(await activeCacheName())).put(request, copy);
          return response;
        } catch {
          // D3: เจอ cache ตรงก่อน → เผื่อ query ต่าง → หน้า local-first → หน้า offline
          const cached = (await caches.match(request))
            || (await caches.match(request, { ignoreSearch: true }));
          if (cached) return cached;
          for (const p of OFFLINE_PAGES) {
            const page = await caches.match(p, { ignoreSearch: true });
            if (page) return page;
          }
          return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      })()
    );
    return;
  }

  // manifest ของ SW ต้องสดเสมอ (13/10/69) — เคยเป็น cache-first → SW ดึง manifest เก่า
  // → precache ของเก่า → UI เก่าได้เป็นสัปดาห์
  if (url.pathname === '/sw-precache.json') {
    event.respondWith(networkFirst(request));
    return;
  }

  // app shell / assets: cache-first (offline เปิดได้ทันที)
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/icon.svg'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // อื่นๆ (same-origin): stale-while-revalidate
  event.respondWith(cacheFirst(request));
});
