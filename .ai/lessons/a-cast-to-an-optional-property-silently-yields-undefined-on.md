---
paths: []
triggers: []
promoted: null
---
# A cast to an OPTIONAL property silently yields `undefined` on a type that lacks it

**Context:** `JobMaterialsTable` renders an "↩ substituted from X" indicator for supersession-swapped job materials, reading the field as `(row.original as { substitutedFromItemId?: string | null }).substitutedFromItemId`. The row type comes from the `get_job_quantity_on_hand` RPC, whose `RETURNS TABLE` never included that column.

**Problem:** Asserting an OPTIONAL property onto a type that does not have it is legal TypeScript and raises nothing — the expression just evaluates to `undefined` on every row, so `{substitutedFrom && ...}` never rendered. The feature wrote correct provenance data to the database for its entire life and displayed it zero times. Had the property been declared non-optional, or read without the cast, it would have been a compile error the day it was written.

**Rule:** Treat `as { someField?: T }` on a row/DTO type as a smell, not a convenience — it is indistinguishable from a field that does not exist. When a UI needs a column its loader does not return, widen the RPC/view and regenerate types so the compiler enforces the contract. More generally: a field written to the DB but rendered nowhere has no feedback loop — `jobMaterial.itemScrapPercentage` was wrong in three code paths for the same reason.

**Applies to:** `apps/erp/app/**` table cells reading loader rows; any `as { x?: T }` over a generated DB/RPC type.

---

**Context:** Ramp integration live verification kept failing at every DB touch of the chart of accounts — post-charge 500'd, pushChartOfAccounts pushed 0, every coded card charge failed "Failed to verify accounts" (2026-08-28).

**Problem:** The `account` (chart of accounts) table is scoped by **`companyGroupId`, not `companyId`** — it has **no `companyId` column** and its PK is `id` alone (globally unique). Four separate sites wrote `.from("account")…​.eq("companyId", companyId)`, which PostgREST rejects ("column companyId does not exist"). Each caller either 500'd or swallowed the error and behaved as if zero accounts existed. The bug was invisible to unit tests (they mock the data, never hit the query) and recurred because a well-meaning "add companyId scoping everywhere" self-review pass applied the standard multi-tenant pattern to a table that breaks it. Same class as `item` (single-column PK, globally unique).

**Rule:** Before scoping any query by `companyId`, confirm the table HAS a `companyId` column. Group-shared config tables — `account` (chart of accounts), and check others — are scoped by `companyGroupId`; resolve it from `company.companyGroupId` (or `ctx.companyGroupId`) and filter by that, or by `id` alone when the ids already come from this company's own rows. `account.id` is globally unique, so an `.in("id", ids)` lookup is correct and tenant-safe on its own.

**Applies to:** any `.from("account")` in services/edge-functions/jobs; the general check "does this table actually have companyId?" before applying the multi-tenant scoping pattern (mirror of the `item` single-column-PK lesson).

---

**Context:** ramp-sync's card family silently created 0 transactions every run; the error "Cannot use a pool after calling end on the pool" was swallowed by family-failure isolation (2026-08-28).

**Problem:** `getJobDatabaseClient(size)` (packages/jobs/src/db.ts) caches a Kysely client over the shared pool from `getPostgresConnectionPool(size)`. Three accounting sweeps (`accounting-outbound-sweep` cron 15,45, `-consolidation`, `-reconciliation`) call `getPostgresConnectionPool(5)` and `pool.end()` it in a `finally`. `getPostgresConnectionPool` evicts an ended pool for ITS callers, but `getJobDatabaseClient` kept a SEPARATE client cache still wrapping the dead pool — so after any sweep ran, every later `getJobDatabaseClient(5)` job broke until process restart.

**Rule:** A cached client over a shared, end-able pool must detect the ended pool and rebuild — cache the pool alongside the client and check `pool.ending` (node-postgres) before returning the cached client. More generally, never `pool.end()` a pool obtained from a shared cache (`getPostgresConnectionPool`) unless every cache that wraps it also re-derives on end.

**Applies to:** `packages/jobs/src/db.ts` and any code calling `pool.end()` on a `getPostgresConnectionPool(...)` result.
