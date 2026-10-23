// Minimal service worker: exists mainly so Chrome/Android treat the app as
// installable (that requires a registered SW with a fetch handler, on top of
// the manifest). Also gives the app shell basic offline reach, matching the
// app's own local-first design (see CLAUDE.md) — but network-first, so
// online use never risks serving stale JS/CSS behind the ?v= cache-busting
// already used on every import; cache is only a fallback when offline.
// Adds OneSignal's push/notificationclick listeners on top of the caching
// logic below (see push.js) — this stays the one SW file so installability
// and offline caching aren't disturbed. Wrapped in try/catch: importScripts
// throws synchronously on any fetch failure (OneSignal's CDN has been seen
// to 503), and an uncaught throw here fails evaluation of this ENTIRE
// script — meaning the browser can't install this SW to replace whatever
// stale one is currently active, leaving the app stuck on old cached JS/CSS
// indefinitely. Push notifications breaking is fine to fail silently; the
// app shell's own installability/caching below must not depend on it.
try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
} catch (err) {
  console.error('[sw] OneSignal SDK failed to load; push notifications disabled for this SW lifecycle', err);
}

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
