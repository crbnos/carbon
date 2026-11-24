---
paths: []
triggers: []
promoted: null
---
# A dynamic `.server` import fails the client build too

**Context:** The MES services that call the ERP (`operations.service.ts`, `inventory.service.ts`) are also imported by client components, for their client-safe functions. The signing helper they need uses `node:crypto`.

**Problem:** React Router's `react-router:dot-server` plugin checks every `resolveId` in the client build, static and dynamic. Moving a `.server` module behind `await import(…)` does not hide it. The production build still refuses it, and typecheck and the dev server do not show the error.

**Rule:** A helper that a client-graph module must load is not named `.server`. Give it a plain name (`@carbon/api/internal-call`). Load it lazily with `await import(…)` inside the server function, so the browser never evaluates it. Prove it with the production build of the app.

**Applies to:** `apps/mes/app/services/*.service.ts`, `apps/erp/app/modules/*/*.service.ts`, any package subpath they import.
