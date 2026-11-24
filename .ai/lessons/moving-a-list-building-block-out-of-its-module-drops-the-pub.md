---
paths: []
triggers: []
promoted: null
---
# Moving a list building block out of its module drops the published tool's filters

**Context:** A review asked to move the customer portal reads from `shared.service.ts` to
`sales.service.ts`. `shared_getCustomerPortals` (in `shared.server.ts`) calls the list read.

**Problem:** The MCP generator gives a published list tool its `filters` and `sorts` inputs
only when its `run` calls `service.<name>(…)` and `<name>` calls `setGenericQueryFilters` in
the same module's `.service.ts` (`appliesGenericFilters`, `scripts/lib/input-docs.ts`). After
the move the tool silently lost both inputs. Typecheck and tests stayed green; only the
`schema` hash in `tool-manifest.digest.json` changed.

**Rule:** A list building block stays in the `.service.ts` of the module whose `.server.ts`
publishes it. After moving any building block, check `git diff` on
`tool-manifest.digest.json`: a changed `schema` hash is a changed public contract, so
regenerate (`pnpm generate:mcp`) and diff the tool's entry in `tool-metadata.json`.

**Applies to:** any building block a `defineServiceFn` with `@mcp` calls, `scripts/lib/input-docs.ts`.
