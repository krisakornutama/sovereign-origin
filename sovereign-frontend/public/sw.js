/*
 * Sovereign OS – Service Worker v2 (offline-first)
 * - install: precache app shell จาก public/sw-precache.json (สร้างตอน build)
 * - static bundle (_next/static/*): cache-first -> เปิด offline ได้ทันที
 * - navigation: network-first -> cache -> หน้า offline
 */
const VERSION = 'sovereign-v2';

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

/** ดึง precache manifest แล้ว addAll ลง cache (ไม่บล็อก install ถ้า offline) */
async function precacheFromManifest() {
  try {
    const cache = await caches.open(VERSION);
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
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
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
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(VERSION).then((c) => c.put(request, copy));
      }
      return response;
    })
    .catch(() => cached);
  return cached || fetched;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // cache เฉพาะ same-origin — ไม่ยุ่งกับ API/Ollama ข้าม origin
  if (url.origin !== location.origin) return;

  // หน้าเว็บ: network-first -> cache -> หน้า offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = (await caches.match(request)) || (await caches.match('/'));
          return cached || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        })
    );
    return;
  }

  // app shell / assets: cache-first (offline เปิดได้ทันที)
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/sw-precache.json'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // อื่นๆ (same-origin): stale-while-revalidate
  event.respondWith(cacheFirst(request));
});
