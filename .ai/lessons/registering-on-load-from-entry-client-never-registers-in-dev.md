---
paths: ["apps/*/app/entry.client.tsx"]
triggers: ["addEventListener(\"load\"", "serviceWorker.register"]
promoted: null
---
# Registering on `load` from entry.client never registers in dev

**Context:** The ERP and MES service workers were registered from `entry.client.tsx` with `window.addEventListener("load", register)`, the pattern most guides show (2026-10-22).

**Problem:** On the dev server React Router imports `entry.client` late: by the time the module runs, the page has already fired `load` (`document.readyState === "complete"`), so the listener never ran and no worker was registered. The offline page never appeared and nothing logged an error.

**Rule:** Register immediately when `document.readyState === "complete"`, and on `load` otherwise. Check `navigator.serviceWorker.getRegistrations()` in the browser after any change to how a worker is registered.

**Applies to:** `apps/erp/app/entry.client.tsx`, `apps/mes/app/entry.client.tsx`; any code in an entry module that waits for `load`.
