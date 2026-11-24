---
paths: ["apps/*/public/offline.html", "apps/*/public/service-worker.js"]
triggers: ["OFFLINE_CACHE", "SHELL_CACHE"]
promoted: null
---
# Changing a precached file without bumping the cache name changes nothing

**Context:** `offline.html` was edited several times (the game, the text wrapping), and each time existing browsers kept showing the old page (2026-10-22).

**Problem:** A worker saves the file only when it installs, and it reinstalls only when `service-worker.js` itself changes. Editing `offline.html` alone leaves every browser that already has the worker on the old copy, and the self-heal only fills a missing entry, it never replaces one.

**Rule:** Every change to `offline.html` bumps the offline cache in both workers (ERP `OFFLINE_CACHE`, MES `SHELL_CACHE`). `offline-page.test.ts` in each app pins the page's hash to the cache name, so a change that skips the bump fails.

**Applies to:** `apps/{erp,mes}/public/offline.html` and `service-worker.js`.
