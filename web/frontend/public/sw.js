/// Tier 2 #15 — Service worker for offline-capable app shell.
///
/// NOTE: this file is served as-is to browsers, so it MUST stay plain
/// JavaScript — no TypeScript annotations, interfaces, or `as` casts.
/// A single type annotation fails SW script evaluation and disables the
/// whole worker ("ServiceWorker script evaluation failed").
///
/// Strategy:
///  - App shell (index.html, JS chunks, CSS) is cached on first install
///    using a "cache first, falling back to network" strategy.
///  - API calls (/api/*) use a "network first, falling back to cache" strategy
///    so the UI can show stale data when offline, but always tries fresh data.
///  - All other requests go straight to the network.
///
/// Cache names: tg-drive-shell-v1 for static assets, tg-drive-api-v1 for API data.

const SHELL_CACHE = "tg-drive-shell-v1";
const API_CACHE = "tg-drive-api-v1";
const SHELL_URLS = [
  "/",
  "/index.html",
  // JS and CSS chunks are added dynamically below via the install step;
  // we also cache them on fetch so new deployments update the cache.
];

/// Install: precache the shell. We let the fetch handler add chunks as they
/// are requested so we don't need to enumerate every hashed filename in advance.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      // Prime the cache with the root HTML so the offline fallback works.
      return cache.add("/").catch(() => {});
    })
  );
  // Activate immediately so the new worker takes over without waiting.
  event.waitUntil(self.skipWaiting());
});

/// Activate: clean up old caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k.startsWith("tg-drive-") && k !== SHELL_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      );
    })
  );
  event.waitUntil(self.clients.claim());
});

/// Fetch handler: cache-first for shell, network-first for API, network for the rest.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (they can't be safely cached and replayed).
  if (request.method !== "GET") return;

  // Skip anything that isn't http(s) — e.g. chrome-extension:// or blob:
  // the Cache API rejects those schemes and throws.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // API calls: network first, fall back to stale cache.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // App shell: cache first, fall back to network.
  if (
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png")
  ) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Everything else (media, telegram CDN, shared links): network only.
  // These are large or time-sensitive and should not be cached by the SW.
});

/// Media endpoints must never be cached: bodies are huge (multi-GB downloads
/// would fill the cache quota) and partial (206) or failed mid-stream
/// responses make Cache.put() itself throw.
function isCacheableApi(url) {
  if (!url.pathname.startsWith("/api/")) return false;
  return !/\/(download|preview|stream|thumbnail|upload|share)\b/.test(url.pathname);
}

/// Cache-first strategy: return cached response if available, otherwise fetch
/// and cache the result.
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      // put() itself can throw (opaque/partial/interrupted bodies) — a
      // cache write must never break the response going to the page.
      try {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
      } catch {}
    }
    return response;
  } catch {
    // No cached version and network failed — return a minimal fallback for the shell.
    if (request.url.endsWith("/") || request.url.endsWith("/index.html")) {
      const fallback = await caches.match("/index.html");
      if (fallback) return fallback;
    }
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

/// Network-first strategy: try the network, fall back to cache on failure.
/// Media endpoints bypass the cache entirely (see isCacheableApi).
async function networkFirst(request, cacheName) {
  const url = new URL(request.url);
  if (!isCacheableApi(url)) {
    return fetch(request);
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      try {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
      } catch {}
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
