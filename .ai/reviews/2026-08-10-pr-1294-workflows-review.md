# PR #1294 (Workflows) — review changelist

**Branch:** `feat/automation` @ `5e180ddfe` · **PR:** https://github.com/crbnos/carbon/pull/1294
**Scope reviewed:** full branch diff vs `main` (416 files, +93,619 / −2,632) — engine, matcher,
scheduler, retention, actions, migrations, routes, service layer, plus a spot-read of the builder UI.

You are picking this up as a work list. Every item below was verified against the checked-out
branch, not inferred from the diff alone. Three findings from the first pass were checked and
**discarded as false positives** — they are listed at the bottom so you don't re-raise them.

**Baseline:** `pnpm --filter @carbon/workflows --filter @carbon/jobs test` is green on this branch
(641 tests). **None of the defects below are caught by existing coverage.** Assume a fix is not
proven until you have a test that fails before it and passes after.

---

## Ground rules for this work

- Read `AGENTS.md`, `packages/jobs/AGENTS.md`, `packages/workflows/AGENTS.md` and
  `apps/erp/app/modules/workflows/AGENTS.md` before starting. The `.claude/rules/workflow-*.md`
  files are the subsystem reference.
- Carbon is multi-tenant. Every query needs `companyId` scoping; every workflow action must use
  the owner-scoped, run-tagged client (`getOwnerClient`) — a privileged or untagged write escapes
  the owner's permissions and blinds the matcher's origin filter and loop guards.
- `pnpm` only, never `npm`. Scoped typecheck only — a whole-repo typecheck OOMs.
- Don't hand-edit generated DB types (`packages/database/src/types.ts`,
  `swagger-docs-schema.ts`, `supabase/functions/lib/types.ts`). If `pnpm install` dirties them
  with ordering churn, `git checkout --` them.
- Migrations are immutable once applied. For item **P1-7**, check whether the migration has
  shipped anywhere before editing it; if it has, write a follow-up migration instead.

### Verification commands

```bash
pnpm --filter @carbon/workflows test
pnpm --filter @carbon/jobs test
pnpm exec turbo run typecheck --filter=@carbon/jobs
pnpm exec turbo run typecheck --filter=erp        # note: the package is "erp", not "@carbon/erp"
pnpm run lint
```

---

## P0 — blocking

### P0-1 · The walk executes a node before its ancestors have run

**Files:** `packages/jobs/src/workflows/engine/walk.ts`,
`packages/workflows/src/definition/variables.ts` (`resolveRef`)

`walk.ts` is a plain BFS frontier with an `executed` set and no in-degree tracking. When two
paths into the same node have different lengths, the shorter one wins and the node runs early;
the later arrival is then silently discarded by `alreadyExecuted`.

**Reproduced by execution.** Graph `t→b→d` and `t→c1→c2→d` walks as:

```
["b", "c1", "d", "c2"]      // d runs BEFORE c2
```

The symmetric diamond (`t→b→d`, `t→c→d`) is correct — `["b","c","d"]` — and is the only case
`walk.test.ts` covers, which is why this is green.

The validator compounds it: `resolveRef` only requires the referenced node to be a **graph
ancestor** (reverse-reachable), so wiring `d`'s input to `c2.record` passes validation and then
resolves to nothing at run time, with no error surfaced. The failure message for the opposite
case even claims ordering is guaranteed: *"This uses a value from a step that does not always
run before it."*

**Do one of:**
- **(a) Fix the engine** — track in-degree over *live* incoming edges (edges whose source handle
  was actually taken) and hold a node in the frontier until every live predecessor has settled.
  This is the correct fix but needs care around condition branches that are never taken, or the
  join deadlocks.
- **(b) Fix the validator** (cheaper, ships sooner) — change `resolveRef` to require **dominance**
  rather than ancestry: the referenced node must lie on *every* path from every trigger to the
  referencing node. That rejects at publish time exactly what the engine can't honour. Note this
  narrows what customers can wire, so confirm the product call.

**Regression test** (drop into `packages/jobs/src/workflows/engine/walk.test.ts`):

```ts
it("does not execute a join before a longer branch has arrived", () => {
  const def = definition(
    [trigger("t"), action("b"), action("c1"), action("c2"), action("d")],
    [
      edge("t", DEFAULT_HANDLE, "b"),
      edge("t", DEFAULT_HANDLE, "c1"),
      edge("b", DEFAULT_HANDLE, "d"),
      edge("c1", DEFAULT_HANDLE, "c2"),
      edge("c2", DEFAULT_HANDLE, "d")
    ]
  );
  expect(drain(createWalkState(def), def)).toEqual(["b", "c1", "c2", "d"]);
});
```

(`definition`, `trigger`, `action`, `edge` and `drain` already exist in that file.)

---

### P0-2 · Retention pass 4 never advances; step payloads leak

**File:** `packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts:180`

`drop-step-detail` calls `selectTerminalRuns(db, cutoffDays(30), BATCH)` with no `ORDER BY` and
no predicate excluding runs whose steps are already deleted. It re-picks the same ~500 rows every
night and deletes zero. Passes 2 and 3 self-advance (pass 2 deletes the rows; pass 3 filters
`compactedAt is null`); this pass does not. Any company with more than 500 terminal runs in the
30–90 day window keeps full `workflowStepRun` payloads until the 90-day header purge catches up.

**Do:** add a progress marker mirroring `compactedAt` (e.g. `detailDroppedAt` on `workflowRun`),
or gate the select on `WHERE EXISTS (SELECT 1 FROM "workflowStepRun" s WHERE s."runId" = r."id")`.
Add an `ORDER BY` so batching is deterministic.

---

### P0-3 · Unbounded `Promise.all` exhausts the connection pool

**File:** `workflow-run-retention.ts:136`

One UPDATE per step row across up to 200 runs, all fanned out at once, against
`getJobDatabaseClient(5)` — a pool of 5 with `connectionTimeoutMillis: 10_000`
(`packages/database/supabase/functions/lib/postgres/index.ts:75`). A few thousand queued promises
start throwing connection timeouts and fail the whole Inngest step.

**Do:** one set-based statement (`UPDATE … FROM (VALUES …)`), or move the truncation into SQL
(see **P1-6**), which removes this loop entirely.

---

### P0-4 · Autosave silently loses edits

**Files:** `apps/erp/app/modules/workflows/ui/Builder/Autosave.tsx:60`,
`apps/erp/app/modules/workflows/ui/Builder/store.ts:253`

`rebaseline()` snapshots the **current** store state, not the payload that was submitted:

```ts
rebaseline: () => {
  const { nodes, edges } = get();          // ← current, not what was saved
  set({ baseline: snapshot(nodes, edges) });
}
```

Sequence: edit A → debounce submits payload A → user edits B while in flight → A's response
arrives → `rebaseline()` baselines A+B → next debounce compares against A+B, finds no diff, and
**skips the save**. Edit B is gone on reload.

**Do:** thread the submitted definition through — `rebaseline(submittedDefinition)` — and baseline
that. Also consider that `savedRef` is a single boolean and can't distinguish overlapping
in-flight saves.

---

### P0-5 · Deleting a workflow orphans its `eventSystemSubscription` rows

**File:** `apps/erp/app/routes/x+/workflows+/delete.$id.tsx`

`syncWorkflowTriggers` is the only reconciler of `eventSystemSubscription`, and it has exactly two
callers — `publishWorkflowVersion` and `setWorkflowActive`
(`apps/erp/app/modules/workflows/workflows.server.ts:136,168`). The delete path calls neither.

The FK cascade removes `workflowTriggerEvent`, but the `handlerType = 'WORKFLOW'` subscription row
survives **active**. `dispatch_event_batch()` then keeps `row_to_json`-ing every row of that table
for that company and enqueuing to pgmq, forever, for a workflow that no longer exists.

**Do:** call `syncAndWake(companyId, workflowId)` (or `syncWorkflowSubscriptions`) after a
successful delete.

---

### P0-6 · Company-wide subscription reconcile has no lock

**File:** `packages/workflows/src/sync.ts:203`

`reconcileWorkflowSubscriptions(trx, companyId)` reads **all** of the company's
`workflowTriggerEvent` rows and delete/inserts `eventSystemSubscription` — but it runs inside a
per-**workflow** transaction. Two concurrent publishes or toggles in the same company each compute
`desired` against pre-commit state; one can delete a subscription the other still needs, and event
delivery silently stops for that table. The delete/insert loop also iterates existing rows in
non-deterministic order, which is a two-session deadlock shape.

**Do:** take a company-scoped advisory lock as the first statement inside the
`syncWorkflowTriggers` transaction:

```ts
await sql`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`.execute(trx);
```

---

### P0-7 · Global Tooltip change with app-wide blast radius

**File:** `packages/react/src/Tooltip.tsx:112-120`

```tsx
<TooltipPrimitive.Portal container={typeof document !== "undefined" ? document.body : undefined}>
  <TooltipPrimitive.Positioner className="z-[100]" style={{ zIndex: 9999 }}>
```

The inline style always beats the class, so `z-[100]` is dead code, and **every tooltip in ERP and
MES** now paints above modals, drawers, sheets and the command palette. The portal container change
is also app-wide. This is a workflow-builder stacking fix pushed into a shared primitive.

**Do:** revert the shared component. Fix the stacking inside the builder — raise the canvas
popover's own stacking context, or pass an opt-in prop for the one call site that needs it.

---

## P1 — scale (before this sees real volume)

### P1-1 · Add two missing indexes

```sql
-- Global runs list: apps/erp/app/routes/x+/workflows+/runs.tsx filters companyId only
-- and sorts createdAt DESC. No existing index leads with (companyId, createdAt) —
-- workflowRun_companyId_workflowId_idx puts workflowId in the middle, so this is a
-- scan + sort of the company's entire 90-day run history on every page.
CREATE INDEX "workflowRun_companyId_createdAt_idx"
  ON "workflowRun" ("companyId", "createdAt" DESC);

-- hasActiveRun (packages/jobs/src/workflows/scheduler.ts) runs once per due workflow
-- per scheduler wake and currently scans every historical run for that workflow.
CREATE INDEX "workflowRun_active_idx"
  ON "workflowRun" ("companyId", "workflowId")
  WHERE "status" IN ('Queued', 'Running');
```

### P1-2 · Drop two dead indexes

Verified no consumer exists for either; both are pure write cost on the two highest-insert tables.

- `workflowRun_purge_idx ("status","completedAt")` — the retention job filters on
  `COALESCE("completedAt","createdAt")`, which is what `workflowRun_retention_idx` is for.
- `workflowStepRun_companyId_idx ("companyId")` — every query on that table also filters `runId`
  (covered by `workflowStepRun_runId_idx`) or `id` (covered by the PK).

### P1-3 · `dispatchDue` is a ~600-round-trip loop

`packages/jobs/src/workflows/scheduler.ts:139` — up to 200 due workflows, each doing a `claimDue`
UPDATE + a `hasActiveRun` SELECT + an insert, inside one Inngest step on a pool of 1.

**Do:** collapse into a single CTE / `UPDATE … RETURNING`. Consider `FOR UPDATE SKIP LOCKED` on
the claim so more than one wake can drain in parallel.

### P1-4 · `reap-stale-runs` is a ~1,500-round-trip loop

`workflow-run-retention.ts:83` — per stale run: `failInterruptedSteps` + `failCrashedRun` (itself
a SELECT then an UPDATE). **Do:** two set-based UPDATEs.

### P1-5 · Exact count on the run log

`apps/erp/app/modules/workflows/workflows.service.ts:225` uses `{ count: "exact" }`, and
`runs.tsx` consumes `count` for pagination — so every page load runs a full RLS-filtered
`COUNT(*)` over a table that grows with event volume. (Line 19, on `workflow`, is fine — tens of
rows.) **Do:** estimated count or keyset pagination.

### P1-6 · Move JSONB compaction into SQL

The compaction pass reads every step's `input`/`output`/`detail` into Node, truncates in JS via
`compactForLog` (`packages/jobs/src/workflows/retention.ts`), and writes each row back. Port the
truncation to a `compact_jsonb()` plpgsql function driven by one
`UPDATE "workflowStepRun" SET … WHERE "runId" = ANY($1)`. Also resolves **P0-3**.

### P1-7 · Migration rewrites every `userPermission` row

`packages/database/supabase/migrations/20260730142317_workflows-foundation.sql:24` — the
`UPDATE "userPermission" SET "permissions" = "permissions" || …` has **no WHERE clause**. Every
row in every tenant is rewritten, doubling the table until vacuum and holding locks across the
whole table.

**Do:** add `WHERE NOT ("permissions" ? 'workflows_view')`. **Check first whether this migration
has already been applied anywhere** — if it has, leave it alone and ship a corrected follow-up.

### P1-8 · `getWorkflowRunSteps` is unbounded

`workflows.service.ts:253`, called from `runs.$runId.tsx:43` with no pagination. A batched node
with 500 items returns 500+ rows each carrying `input`, `output` and `detail` JSONB, all shipped
to the browser.

### P1-9 · Lookup does `select("*")` and persists whole rows

`packages/jobs/src/workflows/actions/search.ts:49`. Full rows ride inline on each entity value and
land in `workflowStepRun.output`, retained 30 days — a payload-size *and* data-minimisation problem
for tables like `supplier`, `user`, `salesOrder`. **Do:** select `id` plus the columns the
catalog's entity properties actually declare.

### P1-10 · `checkWorkflowVersionLock` runs on every autosave and reads the whole definition

`apps/erp/app/modules/workflows/workflows.server.ts:41` — two round trips roughly once per second
while editing, one of which (`getWorkflowVersion`) selects the entire `nodes`/`edges` JSONB purely
to check a lock. **Do:** one query —
`select 1 from workflowVersion v join workflow w on … where v.id = w.activeVersionId`.

---

## P2 — robustness

- **P2-1** Redact `detail`. `packages/jobs/src/workflows/engine/ledger.ts:150` writes it raw while
  `input`/`output` go through `redactForLog`. Condition diagnostics carry resolved values.
- **P2-2** Clamp `durationMs`. `ledger.ts:143` lacks the `Math.max(0, …)` that `finishRun` has, so
  it can go negative.
- **P2-3** Fix the sequence collision. The trigger row hardcodes `sequence: 0`
  (`execute.ts:501`) and the first node also reads `0` (`execute.ts:540`, `state.sequence` starts
  at 0). Run detail orders by sequence, so the first two rows are ambiguously ordered. Start the
  walk at 1.
- **P2-4** *(product decision)* Decide what a test run leaves behind. `engine/manual.ts` uses
  `createMemoryLedger`, so an owner can create records, update rows and fire outbound webhooks
  with **zero** `workflowRun`/`workflowStepRun` history. The side effects are intentional; the
  total absence of an audit trail probably isn't. Minimum: write a run header flagged as a test.
- **P2-5** Move the permission gate before the privileged read.
  `apps/erp/app/routes/x+/workflow+/$id.test-run.tsx:247` fetches the trigger record with service
  role (bypassing RLS) before `walkWorkflow` checks the owner's module `view` permission. No leak
  today; the ordering is fragile. Hardening.
- **P2-6** `actorId` is dead payload. Parsed in `inngest/functions/workflows/moment.ts:11` and
  `inngest/functions/events/workflow.ts:12`, never read; `MatchInput`
  (`packages/jobs/src/workflows/types.ts`) has no such field. Related: origin is decided purely by
  the presence of the run tag, so **every service-role / background / edge-function write
  classifies as `Person`**. Either use `actorId` to classify properly, or drop the field.
- **P2-7** SSRF guard gaps in `packages/jobs/src/workflows/actions/url-guard.ts`:
  `100.64.0.0/10` (CGNAT) and `198.18.0.0/15` (benchmark) are not blocked, and URLs with embedded
  credentials are accepted. The DNS-rebinding TOCTOU (resolve, then `fetch` re-resolves) is
  inherent — either pin the resolved IP or document it as accepted.
- **P2-8** Re-validate `field` at run time in `runSearch`. Column names are checked at publish
  (`packages/workflows/src/definition/nodes.ts:543`) but the executor passes `field` straight into
  `.eq()`/`.ilike()`. Defence in depth against validator/catalog drift.
- **P2-9** Add optimistic concurrency to save. `$id.save.tsx` has none, and the canvas is
  explicitly designed as shared (`canvasState` is per workflow, not per user), so two editors on
  one draft silently last-write-wins.
- **P2-10** Make workflow delete async. The cascade
  (`workflowVersion → workflowRun → workflowStepRun`) can be hundreds of thousands of rows inside
  the HTTP request transaction. Soft-delete + background purge.
- **P2-11** Scope the two canvas workarounds that leaked app-wide:
  - `apps/erp/app/components/Selectors/UserSelect/useUserSelect.ts:377` sets
    `useOutsideClick({ immediate: true })` unconditionally, changing close-on-press behaviour for
    every user select in the app.
  - `apps/erp/app/components/Selectors/UserSelect/components/TreeSelect.tsx:31` swallows
    `onWheel`/`onTouchMove` for every UserSelect, including ones in drawers that need the scroll.

  Gate both on being inside the canvas (prop or context).
- **P2-12** Remove the debug dump. `apps/erp/app/routes/x+/workflow+/$id.save.tsx:65` logs full
  user definitions to server logs via `console.error(…, JSON.stringify(…, null, 2))`.
- **P2-13** Cache the Kysely client. `packages/jobs/src/db.ts:10` builds a new instance on every
  call — once per engine step, per matcher run, per queue pass. The pool is already cached.
- **P2-14** Cache the owner client per run. `execute.ts:106` (`contextFor`) mints a JWT and a
  Supabase client for every node *and* again inside `resolveBatchItems`; a 100-item batch signs
  ~101 JWTs.
- **P2-15** Parallelise batched items. `runBatchedNode` awaits one `step.run` per item serially;
  durability justifies discrete steps, not serial ones.

---

## P3 — cleanup

- **P3-1** `RunLedger.records()` returns `[]` for the durable ledger (`execute.ts:90`) — an
  interface method meaningless for one of its two implementors. Split the interface, or let
  `executeManualWorkflowRun` own the memory ledger's accessor.
- **P3-2** Three overlapping id→route resolvers now exist: `getEntityPath`
  (`apps/erp/app/utils/entity.ts`, id-prefix based), `getWorkflowRecordPath`
  (`apps/erp/app/utils/path.ts:2210`, entity-name based) and the pre-existing `getItemDetailPath`.
  Collapse to one.
- **P3-3** Wire `packages/checks`' `workflow-events` script into CI, or drop it in favour of the
  `workflow-trigger-event-drift.sql` invariant. `.github/workflows/check.yml:145` only runs
  `check:workflow-catalog`.
- **P3-4** Loop-guard depth resets to 0 when the causing run has been purged
  (`packages/jobs/src/workflows/matcher.ts`, `causingRun` fallback), so the chain cap isn't
  strictly enforceable. Low risk — worth a comment if not a fix.
- **P3-5** Measure the realtime cost. `workflowRun` and `workflowStepRun` are both in the
  `supabase_realtime` publication, and each step is an INSERT + an UPDATE, per item in a batch.

---

## Docs

- **D-1** Move the ten implemented specs from `.ai/specs/` to `.ai/specs/implemented/` per
  `.ai/specs/AGENTS.md`: `2026-07-30-workflows-{engine,event-catalog,foundation,matcher}`,
  `2026-07-31-workflows-{builder-canvas,builder-ux-overhaul,node-configuration,run-history,scheduling}`,
  `2026-08-03-workflow-variable-ux`. (Only `2026-07-30-workflows-catalogs.md` was moved.)
- **D-2** `packages/jobs/AGENTS.md:70` documents an **`ensureSchedulerChain()` export that does not
  exist anywhere in the codebase** — that line is the only occurrence of the identifier. The real
  mechanism is `trigger("workflow-scheduler-wake", { bookedFor: null })` inside `syncAndWake`
  (`apps/erp/app/modules/workflows/workflows.server.ts:79`). Fix or delete the line.
- **D-3** `packages/checks/AGENTS.md` has zero mention of workflows — add the `workflow-events`
  script and the `workflow-trigger-event-drift.sql` invariant.
- **D-4** `packages/lib/AGENTS.md` has zero mention of workflows — add `src/workflows/raise-moment.ts`
  and its contract (never throws into the caller; `momentId` doubles as the Inngest event id and
  the matcher's `sourceEventId`).
- **D-5** *(optional)* `packages/database/AGENTS.md` has no seed section at all. This PR
  restructured `seed-dev.ts` into a ten-tier `seed-dev/` directory and deleted
  `seed-change-orders.ts` plus its `db:seed:change-orders` script.

---

## Checked and found fine — do not re-raise

- Permission and plan gating is consistent across all 14 workflow routes
  (`requirePermissions` + `requirePlan({ feature: "WORKFLOWS" })`).
- RLS policies use the `(SELECT get_companies_with_employee_permission(...))` initplan-cached form.
- `workflowLastRun` is `security_invoker`, its `DISTINCT ON` key supports qual pushdown, and the
  supporting index exists.
- Tenancy in `runUpdateAction` is sound — `existsInCompany` is checked on the target **and** on
  every entity-typed value before the write.
- `claimStep` / `claimRun` idempotency is genuinely atomic (unique-constraint
  `ON CONFLICT DO NOTHING`; conditional `Queued → Running` update).
- Webhook secret-header scrubbing is applied in both the log redactor and the response excerpt.
- `scanDue`'s partial index `workflow_due_idx` matches its predicate exactly.
- Schedule arithmetic is correct: wall-clock recomputation via `@internationalized/date` (not
  instant addition, so DST-safe), monthly skips rather than clamps, and per-workflow jitter spread.
- No `console.log` / `debugger` / `TODO` / `.only` / `.skip` in added lines (the one `console.error`
  is **P2-12**).
- No new file pushed past ~800 lines; the new code is well modularised.

### Discarded as false positives

1. **"`delete.$id.tsx` is missing `assertIsPost`."** Only 1 of 10 delete routes in the repo uses
   it — omitting it *is* the convention. Not an inconsistency.
2. **"Remaining JS `Date` usage violates the date rule."** It doesn't.
   `packages/checks/src/conformance/no-local-timezone.ts` bans exactly four idioms
   (`getLocalTimeZone()`, UTC day-slicing, date-parts-of-now, `setHours(0,0,0,0)`) and explicitly
   states *"Full-instant `new Date().toISOString()` stays allowed — timestamps are timezone-free."*
   `.claude/rules/date-handling.md` carries a matching narrow exception for instant arithmetic.
   `Date.parse(completedAt)`, `new Date(startedAt).getTime()` and the scheduler's instant
   comparisons all fall inside it. (**P2-2**, the negative `durationMs`, survives on its own
   merits — it is an inconsistency with `finishRun`, not a date-rule issue.)
3. **"Compute retention cutoffs in SQL."** Same reasoning — `cutoffDays` is permitted instant
   arithmetic. Marginal at best.
