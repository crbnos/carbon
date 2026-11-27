# Testing lessons

Vitest, database tests, browser tests, conformance checks as tests.

## A conformance check is only as good as its source glob — route modules are server AND client in one file

```scope
id: a-conformance-check-is-only-as-good-as-its-source-glob-route
paths: ["packages/checks/src/sources/server-files.ts","packages/checks/src/conformance/*.ts"]
triggers: ["maskClientCode","SERVER_CHECKS","ConformanceCheck"]
```

**Context:** The timezone audit (branch `sid/timezone-tz-audit`, PR #1339) added the `no-local-timezone` conformance check to ban process-timezone day derivation in server code. Self-review then found 26 surviving violations in route files, plus more in files the check DID scan using idioms it didn't match.

**Problem:** Two independent under-coverages compounded. (1) The check's source globs (`sources/server-files.ts`) listed services, jobs, and edge functions but not `apps/*/app/routes` — and collected only `.ts`, never `.tsx` — so route loaders/actions (server code!) were never scanned. (2) The banned-pattern list encoded only the idioms already found (`getLocalTimeZone(`, UTC-slicing), not the bug class — `new Date().getDay()` shift rosters and `setHours(0,0,0,0)` week boundaries sailed through in files that WERE scanned. Naively adding the route glob would over-flag: a route module's default export, `clientLoader`/`clientAction`, and hooks run in the browser where the local timezone is correct. Masking IN loader/action bodies also failed — module-level helpers a loader calls (e.g. `getExpiredItemIds`) are server code outside those bodies.

**Rule:** When authoring a conformance check, verify the checker actually loads every file class the rule applies to (run it, count the files, grep one known-bad file into the scan). Ban the bug class, not just the instances you found — then run the widened pattern over the full source set and fix or baseline everything it surfaces before landing. For React Router route modules, path-level globs are the wrong granularity: mask OUT the client regions by declaration shape (`maskClientCode` blanks default export / `clientLoader` / `clientAction` / PascalCase and `use*` declarations) so server helpers stay covered; masking IN named exports under-covers. And when masking by line shape, the region CLOSER is as bug-prone as the opener: a `)` closer that also matches a multi-line signature's `) {` line ends the region before the body and un-masks client code (only statement-terminating `)`/`);` lines close a region), while an expression-bodied one-liner (`const X = () => null;`) must never OPEN a region at all — pin both shapes as regression tests.

**Applies to:** `packages/checks/src/sources/server-files.ts` + `conformance/no-local-timezone.ts`; any new `SERVER_CHECKS` rule; any lint/conformance gate keyed on file paths over `apps/*/app/routes`.

## A module first loaded inside a `vi.mock` factory binds the unmocked module

```scope
id: a-module-first-loaded-inside-a-vi-mock-factory-binds-the-unm
paths: ["apps/erp/test/*.test.ts","apps/erp/app/modules/**/*.test.ts"]
triggers: ["importOriginal"]
```

**Context:** ERP unit tests mock `shared.service` with `importOriginal` and override `invokePosting`. `shared.service.ts` imports other module services (`resources`, `sales`, `production`), and they import it back.

**Problem:** `importOriginal` evaluates the real `shared.service`, and that evaluates its imports. A module whose first evaluation happens there binds the real `shared.service`, because the mock is not built yet. Its calls then skip the mock. A new import edge elsewhere (`inventory.service` → `production.service`) changed the load order and broke tests that had passed for weeks.

**Rule:** Before the module under test, load the service that makes the mocked call: `await import("../app/modules/<module>/<module>.service")`, with a comment that says why. If a mock does not intercept, check the import order first.

**Applies to:** `apps/erp/test/*.test.ts`, `apps/erp/app/modules/**/*.test.ts` that mock `shared.service`.

## In a bulk API sweep, a 4xx carrying a service's generic fallback string is a finding, not a pass

```scope
id: in-a-bulk-api-sweep-a-4xx-carrying-a-service-s-generic-fallb
paths: ["apps/erp/app/modules/*/[a-z]*.models.ts","packages/api/src/errors.ts","packages/utils/src/errors.ts"]
triggers: ["getErrorMessage","itemLedgerTypes"]
```

**Context:** The 1,495-operation API sweep triaged all 274 WRITE-op 400s as "reached the DB, expected FK rejections" and flagged only 500s. The manual inventory adjustment write (today `adjustInventory` in `inventory.server.ts`) came back 400 with `"Failed to create manual inventory adjustment"` and was waved through — but that string is the service's FALLBACK for a posting error whose real message was suppressed. A customer later hit exactly this: the published schema advertised 12 `adjustmentType` values (the validator spread `itemLedgerTypes` into its enum) while the posting accepted 5, so every LLM-guided "add stock" call failed undiagnosably.

**Problem:** Bucketing sweep results by status code alone treats "the request was validly rejected" and "the error was swallowed somewhere in the chain" as the same outcome. The ops most likely to be broken-by-contract-drift are precisely the ones that fail with a generic message, because the generic message IS the symptom of a suppressed real error.

**Rule:** When triaging sweep failures, grep the response bodies for known fallback strings (`"Failed to *"` service fallbacks, `getErrorMessage` fallback arguments) and treat each match as a defect to root-cause: either the advertised schema disagrees with the actual acceptor (enum/shape drift between a `.models.ts` validator and a server function's `input` schema), or an error-sanitization layer is eating a legible message. Published-schema enums must be exactly what the write path accepts — never a wider "domain" enum reused for convenience.

**Applies to:** API/MCP sweep scripts, `apps/erp/app/modules/*/[a-z]*.models.ts` validators that feed posting wrappers, `packages/api/src/errors.ts`, `packages/utils/src/errors.ts`.

## `pg_temp.allows` cannot see a policy's role list

```scope
id: pg-temp-allows-cannot-see-a-policy-s-role-list
paths: ["packages/database/supabase/tests/authz-*.test.sql"]
triggers: ["pg_temp.allows"]
```

**Context:** `authz-pieces.test.sql` evaluates a policy with `pg_temp.allows(table, command, clause, row)`, which reads the policy's `USING` or `WITH CHECK` text from `pg_policies` and runs it as the current role.

**Problem:** It ignores `pg_policies.roles`. `exchangeRate` kept API keys out with `TO authenticated USING (true)`, so an `allows('exchangeRate', …)` assertion made as `anon` passed against the old policy: the test could not fail.

**Rule:** For a policy restricted by `TO <role>`, or whenever the role decides, test the behaviour instead: select from the table, or call the function that reads it (`get_exchange_rate`), as that role. Prove the assertion red against the old policy before trusting it.

**Applies to:** `packages/database/supabase/tests/authz-*.test.sql` and any test built on `pg_temp.allows`.

## An SQL test that inserts an employee needs the company's root group first

```scope
id: an-sql-test-that-inserts-an-employee-needs-the-company-s-roo
paths: ["packages/database/supabase/tests/*.sql"]
triggers: ["INSERT INTO \"employee\"","getGroupId","employeeTypeId"]
```

**Context:** Seeding employees in a `supabase/tests/*.test.sql` file (`rpc-privileges.test.sql`, 2026-10-26).

**Problem:** The `employee` insert fires the employee-type group interceptor, which needs the company's "All Employees" root group. A test company made by hand has no root group, so the insert fails. `SET session_replication_role` is not permitted there.

**Rule:** Insert the root group first, with the id `getGroupId` builds: `'00000000-0000-' || substr(c,1,4) || '-' || substr(c,5,4) || '-' || substr(c,9,12)` for company id `c`. Then insert the employee type and the employee.

**Applies to:** SQL tests under `packages/database/supabase/tests/` that create employees.

## Browser-testing MES flows that write data

```scope
id: browser-testing-mes-flows-that-write-data
paths: []
triggers: ["agent-browser"]
```

- **Context:** Verifying AssemblyView keyboard shortcuts with agent-browser while editing the same file (Vite HMR live).
- **Problem:** Step records appeared at timestamps with no corresponding keypress; hours went into suspecting the new code. Cause: overlapping test sessions — a page left open across HMR edits (sometimes with a modal up) replays/refires interactions, and interleaved key presses land on freshly auto-advanced steps.
- **Rule:** When a browser test writes rows, run it as a closed loop: wipe the rows, reload the page fresh, then check the DB after EVERY single action before pressing the next key. Never diagnose from an accumulated tail of prior test sessions.
- **Applies to:** agent-browser verification of any MES/ERP flow with side effects, especially while HMR is live.

## Demo-seeded attributes can make a dead query look alive

```scope
id: demo-seeded-attributes-can-make-a-dead-query-look-alive
paths: []
triggers: ["attributes->>","attributes ->>"]
```

- **Context:** The supplier-return entity picker filtered `trackedEntity` on `attributes ->> Supplier`. Browser verification on the local DB showed results, so the query looked correct.
- **Problem:** No production code ever writes a `Supplier` attribute — the 49 local entities carrying it came from MCP demo seeding (Axiom/Northspoke programs). In production the picker would always be empty. Verification against hand-seeded data validated the seed, not the code.
- **Rule:** Before anchoring a query on a `trackedEntity.attributes` key, grep for the WRITER of that key in app + edge-function code (receipt tracking writes `Receipt`/`Receipt Line`/`Receipt Line Index`; shipment tracking writes `Shipment`/`Shipment Line`). If the only writers are tests or seeds, the key does not exist in production. Local rows proving a filter matches prove nothing about who writes the attribute.
- **Applies to:** any `attributes ->> X` filter on trackedEntity/trackedActivity; browser verification on a DB that has been demo-seeded.

## Raw-SQL item fixtures break type-specific UI — Material items need a companion `material` row keyed by readableId

```scope
id: raw-sql-item-fixtures-break-type-specific-ui-material-items
paths: ["apps/erp/app/routes/x+/items+/$itemId.properties.tsx"]
triggers: ["INSERT INTO \"item\"","get_material_details","get_part_details","get_tool_details"]
```

**Context:** Posting-flow verification created a type-`Material` item (RM-STEEL) with a raw `INSERT INTO "item"`. Interceptors auto-created `itemCost`/`itemReplenishment`/etc., so purchasing and posting worked. Later, selecting that material on a part's BOM (`/x/part/{id}/details?materialId=…`) crashed the whole page with "Not Found".

**Problem:** Type-specific detail RPCs join companion tables the interceptors do NOT create: `get_material_details` requires a `material` row joined via `material."id" = item."readableId"` (readableId, not item id — all revisions share one taxonomy row). The properties route throws `404` when the RPC returns nothing, and a fetcher 404 bubbles to the route error boundary, taking down the entire details page.

**Rule:** When creating item fixtures via SQL, create the type's companion row too (`material` keyed by `readableId` for Materials; check the `get_{type}_details` RPC joins for the type). Prefer creating fixtures through the UI or service functions when the item will be used in UI flows, not just ledger posting.

**Applies to:** any psql/SQL test-fixture item creation; `get_material_details` / `get_part_details` / `get_tool_details` consumers; `apps/erp/app/routes/x+/items+/$itemId.properties.tsx`.

## A tested `assert*` helper that is never imported is worse than none — it reads as a guard that is not there

```scope
id: a-tested-assert-helper-that-is-never-imported-is-worse-than
paths: ["packages/utils/src/batch-time-split.ts"]
triggers: ["export function assert","export const assert"]
```

**Context:** `batch-time-split.ts` exported `assertAllOperationsClaimed` (concurrent-claim race guard) and `assertBatchWorkCenterMutable` (completed-batch immutability guard), both unit-tested. Neither was imported by the code that ran batch operations at the time — the `update` branch happily re-pointed a Completed batch's work center, and the claim had no `IS NULL` race guard.

**Problem:** The presence of a well-named, tested guard function signals "this invariant is enforced." A reviewer (and the author) reads the export list and assumes coverage. Dead safety helpers give false confidence precisely where the risk is highest.

**Rule:** Wire a safety `assert*` into its call site in the same change that introduces it, or don't write it yet. When reviewing, grep every exported `assert*`/guard for a real importer — an unused one is a finding, not dead weight to leave. Duplicated cross-runtime logic (Node + Deno copies) should re-export one source (`precision.ts` / `batch-time-split.ts` pattern) rather than rely on "keep in sync" comments.

**Applies to:** `packages/utils/src/**`, `packages/database/src/**`, any exported guard/assert helper.

## The root `.env` overrides `.env.local`, so a worktree's DB port is not the default

```scope
id: the-root-env-overrides-env-local-so-a-worktree-s-db-port-is
paths: ["apps/erp/test/database/fixtures/**"]
triggers: ["SUPABASE_DB_URL","databaseTest"]
```

**Context:** Database tests in a worktree failed in fixtures they never touch: `relation "companyGroup" does not exist`, also on unedited files. The connection string was wrong, not the code.

**Problem:** `crbn` loads `.env.local` over `.env` for itself, but a test runner does not use that loader. Vitest and the Deno tests read `SUPABASE_DB_URL` from the root `.env`, which points at the shared Postgres on 54322 with the stock `postgres` database. A worktree's schema lives in its own `wt_<slug>` database, named in that worktree's `.env.local`. The host is local, so `databaseTest` does not skip: the tests connect to a real database with the wrong schema, and the failures look like a bug in your change.

**Rule:** Before you run database tests, export this worktree's URL: `export SUPABASE_DB_URL="$(grep -h '^SUPABASE_DB_URL' .env.local | cut -d= -f2- | tr -d '"')"`. If `.env.local` is missing, the worktree has no database yet: run `crbn up`. Before you believe a failure is yours, run a neighbouring suite you did not touch. The same failures in untouched code mean the environment, not the diff.

**Applies to:** DB-backed tests (`apps/erp/test/database/fixtures/`, vitest `databaseTest`); any `pnpm db:check:*` or psql work inside
a Conductor worktree.

## A race test that relies on Promise.all can pass without the lock

```scope
id: a-race-test-that-relies-on-promise-all-can-pass-without-the
paths: ["apps/erp/test/database/**"]
triggers: ["raceBehindRowLock"]
```

**Context:** Database tests for postings that read a row, then write from that read (a lot split, a serial increase, a calibration update).

**Problem:** Two posts run with `Promise.all` interleave by timing. Often one finishes before the other starts, so the test passes with the row lock removed.

**Rule:** Hold `FOR UPDATE` on the row from a third connection. Start each post on its own connection. Release the row only once every post's backend waits on a lock (`pg_stat_activity.wait_event_type = 'Lock'` by pid). `raceBehindRowLock` (`apps/erp/test/database/fixtures/row-lock-race.ts`) does this. Check the test fails with the lock removed.

**Applies to:** Concurrency tests under `apps/erp/test/database/`.

## Database fixtures turn the interceptors off

```scope
id: database-fixtures-turn-the-interceptors-off
paths: ["apps/erp/test/database/fixtures/local-database.ts"]
triggers: ["connectLocalTestDatabase"]
```

**Context:** `connectLocalTestDatabase` sets `app.sync_in_progress`, so the event-system interceptors do not run.

**Problem:** A test that needs a row an interceptor creates (an item insert's `itemCost`) finds none, and a guard that reads it looks broken.

**Rule:** Set `app.sync_in_progress` to `false` around the call that needs the interceptor, inside the test's transaction.

**Applies to:** Database tests of item creates, and any write whose side rows come from an interceptor.
