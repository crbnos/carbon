# Database access lessons

Kysely, supabase-js and PostgREST queries, RLS, companyId tenancy, transactions, row locks, generated types.

## A cast that silences excess-property errors hides failed writes

```scope
id: a-cast-that-silences-excess-property-errors-hides-failed-wri
paths: ["packages/utils/src/object.ts","apps/erp/app/modules/*/*.service.ts","apps/mes/app/services/*.service.ts"]
triggers: ["unchecked(","RejectExcessProperties"]
```

**Context:** supabase-js 2.117 types reject keys a table does not have (`RejectExcessProperties`). The upgrade wrapped ~75 failing write payloads in `unchecked()` (a cast to `never`) to get typecheck green.

**Problem:** About 30 of those were typed payloads (a zod validator spread into an insert/update) carrying fields the table lacks: `item.shelfLifeCalculateFromBom`, `ability.name`, `quote.notes`, `salesOrder.promisedDate`, `batchProperty.batchPropertyGroupId`, and more. PostgREST rejects any unknown column with PGRST204, so every such write failed whenever the field was present, and `itemValidator`'s always-present checkbox made the BoM explorer's item edit (`api+/item.$type.ts` → `updateItem`) fail on every save. The cast had removed the only warning. The 2.80 types never rejected excess keys, so these were latent all along.

**Rule:** Never cast a typed payload past the table's type. When the compiler names an extra key, destructure it out at the write, where every caller is covered, and say where the value actually lives. `unchecked()` is only for a column or table chosen at runtime (`{ [field]: value }`, `.from(table)`). To list every extra key at once rather than one per error, probe with `Exclude<keyof Payload, keyof Database["public"]["Tables"][T]["Update"]>`.

**Applies to:** every `{module}.service.ts` write, MES `services/*.service.ts`, `packages/utils/src/object.ts` (`unchecked`).

## A new FK on a busy table breaks bare PostgREST embeds of it (TS2589)

```scope
id: a-new-fk-on-a-busy-table-breaks-bare-postgrest-embeds-of-it
paths: []
triggers: ["TS2589","ALTER TABLE \"salesInvoiceLine\"","ALTER TABLE \"salesOrderLine\"","ALTER TABLE \"jobMaterial\"","_fkey("]
```

**Context:** The contracts migration (`20261006221301_contracts.sql`) gave `salesInvoiceLine` four new FKs (`customerContractId`, `customerContractLineId`, `customerContractInvoiceLineId`, `projectId`).

**Problem:** After `generate:types`, the ERP typecheck failed with TS2589 ("type instantiation is excessively deep") in four files that the change did not touch. Each did a bare embed such as `.select("salesInvoice(id, invoiceId)")` from `salesInvoiceLine`. More relationships on the table make the inference of a bare embed too deep. A `@ts-ignore` would hide it, but the next new FK moves the error to another file.

**Rule:** When you add a FK to a table that other code embeds from, name the FK in every embed of its parent: `salesInvoice!salesInvoiceLine_invoiceId_fkey(...)`. Run the scoped `erp` typecheck after `generate:types`, before you commit the migration. Fix the cause at the embed by naming the FK (fix commit `5b26a095dd`). Use `@ts-ignore` (the TS2589 lesson above) only for an embed that already names its FK.

**Applies to:** any migration that adds a FK column to `salesInvoiceLine`, `salesOrderLine`, `jobMaterial` or another widely embedded table; the PostgREST selects in `apps/erp` that embed from it.

## A PostgREST update that matches no row reports success

```scope
id: a-postgrest-update-that-matches-no-row-reports-success
paths: ["apps/erp/app/modules/items/items.service.ts"]
triggers: [".update(","resolveTypedItem","updateTypedItem"]
```

**Context:** Typed item updates (`upsertPart`, `upsertTool`, `upsertConsumable`,
`upsertService`, `upsertMaterial`) filtered the typed table by the item's uuid,
but those tables are keyed by the item's readable id plus `companyId`.

**Problem:** `client.from(t).update(...).eq(...)` with no `.select()` returns
`{ error: null }` when it matches zero rows. Half of every typed update wrote
nothing, and the API and MCP reported success.

**Rule:** An update whose miss is a bug ends with `.select("id").single()`, so
a miss comes back as an error. Key each table by its own primary key: `item`
by uuid, the typed tables by `readableId` + `companyId`
(`resolveTypedItem` / `updateTypedItem` in `items.service.ts`).

**Applies to:** any supabase-js update in a service, above all one that writes
a pair of tables keyed differently.

## Chained Supabase writes in a route action are not a transaction

```scope
id: chained-supabase-writes-in-a-route-action-are-not-a-transact
paths: []
triggers: [{"text":".insert(","minCount":2},{"text":".update(","minCount":2},{"text":".upsert(","minCount":2}]
```

**Context:** RFQ finalize and supplier quote finalize each wrote a quote, its lines, a share link and a price list as separate `client.from(...)` calls in a loop, logging and skipping any that failed.

**Problem:** Every statement was its own PostgREST request (about 34 ms each), and a failure partway left quotes without lines or half a price list while the action still reported success. The checks that made the write safe (every line priced, the RFQ still Draft) lived in the route, so the API tool for the same operation skipped them.

**Rule:** Check a multi-table write's preconditions inside its transaction, on a locked read of the document (`forUpdate()`), so a double submit and every other caller get the same answer. The route keeps only what is about the request: the form, the flash, the email. The rest is in `AGENTS.md` (Never: chained Supabase-client writes) and the `route-action-shape` check.

**Applies to:** any route action with more than one write; `finalizePurchasingRfq` and `finalizeSupplierQuote` in `apps/erp/app/modules/purchasing/purchasing.service.ts`.

## Kysely writes in a server function bypass RLS — every one needs an explicit companyId, even when it looks batch-scoped

```scope
id: kysely-writes-in-a-server-function-bypass-rls-every-one-need
paths: ["apps/erp/app/modules/*/*.service.ts"]
triggers: [".updateTable(",".deleteFrom(","assertAllOperationsClaimed"]
```

**Context:** The `batch-operations` code (then an edge function, now in `apps/erp/app/modules/production/production.service.ts`) had `remove`/`update`/`dissolve` cases that updated `jobOperation` rows filtered only by `jobOperationBatchId` (from the caller's payload). `requirePermissions` proved the caller held `production_update` in *their own* company; the following batch-scoped update carried no `companyId`.

**Problem:** That code ran on the service-role Kysely handle, which bypasses RLS entirely — the app-layer permission check is the ONLY gate, and it does not scope the rows a subsequent write touches. A caller passing their own `companyId` (to pass the gate) plus another company's `batchId` (a `nanoid`, not enumerable, but leakable) could detach or re-point the victim's operations; the companyId-scoped batch delete right after matched 0 rows but the transaction still committed the unscoped write. A batch-id predicate is not a tenant boundary.

**Rule:** Assert the row count of a batch-scoped claim (`assertAllOperationsClaimed`) so a concurrent or cross-tenant mismatch rolls back instead of committing a partial. And a two-phase resumable flow must re-validate membership on the resume path exactly as the first pass does — a phase-2 step that flips rows batch-wide but iterates only the payload will strand the rows the short payload omitted. The rest is in the `no-unscoped-kysely-write` check and `.claude/rules/conventions-services.md`.

**Applies to:** postings in `apps/erp/app/modules/*/*.service.ts` (any service-role Kysely write), resumable multi-phase flows.

## Never correlate bulk-insert results by RETURNING position

```scope
id: never-correlate-bulk-insert-results-by-returning-position
paths: []
triggers: [{"text":".returning(","minCount":2},{"text":"RETURNING","minCount":2}]
```

**Context:** Card posting and voiding bulk-insert journal lines, then create dimensions that must reference the exact source line they describe.

**Problem:** The code paired source rows with `INSERT ... RETURNING` rows by array index, but PostgreSQL does not guarantee that returned rows preserve input order. A reordered result could attach a cost center to the wrong GL account.

**Rule:** Allocate native ids up front in one query, include them in the bulk insert, and build dependent rows from those explicit ids. Positional correlation is safe only within application-owned arrays, never across an unordered database result.

**Applies to:** Journal lines and dimensions, and any bulk insert followed by dependent rows that need source-to-result identity.

## PostgREST inserts NULL (not the DB default) for a present-but-`undefined` key spread into an insert

```scope
id: postgrest-inserts-null-not-the-db-default-for-a-present-but
paths: ["apps/erp/app/modules/sales/sales.service.ts"]
triggers: ["upsertSalesOrderLine","upsertPurchaseOrderLine","upsertQuoteLine","upsertSalesInvoiceLine","upsertPurchaseInvoiceLine","defaultToNull"]
```

**Context:** Creating a Fixed Asset sales-order line failed with `23502 null value in column "methodType" violates not-null constraint`, even though `salesOrderLine.methodType` is `NOT NULL DEFAULT 'Pull from Inventory'`. The validator (`salesOrderLineValidator`) intentionally coerces the form's empty `methodType` to `undefined` for Fixed Asset / Comment lines (`zfd.text` + a refine that exempts them). The action spreads `...validation.data` into `upsertSalesOrderLine`, whose insert path spreads `...salesOrderLine` — so the object still carries `methodType: undefined`. A raw psql insert omitting the column succeeded (used the default); the app's PostgREST insert did not.

**Problem:** `postgrest-js` builds its `?columns=` list from `Object.keys(row)`, which **includes keys whose value is `undefined`**. `JSON.stringify` then drops the value from the body, so PostgREST sees the column listed with no value and inserts `NULL` — it does **not** fall back to the column `DEFAULT`. A truly absent key (never spread, e.g. `id`) is excluded from `?columns=` and does get its default. This is why the sibling **update** path was fine: it runs `sanitize(...)`, which strips `undefined`/empty keys before the write. Only the **insert** path (which didn't sanitize) leaked the `undefined` key.

**Rule:** When spreading validated/optional data into a supabase-js `.insert(...)`, a NOT-NULL column with a DB default will still fail if the key is present-but-`undefined`. Either (a) supply the value explicitly at the insert site next to the other defaults (`methodType: x.methodType ?? "Pull from Inventory"`), (b) `sanitize(...)` the insert object so undefined keys are dropped (matches the update path), or (c) pass `{ defaultToNull: false }` to `.insert(...)` (sends `Prefer: missing=default`). Prefer (a) for a single column, (b) for consistency with an existing update path. Don't assume the DB `DEFAULT` will apply — it only does for keys entirely absent from the object.

**Applies to:** `upsertSalesOrderLine` (`apps/erp/app/modules/sales/sales.service.ts`); any `upsert*` whose insert branch spreads optional/validated fields into a table with NOT-NULL-DEFAULT columns (sales/purchase/quote/invoice line inserts especially, which all carry a NOT NULL `methodType`).

## Retrying a 5xx from a non-idempotent Edge Function multiplies its side effects

```scope
id: retrying-a-5xx-from-a-non-idempotent-edge-function-multiplie
paths: ["packages/auth/src/lib/supabase/client.ts","apps/erp/app/routes/x+/quote+/$quoteId.duplicate.tsx"]
triggers: ["functions.invoke","storageReadFetch"]
```

**Context:** Duplicating a quote (`quoteToQuote`, then in the `get-method` edge function, now in `apps/erp/app/modules/production/production.service.ts`) kept failing with a generic toast while silently leaving 3-4 duplicate quotes behind — recurring across three separate production incidents, including twice AFTER the underlying jsonb-serialisation bug (see the lesson above) had already been fixed and deployed. Vercel logs showed exactly ONE incoming `POST .../duplicate.data` per incident, always HTTP 200 (the route swallows `copy.error` into a generic `{success:false}` and never throws, so the response code tells you nothing), with zero attached application logs.

**Problem:** At the time, every Supabase client went through a retry wrapper that retried ANY 5xx response — including `client.functions.invoke(...)` calls into Edge Functions — up to 2 more times. `quoteToQuote` is not idempotent (it always creates a brand-new quote/opportunity/externalLink) and ran across two separate Kysely transactions, so a deterministic failure partway through the second transaction let the first transaction's insert commit on EVERY retry attempt before failing again — one incoming request, N internal retries, N duplicate quotes, and the client still reported failure because the last attempt also failed. Fixing one root cause (the jsonb bug) only stopped THAT cause from triggering the retries; any other exception in the same code path reproduced the same symptom.

**Rule:** A retry wrapper must never blindly retry a write with real side effects and no idempotency key. Retry reads only, as `storageReadFetch` (`packages/auth/src/lib/supabase/client.ts`) does for storage reads. When debugging "op failed but extra copies appeared," check for this shape (one incoming request, several committed results) before assuming a client-side double-submit or a browser retry.

**Applies to:** `packages/auth/src/lib/supabase/client.ts` and any future retry/timeout wrapper placed in front of a write or `client.functions.invoke`. Also: `$quoteId.duplicate.tsx` and similar routes that discard the real error into a generic message — add `logger.error` there so a recurrence is diagnosable from the logs alone.

## A cast to an OPTIONAL property silently yields `undefined` on a type that lacks it

```scope
id: a-cast-to-an-optional-property-silently-yields-undefined-on
paths: ["packages/jobs/src/db.ts","apps/erp/app/modules/production/ui/Jobs/JobMaterialsTable.tsx"]
triggers: [".original as {",".from(\"account\")","pool.end()"]
```

**Context:** `JobMaterialsTable` renders an "↩ substituted from X" indicator for supersession-swapped job materials, reading the field as `(row.original as { substitutedFromItemId?: string | null }).substitutedFromItemId`. The row type comes from the `get_job_quantity_on_hand` RPC, whose `RETURNS TABLE` never included that column.

**Problem:** Asserting an OPTIONAL property onto a type that does not have it is legal TypeScript and raises nothing — the expression just evaluates to `undefined` on every row, so `{substitutedFrom && ...}` never rendered. The feature wrote correct provenance data to the database for its entire life and displayed it zero times. Had the property been declared non-optional, or read without the cast, it would have been a compile error the day it was written.

**Rule:** Treat `as { someField?: T }` on a row/DTO type as a smell, not a convenience — it is indistinguishable from a field that does not exist. When a UI needs a column its loader does not return, widen the RPC/view and regenerate types so the compiler enforces the contract. More generally: a field written to the DB but rendered nowhere has no feedback loop — `jobMaterial.itemScrapPercentage` was wrong in three code paths for the same reason.

**Applies to:** `apps/erp/app/**` table cells reading loader rows; any `as { x?: T }` over a generated DB/RPC type.

---

**Context:** Ramp integration live verification kept failing at every DB touch of the chart of accounts — post-charge 500'd, pushChartOfAccounts pushed 0, every coded card charge failed "Failed to verify accounts" (2026-08-28).

**Problem:** The `account` (chart of accounts) table is scoped by **`companyGroupId`, not `companyId`** — it has **no `companyId` column** and its PK is `id` alone (globally unique). Four separate sites wrote `.from("account")…​.eq("companyId", companyId)`, which PostgREST rejects ("column companyId does not exist"). Each caller either 500'd or swallowed the error and behaved as if zero accounts existed. The bug was invisible to unit tests (they mock the data, never hit the query) and recurred because a well-meaning "add companyId scoping everywhere" self-review pass applied the standard multi-tenant pattern to a table that breaks it. Same class as `item` (single-column PK, globally unique).

**Rule:** Before scoping any query by `companyId`, confirm the table HAS a `companyId` column. A group-shared table is scoped by `companyGroupId`; resolve it from `company.companyGroupId` (or `ctx.companyGroupId`) and filter by that, or by `id` alone when the ids already come from this company's own rows. The rest (`account` has no `companyId`) is in `.claude/rules/ramp-integration.md`.

**Applies to:** any `.from("account")` in services and jobs; the general check "does this table actually have companyId?" before applying the multi-tenant scoping pattern (mirror of the `item` single-column-PK lesson).

---

**Context:** ramp-sync's card family silently created 0 transactions every run; the error "Cannot use a pool after calling end on the pool" was swallowed by family-failure isolation (2026-08-28).

**Problem:** `getJobDatabaseClient` (packages/jobs/src/db.ts) cached a Kysely client over a shared pool. Three accounting sweeps ended that pool in a `finally`. The pool factory evicted an ended pool for ITS callers, but `getJobDatabaseClient` kept a SEPARATE client cache still wrapping the dead pool — so after any sweep ran, every later job that used it broke until process restart.

**Rule:** A cached client over the shared, end-able pool must detect the ended pool and rebuild. `getProcessPool()` (`@carbon/database/client`) replaces a pool that is `ending`, and `getJobDatabaseClient` caches the pool alongside the client and rebuilds when `getProcessPool()` returns another one. Any new cache over `getProcessPool()` does the same. Never `pool.end()` the process pool unless every cache that wraps it also re-derives on end.

**Applies to:** `packages/jobs/src/db.ts`, any cache over `getProcessPool()`, and any code calling `pool.end()`.

## A generated column is writable in the Supabase Insert type but rejected at runtime

```scope
id: a-generated-column-is-writable-in-the-supabase-insert-type-b
paths: ["packages/jobs/src/inngest/functions/integrations/ramp-sync-bill*.ts"]
triggers: ["purchaseInvoiceLine","supplierQuoteLinePrice","supplierUnitPrice","GENERATED ALWAYS"]
```

**Context:** The Ramp inbound bill/reimbursement sync inserted `purchaseInvoiceLine` rows with `unitPrice: line.amount` and `exchangeRate: 1`. Since `20260811123616`, `purchaseInvoiceLine.unitPrice`/`totalAmount`/`shippingCost`/`taxAmount` are `GENERATED ALWAYS AS (supplier* / exchangeRate) STORED` — base-currency mirrors of the document-currency `supplier*` columns.

**Problem:** `supabase gen types` lists STORED generated columns in the `Insert`/`Update` types as optional, so `unitPrice: line.amount` typechecks — but Postgres rejects a non-DEFAULT write to a generated column at runtime, and the value never reaches `supplierUnitPrice`, so `post-purchase-invoice` (which posts `quantity * unitPrice`, unitPrice already base) had nothing to post. The path also hardcoded `exchangeRate: 1`, so even when it did post, a foreign-currency bill posted at par. Both are invisible to typecheck and to unit tests that mock the insert.

**Rule:** A column being present in the generated `Insert` type is NOT proof it is writable — check the migration for `GENERATED ALWAYS` before you write a value to it. The rest (write the `supplier*` columns plus the real `exchangeRate`, never the generated price columns) is in `.claude/rules/ramp-integration.md` and `.claude/rules/purchasing-conversion-factors.md`.

**Applies to:** any code inserting `purchaseInvoiceLine` / `purchaseOrderLine` / `supplierQuoteLinePrice` rows (Ramp `syncBill`/reimbursement path, CSV import, AI extraction), and the general "is this Insert-typed column actually generated?" check before writing a value-bearing purchase column.

## A Kysely write needs its own RLS gate

```scope
id: a-kysely-write-needs-its-own-rls-gate
paths: ["packages/database/src/authz/**","packages/checks/src/clobber.ts","packages/database/src/datasets/wipe.ts"]
triggers: ["requireMaterialUpdatable","db: Kysely<KyselyDatabase>","OBJECT_PATTERNS","assertWipeable","authz migration"]
```

**Context:** Material property edits write the material row, every revision's
item row and `itemCost` in one Kysely transaction.

**Problem:** Kysely connects as the Postgres role and bypasses RLS, so a caller
without `parts_update` in the company, or naming another company's material,
would still write.

**Rule:** In ANY service, not only materials: before a Kysely transaction on
rows a caller names, run one UPDATE through the caller's supabase client,
filtered by id and `companyId`, with `.select().single()`, and stop on its
error. Pick a row whose policy also covers the other rows the transaction
writes. The rest (`requireMaterialUpdatable`) is in
`.claude/rules/material-tables.md`.

**Applies to:** any service that takes both `client` and `db` and writes with
`db` on behalf of an API or MCP caller.

---

**Context:** Merging `origin/main` into a branch that had renamed `cardTransaction`
→ `charge` and added three `reimbursement*` tables, after main moved RLS into the
declarative manifest (`packages/database/src/authz/`).

**Problem:** Nothing in the textual merge mentions the manifest, so the merge looks
clean and the branch's own migrations still create correct policies. The breakage
surfaces later and in three different places: `crbn migrate` aborts with `authz
rules that do not apply: cardTransaction: relation "public.cardTransaction" does
not exist` (the manifest still declares the OLD name), `authz check` reports the
new tables as `unmanaged`, and `@carbon/database`'s `migration.test.ts` fails in CI
on `unshipped` because production reaches RLS only through a generated migration —
deploy does NOT run `authz sync` (nothing in `ci/src/migrations.ts` or
`.github/workflows/` calls it). A branch that renames a table also strands its
`baseline.json` entry, which must NOT be regenerated.

**Rule:** When a branch RENAMES a table, rename its entry in
`packages/database/src/authz/manifest.ts` too, then `authz check` until it
reports 0 tables (`authz migration` scopes itself to the unshipped set — it will
not sweep up unrelated drift). The rest of the shipping steps are in
`.claude/rules/authz-manifest.md`. Verify a hand-written policy and its manifest entry agree by
rendering both rather than reading them: alias (`p` vs `h`), the enum cast Postgres
adds, and an omitted `WITH CHECK` on UPDATE are all cosmetic, but a missing clause
is not. A two-hop parent check needs `custom()` — nested `exists()` aliases its
parent `p`, so the intermediate table has no name to reference.

**Applies to:** every in-flight worktree that adds or renames a table and then
merges main; `packages/database/src/authz/**`.

---

**Context:** The same merge: `pnpm --filter @carbon/checks clobbers` reported
`function:public` redefined on both sides, naming two migrations whose functions
were `check_charge_*` and `update_receipt_line_batch_tracking` — no overlap at all.

**Problem:** `clobber.ts`'s patterns captured the first identifier after `FUNCTION`
/ `VIEW`, so `public.foo` keyed as `function:public`. Two unrelated schema-qualified
definitions therefore always collided, and — the half that actually matters — two
redefinitions of the SAME qualified function were never keyed by its name, so a
genuine clobber went unreported. A check that cries wolf on every merge is a check
people learn to pass with `--no-verify`.

**Rule:** Key a DB object by its OBJECT name with the `schema.` qualifier
discarded (`public.foo` and a bare `foo` ARE the same object — `public` is the
default search path). When a conformance check fires, confirm the two sides really
do name the same object before rebasing; a vague key like `function:public` is
evidence about the check, not about the migrations.

**Applies to:** `packages/checks/src/clobber.ts` and any future `OBJECT_PATTERNS` row.

---

**Context:** Immediately after that merge, `crbn reset` failed with
`relation "cardTransaction" does not exist` from `assertWipeable`
(`datasets/wipe.ts`) — a function that did not exist at the merge-base and was
added by main while this branch was renaming that table to `charge`.

**Problem:** Neither side edited the other's lines, so git merged it with no
conflict and every gate stayed green. `pnpm db:check:datasets` does NOT cover it:
`verifyDataset` seeds a SCRATCH company with `wipeFirst: false`, so the wipe — and
`assertWipeable` with it — never runs. Only a real `db:seed:dev` / `crbn reset`
reaches that path, which is exactly the step nobody runs while resolving a merge.
Typecheck cannot see it either: the table name is a string inside `client.query`.

**Rule:** After merging main into a branch that RENAMED a database object, grep the
files MAIN changed for the OLD identifier — `git diff --name-only <merge-base>
origin/main` piped into a grep for the old name — instead of trusting a clean merge
or a green `db:check:datasets`. Exclude `supabase/migrations/**` (history),
`authz/baseline.json` (what production had, never regenerated) and
`jobs/src/backups/renames.ts` (the old→new restore map): all three are SUPPOSED to
keep the old name. Then run the seed itself. Docs count as hits too — main's new
`assertWipeable` paragraphs in `datasets/AGENTS.md` and
`.claude/rules/onboarding-company-templates.md` named the old table as well.

**Applies to:** any branch that renames a table, column or enum value and then
merges main; `packages/database/src/datasets/wipe.ts` above all, since no automated
gate executes it.

## A local-only sync step does not deploy (authz manifest, 2026-09-27)

```scope
id: a-local-only-sync-step-does-not-deploy-authz-manifest-2026-0
paths: ["packages/database/src/authz/**","packages/database/supabase/tests/authz-*.sql"]
triggers: ["WITH CHECK","authz sync"]
```

**Context:** RLS policies moved from migrations into `packages/database/src/authz/manifest.ts`,
applied by `authz sync` after `crbn migrate`. Production runs migrations only.

**Problem:** With policies forbidden in migrations, a new table would be correct locally and
ship to production with no policies and RLS off — open to the anon key, since Supabase grants
public tables to `anon`/`authenticated` by default. Edited rules would silently never deploy.
Separately, a test of a missing UPDATE `WITH CHECK` passed against the broken policy: a
filtered `UPDATE … WHERE` checks the new row against the SELECT policy too.

**Rule:** Anything applied outside migrations, not only authz, needs a CI gate that proves
the deploy path carries it. Prove a policy test red first. The rest (the authz gate, testing
a WITH CHECK with an unfiltered UPDATE) is in `.claude/rules/authz-manifest.md`.

**Applies to:** `packages/database/src/authz/**`, `packages/database/supabase/tests/authz-*.sql`.

## A module the browser bundles must not reach the Kysely runtime, even through a helper

```scope
id: a-module-the-browser-bundles-must-not-reach-the-kysely-runti
paths: ["packages/database/src/strict-backflush.ts"]
triggers: ["@carbon/database/strict-backflush","@carbon/database/rows","inOrder(","from \"kysely\""]
```

**Context:** Strict backflush (2026-10-16). `@carbon/database/strict-backflush` is imported by UI components (`BillOfMaterial.tsx`, `JobBillOfMaterial.tsx`, `BatchReleaseModal.tsx`), so the browser bundles it.

**Problem:** Using `inOrder` from `@carbon/database/rows` there would have imported `kysely` at runtime into the client bundle; typecheck does not see it. Separately, `settings.server.ts` gained an import of `~/utils/query`, which imports the `@carbon/auth` barrel. That barrel runs a Lingui `msg` macro, which plain vitest cannot compile, so 2 unrelated test files stopped loading.

**Rule:** In a client-bundled module, import only types from `kysely` and `./client`. Run two awaits instead of `inOrder`. Raw `sql` belongs in a server-only file. Before adding an import to a file that tests import, check what that import's barrel pulls in, then run the module's tests.

**Applies to:** `@carbon/database` subpaths read by UI, `{module}.server.ts` imported by vitest files.

## A `@ts-expect-error` on generated DB types is evidence of a dropped column, not a type quirk

```scope
id: a-ts-expect-error-on-generated-db-types-is-evidence-of-a-dro
paths: ["apps/erp/app/modules/inventory/ui/Inventory/InventoryTable.tsx","apps/erp/app/routes/x+/inventory+/quantities.tsx"]
triggers: ["@ts-expect-error","@ts-ignore","get_inventory_quantities"]
```

**Context:** `InventoryTable.tsx` read `row.original.tags` behind a `// @ts-expect-error TS2339`. The suppression was correct that the property was missing — `20260713235406` had forked `get_inventory_quantities` and dropped the `tags` output added by `20260113122437` (the failure mode in the `database-migrations.md` lesson "A function redefinition forked from an old copy reverts every migration between"). The regression then hid in plain sight for months: the Tags column silently rendered empty, and the Tags filter sent `.overlaps("tags", …)` → PostgREST 42703 against a nonexistent column.

**Problem:** Generated types are mechanically derived from the live schema, so TS2339 on a generated Row/Returns type is never a false positive — it is the type system reporting that the column does not exist. Suppressing it converts a compile-time regression signal into a silent runtime one. The blast radius was widened by `quantities.tsx` calling `redirect(...)` without `throw`, which discarded the resulting PostgREST error and rendered an empty table instead of surfacing it.

**Rule:** Never `@ts-expect-error` / `@ts-ignore` a missing property on a `@carbon/database` generated type. Grep every migration touching the function or table (`grep -l '<name>' migrations/*.sql | sort`) and find the revision that removed it — the fix is a migration restoring the column, not a suppression. When reviewing, treat a `@ts-expect-error` near generated types as a probable dropped-column regression. Corollary: in a loader, always `return` or `throw redirect(...)` on a service error — a `redirect(...)` that is neither returned nor thrown is a no-op that swallows the error and renders empty data.

**Applies to:** `packages/database/src/types.ts` consumers; `apps/erp/app/modules/**/ui/**` table columns bound to RPC outputs; any loader branching on `{ data, error }`.

## An `.in()` list built from a result set has no upper bound

```scope
id: an-in-list-built-from-a-result-set-has-no-upper-bound
paths: ["apps/erp/app/modules/production/production.service.ts","apps/erp/app/routes/x+/purchasing+/planning*.tsx","apps/erp/app/routes/x+/production+/planning*.tsx","apps/erp/app/modules/*/*.service.ts"]
triggers: ["getPlanningActions","fetchAllByIds",{"text":".in(\"id\"","minCount":2},"itemToJob",{"text":".in(\"","minCount":3}]
```

**Context:** The planning grids load the actions for the 100 parts on a page, then looked up
each action's purchase order line with `.in("id", lineIds)`. Separately, a fix for the N+1
traversal in `get-method`'s `itemToJob` prefetched `itemReplenishment` for a whole method
tree (260 item ids) with `client.from(...).in("itemId", ids)`, chunked at 200 ids per request.

**Problem:** `.in()` writes every id into the URL. The list was one id per ACTION, so it grew
with the data, not the page size: 2,357 ids was a 54 kB request line and the gateway rejected
it (HTTP 431). The loader did `planningActions.data ?? []`, so the page rendered every part
with no actions — indistinguishable from "nothing to do". Demo data and hand-made test parts
(a few actions each) never came near the limit; it took load data to see it.

Chunking does not help when the chunk is too big. 200 UUID-length ids is about 8 kB of URL,
over the local gateway's request-line limit. The `itemToJob` prefetch failed and threw, and
every job created for a large-BOM item landed with an empty BOM, because the caller logs the
invoke error and continues. A chunk size that works in tests fails on the tenant with the most
data.

**Rule:** An id list for `.in()` must be bounded by something you control (the page size), and
chunked when that bound is large — about 100 ids per request (`fetchAllByIds` in
`@carbon/database` does the chunking and the paging). When the related rows hang off
a foreign key, embed them in the first read instead of looking them up afterwards. And a
loader never swaps a failed read for an empty list: log it and throw.

In server functions and edge functions, a batch read keyed by a large id list goes through
the Kysely `db` handle (bound parameters, no URL cap) when it needs no PostgREST embed. When
an embed forces PostgREST, chunk conservatively (100 ids or fewer; the `itemToJob` fix chose
50), and put `res.error.message` in the thrown error so the failure names its cause. Never
swallow a prefetch error into a bare string with no detail.

A list the USER builds (the ids of a bulk selection: Apply, Dismiss, Assign) has no bound at
all, and chunking a WRITE breaks its atomicity — a claim that lands in chunk 1 and fails in
chunk 2 leaves rows claimed with nothing applied. Send such a list through Kysely instead:
`where("id", "in", ids)` binds the ids as parameters, one statement, no URL, no `max_rows`.
The same bulk Apply did this over PostgREST in five functions and would have failed whole on a
page of busy parts.

**Applies to:** `getPlanningActions` and the planning action worklist writes in
`apps/erp/app/modules/production/production.service.ts`, the planning loaders and
`planning.update` routes (`x+/purchasing+/planning*.tsx`, `x+/production+/planning*.tsx`),
`get-method`'s `itemToJob`, the posting batch reads in `apps/erp/app/modules/*/*.service.ts`,
and any "read rows, then `.in()` their ids" enrichment over tree-collected or list-collected
ids.

## Comparing a Kysely timestamp against a PostgREST one is silently always-false

```scope
id: comparing-a-kysely-timestamp-against-a-postgrest-one-is-sile
paths: ["packages/jobs/src/inngest/functions/integrations/reconcile*.ts","packages/ee/src/accounting/core/**"]
triggers: ["instantMs","lastSyncedAt","has_any_company_permission"]
```

**Context:** "Why does this one vendor resync every 30 minutes?" — the v5 reconciler's
master-data change check (`reconcileMasterData`, `jobs/…/integrations/reconcile.ts`).

**Problem:** `snapshot.updatedAt <= input.lastSyncedAt` compared an ISO string (loaded
via supabase-js) against a JS `Date` (loaded via Kysely — see the `date` lesson above;
timestamptz is still decoded as a `Date`). JS relational operators coerce both operands
toward NUMBER: the `Date` becomes epoch ms, the ISO string becomes `NaN`, and every
comparison with NaN is `false`. So the "unchanged since the last successful sync"
short-circuit could never fire, and every master-data row edited inside the 7-day sweep
window re-enqueued a no-op push twice an hour — ~336 green `Completed` rows per row.
Nothing failed, nothing was written remotely (the provider's own bailout does the same
comparison correctly, `Date <= Date`), so the only symptom was ledger noise. Both the
declared type (`lastSyncedAt: string | null`) and the existing golden tests (two matching
ISO strings) asserted the fiction.

**Rule:** never use `<`/`<=` on two timestamps that came from DIFFERENT clients. Convert
both to epoch ms first (`instantMs`). Where a value's runtime type disagrees with the
generated types, WIDEN the declared type (`string | Date | null`) rather than leaving the
lie in place — the widened type is what makes the next reader handle it. And write the
test with the argument shapes the caller REALLY passes: a test that feeds two tidy ISO
strings into a comparison bug passes forever.

**Applies to:** any decision function fed by both a Supabase-client read and a Kysely
read — `jobs/…/integrations/reconcile*.ts` above all; `packages/ee/src/accounting/core/**`
syncers (`syncInstant` in `charge-syncer.ts` is the pattern that got it right).

---

**Context:** A security report: any signed-in user could read, create, update and delete every
`public."user"` row through PostgREST. The policy was `FOR ALL USING
(has_any_company_permission('users_update'))`, and a self-serve signup holds `users_update` in
its own company.

**Problem:** `has_any_company_permission(claim)` answers "does the caller hold this permission
ANYWHERE?" It never relates the row to a company, so any policy built on it alone is
cross-tenant. A table with no `companyId` (`user`) cannot use the standard four-policy template,
so the shortcut looked reasonable.

**Rule:** Never gate a policy on `has_any_company_permission`. Every policy must connect the ROW
to a company in `get_companies_with_employee_role()` or
`get_companies_with_employee_permission(...)`. For tables without `companyId`, go through a
membership table (`userToCompany`, `employee`, …), as `20260924153817` does. When a global
row is shared by several tenants, also pin the columns no single tenant owns (a BEFORE UPDATE
guard on `current_user IN ('anon','authenticated')`), and revoke INSERT/DELETE from the API
roles when only the server writes them. Also check `pg_policies` for `qual = 'true'`.

**Applies to:** `packages/database/supabase/migrations/**` RLS on global tables (`user`,
`userPermission`, `group`), and any review of an RLS helper.

---

The SECURITY DEFINER section moved out. The rest is in the `public-definer-function-authorizes-caller` invariant, the `edge-function-authorizes-caller` check and `.claude/rules/authz-manifest.md`.

## Copying child rows onto a new record can make that record undeletable

```scope
id: copying-child-rows-onto-a-new-record-can-make-that-record-un
paths: ["apps/erp/app/modules/items/items.service.ts"]
triggers: ["supplierPartPrice","copyItemPlanningAndPurchasing","ON DELETE RESTRICT"]
```

**Context:** A new item revision now inherits the source revision's supplier parts and their
price breaks (`copyItemPlanningAndPurchasing`, called by `createRevision`). A change notice
discards its draft revision by deleting the draft item.

**Problem:** `supplierPart.itemId → item` is `ON DELETE CASCADE`, but
`supplierPartPrice → supplierPart` is `ON DELETE RESTRICT`. An item delete therefore cascades
into a supplier part that a price break refuses to let go, and the whole delete fails with
`23503`. Before the copy, a fresh revision had no supplier parts, so nothing exercised that
path; after it, every revision of an item with price breaks carries the blocker: the Item
Master delete was refused, and the change notice's draft discard ignored the delete's error,
so the draft would have survived silently. Reading the migrations for the table being copied
was not enough; the constraint that mattered sat on its child.

**Rule:** Before copying rows onto a record, list the delete rule of every FK that points at
the copied tables (`pg_constraint.confdeltype`, or `grep REFERENCES` for the table name) and
walk every path that deletes the parent. A `RESTRICT`/`NO ACTION` child turns a copy into a
delete blocker. Either delete the child first on that path, in the same transaction as the
parent so a refused parent delete does not lose the child, or change the rule in a migration.
And a delete whose failure the caller ignores is not a delete: return the error.

**Applies to:** `apps/erp/app/modules/items/items.service.ts` (`createRevision`,
`deleteItemsWithPriceBreaks`, `deleteItem`, `discardChangeNoticeDrafts`,
`deleteSupplierPart`), and any copy/duplicate of `supplierPart`.

## Kysely builds ONE column list per multi-row insert — a conditionally-set key writes NULL into its siblings

```scope
id: kysely-builds-one-column-list-per-multi-row-insert-a-conditi
paths: []
triggers: [".values(rows",".values([","quoteLineToJob"]
```

**Context:** `quoteLineToJob` (then in the `get-method` edge function, now in `apps/erp/app/modules/production/production.service.ts`) builds every `jobMaterial` row into one array, then inserts them with a single `trx.insertInto("jobMaterial").values(rows)`. Only rows whose item had an effective supersession successor carried a `unitCost` key; the rest omitted it, on the assumption that omitting a key lets the column default apply.

**Problem:** Kysely derives the INSERT's column list from the union of keys across ALL rows, not per row. The moment one swapped row carries `unitCost`, the column joins the statement and every row that omitted the key is written `NULL`. `jobMaterial.unitCost` is `NOT NULL DEFAULT 0`, so the whole insert failed with a 23502 and job creation died — and because it is one statement in one transaction, a single swapped line took down the entire job. The column default is only reached when NO row in the batch has the key, which is why it worked until the first quote-to-job with a superseded line. It was invisible to typecheck, to 157 unit tests, and to three review agents; it surfaced the first time a human clicked the flow in a browser.

**Rule:** In a multi-row insert, set every column on EVERY row or on none. Never conditionally spread a key (`...(cond ? {col: v} : {})`) into rows of a batch — that is the shape that writes NULL into the others. If a column is `NOT NULL DEFAULT x` and you want the default, either omit it from all rows or write `x` explicitly. When in doubt write the value explicitly; a default duplicated in code is cheaper than a constraint violation that fails the whole transaction.

**Applies to:** any Kysely `.values([...])` over more than one row, especially `jobMaterial` / `methodMaterial` / any table with `NOT NULL DEFAULT` columns.

## `max_rows` is enforced in production but not by the local dev stack

```scope
id: max-rows-is-enforced-in-production-but-not-by-the-local-dev
paths: ["packages/planning/src/mrp/mrp.ts","packages/database/src/fetch-all.ts","packages/database/supabase/config.toml"]
triggers: ["fetchAllFromTable","fetchAllRecords","select(\"*\")","max_rows"]
```

**Context:** MRP's Phase-1 loads used bare `.select("*")` with no pagination, and had done so since the function was written. Every local test passed.

**Problem:** `packages/database/supabase/config.toml` sets `max_rows = 1000`, so PostgREST truncates responses in production. The crbn dev stack runs its own `postgrest` container without `PGRST_DB_MAX_ROWS`, so locally the same query returns everything — verified: a view with 2,497 rows returned all 2,497 locally. Two production tenants exceeded the cap on `openJobMaterialLines` (2,497 and 1,495 rows) and a third on `demandActual` (9,391), so MRP silently planned on truncated demand and its zeroing pass missed stale actuals. The bug is structurally invisible to local testing.

**Rule:** Outside MRP too, any PostgREST read that can exceed 1000 rows pages: `fetchAllFromTable`/`fetchAllRecords` from `@carbon/database` in app code, `fetchAll` (`@carbon/database/fetch-all`) in server functions and `@carbon/planning`. The rest (a stable `.order()`, the 1000-row cap that dev does not enforce) is in `.claude/rules/mrp-system.md`.

**Applies to:** `packages/planning/src/mrp/mrp.ts`, `packages/database/src/fetch-all.ts`, `packages/database/supabase/config.toml`, any `.select()` in `packages/planning/src/**` or `apps/erp/app/modules/**`.

## A client swap can change runtime value types (Kysely once returned NUMERIC as a string)

```scope
id: a-client-swap-can-change-runtime-value-types-kysely-once-ret
paths: ["apps/erp/app/modules/sales/sales.service.ts","packages/database/src/client.ts"]
triggers: ["upsertQuoteLinePrices","setTypeParser","getPostgresClient"]
```

**Context:** `upsertQuoteLinePrices` was converted from supabase-js to a Kysely transaction so its delete + reinsert would roll back as a unit. The conversion typechecked, and the shipped result silently stopped preserving `shippingCost`, `discountPercent` and `leadTime` on every markup change.

**Problem:** The function keys the snapshot of existing rows by quantity and looks each one up while building the reinsert. Through PostgREST a `NUMERIC` column arrives as a JS `number`, so `pricesByQuantity[10]` matched. Through node-postgres — which Kysely uses — the same column arrives as the string `"10.00000"`, because pg does not parse `NUMERIC` (oid 1700) to float and this repo sets no `setTypeParser` anywhere. Every `Map.get(10)` therefore missed, `existing` was always `undefined`, and each preserved field fell back to the caller's value: shipping to the column default `0`, discount and lead time to the zeros the recalculate route passes. The generated types say `number` on both paths, so `tsc` cannot see it — the mismatch exists only at runtime.

**Rule:** `BIGINT` still arrives as a string, as does a NUMERIC from a pool that is not built through the shared factory. Do not convert those for tidiness: `Number()` on a `BIGINT` loses precision past `Number.MAX_SAFE_INTEGER`. More generally: a client swap can change runtime value types without changing a single TypeScript type, so a typecheck is not evidence that a port behaves identically. Exercise it against a real database. The rest (the NUMERIC parser, no `Number(...)` wrappers, float8) is in `.claude/rules/numeric-precision.md` ("Runtime type decoding").

**Applies to:** `apps/erp/app/modules/sales/sales.service.ts` (`upsertQuoteLinePrices`), any `Kysely<KyselyDatabase>` service in `apps/erp/app/modules/**`, and the `getPostgresClient` pool in `packages/database/src/client.ts`.

## A header and the get-method copy into it share one transaction

```scope
id: a-header-and-the-get-method-copy-into-it-share-one-transacti
paths: ["apps/erp/app/modules/items/items.service.ts"]
triggers: ["createMakeMethodVersion","copyMakeMethod","makeMethodToMakeMethod","ensureDraftMakeMethod","createChangeNoticeDraftMethod"]
```

**Context:** New Version on a make method inserted the `makeMethod` header through supabase-js, set the source version Active, then ran get-method's `makeMethodToMakeMethod` copy, which opened its own Kysely transaction. A version change notice and the Onshape panel's Draft did the same in their own code.

**Problem:** When the copy failed it rolled back only its own rows. The empty Draft stayed, numbered above a source that was now Active and read-only. A first fix deleted them again after the failure; that cleanup could fail too, and it needed a delete the caller may not be allowed to make.

**Rule:** Put the header insert, any status change and the copy in ONE Kysely transaction and pass the transaction to `copyMakeMethod` as `db`. Every get-method body, and `createMakeMethodVersion` itself, joins a transaction it is handed, so a caller can add its own writes to the same commit (the change notice writes its `changeOrderId` in the insert; the Onshape Draft adds its line ownership and marker) instead of a second write after the commit that can fail alone. Kysely bypasses RLS, so check the policy's permission through the caller's client first (`requireCompanyPermission`), as `createRevision` does. The rest (`withTransaction`, never `db.transaction()`) is in `.claude/rules/database-patterns.md`.

**Applies to:** `createMakeMethodVersion` (`items.service.ts`) and its callers (`createMethodVersion`, `createChangeNoticeDraftMethod`, `ensureDraftMakeMethod`); any other header insert followed by a get-method copy (quote and job duplication, revisions).

## A JS array bound for a jsonb column must be stringified on the Kysely path

```scope
id: a-js-array-bound-for-a-jsonb-column-must-be-stringified-on-t
paths: ["packages/database/src/json.ts","apps/erp/app/modules/shared/shared.models.ts"]
triggers: ["priceTrace","toJsonColumns","toJson(","toTiptapDoc","internalNotes","additionalCharges","z.any()"]
```

**Context:** `quoteLinePrice.priceTrace` (a `PriceTraceStep[]`) is written both through
supabase-js (PostgREST) and through Kysely (`rewriteQuoteLinePrices`,
`saveQuoteLineWithPrices`, the get-method copies in `production.service.ts`). Quote → sales
order conversion (`convertDocument` in `shared.service.ts`, then the `convert` edge function) reads the quote with supabase-js and re-inserts its `internalNotes` /
`externalNotes` into `salesOrder` through Kysely inside the transaction. One quote had
`internalNotes` stored as a JSON string scalar, not a tiptap document. An API path wrote it,
and that path's validator typed `notes` as `z.any()`.

**Problem:** node-postgres and deno-postgres serialise a parameter by its JS type, not the
column's: an object becomes JSON, but an array becomes a Postgres array literal (`{a,b}`),
which a jsonb column rejects. A bare string is sent as raw text, so a JSON string scalar
round-trips as unquoted text and Postgres rejects the insert with `invalid input syntax for
type json`. supabase-js sends JSON either way, so the same row "works" on
one path and fails on the other — and typecheck sees nothing, since `Json` admits arrays.
The failure was opaque: the route sanitised the body, so Vercel only showed "Edge Function
returned a non-2xx status code". The real line was only in the Supabase function log. Every
retry failed the same way. The same latent fault sat in the RFQ → quote, supplier quote → PO
and quote revision copies.

The first fix covered only the `quote` header's `internalNotes` / `externalNotes` in
`quoteToQuote`. The per-line copy loop in the same function still spread the source row raw
(`{...line, quoteId, companyId}`) into `quoteLine`. That left `additionalCharges`,
`configuration`, `customFields`, `externalNotes`, `internalNotes` and `priceTrace`
unserialised, and `quoteOperation.workInstruction` (NOT NULL jsonb) was copied raw too. A
quote whose line holds one of these as a string or an array fails the copy every time with
the same 500. The caller's `fetchWithRetry` retried it up to 3 times. The failure lands inside
the same transaction as the `quote` / `quoteLine` / `quoteLinePrice` inserts, so it rolls back
cleanly (no duplicate).

**Rule:** On a Kysely write, `JSON.stringify` any jsonb value that can be an array (or a bare
string). Send every `json`/`jsonb` value through `toJson()` (or a row through
`toJsonColumns`) from `@carbon/database/json` (source `packages/database/src/json.ts`). It pre-serialises every non-null shape, so the wire value is
valid JSON text. A validator for a rich-text column is never `z.any()`. Use the shared
`optionalTiptapDoc` / `toTiptapDoc` in `shared.models.ts`: it turns text, a JSON-encoded doc
or a doc object into a tiptap document and rejects the rest. Put `.optional()` AFTER the
transform, or zod infers a required key. When you apply this fix, grep the whole function for
every `{...row}` spread and every raw `column: source.column` assignment into a jsonb column,
not only the columns known to be trouble. A partial rollout re-creates the same bug, only
narrower. When an edge function fails opaquely, read the function's own log (Supabase
management API `function_logs`), not the caller's.

**Applies to:** every `insertInto` / `updateTable` that sets a jsonb column — `priceTrace`,
`configuration`, notes (`internalNotes`, `externalNotes`), `customFields`,
`additionalCharges`, `workInstruction`, any copied row spread from a supabase-js read; the
posting Kysely inserts in `apps/erp/app/modules/*/*.service.ts`; every `*.models.ts` field that
feeds a rich-text column (the purchasing `notes: z.any()` fields still need this).

## A JSONB column returns object keys in another order than you wrote them

```scope
id: a-jsonb-column-returns-object-keys-in-another-order-than-you
paths: ["packages/ee/src/issue-sync/maps.ts"]
triggers: ["hashText","createHash(","fingerprint"]
```

**Context:** The issue sync's echo guard hashed `JSON.stringify` of a written rich text, and a JSONB read returned its keys re-ordered, so every inbound change echoed back (2026-10-19).

**Rule:** Outside the issue sync too, fingerprint JSON with sorted keys, never with plain `JSON.stringify`, when one side of the comparison may be a JSONB read. The rest (`hashText`) is in `.claude/rules/issue-sync.md`.

**Applies to:** snapshot, dedupe or change-detection hashes over JSON/JSONB columns.

## A PostgREST filter on an embedded column needs `!inner`, or it filters nothing

```scope
id: a-postgrest-filter-on-an-embedded-column-needs-inner-or-it-f
paths: []
triggers: ["!inner(","user(email)",".in(\"user."]
```

**Context:** The Linear and Jira inbound sync filtered `user.email` on a plain `user(email)` embed, so every synced issue went to the company's first employee (2026-10-19). Typecheck and a "returns rows" check both pass.

**Rule:** On EVERY query, not only `getCompanyEmployees`: when a filter on an embedded column must restrict the parent rows, embed it as `relation!inner(...)`. Test it with a non-matching value and expect zero rows. The rest is in `.claude/rules/linear-integration.md`.

**Applies to:** every `.eq/.in/.ilike("embed.column", …)` on a Supabase select.

## An unchecked supabase-js insert turns a NOT NULL violation into silence

```scope
id: an-unchecked-supabase-js-insert-turns-a-not-null-violation-i
paths: ["apps/erp/app/routes/x+/inspection+/$id.reject.tsx","apps/erp/app/routes/x+/issue+/new.tsx"]
triggers: ["nonConformanceItemTrackedEntity",{"text":".insert(","minCount":3}]
```

**Context:** Inspection rejects were supposed to seed `nonConformanceItemTrackedEntity` links on the NCR's default Scrap row so the MRB could split or reassign specific entities. Nothing ever appeared. Both writers — `x+/inspection+/$id.reject.tsx` and `x+/issue+/new.tsx`'s job-operation auto-link — built their rows without `nonConformanceId`, which is `NOT NULL` on that table (`20260421130000_nc-item-tracked-entity.sql`).

**Problem:** Every such insert returned a 23502, and nobody read it. The reject route did `await (serviceRole as any).from(...).insert(rows)` and discarded the result entirely, so the feature had never worked in production and no error surfaced anywhere. supabase-js does not throw — it resolves to `{ data, error }` — so an unchecked insert is indistinguishable from a successful one, and the `as any` cast additionally hid that the row type was missing a required column. A Kysely insert in the same place would have thrown.

**Rule:** Never discard a supabase-js write result — bind it and check `.error`, even for a fire-and-forget link write. Treat `as any` on a `.from(...).insert(...)` as a defect in review: the cast exists precisely because the row object does not satisfy the generated type, which is the compiler telling you a required column is missing. When a "seeded" side table is mysteriously empty, check the writer's error handling before suspecting the read. (Enforced by `no-discarded-query-error`.)

**Applies to:** every `.from(...).insert(...)` / `.update(...)` whose result is not bound, especially in post-commit "also link X" tails; fixed for both writers in PR #1612 by moving them into a Kysely transaction under `lockIssueDispositions`.

## Composite (`id, companyId`) FKs break PostgREST `alias:column(...)` embeds

```scope
id: composite-id-companyid-fks-break-postgrest-alias-column-embe
paths: ["apps/erp/app/modules/purchasing/purchasing.service.ts"]
triggers: ["Id(id","Id(*)","Id (*)","purchasingRfqSupplier"]
```

**Context:** RFQ supplier linking silently failed — `getPurchasingRFQSuppliersWithLinks` / `getPurchasingRFQSuppliers` (`purchasing.service.ts`) returned an empty `suppliers` array even though the `purchasingRfqSupplier` row existed, so the Properties multiselect never showed linked suppliers and an optimistic add reverted on revalidation.

**Problem:** The embed `.select("*, supplier:supplierId(id, name)")` uses the `alias:foreignKeyColumn(...)` disambiguation form. That only resolves when `supplierId` is a **single-column** FK. Multi-tenant FKs here are **composite** — `purchasingRfqSupplier_supplierId_fkey FOREIGN KEY ("supplierId","companyId") REFERENCES supplier(id,"companyId")` — so PostgREST returns `PGRST200: Could not find a relationship ... 'supplierId' ... Perhaps you meant 'supplier'`. The whole query errors, `data` is null. Loaders that do `result.data?.map(...) ?? []` (and never check `result.error`) swallow it as "no rows". Same bug hit the nested `supplier:supplierId (*)` inside `supplierQuote:supplierQuoteId(*, ...)` for linked-quote reads.

**Rule:** For a composite-FK relationship, embed by **target table name** — `.select("*, supplier(id, name)")` (or the explicit constraint `supplier:supplier!purchasingRfqSupplier_supplierId_fkey(...)`), never `alias:fkColumn(...)`. Verify a PostgREST embed against the running REST API (`/rest/v1/<table>?select=...` with the service-role key) — PGRST200 is a schema-cache error returned even on empty tables. And when a loader powers UI state, check `.error`, don't `?? []` a failed query into silent emptiness.

**Applies to:** any supabase-js embed on a join table with a composite `(entityId, companyId)` FK — `purchasingRfqSupplier`, `supplierQuote.supplierId`, and siblings; `apps/erp/app/modules/purchasing/purchasing.service.ts`.

## Generated DB types must come from a migration-built database, never a restored snapshot

```scope
id: generated-db-types-must-come-from-a-migration-built-database
paths: ["packages/database/src/types.ts","packages/dev/src/commands/restore.ts"]
triggers: ["db:types","generate:types","unidiff-zero"]
```

**Context:** `crbn restore` ends with `pnpm db:types`. Those regenerated types were then swept into a commit by `git add -A`, putting 194 lines of unrelated churn into a webhooks/RLS PR. In another case, a worktree's local database was shared by every branch checked out in it. `pnpm db:migrate` regenerates `packages/database/src/types.ts` from that database, not from the branch's migrations.

**Problem:** A production snapshot carries whatever the source environment accumulated outside the migration stream, so types generated from it describe *that* database rather than the schema the migrations define. The diff added a `v_readable_id` relation absent from `main` — not a schema object at all, but a plpgsql local (`v_readable_id TEXT;` … `SELECT … INTO v_readable_id, v_company_id`) that ran somewhere in a plain-SQL context, where `SELECT … INTO` is CREATE-TABLE-AS. An accidental artifact table exists in the snapshot, and regenerating baked it into the repo's public type surface, alongside `procedureStep`→`procedureAttribute` FK-name churn. A shared worktree database does the same: the regenerated types picked up another branch's table, and columns on two SQL functions that no migration defines. CI's "Database types" job regenerates from migrations alone, so the committed types failed it. Applying the wanted hunks with `git apply --unidiff-zero` then put new function types inside an unrelated type, because zero-context hunks do not anchor in a 100k-line file.

**Rule:** Never commit `packages/database/src/types.ts` generated after a `crbn restore` — regenerate against a migration-built database first. `crbn restore` now warns about this. Stage generated types explicitly rather than with `git add -A`, and diff them before committing: any relation appearing that no migration defines is drift from the source environment, not a schema change. After every regeneration, diff `types.ts` against the base branch, keep only the lines your migration explains, and restore the rest. Move those lines by matching text (the table's `Row` / `Insert` / `Update` blocks, the function's alphabetical neighbour), never by zero-context patches. The typecheck and CI's "Database types" job are the proof. Separately, `SELECT … INTO <name>` in a SQL (non-plpgsql) context silently creates a table — a real hazard when copying plpgsql bodies into migrations.

**Applies to:** `packages/dev/src/commands/restore.ts`, `packages/database/src/types.ts`; any branch with a migration, in a worktree whose database has run other branches' migrations.

## Kysely returns `date` columns as JS `Date`s; PostgREST returns strings

```scope
id: kysely-returns-date-columns-as-js-date-s-postgrest-returns-s
paths: ["packages/database/src/client.ts"]
triggers: ["toPostingDateString","BaseEntitySyncer","setTypeParser"]
```

**Context:** Porting Ramp's outbound draft-bill push from a Supabase-client job into a
`BaseEntitySyncer` (which uses Kysely) — `.ai/plans/implemented/2026-09-23-spend-outbound-event-engine.md`.

**Problem:** `purchaseInvoice.dateIssued` / `dateDue` are `date` columns. Read through
PostgREST they arrive as `"2026-09-15"` strings; read through Kysely's pg driver they
arrive as JS `Date` objects, which `JSON.stringify` renders as a full ISO timestamp.
Ramp rejected every draft bill with `422 DEVELOPER_7001 "Not a valid date"`. Typecheck
did not catch it — the syncer's local type declared `string | null` and the Kysely row
was assigned straight in. Unit tests did not catch it either; only a live push did.

**Rule:** The rest (DATE decodes to a string, timestamps are still `Date`s, normalize with
`toPostingDateString`) is in `.claude/rules/date-handling.md`.

**The deeper rule:** a runtime/type mismatch that the GENERATED types already paper over
is invisible to typecheck by construction. Fix it at the driver, not with a helper at
every call site — the helper is what 34 call sites and ~16 `instanceof Date` guards were.

**Applies to:** any `packages/ee` syncer or `packages/jobs` function reading timestamp
columns through Kysely and sending them to a provider API.

## Never build PostgREST `.or()` filter strings from external values

```scope
id: never-build-postgrest-or-filter-strings-from-external-values
paths: ["apps/erp/app/routes/api+/integrations.onshape.*"]
triggers: [".or(`"]
```

**Context:** Mapping-row deletes used `.or(`entityId.eq.${id},externalId.eq.${externalId}`)` where `externalId` embeds an Onshape part number.

**Problem:** A part number containing `,` or `(` `)` changes the filter's meaning — the value is interpolated into PostgREST's filter grammar unquoted, so the delete can match other rows or fail. Every `.in()` / `.eq()` call passes values as parameters and is immune.

**Rule:** Use `.eq()` / `.in()` instead of a hand-built `.or()` string whenever any operand comes from outside Carbon (CAD part numbers, external ids, user text). Chained filters on one query are AND-ed, so an OR across two columns ("remove mappings matching `entityId` OR `externalId`") becomes one parameterized statement PER COLUMN — two separate deletes — never both filters chained onto one delete, which removes only rows matching both and leaves the conflicting row that the next insert trips over.

**Applies to:** every Supabase client call with `.or(` whose operands are not literals; `apps/erp/app/routes/api+/integrations.onshape.*`.

## Rows inserted in one transaction share `createdAt`

```scope
id: rows-inserted-in-one-transaction-share-createdat
paths: []
triggers: ["ORDER BY \"createdAt\"","orderBy(\"createdAt\"","order(\"createdAt\""]
```

**Context:** The inspection plan editor listed features `ORDER BY "createdAt"`. The save
RPC (`save_inspection_document_atomic`) creates every new feature in one transaction.

**Problem:** `NOW()` is fixed for the whole transaction, so those features tie, and Postgres
returns ties in heap order. An `UPDATE` writes a new tuple at the end of the heap, so the
feature someone just edited dropped to the bottom after a reload. Its neighbour then sat in
its place, and the edit read as "not saved" although the database had it.

**Rule:** An `ORDER BY` on a timestamp that a batch insert sets needs a deterministic
tiebreak (a label, a sort order, then the id). Never rely on insertion order surviving.

**Applies to:** any list ordered by `createdAt` whose rows are written together — RPCs,
Kysely transactions, `insertInto(...).values([...])`, seeds.

## `@ts-expect-error TS2589` on Supabase joined-selects is fragile — flips "used/unused" as files are added

```scope
id: ts-expect-error-ts2589-on-supabase-joined-selects-is-fragile
paths: []
triggers: ["TS2589"]
```

**Context:** A set of sibling routes each ran the same Supabase joined select. Some carried `// @ts-expect-error TS2589 — … type instantiation too deep`. Adding an unrelated new route file (`periods.generate.tsx`) flipped which file the checker reported: `material` went from TS2578 (unused directive) to clean, `tool` went from clean to TS2589 — a whack-a-mole that broke `erp` typecheck without touching those files.

**Problem:** TS2589 ("type instantiation is excessively deep") on PostgREST joined-select types is **order/threshold dependent** — it surfaces at whichever file crosses a cumulative-depth limit during a given check pass, so which file errors changes as files are added/removed elsewhere. `@ts-expect-error` *requires* an error on the next line, so a directive that was "used" becomes an "unused directive" (TS2578) the moment the trigger moves — and the newly-triggering file now lacks a directive (TS2589). Swapping directives just moves the problem.

**Rule:** Don't manage TS2589 on Supabase joined-selects with `@ts-expect-error` — it *requires* an error, so it flips to TS2578 the moment the trigger moves to another file. Use `@ts-ignore` instead: it suppresses the error when it fires and stays green when it doesn't, and it preserves the inferred `result` type. A localized `(client as any)` cast is the heavier alternative — it removes the file from the cumulative-depth pool entirely but drops the result's type; prefer `@ts-ignore` unless you specifically need to break the inference chain.

**Applies to:** any Supabase joined select or embed that trips TS2589.
