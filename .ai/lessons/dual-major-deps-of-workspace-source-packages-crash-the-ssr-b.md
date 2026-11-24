---
paths: ["apps/erp/vite.config.ts", "apps/mes/vite.config.ts", "packages/viewer/package.json"]
triggers: ["noExternal", "zustand", "@react-three/fiber"]
promoted: null
---
# Dual-major deps of workspace source packages crash the SSR bundle when the shared dep is externalized

**Context:** Merging assembly instructions (#1075) added `@carbon/viewer` (a source-only workspace package) with `@react-three/fiber@8`, whose ESM dist does `import create from 'zustand'` against its own nested zustand v3. The app + `@react-three/drei` use the catalog zustand v5, which removed the default export.

**Problem:** Production (app.carbon.ms) 500'd on every request while builds stayed green. Vite/rolldown inlines deps of linked workspace packages into the SSR bundle but externalizes packages resolvable from the app root **by package name**, merging fiber's v3 default import with v5 named imports into one `import ste,{create,...}from"zustand"` in `build/server/index.js`. Node resolves that to v5 at runtime → `SyntaxError: The requested module 'zustand' does not provide an export named 'default'` at `ModuleJob._instantiate` — before any code runs, so the error never reaches error reporting, dev SSR never reproduces it (per-importer resolution), and Vercel previews show READY (crash is invocation-time). The runtime log dumps a random window of the minified bundle (logtape's timezone formatter), which reads like an Intl/timezone error — red herring.

**Rule:** When a dep of a workspace source package pins a different major of a package the app also depends on, add that package to `ssr.noExternal` in the consuming apps' `vite.config.ts` so each importer keeps its own inlined copy. Verify with a build + `grep -E "from *[\"']zustand" build/server/**` (expect no bare imports) and `node --input-type=module -e "await import('.../build/server/index.js')"` — reaching an env-var error proves linking succeeded. For any all-requests-500 Vercel incident with a minified source dump, read the **last** lines for the real error and check `node:internal/modules/esm/module_job` in the stack before believing anything the dumped source suggests.

**Applies to:** `apps/erp/vite.config.ts`, `apps/mes/vite.config.ts` `ssr.noExternal`; any new dep of `@carbon/viewer` or other source-only workspace packages (`@carbon/form`, `@carbon/onboarding`, ...) that pins an older major of a shared package.
