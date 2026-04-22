const VERSION = "smdp-v2026-04-22";
const APP_SHELL_CACHE = `${VERSION}-app-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const DOCUMENT_CACHE = `${VERSION}-documents`;
const MAX_ASSET_ENTRIES = 64;
const MAX_DOCUMENT_ENTRIES = 48;
const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/apple-touch-icon.png",
  "/pwa-192.png",
  "/pwa-512.png",
  "/test.md",
];

function isCacheableResponse(response) {
  return response.ok || response.type === "opaque";
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  if (requests.length <= maxEntries) {
    return;
  }

  const extraEntries = requests.length - maxEntries;
  for (let index = 0; index < extraEntries; index += 1) {
    await cache.delete(requests[index]);
  }
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
        await trimCache(cacheName, maxEntries);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) {
    return networkResponse;
  }

  throw new Error("Unable to resolve cached asset");
}

async function networkFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
      await trimCache(cacheName, maxEntries);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

function isMarkdownRequest(url) {
  return /\.(md|markdown|mdown|mdx)$/i.test(url.pathname);
}

function isStaticAssetRequest(request, url) {
  if (url.origin !== self.location.origin) {
    return false;
  }

  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "worker" ||
    request.destination === "font" ||
    request.destination === "image"
  ) {
    return true;
  }

  if (url.pathname.startsWith("/assets/")) {
    return true;
  }

  return APP_SHELL_URLS.includes(url.pathname);
}

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      const cache = await caches.open(APP_SHELL_CACHE);
      await cache.put("/index.html", response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(APP_SHELL_CACHE);
    return (
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match("/index.html")) ||
      (await cache.match("/")) ||
      Response.error()
    );
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      await cache.addAll(APP_SHELL_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== APP_SHELL_CACHE &&
            cacheName !== ASSET_CACHE &&
            cacheName !== DOCUMENT_CACHE
          ) {
            return caches.delete(cacheName);
          }
          return Promise.resolve(false);
        }),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE, MAX_ASSET_ENTRIES));
    return;
  }

  if (isMarkdownRequest(url)) {
    event.respondWith(networkFirst(request, DOCUMENT_CACHE, MAX_DOCUMENT_ENTRIES));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE, MAX_ASSET_ENTRIES));
  }
});
