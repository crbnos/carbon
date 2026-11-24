---
paths: ["apps/erp/app/routes/api+/v1+/lib/base.server.ts", "apps/erp/app/routes/api+/mcp+/_index.ts", "apps/erp/test/mcp-tool-permissions.test.ts"]
triggers: ["scopesFromPermissions", "asSystem.pg"]
promoted: null
---
# RLS does not bound an MCP tool handed `db`; its declared permission is the only gate

**Context:** A 2026-10 security disclosure: an OAuth (MCP connector) token for a user with no accounting permission could create draft GL journals through `inventory_createInventoryReconciliationJournal`.

**Problem:** Two gaps stacked. The oRPC `gate()` skipped OAuth callers on the theory that RLS bounds them, but a service whose manifest asks for `db` gets `getDatabaseClient()`, the direct connection, which bypasses RLS. And a tool's default permission is its own module plus its verb's action, so the journal tool was gated on `inventory:create` while the Reconcile screen requires `accounting:create`. Supplier and customer bank accounts (`purchasing`/`sales` vs `accounting`) and return-order credits (`purchasing`/`sales` vs `invoicing`) had the same mismatch, for API keys as well.

**Rule:** Every non-session caller (API key AND OAuth) is gated per operation, OAuth on the user's live permissions in the token's company (`scopesFromPermissions`). When a tool does what an ERP route does, its permission must equal that route's `requirePermissions`: add `@mcp permission` where the default differs, regenerate, and pin it in `OVERRIDES` in `mcp-tool-permissions.test.ts`. Never reason "RLS will catch it" for a tool whose `contextParams` include `db`.

**Applies to:** `apps/erp/app/routes/api+/v1+/lib/base.server.ts`, `apps/erp/app/routes/api+/mcp+/_index.ts`, every `@mcp`-tagged service taking `db: Kysely<KyselyDatabase>`.
