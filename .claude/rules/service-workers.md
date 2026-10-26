---
paths:
  - "apps/erp/public/service-worker.js"
  - "apps/mes/public/service-worker.js"
  - "apps/*/public/offline.html"
  - "apps/*/public/site.webmanifest"
  - "apps/erp/app/entry.client.tsx"
  - "apps/mes/app/entry.client.tsx"
  - "apps/erp/app/utils/service-worker.ts"
  - "apps/erp/app/utils/app-badge.ts"
  - "apps/erp/app/hooks/useAppBadge.ts"
  - "apps/erp/app/hooks/usePushSubscription.ts"
  - "packages/jobs/src/inngest/functions/notifications/send-push.ts"
---

# Service workers, the offline page, the app badge and installing

Each app has ONE worker, `public/service-worker.js`, at scope `/`: a browser keeps
one registration per scope, so anything a worker does (push, offline, caching) goes
into that file. Both `entry.client.tsx` files register it on every page load,
immediately when `document.readyState` is already `complete` (the dev server
imports the entry after `load`), else on `load`. Workers in `public/` are plain JS:
no Biome, no typecheck, no bundling. Check them with `node --check`.

## ERP (`apps/erp/public/service-worker.js`)

- Was `push-worker.js` until it took on the offline page. `SERVICE_WORKER_URL`
  (`apps/erp/app/utils/service-worker.ts`) is the one URL; `usePushSubscription`
  registers the same URL before subscribing. Registering a new script URL at the
  same scope keeps the registration and its push subscription.
- **Fetch:** page loads only (`mode === "navigate"`, GET). Navigation preload is on;
  the response passes through untouched, a server error page included. Only a
  network failure answers `offline.html` from `OFFLINE_CACHE`, else
  `fallbackOfflinePage()` (built in), never the browser's error. Assets, loader data
  and API calls never reach the worker: a failed client-side navigation shows React
  Router's own error, not the offline page.
- **Cache:** `offline.html` only. Saved at install (a failed save still installs, so
  push never depends on it) and re-saved by `ensureOfflinePage()` after any page load
  that reached the network.
- **Push:** `setBadge(payload.badge)`, then the notification (no `tag` passed to
  `showNotification`, see `.ai/lessons.md`), icon `/icon-192.png`; `notificationclick`
  focuses a controlled Carbon window and navigates it, else `clients.openWindow`;
  `pushsubscriptionchange` re-saves through `PUT /api/push-subscription`.

## MES (`apps/mes/public/service-worker.js`)

Same navigate/offline behaviour, plus `ASSET_CACHE`: `/assets/*` (content-hashed
build files) cache-first, trimmed to 400 entries; icons, logos and the manifest
stale-while-revalidate. Same-origin only, so a CDN asset base (`ASSETS_URL`) is
untouched. It never caches a page, loader data or a private file, so nothing
outlives a sign-out. `SHELL_CACHE` (the offline page) and `ASSET_CACHE` have their
own versions.

## offline.html

One page, copied into both apps' `public/`, kept identical. Self-contained (inline
CSS and script, nothing to fetch). It reloads on the `online` event and, every 10 s
while the device reports online, when `GET /health` answers 2xx: `online` never
fires when the Wi-Fi stayed up but Carbon was unreachable, and `/health` answers 503
while the database is down. It skips that check at its own address. The forklift
game opens only from **Play while you wait**.

**Every change to `offline.html` bumps both offline caches** (ERP `OFFLINE_CACHE`,
MES `SHELL_CACHE`): the worker saves the page only when it installs, and installs
only when its own file changes. `apps/{erp,mes}/app/utils/offline-page.test.ts` pin
the page's sha256 to the cache name, so a change without a bump fails.

## App icon badge

The installed app's icon shows the user's unread top-level notifications (no digest
children) across their EMPLOYEE companies, not just the current one.

- Open tab: `useAppBadge` (mounted by the desktop bell and the mobile dock, never
  both) counts on mount and again 500 ms after any change on the user's notification
  topic; `employeeCompanyIds` and `setAppBadge` live in `~/utils/app-badge.ts`.
- Closed app: `send-push` step `count-unread` counts the same set with the service
  role and sends `badge` in the payload (omitted when the read fails; the push
  still goes). The worker sets it.
- Sign-out: the login page clears it.
- Platform limits: macOS needs notification permission with "Badge app icon" for the
  app. Chrome on macOS drops the badge when the app's window closes, and a later push
  does not bring it back.

## Installing

`site.webmanifest` (ERP, MES): `id`, `start_url` and `scope` are `/` (Chrome's
address-bar install needs `start_url`; `id` keeps later manifest changes on the same
installed app). Icons: `icon-192.png` / `icon-512.png` (`any`, transparent: the
tab favicon's dark mark), `icon-maskable-512.png` (white, mark at 60 % for Android's
crop) and an opaque white `apple-touch-icon.png` (iOS fills transparency with black).
All are rendered from `carbon-favicon.svg`, and academy, starter and docs carry the
same files. A web app gets one icon: no manifest field switches it with light or dark
mode.
