// App-shell service worker: lets MyMusic open offline. Song audio is stored in IndexedDB by the app itself.
const VERSION = "v2";
const SHELL = `mymusic-shell-${VERSION}`;
const IMAGES = "mymusic-images"; // also written by src/services/offline.ts when a song is downloaded
const FONTS = "mymusic-fonts";
const MAX_IMAGES = 400;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(["/", "/favicon.svg", "/manifest.webmanifest"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith("mymusic-shell-") && key !== SHELL).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map(key => cache.delete(key)));
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    if (cacheName === IMAGES) void trim(IMAGES, MAX_IMAGES);
  }
  return response;
}

// Pages: network first so deploys show up, falling back to the cached shell (it's a single-page app).
async function navigate(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(SHELL)).put("/", response.clone());
    return response;
  } catch {
    return (await caches.match("/")) ?? Response.error();
  }
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") return event.respondWith(navigate(request));
  // Live APIs (e.g. Jam rooms) must never be served from cache.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;
  // Built assets are content-hashed, so a cached copy is always correct.
  if (url.origin === self.location.origin) return event.respondWith(cacheFirst(request, SHELL));
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return event.respondWith(cacheFirst(request, FONTS));
  if (request.destination === "image") return event.respondWith(cacheFirst(request, IMAGES).catch(() => Response.error()));
  // API calls and audio streams go straight to the network.
});
