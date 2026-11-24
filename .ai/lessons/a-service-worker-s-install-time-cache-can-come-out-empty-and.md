---
paths: []
triggers: []
promoted: null
---
# A service worker's install-time cache can come out empty and stay empty

**Context:** The ERP worker saves `offline.html` when it installs, and installs anyway when the save fails, so push never depends on it (2026-10-22).

**Problem:** A user toggled offline while an updated worker was installing. The save failed, the new worker activated and deleted the previous cache, and every later offline page load got the browser's "This site can't be reached": the worker had nothing to answer with, and it only reinstalls when its own file changes.

**Rule:** Never trust that install filled a cache. Re-check it from the fetch handler after a page load that reached the network (`ensureOfflinePage`), and give the worker a built-in last-resort response (`fallbackOfflinePage`) so a cache miss never surfaces as the browser's error.

**Applies to:** `apps/{erp,mes}/public/service-worker.js`; any worker that precaches on install.
