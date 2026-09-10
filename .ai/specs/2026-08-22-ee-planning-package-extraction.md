# @carbon/ee/planning — Extract MRP + Finite Scheduling + Forecasting into an EE package

> Status: draft
> Author: Brad Barbin (with Claude)
> Date: 2026-08-22

## TLDR

Consolidate the planning engines — MRP, finite-capacity scheduling, and the
forecast-first calendar math — into a single new sub-package `@carbon/ee/planning`.
Migrate MRP off the Supabase Deno edge runtime: delete the `mrp` edge function and
run its logic in-process in Node inside a Kysely transaction, called from the ERP
route and the Inngest cron. Relocate the already-in-process scheduling engine
(currently `packages/database/supabase/functions/lib/scheduling/**`, bridged via
`@carbon/database/scheduling`) into the same package, converting its Deno tests to
vitest. This is a **pure relocation/refactor: no behavior change** to MRP outputs,
schedule outputs, demand/supply forecasts, or any UI. The result is clean, typed,
Node-native exports (`@carbon/ee/planning`) with the planning domain living in one
place, and no dormant edge wrappers left behind.

## Problem Statement

Planning logic is scattered across three homes with three different runtimes and no
single import surface:

1. **MRP** is a live Supabase **Deno edge function** (`supabase/functions/mrp/index.ts`,
   1112 lines + pure `lib/mrp-engine.ts`, 320 lines). It is invoked over HTTP via
   `client.functions.invoke("mrp", …)` from two **Node** call sites — the Inngest cron
   (`packages/jobs/.../scheduled/mrp.ts`) and the ERP route `api+/mrp.ts` (via
   `runMRP` in `production.service.ts`). No Deno function calls it, so the edge
   runtime buys nothing but a cold-start + HTTP hop and a second auth layer.
2. **Finite scheduling** ("resource planning") already runs **in-process in Node**,
   but its ~11.5k lines (incl. tests) live under `supabase/functions/lib/scheduling/**`
   and reach Node only through the `@carbon/database/scheduling` re-export bridge.
   The `schedule` edge function is **dormant** — not registered in `config.toml`,
   zero `invoke` callers — yet still ships as dead weight.
3. **Forecasting** has no edge function at all: it is MRP's `demandForecast` output
   plus the forecast-first *visualization* (`forecastCalendar.server.ts`, forecast
   routes/UI), which already import the scheduling engine's window ladder.

Consequences: MRP pays an avoidable edge round-trip and a duplicated auth gate;
scheduling's engine sits in a package (`@carbon/database`) whose purpose is schema
and low-level DB access, not domain logic; there is no coherent `planning` import;
and the two engines can't share a home because one is Deno-shaped.

## Proposed Solution

Create `packages/ee/src/planning/` and make it the single home for the planning
**engines and orchestration** (not UI, not routes). Follow the `@carbon/ee/accounting`
sub-area pattern: a folder with an `index.ts` barrel, dependency-injected
`Kysely<KyselyDatabase>` (the package never constructs a pool), and multi-row writes
in `db.transaction().execute(...)`. Expose it via a new `"./planning"` export.

Concretely:

- **MRP** → move `lib/mrp-engine.ts` and the load-bearing body of `mrp/index.ts`
  (period generation, demand/supply/on-hand fetching, BOM explosion orchestration,
  Phase-7 atomic delete-and-rewrite) into `@carbon/ee/planning` as a `runMrp(db, payload)`
  orchestrator that accepts an injected Kysely client. **Delete** the `mrp` edge
  function directory and its `[functions.mrp]` `config.toml` entry. Drop the
  edge-only shell: the Deno `serve` handler, `lib/response.ts` (CORS/HTTP framing),
  and `lib/supabase.ts`'s `requirePermissions` (the ERP route and the Inngest cron
  already authenticate before invoking).
- **Scheduling** → move `lib/scheduling/**` into `@carbon/ee/planning`, keeping the
  `runLocationSchedule` / `runExpediteWhatIf` / `resolveLocationWindows` public
  surface. **Delete** the dormant `schedule` edge function and the
  `@carbon/database/scheduling` bridge (`packages/database/src/scheduling.ts` +
  the `"./scheduling"` export). Convert the ~13 Deno test files (~4,600 lines) to
  vitest so they run under `pnpm --filter @carbon/ee test`.
- **Forecasting** → the forecast math already lives in ERP app code
  (`forecastCalendar.server.ts`) and imports the engine's window ladder; it stays in
  the ERP app but repoints its import to `@carbon/ee/planning`. No forecasting engine
  moves because there is none to move. **Rename** `forecastCalendar.server.ts` →
  `forecast.server.ts` (and `forecastCalendar.test.ts` → `forecast.test.ts`) — no
  camelCase filenames.
- **Callers** → repoint every import site (see API / Service Changes). Both new
  callers of `runMrp` (ERP route + Inngest cron) inject the client via
  `getDatabaseClient()` (ERP) / `getJobDatabaseClient()` (jobs), exactly as
  `@carbon/ee/accounting` is fed today.
- **Shared plumbing stays license-neutral.** The low-level DB/date helpers the
  engines depend on (`postgres/`, `database.ts`, `datetime.ts`, `driver.ts`, and any
  purely-generic helper) remain in `@carbon/database` and are consumed via
  `@carbon/database/client` (plus new `@carbon/database/*` barrels if a helper is not
  yet Node-exported). Only planning-**specific** pure helpers move into the package
  (`mrp-engine.ts`, `fetch-all.ts`, `supersession-pick.ts` — verify no remaining Deno
  edge function imports them before moving; research found none).
- **Conformance** → extend `@carbon/checks`' TypeScript source set
  (`packages/checks/src/sources/typescript.ts`) to include `packages/ee/src/planning`
  so relocated value-bearing math stays inside the `no-raw-rounding` /
  `no-inline-fraction-digits` net.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package name / location | `@carbon/ee/planning` (new sub-area under `packages/ee/src/planning/`) | User decision (Q1a): planning is positioned as an enterprise/paid capability, so it belongs under the EE commercial-license marker. `plan`/`plan.server` are already the billing plan-gate, so `planning` avoids the name collision. |
| What moves into the package | Engines + orchestration only (`mrp-engine`, `runMrp`, `scheduling/**`, `runLocationSchedule`, `runExpediteWhatIf`, window resolvers) | UI and React Router routes/loaders/actions cannot live in a package; the `@carbon/ee/accounting` precedent is logic-only with UI staying in ERP. |
| Client acquisition | Dependency-injected `Kysely<KyselyDatabase>`; package never builds a pool | Exact `@carbon/ee/accounting` pattern (`SyncContext.database`). Callers supply `getDatabaseClient()` (ERP) or `getJobDatabaseClient()` (jobs). |
| MRP runtime | In-process Node + one Kysely transaction; delete the edge function | Both callers are already Node; the edge hop and its second auth gate are pure overhead. MRP's writes are already one Kysely transaction, so atomicity is preserved verbatim. |
| Scheduling relocation | Physically move `lib/scheduling/**` into the package; delete the dormant `schedule` wrapper and the `@carbon/database/scheduling` bridge | User decision (Q2). A package cannot re-export through `@carbon/database` without creating a `database → ee` cycle, so the bridge must go and call sites repoint directly. |
| Test runtime | Convert scheduling's Deno tests to vitest under `@carbon/ee` | Engine no longer lives under `supabase/functions/`, so `deno test lib/scheduling/` can't reach it; `@carbon/ee` runs vitest. |
| Edge function disposition | Delete `mrp` (+ `[functions.mrp]`) and `schedule`; keep no compatibility wrappers | User decision (Q3). No known external/self-hosted caller; the ERP `api+/mrp.ts` route remains the stable entry point. |
| Sequencing | Do it on this branch (`naveen/capacity-planning`), bundled with the feature | User decision (Q4). Risk acknowledged (see Risks) and mitigated by "no behavior change" acceptance gates. |
| Conformance coverage | Extend `@carbon/checks` TS sources to scan `packages/ee/src/planning` | User decision (Q5). Relocated pricing/quantity math must not escape the numeric-precision checks. |
| Heuristic 1–3 (multi-tenancy / service shape / RLS) | N/A — no new tables or columns | Pure relocation of existing logic; all planning tables and RLS already exist and are untouched. |
| Heuristic 4 (permission scoping) | ERP route keeps `requirePermissions(request, { update: "inventory" })`; edge `requirePermissions` is dropped | The route/cron already gate the call; the in-edge re-check was redundant. No permission surface changes. |
| Heuristic 5 (form pattern) | N/A | No forms added or changed. |
| Heuristic 6 (module layout) | Package sub-area layout (folder + `index.ts` barrel, `.server` split if needed), not the ERP `{module}.service.ts` shape | `packages/ee` uses the sub-area convention (accounting/storage-rules), not the ERP single-file module shape. |
| Heuristic 7 (backward compatibility) | Two contracts change: the `mrp` edge function and the `@carbon/database/scheduling` export are removed | Migration path documented below; both are internal contracts (no public API route removed — `api+/mrp.ts` stays). Customer docs citing `functions/mrp/index.ts` must be updated. |

## Data Model Changes

**N/A** — this is a code relocation. No tables, columns, enums, RLS policies,
migrations, or generated types change. The planning schema
(`period`, `demandForecast`, `demandActual`, `supplyForecast`, `supplyActual`,
`demandForecastSource`, `capacityReservation`, people-assignment tables, etc.) is
untouched. `pnpm run generate:types` should produce no diff.

## API / Service Changes

### New package surface

`packages/ee/package.json` exports gains:

```jsonc
"./planning": "./src/planning/index.ts"
// add "./planning.server" only if a server-only split proves necessary
```

`@carbon/ee/planning` public exports (names preserved from today's engines):

- `runMrp(db: Kysely<KyselyDatabase>, payload: MrpPayload): Promise<MrpResult>` — the
  extracted MRP orchestrator (was the body of `mrp/index.ts`). `explodeBom` and the
  `makeKey` family come with `mrp-engine.ts`.
- `runLocationSchedule(...)`, `runExpediteWhatIf(...)`, `resolveLocationWindows(...)`,
  `resolveWorkCenterWindows(...)` — moved verbatim from `lib/scheduling/run-schedule.ts`
  and `machine-availability.ts`.

### Deletions

- `packages/database/supabase/functions/mrp/` (whole directory) and the
  `[functions.mrp]` block in `packages/database/supabase/config.toml`.
- `packages/database/supabase/functions/schedule/` (dormant wrapper).
- `packages/database/src/scheduling.ts` and the `"./scheduling"` entry in
  `packages/database/package.json`.
- The dev script's stale `functions.invoke("schedule", …)` in
  `scripts/generate-job-dependencies.ts` (already broken against the current
  validator) — repoint to `runLocationSchedule` or remove.

### Call-site repointing

MRP (was `client.functions.invoke("mrp", { body })`):

| Site | Change |
|------|--------|
| `apps/erp/app/modules/production/production.service.ts` (`runMRP`, ~:2606) | Call `runMrp(getDatabaseClient(), payload)` in-process instead of `client.functions.invoke("mrp", …)`. Keep the `runMRP` signature so `api+/mrp.ts` is unaffected. |
| `packages/jobs/src/inngest/functions/scheduled/mrp.ts` (:25) | Replace `serviceRole.functions.invoke("mrp", …)` with `runMrp(getJobDatabaseClient(), payload)` inside the existing per-company `step.run`. |

Scheduling (`@carbon/database/scheduling` → `@carbon/ee/planning`), 8 sites:

- `apps/erp/app/modules/production/forecastCalendar.server.ts:5` (also renamed → `forecast.server.ts`)
- `apps/erp/app/modules/production/production.service.ts:1032`, `:2543` (dynamic `import()`)
- `apps/erp/app/routes/api+/schedule.ts:4`
- `apps/erp/app/routes/api+/kanban.$id.tsx:5`
- `apps/erp/app/routes/x+/job+/$jobId.status.tsx:5`
- `packages/jobs/src/inngest/functions/tasks/recalculate.ts:2`
- `packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts:3`

### Dependency graph (verified — no cycles)

`@carbon/jobs` and `apps/mes` already depend on `@carbon/ee`; `apps/erp` depends on
it heavily; `@carbon/database` does **not** depend on `@carbon/ee`. So
`@carbon/ee/planning` importing `@carbon/database/client` is the correct (low→high)
direction, and no consumer needs a new dependency edge except the value being
imported changing packages.

## UI Changes

**N/A** — no page, form, table, route, or component changes. The forecast/People/
Gantt UI keeps working against the same service functions; only the server helper
`forecastCalendar.server.ts` moves its import (and is renamed to `forecast.server.ts`).

## Documentation Changes

Per keep-sources-in-sync, update in the same PR:

- `docs/content/docs/reference/forecast.mdx` — replace the `packages/database/supabase/functions/mrp/index.ts:NNN` source citations with the new `@carbon/ee/planning` locations.
- `.claude/rules/mrp-system.md` — MRP is no longer a Deno edge function; document the in-process Node + `@carbon/ee/planning` model, delete the "It is Inngest, not Trigger.dev / edge function" framing that references the edge path.
- `.claude/rules/scheduling-data-structures.md` — repoint `@carbon/database/scheduling` references to `@carbon/ee/planning`; note the `schedule` wrapper is deleted.
- `packages/ee/AGENTS.md` — add the `planning` sub-area, its exports, and the DI'd-Kysely + `runMrp`/`runLocationSchedule` entry points.
- `apps/erp/app/modules/production/AGENTS.md` — update the MRP description.
- `packages/database/AGENTS.md` — remove the `"./scheduling"` export mention.

## Acceptance Criteria

- [ ] `@carbon/ee/planning` exists, exports `runMrp`, `runLocationSchedule`, `runExpediteWhatIf`, and the window resolvers; `import { runMrp } from "@carbon/ee/planning"` typechecks from both `apps/erp` and `packages/jobs`.
- [ ] The `mrp` and `schedule` edge function directories are deleted, `[functions.mrp]` is removed from `config.toml`, and `grep -rn 'functions.invoke("mrp"\|functions.invoke("schedule"' apps packages` returns nothing (except updated/removed dev script).
- [ ] `@carbon/database/scheduling` and `packages/database/src/scheduling.ts` are deleted; `grep -rn "@carbon/database/scheduling" apps packages` returns nothing.
- [ ] `forecastCalendar.server.ts` is renamed to `forecast.server.ts` (test likewise), and every new/relocated file in `@carbon/ee/planning` uses kebab-case or dotted naming — no camelCase filenames.
- [ ] Running MRP for a company via `POST api+/mrp.ts` (the "Recalculate" button) writes exactly the same `demandForecast` / `demandForecastSource` / `demandActual` / `supplyActual` rows as `origin` MRP for the same fixture — verified by seeding a demo dataset, running both, and diffing the four tables' row counts + a checksum of key columns.
- [ ] The Inngest MRP cron completes a per-company run in-process with no `functions.invoke` and writes identical output.
- [ ] `runLocationSchedule` produces byte-identical schedule output to `origin` for the determinism + envelope fixtures (the existing suites, now under vitest, pass).
- [ ] All ~13 relocated scheduling test files pass under `pnpm --filter @carbon/ee test`; `deno test lib/scheduling/` no longer exists as a required gate.
- [ ] `pnpm --filter @carbon/ee typecheck`, `pnpm exec turbo run typecheck --filter=@carbon/erp --filter=@carbon/jobs`, and `pnpm run lint` are green.
- [ ] `@carbon/checks` scans `packages/ee/src/planning` and the relocated code produces **zero** new `no-raw-rounding` / `no-inline-fraction-digits` findings (or the pre-existing baseline is carried over intact).
- [ ] `pnpm run generate:types` yields no diff (no schema touched).
- [ ] The six documentation targets above are updated and the docs build passes.
- [ ] A browser smoke of the forecast page, the People capacity board, and both planning tables ("Recalculate") renders and functions identically to `origin`.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Relocating engines *on top of* an unmerged +42.8k-line feature branch complicates review and rebase (Q4) | High | Land the relocation as a clearly-separated set of commits with a "no behavior change" contract; the diff-the-outputs acceptance gate is the proof. Keep engine file contents move-only (no logic edits) so `git` shows renames, not rewrites. |
| Deno→vitest test conversion silently weakens a suite (e.g. an assertion that no longer runs) | High | Convert mechanically (`Deno.test`→`it`, `assertEquals`→`expect().toEqual`); assert the vitest run reports the **same test count** as the Deno run; keep the determinism/envelope fixtures byte-for-byte. |
| MRP behavior drift from dropping the edge auth/HTTP shell or from Deno↔Node driver differences (NUMERIC decoding, `pg` alias) | High | `postgres/index.ts` already registers NUMERIC decoders for both drivers and is already Node-consumed by scheduling; add the four-table output diff to CI-style verification before merge. |
| A remaining Deno edge function imports a helper being moved out of `functions/lib` (`mrp-engine`, `fetch-all`, `supersession-pick`) | Medium | Grep `functions/**` for imports of each moved file before moving; research found no cross-Deno importers — re-verify in the plan's first task. |
| EE-marking core planning changes self-hosted/community availability | Medium | Explicit product decision (Q1a). `@carbon/ee` gating is a no-op off Cloud, so self-hosted still runs the code; only the licensing marker changes. Document in the PR. |
| Stale customer docs citing `functions/mrp/index.ts` line numbers | Low | Docs update is an acceptance criterion, not optional. |
| `getPostgresClient` is typed against the edge's vendored kysely, forcing casts in Node | Low | Reuse the existing `as unknown as Kysely<KyselyDatabase>` pattern already in `packages/jobs/src/db.ts`; centralize the cast in the package's client-accepting entry points. |

## Open Questions

> All resolved with the user on 2026-08-22 before this spec was written.

- [x] **Q1 — Should MRP + finite scheduling live under `@carbon/ee` (the commercial-license marker) at all?** — **Answer:** (a) Yes, `@carbon/ee/planning`. Planning is positioned as an enterprise/paid capability. (Rejected: license-neutral `@carbon/planning`, and leaving it in `@carbon/database`.)
- [x] **Q2 — Relocate the already-in-process scheduling engine too, or only MRP?** — **Answer:** Relocate **both** into `@carbon/ee/planning`, accepting the Deno→vitest test-conversion cost as budgeted work.
- [x] **Q3 — Delete the edge functions or keep thin compatibility wrappers?** — **Answer:** Delete both the `mrp` edge function (+ `config.toml` entry) and the dormant `schedule` wrapper. No known external caller; `api+/mrp.ts` remains the stable entry point.
- [x] **Q4 — Sequence the extraction after the feature merges, or bundle it now?** — **Answer:** Do it now, on `naveen/capacity-planning`. Risk acknowledged; mitigated by move-only diffs and output-diff verification.
- [x] **Q5 — Extend `@carbon/checks` to cover `packages/ee/src/planning`?** — **Answer:** Yes. Add `packages/ee/src/planning` to the TypeScript source set so relocated value-bearing math stays under `no-raw-rounding` / `no-inline-fraction-digits`.
- [x] **Q6 (surfaced while writing) — Can `@carbon/database/scheduling` be kept as a compatibility re-export?** — **Answer:** No. `@carbon/database` re-exporting from `@carbon/ee` would create a `database → ee → database` cycle. The bridge is deleted and all 8 call sites repoint to `@carbon/ee/planning` directly.

## Changelog

- 2026-08-22: Created. Open questions Q1–Q5 resolved with the user before writing; Q6 surfaced during writing and resolved (delete the `@carbon/database/scheduling` bridge — no circular dep allowed). Grounded against branch research: MRP is the only live edge function (2 Node callers), scheduling is already in-process via `@carbon/database/scheduling`, no forecasting edge function exists, and the `mrp` edge function is cited in customer docs.
