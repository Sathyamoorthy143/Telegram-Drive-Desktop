// tg-drive service worker v2.
// v1 caused "MIME type text/html" module errors: it served stale/poisoned
// cache entries for hashed JS chunks and cached error pages under asset URLs.
// v2 rules:
// - navigations (index.html): NETWORK FIRST so a new deploy is picked up
//   immediately; cache is only a fallback when offline.
// - versioned assets (/assets/*, logo, manifest): cache-first, and ONLY
//   successful same-origin responses are stored (never error pages).
// - everything else (api, share links, extensions): never intercepted.
const CACHE = 'tg-drive-v2';
const SHELL = ['/logo.svg', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(url, res) {
  return (
    res &&
    res.ok &&
    res.type === 'basic' &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname === '/logo.svg' ||
      url.pathname === '/manifest.json' ||
      url.pathname === '/index.html' ||
      url.pathname === '/')
  );
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Never touch extension schemes, API calls, or public share links.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/s/')) return;

  const isNavigation =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    // Network-first: a fresh index.html always references existing chunks.
    e.respondWith(
      fetch(req)
        .then(res => {
          if (isCacheable(url, res)) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(r => r || caches.match('/index.html'))
        )
    );
    return;
  }

  // Static assets: cache-first, but only store good responses.
  e.respondWith(
    caches.match(req).then(
      hit =>
        hit ||
        fetch(req).then(res => {
          if (isCacheable(url, res)) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
