// Minimal service worker: exists mainly so Chrome/Android treat the app as
// installable (that requires a registered SW with a fetch handler, on top of
// the manifest). Also gives the app shell basic offline reach, matching the
// app's own local-first design (see CLAUDE.md) — but network-first, so
// online use never risks serving stale JS/CSS behind the ?v= cache-busting
// already used on every import; cache is only a fallback when offline.
const CACHE = 'dietz-shell-v1';
const SHELL = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never cache cross-origin (Apps Script/Notion) calls

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
