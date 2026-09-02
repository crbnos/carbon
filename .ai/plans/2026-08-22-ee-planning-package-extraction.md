# @carbon/ee/planning extraction — implementation plan

**Spec:** .ai/specs/2026-08-22-ee-planning-package-extraction.md
**Research:** (inline in spec — grounded via branch inventory + caller maps 2026-08-22)
**Branch:** naveen/capacity-planning

## Guiding contract

**Pure relocation, ZERO behavior change.** No SQL, no schema, no generated-types
diff, no UI change. Move engine code; keep every Deno function that is NOT being
deleted working unchanged. When a step reveals the approach is wrong, STOP and
report rather than improvising logic.

## Strategy (why the moves are shaped this way)

- The finite-scheduling engine (`functions/lib/scheduling/**`) and the MRP
  orchestration (`functions/mrp/index.ts` body) **move** into
  `packages/ee/src/planning/`.
- The shared **leaf helpers** they depend on stay in `functions/lib/` because
  other Deno functions still import them, and are reached from Node via new
  `@carbon/database/*` re-export barrels (same pattern as the existing
  `@carbon/database/client` and `@carbon/database/scheduling`):
  - `datetime.ts` (21 other Deno consumers), `methods.ts` (2), `logging.ts` (6),
    `mrp-engine.ts` (also used by `recalculate/index.ts` + `job-quantities-engine.ts`),
    `fetch-all.ts` (2), `supersession-pick.ts` (2), `postgres/index.ts` (already
    bridged via `@carbon/database/client`).
- `scheduling/types.ts` is scheduling-internal and **moves** with the engine.
- `@carbon/checks` already scans `packages/ee/src`, so relocated math stays covered
  with **no check change** — Task 10 only verifies.
- Moved files keep their Deno-style `./x.ts` relative extensions (ee's tsconfig sets
  `allowImportingTsExtensions: true`); only their `../` external imports repoint.

## Repointing table (external imports in moved files → Node target)

| Deno import in moved file | Symbols | Repoint to |
|---|---|---|
| `../types.ts` | `type Database` | `@carbon/database` |
| `../postgres/index.ts` | `type DB` (and client fns in mrp) | `@carbon/database/client` |
| `../methods.ts` | `getJobMethodTree`, `type JobMethodTreeItem` | `@carbon/database/methods` (NEW) |
| `../datetime.ts` | `datetime`, `getCompanyTimeZone`, `getLocationTimeZone` | `@carbon/database/datetime` (NEW) |
| `../logging.ts` | `getFunctionLogger` | `@carbon/database/logging` (NEW) |
| `../mrp-engine.ts` | `explodeBom`, `makeKey`, … (mrp only) | `@carbon/database/mrp-engine` (NEW) |
| `../fetch-all.ts` | `fetchAll` (mrp only) | `@carbon/database/fetch-all` (NEW) |
| `../supersession-pick.ts` | `buildSupersessionRedirectMap` (mrp only) | `@carbon/database/supersession-pick` (NEW) |

`./`-relative imports inside `scheduling/**` are unchanged (they move together).

## Progress
- [x] Task 1: Add `@carbon/database` re-export barrels for the shared leaf helpers
- [x] Task 2: Scaffold `packages/ee/src/planning/` + `./planning` export
- [x] Task 3: Move `scheduling/**` source into the package and repoint external imports
- [x] Task 4: Convert the 13 scheduling Deno tests to vitest (165 tests pass)
- [x] Task 5: Extract MRP orchestration into `planning/mrp/mrp.ts`
- [x] Task 6: Wire `planning/index.ts` exports; typecheck + test the package (721 tests)
- [x] Task 7: Repoint the 8 `@carbon/database/scheduling` call sites
- [x] Task 8: Repoint MRP callers in-process; rename `forecastCalendar.server.ts`
- [x] Task 9: Delete edge functions, `config.toml` entry, and the scheduling bridge
- [x] Task 10: Verify conformance (@carbon/checks) — baseline refreshed, 69 tests pass
- [x] Task 11: Update the 6 documentation targets (docs build passes)
- [x] Task 12: Verification — per-package typecheck green (ee/database/jobs/erp), lint 33/33, ee(721)+scheduling(165)+checks(69) tests green, `pnpm run build` 8/8 green (erp bundles @carbon/ee/planning), generate:types no-op.
- [~] Task 13: Behavior-equivalence + browser verification — DEFERRED. Host recovered (load ~5) but the ERP dev server is down (persistent 502; crashed during the load spike). Needs a `crbn up` restart the user can supervise. Schedule equivalence is already proven by the 165 determinism/envelope tests; the open item is the MRP output-diff (run MRP on a seeded company, diff demandForecast/demandForecastSource/demandActual/supplyActual vs origin) + a browser smoke of the forecast/People/planning pages (the full build already compiled+bundled every route).

## Dependencies
- Task 1 → 3, 5 (barrels must exist before moved files import them)
- Task 2 → 3, 5, 6
- Task 3 → 4, 6
- Tasks 5 depends on 1, 2
- Task 6 depends on 3, 4, 5
- Task 7, 8 depend on 6 (package must export before callers import)
- Task 9 depends on 7, 8 (delete only after callers repointed)
- Tasks 10, 11 depend on 9
- Task 12 depends on 3–11; Task 13 depends on 12
- Tasks 3 and 5 are largely independent after Task 1/2 but both feed Task 6.

---

## Task 1: Add `@carbon/database` re-export barrels for the shared leaf helpers

**Depends on:** none
**Files:**
- Create: `packages/database/src/datetime.ts`
- Create: `packages/database/src/methods.ts`
- Create: `packages/database/src/logging.ts`
- Create: `packages/database/src/mrp-engine.ts`
- Create: `packages/database/src/fetch-all.ts`
- Create: `packages/database/src/supersession-pick.ts`
- Modify: `packages/database/package.json` — add 6 export entries
- Copy from (precedent): `packages/database/src/scheduling.ts`, `packages/database/src/client.ts` (the existing re-export-from-functions-lib bridges)

**Steps:**
1. Each new `src/<name>.ts` is a one-line barrel re-exporting the corresponding
   edge lib file, mirroring `client.ts`:
   ```ts
   // packages/database/src/datetime.ts
   export * from "../supabase/functions/lib/datetime.ts";
   ```
   Do the same for `methods.ts`, `logging.ts`, `mrp-engine.ts`, `fetch-all.ts`,
   `supersession-pick.ts` (each pointing at `../supabase/functions/lib/<name>.ts`).
2. Add to `packages/database/package.json` `exports`:
   ```jsonc
   "./datetime": "./src/datetime.ts",
   "./methods": "./src/methods.ts",
   "./logging": "./src/logging.ts",
   "./mrp-engine": "./src/mrp-engine.ts",
   "./fetch-all": "./src/fetch-all.ts",
   "./supersession-pick": "./src/supersession-pick.ts",
   ```
3. If any barrel fails to typecheck because the edge file imports a Deno-only
   module that Node can't resolve, STOP and report — do not stub it. (Not
   expected: all six already run under Node today via the scheduling bridge or are
   pure.)

**Verify:**
```bash
cd /Users/barbinbrad/conductor/workspaces/carbon/tianjin
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: success, no new errors
```
**Out of scope:** Do NOT move or edit the edge lib files themselves. Do NOT delete
`src/scheduling.ts` yet (Task 9).

---

## Task 2: Scaffold `packages/ee/src/planning/` + `./planning` export

**Depends on:** none
**Files:**
- Create: `packages/ee/src/planning/index.ts` (temporary placeholder: `export {};`)
- Create dirs: `packages/ee/src/planning/scheduling/`, `packages/ee/src/planning/mrp/`
- Modify: `packages/ee/package.json` — add `"./planning": "./src/planning/index.ts"` to `exports`
- Copy from (precedent): `packages/ee/src/accounting/index.ts` (sub-area barrel shape)

**Steps:**
1. Add the `"./planning"` export entry to `packages/ee/package.json`.
2. Create `packages/ee/src/planning/index.ts` with `export {};` for now.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: success
```
**Out of scope:** No engine code yet.

---

## Task 3: Move `scheduling/**` source into the package and repoint external imports

**Depends on:** 1, 2
**Files:**
- Move (git mv): every non-test `.ts` in
  `packages/database/supabase/functions/lib/scheduling/` →
  `packages/ee/src/planning/scheduling/` (20 source files incl. `types.ts`)
- Modify: the 5 moved files that import `../types.ts` / `../postgres/index.ts` /
  `../methods.ts` / `../datetime.ts` / `../logging.ts` (see repointing table)

**Steps:**
1. `git mv` the source files (NOT the `.test.ts` files yet — Task 4 handles those,
   but moving them together is fine; if moved together, Task 4 just converts them
   in place). Move source files first to keep the diff readable:
   ```bash
   cd packages/database/supabase/functions/lib/scheduling
   git mv apply-work-center-selections.ts assembly-handler.ts calendar-utils.ts \
     date-calculator.ts date-utils.ts dependency-manager.ts duration-calculator.ts \
     machine-availability.ts master-data-provider.ts material-manager.ts \
     need-by-calculator.ts operator-eligibility.ts people-utils.ts \
     priority-calculator.ts run-schedule.ts scheduling-engine.ts slot-allocator.ts \
     types.ts work-center-selector.ts \
     /Users/barbinbrad/conductor/workspaces/carbon/tianjin/packages/ee/src/planning/scheduling/
   ```
2. In the moved files, repoint ONLY the `../` external imports per the table:
   - `from "../types.ts"` → `from "@carbon/database"` (all `type Database`)
   - `from "../postgres/index.ts"` → `from "@carbon/database/client"`
   - `from "../methods.ts"` → `from "@carbon/database/methods"`
   - `from "../datetime.ts"` → `from "@carbon/database/datetime"`
   - `from "../logging.ts"` → `from "@carbon/database/logging"`
   Leave every `./x.ts` import exactly as-is.
   Affected files (from grep): `dependency-manager.ts`, `run-schedule.ts`,
   `types.ts`, `scheduling-engine.ts`, `master-data-provider.ts` (all import
   `../types.ts`); plus any file importing `../postgres/index.ts`, `../methods.ts`,
   `../datetime.ts`, `../logging.ts` — re-grep after moving:
   ```bash
   grep -rn 'from "\.\./' packages/ee/src/planning/scheduling/*.ts
   # Expected after repointing: ZERO matches (every ../ import is repointed)
   ```
3. If any moved file imports a `../` module NOT in the repointing table, STOP and
   report — a new shared dependency was missed.

**Verify:**
```bash
grep -rn 'from "\.\./' packages/ee/src/planning/scheduling/*.ts   # Expected: no output
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: success (or only errors about the still-placeholder index.ts / missing tests — resolved in Tasks 4/6)
```
**Out of scope:** Do not change any logic; do not touch `./`-relative imports.

---

## Task 4: Convert the 13 scheduling Deno tests to vitest

**Depends on:** 3
**Files:**
- Move (git mv) + Modify: the 13 `*.test.ts` files from
  `functions/lib/scheduling/` → `packages/ee/src/planning/scheduling/`:
  `apply-work-center-selections`, `calendar-utils`, `conflict-messages`,
  `date-utils`, `determinism`, `duration-calculator`, `envelope`,
  `machine-availability`, `need-by-calculator`, `operator-eligibility`,
  `people-utils`, `slot-allocator`, `work-center-selector`

**Steps:**
1. `git mv` each `.test.ts` into the package scheduling dir.
2. In EACH test file, apply the mechanical conversion:
   - Replace the Deno std import line(s)
     `import { assert, assertEquals, ... } from "https://deno.land/std@0.175.0/testing/asserts.ts";`
     with `import { describe, expect, it } from "vitest";`
   - `Deno.test("name", fn)` → `it("name", fn)`
   - `assertEquals(a, b)` → `expect(a).toEqual(b)`
   - `assert(x)` → `expect(x).toBeTruthy()`
   - `assert(!x)` → `expect(x).toBeFalsy()`
   - `assertThrows(fn)` → `expect(fn).toThrow()`
   - `assertExists(x)` → `expect(x).toBeDefined()`
   - `assertAlmostEquals(a, b)` → `expect(a).toBeCloseTo(b)`
   - Drop any trailing assertion message arg that vitest can't take, or move it
     into `expect(a, "msg")`.
   - Leave `./x.ts` imports as-is.
3. If a test uses a Deno assert helper NOT in this map, map it to the closest
   vitest matcher and add a `// converted from <deno assert>` comment. If a test
   uses `Deno.*` runtime APIs beyond `Deno.test` (e.g. `Deno.readFile`), STOP and
   report — that needs a real decision.
4. Delete the now-empty `functions/lib/scheduling/` directory if nothing remains.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- planning/scheduling
# Expected: all suites pass; the test COUNT should match the pre-move Deno run
# (determinism + envelope + the 11 unit suites). If a suite silently drops to 0
# tests, the conversion broke it — STOP and report.
```
**Out of scope:** Do not weaken assertions or delete tests. Fixtures must stay
byte-identical.

---

## Task 5: Extract MRP orchestration into `planning/mrp/mrp.ts`

**Depends on:** 1, 2
**Files:**
- Create: `packages/ee/src/planning/mrp/mrp.ts`
- Copy from (source): `packages/database/supabase/functions/mrp/index.ts` (the body)

**Steps:**
1. Copy `mrp/index.ts` into `planning/mrp/mrp.ts`. Then transform:
   - Remove `import { serve } from "https://deno.land/std.../server.ts";` and the
     entire `serve(async (req) => { ... })` wrapper, the OPTIONS/CORS handling,
     `corsPreflight/errorResponse/jsonResponse` (drop `../lib/response.ts`), and
     the `requirePermissions` auth call (drop `../lib/supabase.ts`).
   - Remove the module-scope pool creation
     (`const pool = getConnectionPool(1); const db = getDatabaseClient<DB>(pool);`).
   - Export a single function:
     ```ts
     export async function runMrp(
       client: SupabaseClient<Database>,
       db: Kysely<KyselyDatabase>,
       payload: MrpPayload
     ): Promise<MrpResult> { /* the former handler body, using the passed client + db */ }
     ```
     where `MrpPayload` is the zod-validated shape the edge function accepted
     (`{ type, id?, companyId, userId }`) — keep the zod `payloadValidator` and
     export it, and export the `MrpResult` shape the former handler returned.
   - Repoint imports per the table: `mrp-engine` → `@carbon/database/mrp-engine`;
     `fetch-all` → `@carbon/database/fetch-all`; `supersession-pick` →
     `@carbon/database/supersession-pick`; `datetime` → `@carbon/database/datetime`;
     `logging` → `@carbon/database/logging`; `Database` → `@carbon/database`;
     `DB`/client types → `@carbon/database/client`; `Kysely` from `kysely`; `z`
     from `zod`.
   - Keep the Phase-7 delete-and-rewrite `db.transaction().execute(...)` body
     EXACTLY as-is (atomicity preserved).
2. If the handler body cannot be cleanly separated from request parsing (e.g. it
   reads `req` deep inside), STOP and report — do not restructure MRP logic.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: success
```
**Out of scope:** No changes to netting, BOM explosion, period generation, or
write batching. Do not delete `functions/mrp/` yet (Task 9).

---

## Task 6: Wire `planning/index.ts` exports; typecheck + test the package

**Depends on:** 3, 4, 5
**Files:**
- Modify: `packages/ee/src/planning/index.ts`
- Copy from (precedent): `packages/database/src/scheduling.ts` (export surface)

**Steps:**
1. Replace the placeholder with re-exports reproducing the old
   `@carbon/database/scheduling` surface plus MRP:
   ```ts
   export {
     type CalendarWindow,
     subtractIntervals
   } from "./scheduling/calendar-utils.ts";
   export {
     type LadderShiftRow,
     resolveLocationWindows,
     resolveWorkCenterWindows,
     type WorkCenterAvailabilityInput
   } from "./scheduling/machine-availability.ts";
   export {
     type ExpediteWhatIfResult,
     type LocationScheduleResult,
     type NewlyLateJob,
     runExpediteWhatIf,
     runLocationSchedule
   } from "./scheduling/run-schedule.ts";
   export { runMrp, type MrpPayload, type MrpResult } from "./mrp/mrp.ts";
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee
pnpm --filter @carbon/ee test
# Expected: typecheck clean; all tests (incl. converted scheduling suites) pass
```
**Out of scope:** none.

---

## Task 7: Repoint the 8 `@carbon/database/scheduling` call sites

**Depends on:** 6
**Files (Modify — change the import specifier only):**
- `apps/erp/app/modules/production/forecastCalendar.server.ts` (renamed in Task 8)
- `apps/erp/app/modules/production/production.service.ts` (lines ~1032, ~2543 — dynamic `import()`)
- `apps/erp/app/routes/api+/schedule.ts`
- `apps/erp/app/routes/api+/kanban.$id.tsx`
- `apps/erp/app/routes/x+/job+/$jobId.status.tsx`
- `packages/jobs/src/inngest/functions/tasks/recalculate.ts`
- `packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts`

**Steps:**
1. Replace `"@carbon/database/scheduling"` with `"@carbon/ee/planning"` in each
   (both static `import` and dynamic `await import(...)`).
2. Confirm none remain:
   ```bash
   grep -rn "@carbon/database/scheduling" apps packages | grep -v node_modules
   # Expected: only the src/scheduling.ts file itself (deleted in Task 9)
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: success
```
**Out of scope:** No logic changes at call sites.

---

## Task 8: Repoint MRP callers in-process; rename the camelCase helper

**Depends on:** 6
**Files:**
- Modify: `apps/erp/app/modules/production/production.service.ts` — `runMRP` (~:2606)
- Modify: `packages/jobs/src/inngest/functions/scheduled/mrp.ts` (~:25)
- Rename (git mv): `apps/erp/app/modules/production/forecastCalendar.server.ts` →
  `forecast.server.ts`, and `forecastCalendar.test.ts` → `forecast.test.ts`
- Modify: every importer of `forecastCalendar.server`/`forecastCalendar`

**Steps:**
1. `runMRP` in `production.service.ts`: replace
   `return client.functions.invoke("mrp", { body: { ...params } });`
   with an in-process call:
   ```ts
   import { getDatabaseClient } from "~/services/database.server";
   import { runMrp } from "@carbon/ee/planning";
   // ...
   const data = await runMrp(client, getDatabaseClient(), { ...params });
   return { data, error: null };
   ```
   Preserve `runMRP`'s existing return shape so `api+/mrp.ts` is unchanged. If the
   route consumes `{ data, error }` from the old invoke, match that exactly.
2. `packages/jobs/src/inngest/functions/scheduled/mrp.ts`: replace
   `serviceRole.functions.invoke("mrp", { body })` with
   `await runMrp(serviceRole, getJobDatabaseClient(), body)` inside the existing
   per-company `step.run` (import `runMrp` from `@carbon/ee/planning`,
   `getJobDatabaseClient` from `packages/jobs/src/db.ts`).
3. `git mv forecastCalendar.server.ts forecast.server.ts` (and the test). Update
   every importer:
   ```bash
   grep -rln "forecastCalendar" apps/erp | grep -v node_modules
   # Repoint each to "./forecast.server" / "~/modules/production/forecast.server"
   ```

**Verify:**
```bash
grep -rn 'functions.invoke("mrp"' apps packages | grep -v node_modules   # Expected: no output
grep -rn "forecastCalendar" apps packages | grep -v node_modules          # Expected: no output
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: success
```
**Out of scope:** Do not change `api+/mrp.ts`'s permission gate or the cron schedule.

---

## Task 9: Delete edge functions, config entry, and the scheduling bridge

**Depends on:** 7, 8
**Files:**
- Delete: `packages/database/supabase/functions/mrp/` (whole dir)
- Delete: `packages/database/supabase/functions/schedule/` (whole dir)
- Modify: `packages/database/supabase/config.toml` — remove the `[functions.mrp]`
  block (lines ~172–175)
- Delete: `packages/database/src/scheduling.ts`
- Modify: `packages/database/package.json` — remove the `"./scheduling"` export
- Modify: `scripts/generate-job-dependencies.ts` — remove/replace the stale
  `functions.invoke("schedule", ...)` (repoint to `runLocationSchedule` from
  `@carbon/ee/planning`, or delete the script if it's dev-only and unused)

**Steps:**
1. Before deleting, re-verify nothing imports the moved-out engine from a
   REMAINING Deno function:
   ```bash
   cd packages/database/supabase/functions
   grep -rn 'lib/scheduling/\|"\./index' mrp schedule 2>/dev/null   # about to delete these
   grep -rln 'lib/scheduling' . | grep -v '^./mrp/' | grep -v '^./schedule/'
   # Expected: no OTHER Deno function imports lib/scheduling — if any does, STOP
   ```
2. Delete the two function dirs, the `[functions.mrp]` config block, `src/scheduling.ts`,
   and the `"./scheduling"` export.
3. Handle the stale script per above.

**Verify:**
```bash
grep -rn "@carbon/database/scheduling" apps packages | grep -v node_modules   # Expected: no output
grep -rn "functions.mrp\|functions.schedule" packages/database/supabase/config.toml   # Expected: no output
pnpm exec turbo run typecheck --filter=@carbon/database --filter=erp --filter=@carbon/jobs
# Expected: success
```
**Out of scope:** Do not remove any OTHER `[functions.*]` entries or any lib file
still used by surviving Deno functions.

---

## Task 10: Verify conformance (@carbon/checks)

**Depends on:** 9
**Files:** none (verification only — `packages/ee/src` is already in
`TYPESCRIPT_ROOTS`)

**Steps:**
1. Run the conformance checks and confirm the relocation introduced no new
   `no-raw-rounding` / `no-inline-fraction-digits` findings (the moved code was
   already scanned under `packages/database/supabase/functions`; it stays scanned
   under `packages/ee/src`).

**Verify:**
```bash
pnpm --filter @carbon/checks test
# Expected: pass. If new findings appear, they are pre-existing baseline entries
# that moved path — update the baseline path, do NOT rewrite the math.
```
**Out of scope:** Do not change any numeric logic.

---

## Task 11: Update the 6 documentation targets

**Depends on:** 9
**Files (Modify):**
- `docs/content/docs/reference/forecast.mdx` — replace
  `packages/database/supabase/functions/mrp/index.ts:NNN` citations with the new
  `packages/ee/src/planning/mrp/mrp.ts` locations (and note MRP now runs
  in-process in Node, not as an edge function)
- `.claude/rules/mrp-system.md` — MRP is no longer a Deno edge function; document
  the in-process `runMrp` from `@carbon/ee/planning`, injected client + Kysely db,
  called from the Inngest cron and `api+/mrp.ts`
- `.claude/rules/scheduling-data-structures.md` — repoint
  `@carbon/database/scheduling` → `@carbon/ee/planning`; note the `schedule`
  wrapper is deleted and the engine now lives in `packages/ee/src/planning/scheduling/`
- `packages/ee/AGENTS.md` — add the `planning` sub-area (exports `runMrp`,
  `runLocationSchedule`, `runExpediteWhatIf`, window resolvers; DI'd Kysely)
- `apps/erp/app/modules/production/AGENTS.md` — update MRP description
- `packages/database/AGENTS.md` — remove `"./scheduling"` export mention; add the
  new leaf-helper barrels

**Steps:**
1. Edit each file to match the shipped code. Ground every claim in the new paths.

**Verify:**
```bash
pnpm --filter docs build 2>&1 | tail -20
# Expected: docs build succeeds (no broken MDX)
```
**Out of scope:** No new doc pages; only correct the stale references.

---

## Task 12: Full scoped verification

**Depends on:** 3–11
**Files:** none

**Steps:**
1. Regenerate types and confirm NO diff (no schema touched):
   ```bash
   pnpm run generate:types && git diff --stat -- '*types.ts'
   # Expected: no change to generated types
   ```
2. Scoped typechecks, lint, tests, build:

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/database --filter=erp --filter=@carbon/jobs
pnpm --filter @carbon/ee test
pnpm run lint
pnpm run build 2>&1 | tail -30
# Expected: all green
```
**Out of scope:** No whole-repo `tsc` (OOMs).

---

## Task 13: Behavior-equivalence + browser verification

**Depends on:** 12
**Files:** none (verification only)

**Steps:**
1. If the local stack is bootable (`crbn up`), seed a demo dataset, run MRP via the
   Planning "Recalculate" button, and confirm `demandForecast` /
   `demandForecastSource` / `demandActual` / `supplyActual` populate (row counts >0,
   no error toast). Compare against expectations from the spec's acceptance
   criteria. The determinism/envelope suites (Task 4) are the schedule-equivalence
   proof.
2. Run `/test` against the forecast page, the People capacity board, and both
   planning tables — they must render and function identically to before.
3. If the stack cannot boot, record that browser verification is BLOCKED (per the
   UI-e2e-verification lesson) and report — do not claim done.

**Verify:**
```bash
# via /auth + /test skills; capture screenshots to .ai/scratch/e2e/
# Expected: forecast page, People board, planning tables render; MRP recalcompute works
```
**Out of scope:** No behavior changes; this task only observes.

---

## Assumed decisions (autonomous — surface at PR)
- `mrp-engine.ts`, `fetch-all.ts`, `supersession-pick.ts` STAY in `functions/lib`
  (bridged), not moved, because surviving Deno functions (`recalculate`,
  `job-quantities-engine`, others) still import them. This refines the spec's
  "these pure helpers move" — moving them would break those Deno functions.
- Moved files keep Deno-style `./x.ts` import extensions (ee tsconfig allows it).
- `@carbon/checks` needs no code change (already scans `packages/ee/src`).
