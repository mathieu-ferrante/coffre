// Service worker : met l'app en cache pour qu'elle s'ouvre sans réseau.
// Ne touche jamais aux requêtes vers Dropbox (elles passent directement).
const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = 'coffre-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('coffre-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Navigation (y compris le retour de Dropbox avec ?code=…) : on sert index.html.
      if (req.mode === 'navigate') {
        const page = await cache.match('./');
        if (page) return page;
        return fetch(req);
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit || fetch(req);
    })(),
  );
});
