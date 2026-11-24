---
paths: []
triggers: []
promoted: null
---
# A `.client.ts` module is empty on the server, even for a value a route only calls at load

**Context:** The invalidation middleware factory lived in `invalidate.client.ts`, next to `flash.client.ts`. `root.tsx` calls `createInvalidationMiddleware(...)` while the module is evaluated.

**Problem:** React Router replaces a `.client` module's exports with `undefined` on the server. `flash.client.ts` survives because `root.tsx` only REFERENCES its export; a factory is CALLED, so SSR died with "is not a function". Typecheck, lint and unit tests passed.

**Rule:** A module whose export is called at module load of a route must not be named `.client` or `.server`. After adding anything to `root.tsx` or a shell layout, load the page from a running dev server before calling it done.

**Applies to:** `apps/*/app/root.tsx`, `packages/query/src/invalidation.ts`, any shared module imported by a route.
