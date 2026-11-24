---
paths: ["packages/dev/vite.js", "apps/*/vite.config.ts"]
triggers: ["linguiWithoutIdQuery", "basename(id)"]
promoted: null
---
# A Vite plugin that reads the file name must drop the query first

**Context:** Lingui 6.9.0's native macro transform chooses its parser from `path.basename(id)`.

**Problem:** React Router loads route modules as `route.tsx?__react-router-build-client-route`. The extension no longer ends the name, the file is parsed as plain JS, and the build fails with hundreds of "Expected ','" errors on `import type`. vitest and non-route files never show it.

**Rule:** When a transform plugin misbehaves only on route modules, look at the id's query. Verify a build-plugin change with a real `react-router build` of ERP, not with vitest.

**Applies to:** `packages/dev/vite.js` (`linguiWithoutIdQuery`), `apps/*/vite.config.ts`.
