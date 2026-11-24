---
paths: ["packages/database/src/strict-backflush.ts"]
triggers: ["@carbon/database/strict-backflush", "@carbon/database/rows", "inOrder(", "from \"kysely\""]
promoted: null
---
# A module the browser bundles must not reach the Kysely runtime, even through a helper

**Context:** Strict backflush (2026-10-16). `@carbon/database/strict-backflush` is imported by BoM UI components and by `settings.service.ts`, which the module barrel bundles for the browser.

**Problem:** Using `inOrder` from `@carbon/database/rows` there would have imported `kysely` at runtime into the client bundle; typecheck does not see it. Separately, `settings.server.ts` gained an import of `~/utils/query`, which imports the `@carbon/auth` barrel. That barrel runs a Lingui `msg` macro, which plain vitest cannot compile, so 2 unrelated test files stopped loading.

**Rule:** In a client-bundled module, import only types from `kysely` and `./client`. Run two awaits instead of `inOrder`. Raw `sql` belongs in a server-only file. Before adding an import to a file that tests import, check what that import's barrel pulls in, then run the module's tests.

**Applies to:** `@carbon/database` subpaths read by UI, `{module}.service.ts`, `{module}.server.ts` imported by vitest files.
