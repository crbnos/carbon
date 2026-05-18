# Lessons

Patterns learned from corrections. Review at the start of each session.

## RLS Policies

- **NEVER** use the old `has_role('employee', "companyId") AND has_company_permission(...)` RLS pattern. It is deprecated.
- **ALWAYS** use the new pattern with `get_companies_with_employee_permission()` helper function and standardized policy names ("SELECT", "INSERT", "UPDATE", "DELETE").
- Reference migration: `20250201181148_rls-refactor.sql`
- Correct pattern:
  ```sql
  CREATE POLICY "SELECT" ON "public"."tableName"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('module_view'))::text[]
    )
  );
  ```
## Event-system interceptors (Carbon-specific)

- Carbon uses `attach_event_trigger(table_name, BEFORE[], AFTER[])` defined in `20260116215036_event_system_impl.sql` / `20260410030406_event-system-after-interceptors.sql`, not plain Postgres triggers. Each call **DROPs and re-CREATEs** the event trigger — so when adding interceptors to a table that already has some registered, the new call must include every existing interceptor plus the new ones, otherwise the old ones silently detach. Grep `attach_event_trigger('<table>'` across migrations to find the latest registration and merge arrays.
- Interceptor functions take `(p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB) RETURNS VOID`. Short-circuit early on operations that don't apply (`IF p_operation <> 'UPDATE' THEN RETURN; END IF;`). `RAISE EXCEPTION` to block; `RETURN` silently to skip.

## Identifiers over free text

- When a field names another record ("the operation that triggers shelf life"), store it as a foreign-key ID (`processId`) rather than a string description. Typo-proof, rename-safe, and the DB enforces existence. The first cut of shelf-life matched against `jobOperation.description` — the user flagged it as a caveat; switching to `processId` removed the fragility without changing the UX (a combobox lets the user create/pick a process by name).

## "Presence of a row = feature enabled"

- When a feature is opt-in per item (or per company, per whatever), don't encode the opt-in state as a `mode = 'NotManaged'` value on the parent table. Use a side table keyed by the parent's id; absence of a row = not enabled. Cleaner queries (no `WHERE mode <> 'NotManaged'` plumbing), narrower parent table, CHECKs on the side table can be tighter (no need to permit NULL fields for the "not enabled" case).
- Applied to `itemShelfLife` — started on `item` with a 3-value enum and two conditional fields; refactored to a side table with a 2-value enum where absence means the third case.

## Upsert helpers must not clobber on partial submits

- A single server action can receive form data from multiple different forms (different UIs posting to the same `$id.details.tsx`). If the upsert helper treats `undefined` as "clear the row", any form that doesn't include the field silently deletes data. Rule:
  - `undefined` -> no-op (form didn't opine, leave it alone)
  - explicit sentinel like `'NotManaged'` -> clear (user explicitly opted out)
  - real value -> upsert
- The Zod validator's `.default("SomeValue")` can defeat this: a missing form field gets the default, which is then passed as an explicit value to the helper. Mark the field `.optional()` instead and gate defaults on the form's `initialValues`.

## `.merge()` breaks after `.refine()`

- Zod's `.refine()` returns a `ZodEffects`, which is no longer a `ZodObject` — so downstream `.merge(...)` calls fail with a type error. When a base object needs to be shared across several validators AND have refines, keep the raw `z.object()` exported for merging and apply the refines in a helper applied to each merged child validator. See `applyStorageAndShelfLifeRefines` in `items.models.ts`.

## Supabase upsert with `onConflict` clobbers audit fields

- `.upsert({ createdBy, updatedBy, ... }, { onConflict: "itemId" })` sets both `createdBy` and `updatedBy` via `ON CONFLICT DO UPDATE SET ... = EXCLUDED....`, which overwrites `createdBy` on every update. When audit semantics matter, do an explicit `SELECT ... maybeSingle()` + branch on existence: `INSERT` sets `createdBy`, `UPDATE` sets `updatedBy`/`updatedAt`. `upsertItemShelfLife` follows this pattern.

## ERP app has no vitest infrastructure

- `apps/erp` has no vitest config and no tests. Adding unit tests for validators there requires setting up vitest + mocking the supabase client — not a 5-minute job. If a task says "add validator tests", the estimate should include test-infrastructure setup unless `packages/*` (which does have vitest) is the right home for the pure function.

## Use `accountId` not `accountNumber`

- The codebase has migrated from `accountNumber` to `accountId` for GL account references. The old `accountNumber`-based foreign keys in the DB schema (e.g., on `purchaseOrderLine`, `purchaseInvoiceLine`) are from older migrations — current code uses `accountId`. Always use `accountId` when referencing GL accounts.

## Do not commit without being asked

- Never create git commits unless the user explicitly asks to commit. Stage and commit only on request. The user wants to review changes before committing.

## Bash fallbacks when tools are missing

- `pandoc` is not on the user's machine. For `.docx` extraction, use the `anthropic-skills:docx` skill's `unpack.py` (needs `defusedxml`; install via `mise x python@3.14.2 -- pip install defusedxml`) or an equivalent Python/JS extraction, rather than assuming pandoc is available.

## Lesson (auth-als Step 2)
- `git checkout -- <dir>` reverts ALL changes in that dir, including intentional hand edits made earlier in the session. Before bulk-reverting a codemod, check `git diff --name-only <dir>` and exclude/reapply intentional files. Reapplied MCP #4 edit after losing it this way.
- Caller direction matters: Step 1 modified ONLY service files, NOT routes. So route callers still have the ORIGINAL `svc(client, companyId, userId, data)` form. Option-C caller pass must DROP stale companyId/userId positionals, NOT insert client (client is already there).
