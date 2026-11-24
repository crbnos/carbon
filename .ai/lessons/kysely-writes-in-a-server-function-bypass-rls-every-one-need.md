---
paths: ["apps/erp/app/modules/*/*.service.ts"]
triggers: [".updateTable(", ".deleteFrom(", "assertAllOperationsClaimed"]
promoted: null
---
# Kysely writes in a server function bypass RLS — every one needs an explicit companyId, even when it looks batch-scoped

**Context:** The `batch-operations` edge function's `remove`/`update`/`dissolve` cases updated `jobOperation` rows filtered only by `jobOperationBatchId` (from the caller's payload). `requirePermissions` proved the caller held `production_update` in *their own* company; the following batch-scoped update carried no `companyId`.

**Problem:** Edge functions run on the service-role Kysely handle, which bypasses RLS entirely — the app-layer permission check is the ONLY gate, and it does not scope the rows a subsequent write touches. A caller passing their own `companyId` (to pass the gate) plus another company's `batchId` (a `nanoid`, not enumerable, but leakable) could detach or re-point the victim's operations; the companyId-scoped batch delete right after matched 0 rows but the transaction still committed the unscoped write. A batch-id predicate is not a tenant boundary.

**Rule:** In a server function, EVERY Kysely read and write carries `.where("companyId","=",companyId)` — even ones that already filter by a scoped foreign key. Assert the row count of a batch-scoped claim (`assertAllOperationsClaimed`) so a concurrent or cross-tenant mismatch rolls back instead of committing a partial. And a two-phase resumable flow must re-validate membership on the resume path exactly as the first pass does — a phase-2 step that flips rows batch-wide but iterates only the payload will strand the rows the short payload omitted.

**Applies to:** postings in `apps/erp/app/modules/*/*.service.ts` (any service-role Kysely write), resumable multi-phase flows.
