/* Service worker minimal : rend la PWA installable et l'ouvre instantanément
   même sans réseau (les POST vers Apps Script ne sont jamais interceptés). */
const CACHE = 'expenses-v7';
const ASSETS = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Stale-while-revalidate : réponse cache immédiate (ouverture instantanée
   hors-ligne), rafraîchissement en arrière-plan → la prochaine ouverture a la
   nouvelle version sans bump manuel de CACHE. */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const cached = await c.match(e.request);
      const refresh = fetch(e.request).then((res) => {
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || refresh;
    })
  );
});
