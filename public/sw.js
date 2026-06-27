/* The Forge — service worker
 * Cache-first for static assets, network-first for navigations (so auth
 * redirects are respected), offline shell fallback. API is never cached —
 * app.js already falls back to localStorage when offline.
 */
const CACHE = 'forge-v55';
const SHELL = '/index.html';
const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>The Forge</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#050509;color:#e5e7eb;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><h1 style="font-weight:800">Offline</h1><p style="color:#9ca3af">Reconnect, then reload.</p>' +
  '<button onclick="location.reload()" style="margin-top:12px;padding:10px 18px;border-radius:99px;border:1px solid #333;background:#111;color:#fff;font-weight:700">Reload</button></div>';
const shellFallback = () =>
  caches.match(SHELL).then((r) => r || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // network-only

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(SHELL, copy));
          }
          return res;
        })
        // Never respond with undefined (that renders a broken page) — fall back
        // to the cached shell, or a minimal offline page if nothing is cached.
        .catch(shellFallback)
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => hit);
        return hit || net;
      })
    )
  );
});

// ----- Web push -----
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || 'Forge';
  const opts = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'forge',
    data: { url: data.url || '/' },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) return w.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
