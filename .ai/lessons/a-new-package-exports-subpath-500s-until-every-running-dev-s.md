---
paths: []
triggers: []
promoted: null
---
# A new package `exports` subpath 500s until every running dev server restarts

**Context:** Adding `@carbon/logger/context.server` and `@carbon/auth/request-scope` during the same perf work.

**Problem:** Vite resolves a package's `exports` map once at dev-server start. Adding a subpath and importing it immediately produced `"./context.server" is not exported under the conditions [...]` on every route — a hard 500 across the whole app, twice, each time looking like a code bug rather than a stale resolver. Typecheck was green throughout, since TypeScript reads the updated `package.json` directly.

**Rule:** Adding an export subpath to a workspace package is a dev-server-restart change. Either restart every running dev server as part of the change, or re-export the new module from an already-exported entry point and leave a TODO to move it at the next coordinated restart. A green typecheck does not mean the running server can resolve the import.

**Applies to:** `packages/*/package.json` `exports`, and any new `src/*.server.ts` intended for cross-package import.
