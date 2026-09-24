// Offline support: network-first for pages, cache-first for hashed assets.
// Every page on the site shares this worker (the game, the demos, Real Town Plans), so each page is
// cached under its own address: a page offline is the page last seen there, never another one.
const CACHE = 'tracks-v4';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// a page asks for its own files to be kept (its first visit loads before this worker runs)
self.addEventListener('message', (e) => {
  const urls = (e.data && Array.isArray(e.data.keep) ? e.data.keep : []).filter((u) => { try { return new URL(u).origin === self.location.origin; } catch { return false; } });
  if (urls.length) e.waitUntil(caches.open(CACHE).then((c) => Promise.all(urls.map((u) => c.match(u).then((hit) => hit || c.add(u).catch(() => {}))))));
});

// offline, and this page was never kept: say so, rather than showing a different page
const offlinePage = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Offline</title><body style="font:16px system-ui;background:#0f3322;color:#f2f5ef;padding:24px"><h1>You’re offline</h1><p>This page hasn’t been opened here before, so there’s no copy on this device. Connect and try again.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!sameOrigin && !isFont) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || offlinePage())),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
  );
});
