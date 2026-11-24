---
paths: []
triggers: []
promoted: null
---
# Postgres transition tables are visible ONLY to the function the trigger invokes directly

**Context:** The `itemStockQuantities` aggregate needed a statement-level handler on `itemLedger` so a bulk posting is one upsert instead of N. The event system already builds statement-level triggers (`trg_event_async_*` with `REFERENCING NEW TABLE AS batched_new`), so the obvious move was to have `dispatch_event_batch()` forward to a custom function.

**Problem:** A nested call cannot see the transition tables. A plain function called from the trigger function fails with `relation "batched_new" does not exist` — and this holds for dynamic SQL too (`EXECUTE 'SELECT count(*) FROM batched_new'` fails identically), because the ephemeral named relation lives in the trigger function's own query environment and is not propagated. The only ways to hand a batch onward are materializing it into a temp table per statement (real cost on a hot write path) or not nesting at all. Separately, `dispatch_event_batch()` early-returns when a table has no active subscription and when `app.sync_in_progress` is set — both correct for queueing, fatal for an aggregate that must always be maintained.

**Rule:** A function that needs `batched_new`/`batched_old` must be attached as the trigger's own function. Use `attach_statement_handler(table, functions[])` (`20260812002453`), the statement-level sibling of the row-level interceptors; it does not enqueue to PGMQ. Handlers are attached for INSERT/UPDATE/DELETE and must branch on `TG_OP` — only `batched_new` exists on INSERT, only `batched_old` on DELETE (PL/pgSQL plans lazily, so an unexecuted branch never resolves its missing table). Note also that adding a defaulted parameter to `attach_event_trigger` is a trap: two overloads are live, and a third with defaults makes existing 2-arg calls ambiguous.

**Applies to:** `packages/database/supabase/migrations/20260812002453_event-system-statement-handlers.sql`, `.claude/rules/event-system.md`, any statement-level trigger work under `packages/database/supabase/migrations/`.
