---
paths: ["apps/erp/public/service-worker.js"]
triggers: ["showNotification", "getNotifications"]
promoted: null
---
# macOS silently replaces a web notification that reuses a tag

**Context:** Browser push notifications (`apps/erp/public/push-worker.js`) passed each notification's `tag` (`job-assignment:<id>`, `carbon-test`) to `showNotification`, so a second push about the same thing would replace the first instead of stacking.

**Problem:** On macOS the browser hands the tag to the OS as the notification's identifier, and the OS replaces a notification with the same identifier silently: no banner, only an updated entry in Notification Center. The first test arrived while banners were still off, and every later test replaced it without a sound, so push looked broken although every send returned `201` (2026-10-08). `renotify: true` did not change it. The cause was only visible in the macOS log (`log show --predicate 'process == "usernoted"'`): `updatedExisting: true`.

**Rule:** Never pass a reused `tag` to `showNotification` when the user must see the repeat. Close the older notifications yourself (`registration.getNotifications()`, match on `notification.data.tag`), then show the new one with no `tag`, so it gets a fresh identifier. To debug a push that "does not arrive", read the send's status code first, then the OS notification log, before changing code.

**Applies to:** `apps/erp/public/service-worker.js` (was `push-worker.js`); any future service worker or Notification API caller.
