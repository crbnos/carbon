# Plan: Run the scheduling engine in-process (Node)

Spec: `.ai/specs/2026-08-19-schedule-in-process-node.md`
Date: 2026-08-19
Status: **DONE** — all gates green (typecheck erp/jobs/database, full erp build,
155 Deno scheduling tests, jobs+database vitest).

## Deviations discovered during execution (all resolved)

1. **`production.service.ts` is client-bundled**, so it CANNOT statically import a
   `.server` module or the engine (the full `erp` build caught this via the
   `react-router:dot-server` plugin). Fix: it **dynamic-imports**
   `@carbon/database/scheduling` + `@carbon/database/client` inside the two
   functions and uses a lazy local Kysely pool (`getSchedulingDb`, pool size 5) —
   the same tactic `notifyScheduleInputsChanged` already uses with
   `await import("@carbon/jobs")`. It uses the **already-passed `client`** for the
   engine's reads (any same-company employee client can read the master data)
   instead of `getCarbonServiceRole`, so it needs no `.server` auth import.
   The route/jobs call sites keep STATIC imports (React Router strips their
   server-only action code from the client bundle; jobs isn't client code).
2. Importing the engine into the Node typecheck surfaced ~34 latent
   `noUncheckedIndexedAccess` issues in vendored Deno engine files (Deno's config
   has the check off) + 2 Deno-driver type errors. Fixed: (a) minimal `!`/guards
   on provably-in-bounds accesses (behavior-preserving; all 155 Deno tests still
   pass), (b) decoupled the engine's `DB` type from the Deno-only
   `database.ts`/`driver.ts` by adding `export type DB = KyselyDatabase` to
   `postgres/index.ts` and repointing 5 `import type { DB }` sites there — so the
   Deno postgres driver never enters any Node typecheck.
3. The edge function is KEPT as a thin wrapper (not deleted) — one orchestration,
   compatibility preserved.


## Task 1 — Make `logging.ts` dual-runtime
File: `packages/database/supabase/functions/lib/logging.ts`
- Replace the unguarded `Deno.env.get("LOG_LEVEL")` with a runtime-guarded read
  that falls back to `process.env.LOG_LEVEL` in Node (mirror the
  `typeof Deno !== "undefined"` guard already used in `postgres/index.ts`).
- [ ] Verify: no other `Deno.` reference remains outside a guard in this file.

## Task 2 — Declare `@logtape` deps on `packages/database`
File: `packages/database/package.json`
- Add `@logtape/logtape` and `@logtape/redaction` (`catalog:`) to `dependencies`.
- [ ] `pnpm install` succeeds; both resolve under `packages/database/node_modules`.

## Task 3 — Extract `runLocationSchedule`
New file: `packages/database/supabase/functions/lib/scheduling/run-schedule.ts`
- Move `deadlineRank`, `asMs`, the job query, the sort, batch build, expedite
  branch, and the sequential engine loop out of the edge `serve()` handler.
- Signature: `runLocationSchedule(opts: { db: Kysely<DB>; client: SupabaseClient<Database>; locationId: string; companyId: string; userId: string; expediteJobId?: string }): Promise<LocationScheduleResult | ExpediteResult>`.
- Export result types. Use only Node+Deno-safe imports (engine, provider,
  priority-calculator, types, `@internationalized/date` if needed — NOT
  `npm:zod`, NOT deno std, NOT `../supabase.ts`, NOT `../response.ts`).
- [ ] `tsc`/tsgo sees the new file typecheck under `@carbon/database`.

## Task 4 — Edge function delegates to the shared orchestration
File: `packages/database/supabase/functions/schedule/index.ts`
- Keep `serve`, CORS preflight, `payloadValidator` (npm zod), `requirePermissions`,
  `jsonResponse`/`errorResponse`, and the module-scope pool/db.
- Replace the inline orchestration with a single `runLocationSchedule({ db,
  client, locationId, companyId, userId, expediteJobId })` call; return its
  result via `jsonResponse`.
- [ ] Behavior identical (same response JSON).

## Task 5 — Node bridge export
File: `packages/database/src/scheduling.ts`
- Re-export `runLocationSchedule` and its result types from `run-schedule.ts`.
- [ ] `@carbon/database/scheduling` exposes `runLocationSchedule`.

## Task 6 — Repoint ERP call sites
- `apps/erp/app/routes/api+/schedule.ts` — call `runLocationSchedule({ db:
  getDatabaseClient(), client: getCarbonServiceRole(), … })`; surface
  `{ success, error }`.
- `apps/erp/app/modules/production/production.service.ts`
  `recalculateJobOperationDependencies` — after resolving `locationId`, call
  `runLocationSchedule` with `getDatabaseClient()` + `getCarbonServiceRole()`
  instead of `client.functions.invoke("schedule", …)`.
- `apps/erp/app/routes/x+/job+/$jobId.status.tsx` — replace the
  `serviceRole.functions.invoke("schedule", …)` inside the `Promise.all` with a
  `runLocationSchedule(...)` call (keep the parallel `create` invoke as-is).
- `apps/erp/app/routes/api+/kanban.$id.tsx` — same swap inside its `Promise.all`.
- [ ] Each keeps existing error handling / flash.

## Task 7 — Repoint jobs call sites
- `packages/jobs/src/inngest/functions/tasks/recalculate.ts`
  `recalculateJobMakeMethodRequirements` — swap invoke → `runLocationSchedule`
  with `getJobDatabaseClient()` + `getCarbonServiceRole()`.
- `packages/jobs/src/inngest/functions/scheduled/schedule-inputs-changed.ts`
  wave `regen-${locationId}` step — swap invoke → `runLocationSchedule`; keep the
  `LocationRegenResult` shape and the newly-late notification logic.
- [ ] Wave still returns `{ jobsScheduled, conflictsDetected, newlyLate }`.

## Task 8 — Regenerate button UX
File: `apps/erp/app/modules/production/ui/Schedule/ForecastHeader.tsx`
- On fetcher completion, if `!success` show an error toast; keep the loading
  state. (Empty board no longer implies failure.)
- [ ] Manual check.

## Task 9 — Docs sync
- Update `apps/erp/app/modules/production/AGENTS.md` and
  `.claude/rules/scheduling-data-structures.md` where they state scheduling runs
  "via the `schedule` edge function" — note the app/jobs now run it in-process
  via `runLocationSchedule` (`@carbon/database/scheduling`); the edge function
  remains as a thin wrapper.

## Verification (gate)
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/database`
- [ ] `pnpm exec turbo run typecheck --filter=erp`
- [ ] `pnpm exec turbo run typecheck --filter=@carbon/jobs`
- [ ] `pnpm --filter erp build` (or `turbo build --filter=erp`) succeeds — no
      Node lib in the client bundle, `.ts` deep-imports resolve.
- [ ] `pnpm run test` for affected packages (scheduling unit tests unaffected).
