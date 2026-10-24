// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Carbon's one service worker (scope "/"; a scope holds one worker). Every
// page load registers it (entry.client.tsx), push or not. It shows a page
// that cannot load for want of a network as offline.html, and for Web Push
// it shows the notification, sets the installed app's icon badge, opens its
// link on click, and re-registers a subscription the browser rotated.
// Nothing but offline.html is cached: never a page or its data. It was
// /push-worker.js until it took on the offline page (utils/service-worker.ts).

// offline.html is saved only when this worker installs, and it installs only
// when this file changes: bump the version whenever offline.html changes, or
// browsers keep the old page.
const OFFLINE_CACHE = "erp-offline-v5";
const OFFLINE_URL = "/offline.html";

// Only offline.html is cached, so a new version can take over at once instead
// of waiting for every Carbon tab to close.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(OFFLINE_CACHE);
        await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      } catch {
        // No offline page is no reason to lose push: install anyway. The
        // next page load that reaches the network saves it
        // (ensureOfflinePage); until then fallbackOfflinePage stands in.
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("erp-offline-") && name !== OFFLINE_CACHE) {
          await caches.delete(name);
        }
      }
      // Starts the page request while this worker boots, so going through the
      // worker costs a navigation nothing.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

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
    const offline = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
    return offline ?? fallbackOfflinePage();
  }
}

// Saves offline.html when it is missing. Install saves it, but a save that
// fails there (the network dropped mid-install) would otherwise leave no
// offline page until the next worker update; every page load that reaches
// the network fills the gap.
async function ensureOfflinePage() {
  try {
    const cache = await caches.open(OFFLINE_CACHE);
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

// Page loads only. Everything else — assets, loader data, API calls — goes to
// the network untouched: React Router shows its own error for a failed
// client-side navigation.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET") {
    return;
  }
  event.respondWith(navigate(event));
});

async function setBadge(count) {
  if (typeof count !== "number" || !("setAppBadge" in self.navigator)) return;
  try {
    if (count > 0) await self.navigator.setAppBadge(count);
    else await self.navigator.clearAppBadge();
  } catch {
    // Refused (Safari without notification permission): no badge is fine.
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Carbon";
  event.waitUntil(
    (async () => {
      // The unread count send-push read for this user. Only an installed app
      // shows a badge; elsewhere the call is missing or does nothing.
      await setBadge(payload.badge);
      // The browser hands `tag` to the OS as the notification's identifier,
      // and macOS replaces a notification with the same identifier silently —
      // no banner, `renotify` notwithstanding. So the tag never reaches
      // showNotification: older notifications about the same thing are
      // closed here, and the new one gets a fresh identifier and alerts.
      if (payload.tag) {
        const shown = await self.registration.getNotifications();
        for (const notification of shown) {
          if (notification.data?.tag === payload.tag) notification.close();
        }
      }
      await self.registration.showNotification(title, {
        body: payload.body || "",
        icon: "/icon-192.png",
        data: { url: payload.url || "/", tag: payload.tag }
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      // Only tabs this worker controls: navigate() rejects for any other (one
      // opened before the worker was installed, or hard-reloaded), and the
      // rejection would end the click with nothing opened.
      const windows = await self.clients.matchAll({ type: "window" });
      const target = new URL(url, self.location.origin);
      const tab = windows.find(
        (client) => new URL(client.url).origin === target.origin
      );
      if (tab) {
        try {
          // Focus first: the click allows focusing a window only briefly.
          await tab.focus();
          await tab.navigate(target.href);
          return;
        } catch {
          // fall through to a new window
        }
      }
      await self.clients.openWindow(target.href);
    })()
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      // Both subscriptions are nullable (Push API): Chromium can hand over a
      // usable newSubscription with no oldSubscription. Save whatever
      // replacement exists; subscribe only when there is none and the old
      // key is known.
      const old = event.oldSubscription;
      const key = old?.options?.applicationServerKey;
      const next =
        event.newSubscription ||
        (await self.registration.pushManager.getSubscription()) ||
        (key
          ? await self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: key
            })
          : null);
      if (!next) return;
      await fetch("/api/push-subscription", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...next.toJSON(),
          ...(old ? { oldEndpoint: old.endpoint } : {})
        })
      });
    })()
  );
});
