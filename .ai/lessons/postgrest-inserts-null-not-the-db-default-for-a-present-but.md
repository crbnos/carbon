---
paths: []
triggers: []
promoted: null
---
# PostgREST inserts NULL (not the DB default) for a present-but-`undefined` key spread into an insert

**Context:** Creating a Fixed Asset sales-order line failed with `23502 null value in column "methodType" violates not-null constraint`, even though `salesOrderLine.methodType` is `NOT NULL DEFAULT 'Pull from Inventory'`. The validator (`salesOrderLineValidator`) intentionally coerces the form's empty `methodType` to `undefined` for Fixed Asset / Comment lines (`zfd.text` + a refine that exempts them). The action spreads `...validation.data` into `upsertSalesOrderLine`, whose insert path spreads `...salesOrderLine` — so the object still carries `methodType: undefined`. A raw psql insert omitting the column succeeded (used the default); the app's PostgREST insert did not.

**Problem:** `postgrest-js` builds its `?columns=` list from `Object.keys(row)`, which **includes keys whose value is `undefined`**. `JSON.stringify` then drops the value from the body, so PostgREST sees the column listed with no value and inserts `NULL` — it does **not** fall back to the column `DEFAULT`. A truly absent key (never spread, e.g. `id`) is excluded from `?columns=` and does get its default. This is why the sibling **update** path was fine: it runs `sanitize(...)`, which strips `undefined`/empty keys before the write. Only the **insert** path (which didn't sanitize) leaked the `undefined` key.

**Rule:** When spreading validated/optional data into a supabase-js `.insert(...)`, a NOT-NULL column with a DB default will still fail if the key is present-but-`undefined`. Either (a) supply the value explicitly at the insert site next to the other defaults (`methodType: x.methodType ?? "Pull from Inventory"`), (b) `sanitize(...)` the insert object so undefined keys are dropped (matches the update path), or (c) pass `{ defaultToNull: false }` to `.insert(...)` (sends `Prefer: missing=default`). Prefer (a) for a single column, (b) for consistency with an existing update path. Don't assume the DB `DEFAULT` will apply — it only does for keys entirely absent from the object.

**Applies to:** `upsertSalesOrderLine` (`apps/erp/app/modules/sales/sales.service.ts`); any `upsert*` whose insert branch spreads optional/validated fields into a table with NOT-NULL-DEFAULT columns (sales/purchase/quote/invoice line inserts especially, which all carry a NOT NULL `methodType`).
