---
paths: []
triggers: []
promoted: null
---
# A notification click on an uncontrolled tab opens nothing

**Context:** `push-worker.js` handled `notificationclick` with `clients.matchAll({ type: "window", includeUncontrolled: true })`, then `focus()` and `navigate()` on the first Carbon tab (2026-10-09).

**Problem:** `WindowClient.navigate()` rejects for a tab the worker does not control: a tab opened before the worker was installed, or a hard-reloaded one. The rejection ended the click handler, so the click opened nothing. No error reached the page.

**Rule:** Call `matchAll({ type: "window" })` without `includeUncontrolled` when you will call `navigate()`. Focus first, because the click allows focus for a short time only. Wrap the focus and the navigation in `try`, and call `clients.openWindow()` when either fails or no tab exists.

**Applies to:** `apps/erp/public/service-worker.js` (was `push-worker.js`); any service worker that navigates a client.
