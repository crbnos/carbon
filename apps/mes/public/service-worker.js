// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// MES on shop-floor tablets: build files come from the cache, and a page load
// with no network shows offline.html instead of the browser's error page.
// Only public, same-origin static files are cached — never a page, loader
// data or a private file, so nothing here outlives a sign-out.

// offline.html is saved only when this worker installs, and it installs only
// when this file changes: bump SHELL_CACHE whenever offline.html changes, or
// browsers keep the old page. The asset cache has its own version: build files
// are named by their content, so an offline.html change keeps them.
const SHELL_CACHE = "mes-shell-v5";
const ASSET_CACHE = "mes-assets-v1";
const OFFLINE_URL = "/offline.html";

// Hashed build files pile up across deploys under new names; the oldest go.
const MAX_ASSET_ENTRIES = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      } catch {
        // Install anyway: the next page load that reaches the network saves
        // it (ensureOfflinePage); until then fallbackOfflinePage stands in.
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      // Starts the page request while this worker boots.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

// Vite names every build file by its content hash, so a URL never changes
// meaning: served from the cache with no network check.
function isHashedAsset(url) {
  return url.pathname.startsWith("/assets/");
}

// Public files with a fixed name (icons, logos): served from the cache and
// refreshed behind it, so a changed icon shows on the next load.
function isPublicFile(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    /^\/(carbon-[\w-]+|apple-touch-icon|icon(-maskable)?-\d+)\.(png|svg)$/.test(url.pathname) ||
    url.pathname === "/site.webmanifest"
  );
}

async function trimAssets(cache) {
  const keys = await cache.keys();
  // keys() is in insertion order: the first are the oldest.
  for (const request of keys.slice(0, keys.length - MAX_ASSET_ENTRIES)) {
    await cache.delete(request);
  }
}

// The cache only ever speeds a response up: a cache that cannot be opened,
// or a write that fails (storage full, or a 206 partial response, which
// cache.put refuses), still serves the file from the network.
async function openAssetCache() {
  try {
    return await caches.open(ASSET_CACHE);
  } catch {
    return null;
  }
}

// Saves a complete response in the background; the response itself is
// returned without waiting for the write.
function saveAsset(event, cache, response, { trim = false } = {}) {
  if (!cache || response.status !== 200) return;
  event.waitUntil(
    cache
      .put(event.request, response.clone())
      .then(() => (trim ? trimAssets(cache) : undefined))
      .catch((error) => {
        console.warn("Failed to cache asset", {
          path: new URL(event.request.url).pathname,
          error
        });
      })
  );
}

async function cacheFirst(event) {
  const cache = await openAssetCache();
  const cached = await cache?.match(event.request).catch(() => undefined);
  if (cached) return cached;
  const response = await fetch(event.request);
  saveAsset(event, cache, response, { trim: true });
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await openAssetCache();
  const cached = await cache?.match(event.request).catch(() => undefined);
  const refresh = fetch(event.request).then((response) => {
    saveAsset(event, cache, response);
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}

async function navigate(event) {
  try {
    const response =
      (await event.preloadResponse) ?? (await fetch(event.request));
    // Online: make sure the offline page is there for next time.
    event.waitUntil(ensureOfflinePage());
    return response;
  } catch {
    // Only a network failure lands here; a server error page is a response
    // and is shown as the server sent it.
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    return offline ?? fallbackOfflinePage();
  }
}

// Saves offline.html when it is missing. Install saves it, but a save that
// fails there (the network dropped mid-install) would otherwise leave no
// offline page until the next worker update; every page load that reaches
// the network fills the gap.
async function ensureOfflinePage() {
  try {
    const cache = await caches.open(SHELL_CACHE);
    if (await cache.match(OFFLINE_URL)) return;
    await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
  } catch {
    // Still offline, or the file is missing: the next page load tries again.
  }
}

// The last resort when offline.html was never saved: a plain page, never the
// browser's "This site can't be reached".
function fallbackOfflinePage() {
  const html =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline | Carbon</title>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;text-align:center">' +
    "<main><h1 style=\"font-size:1.25rem\">You're offline</h1><p>Carbon reloads the page when the connection is back.</p></main>" +
    '<script>addEventListener("online",()=>location.reload());setInterval(()=>navigator.onLine&&fetch("/health",{cache:"no-store"}).then(r=>r.ok&&location.reload(),()=>{}),10000)</script>';
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Supabase, analytics, and a CDN asset base (ASSETS_URL) go straight out.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(event));
  } else if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(event));
  } else if (isPublicFile(url)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
