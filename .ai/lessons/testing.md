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

**Context:** The 1,495-operation API sweep triaged all 274 WRITE-op 400s as "reached the DB, expected FK rejections" and flagged only 500s. `inventory_insertManualInventoryAdjustment` came back 400 with `"Failed to create manual inventory adjustment"` and was waved through — but that string is the service's FALLBACK for an edge-function error whose real message was suppressed. A customer later hit exactly this: the published schema advertised 12 `adjustmentType` values (the validator spread `itemLedgerTypes` into its enum) while the `post-inventory-adjustment` edge function accepts 5, so every LLM-guided "add stock" call failed undiagnosably.

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

## A test that stays green when you break the code guards nothing

```scope
id: a-test-that-stays-green-when-you-break-the-code-guards-nothi
paths: ["**/*.test.ts","**/*.test.tsx"]
triggers: []
```

**Context:** A 2026-11 prune of every test file in the repo (1,268 files) deleted about 300 tests and rewrote about 300 more.

**Problem:** Most of them passed when the code was wrong. Some had an expected value computed by the function under test. Some checked only that two legs sum to zero, which still passes with the signs swapped. Some never reached the branch their name describes, and some ran a fake that ignores the filter it tests. Others failed when nothing a user sees had changed: pinned UI copy, call order, a constant echoed back. A test that only guarded the same rule in another package doubled the upkeep.

**Rule:** Before you commit a test, make the bug it names in the code and watch the test fail. Write expected values as literals. Grep for an existing test of the same rule first. The full list of patterns is in `.claude/rules/testing.md` → "Before you commit one: break the code".

**Applies to:** every committed `*.test.ts` / `*.test.tsx`, including the regression test of a fix.

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

## A mock of a function in the same file does not intercept

```scope
id: a-mock-of-a-function-in-the-same-file-does-not-intercept
paths: ["apps/erp/test/**","apps/erp/app/modules/**/*.test.ts"]
triggers: ["vi.mock(","vi.spyOn("]
```

**Context:** The migration moved callers into the same module file as the functions they call (2026-10-16).

**Problem:** `vi.mock` replaces a module's exports for importers in other files. A call from one function to another inside the same file goes to the real function, so tests that mocked the callee started calling the database, or passed while testing nothing.

**Rule:** Stub only a real boundary (the Supabase client, `fetch`, the clock), as `.claude/rules/testing.md` says. A test that only checks which internal functions were called gets deleted, not repointed.

**Applies to:** tests under `apps/erp/test/` and `apps/erp/app/modules/**`.

## A tested `assert*` helper that is never imported is worse than none — it reads as a guard that is not there

```scope
id: a-tested-assert-helper-that-is-never-imported-is-worse-than
paths: ["packages/utils/src/batch-time-split.ts"]
triggers: ["export function assert","export const assert"]
```

**Context:** `batch-time-split.ts` exported `assertAllOperationsClaimed` (concurrent-claim race guard) and `assertBatchWorkCenterMutable` (completed-batch immutability guard), both unit-tested. Neither was ever imported by the `batch-operations` edge function — the `update` branch happily re-pointed a Completed batch's work center, and the claim had no `IS NULL` race guard.

**Problem:** The presence of a well-named, tested guard function signals "this invariant is enforced." A reviewer (and the author) reads the export list and assumes coverage. Dead safety helpers give false confidence precisely where the risk is highest.

**Rule:** Wire a safety `assert*` into its call site in the same change that introduces it, or don't write it yet. When reviewing, grep every exported `assert*`/guard for a real importer — an unused one is a finding, not dead weight to leave. Duplicated cross-runtime logic (Node + Deno copies) should re-export one source (`precision.ts` / `batch-time-split.ts` pattern) rather than rely on "keep in sync" comments.

**Applies to:** `packages/utils/src/**`, `packages/database/src/**`, any exported guard/assert helper.

## The root `.env` overrides `.env.local`, so a worktree's DB port is not the default

```scope
id: the-root-env-overrides-env-local-so-a-worktree-s-db-port-is
paths: ["apps/erp/test/database/fixtures/**"]
triggers: ["SUPABASE_DB_URL","databaseTest"]
```

**Context:** Running the `post-reimbursement` Deno tests with the
`SUPABASE_DB_URL` I found first gave `16 passed | 12 failed`. Re-running the
UNTOUCHED `post-charge` suite gave `19 passed | 16 failed` — the same shape,
failing at the same fixture line. The connection string was wrong, not the code.

**Problem:** Each `crbn` worktree gets its OWN Postgres container on a random
host port (`docker ps` showed `0.0.0.0:49921->5432`), written to `.env.local`.
The root `.env` still carries the stock `54322`, and it WINS — the same
precedence trap that produced the `db:check:backups` fix in `c1c5e7c138`. Port
54322 is often another worktree's live stack, so you don't get "connection
refused"; you connect to a real database with the wrong schema and read the
failures as a bug in your own change.

**Rule:** Get the port from `docker ps --format '{{.Names}}\t{{.Ports}}' | grep
postgres` (or this worktree's `.env.local`) and pass it explicitly. Before
believing a Deno/DB test failure is yours, run a NEIGHBOURING suite you did not
touch — `post-charge` next to `post-reimbursement`. Identical failure counts in
untouched code means the environment, not the diff.

Vitest reads `SUPABASE_DB_URL` from the root `.env` too, so DB-backed vitest suites
(`databaseTest` in `apps/erp/test/database/fixtures/local-database.ts`) connect to the stale port: they do not skip, because the host is still local. Export the
worktree's URL before you run them:
`export SUPABASE_DB_URL="$(grep -h '^SUPABASE_DB_URL' .env.local | cut -d= -f2- | tr -d '"')"`.

**Applies to:** DB-backed tests (`apps/erp/test/database/fixtures/`, vitest `databaseTest`); any `pnpm db:check:*` or psql work inside
a Conductor worktree.
