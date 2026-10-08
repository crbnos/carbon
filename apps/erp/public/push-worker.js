// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Web Push for Carbon: shows the notification, opens its link on click, and
// re-registers a subscription the browser rotated. No fetch handler — this
// worker caches nothing.

// Nothing is cached, so a new version can take over at once instead of
// waiting for every Carbon tab to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

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
        icon: "/carbon-mark-dark.png",
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
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });
      const target = new URL(url, self.location.origin);
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target.href);
          return;
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
