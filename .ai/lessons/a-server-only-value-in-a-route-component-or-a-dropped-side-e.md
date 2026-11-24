---
paths: []
triggers: []
promoted: null
---
# A server-only value in a route component, or a dropped side-effect import, fails only the production build

**Context:** The service-function migration (2026-10-16) made every `<module>.service.ts` server-only: it may import server-only packages (`@carbon/auth/auth.server`, `@carbon/ee/*.server`, `@carbon/jobs`).

**Problem:** Two mistakes passed typecheck, the tests and the dev server, and broke only `react-router build`:

1. A route component used a value from a `.service.ts` (`LOCK_PERIOD_TASK_NAME` in a close-period component). React Router strips a route's loader and action from the client build, not its component, so the service file and its server-only imports entered the browser graph and the build failed.
2. A bare side-effect import (`import "./modules/carbon.server"`, `import "./zod.client"`) in a package whose `package.json` sets `"sideEffects": false`, or does not list the file. The production bundler dropped the import, so every `carbon()` call threw in production and `z.config({ jitless: true })` never ran. The dev server does not tree-shake, so nothing showed it locally.

**Rule:** A value the browser uses goes in `<module>.utils.ts` (or `models.ts` / `types.ts`), never in `.service.ts` or `.server.ts`. A file imported only for its side effects is listed in its package's `sideEffects` array. The `no-server-code-in-client` check (ERP components, hooks, `ui/`, client-safe module files and the browser half of routes) and the `side-effect-import-declared` check enforce both. Run `pnpm --filter erp build` before you call a change to imports or module files done.

**Applies to:** ERP and MES modules and routes; every `package.json` that sets `sideEffects`.
