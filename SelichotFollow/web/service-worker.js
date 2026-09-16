const CACHE_VERSION = "selichot-follow-v1.6.0";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=1.6.0",
  "/app.js?v=1.6.0",
  "/tracking-core.mjs?v=1.6.0",
  "/speech-session.mjs?v=1.6.0",
  "/chant-reference.mjs?v=1.6.0",
  "/audio-references.json?v=1.6.0",
  "/service-text.json?v=1.6.0",
  "/manifest.webmanifest",
  "/assets/icon.svg",
  "/assets/icon-180.png",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "/index.html"));
    return;
  }

  if (url.hostname === "www.sefaria.org" && url.pathname.startsWith("/api/texts/")) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) return cache.match(fallbackUrl);
    return new Response(JSON.stringify({ offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || update;
}
