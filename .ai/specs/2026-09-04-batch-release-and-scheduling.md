# Batch Release & Batch-Aware Scheduling

> Status: in-progress
> Author: Claude (with Brad, 2026-09-04; independent Fable review same day)
> Date: 2026-09-04
> Research: `.ai/research/2026-09-04-batch-release-and-scheduling.md` (confirmatory —
> all four core choices have clear precedent; no contradictions: SAP PP-PI phase
> release, APS campaigning, p-batch/s-batch resource typing, quantity-equivalence split)
> + `.ai/research/job-operation-batching-competitors.md` (2026-08-31 survey)
> Builds on: `.ai/specs/2026-08-21-job-operation-batching.md` (the batching
> feature this extends — its locked decisions are preserved, not replaced)
> Requirement: REQ-FUN-PRODUCTION-005 (Must, Daily)
> Tracking issue: https://github.com/crbnos/carbon/issues/1010
> Branch: `feat/job-operation-batching-v2`

## TLDR

Today an operation can only be **planned into a batch** after its job is
**released to the floor** — because the batch planner and the shop floor read
the *identical* visibility predicate (job status ∈ `Ready`/`In Progress`/
`Paused`; "Released" is only a UI relabel of `Ready`, not a stored state). So
every operation that *should* be batched spends the window between release and
batch-creation sitting on the floor as a naked, individually-runnable operation
— the wrong thing sent to production. The leak is structural, not a timing bug:
the only way to make an operation visible to the planner is to make it visible
to the floor at the same instant.

This spec **decouples planner visibility from floor visibility** and makes a
batch **independently releasable**:

1. **The planner widens** to show operations from jobs in any live status
   (`Draft`/`Planned`/`Ready`/`In Progress`/`Paused`), so batches are composed
   *before* release.
2. **The batch gains a pre-floor state.** Lifecycle becomes
   `Planned → Active → Completing → Completed`; **"Release batch"** is the new
   `Planned → Active` transition (`Active` keeps its meaning "live on the
   floor", relabelled **"Released"** in the UI, exactly as jobs relabel
   `Ready`). A `Planned` batch lives only in the planner.
3. **Floor visibility becomes a membership handoff.** An operation is
   floor-visible iff — if it **belongs to a batch**, that batch is Released;
   if it **belongs to no batch**, its job is released (today's rule). Once a
   batch owns an operation, the *batch's* release state governs it instead of
   the job's. Nobody is ever blocked: to run a batched op solo you remove it
   from the batch and job-gating takes over.
4. **The scheduler becomes batch-aware.** A Released batch is scheduled as **one
   unit** — one coalesced `capacityReservation` on one work center — and its
   duration follows a new `process.batchType` (`Simultaneous` = oven/furnace,
   members run in parallel, `duration = setup + max(run)`; `Sequential` =
   saw/laser, members run one after another, `duration = setup + Σ(run)`).
   Members are pinned to the batch window, not placed individually — which also
   closes the existing HIGH risk that per-op reservations N×-over-book a batch
   work center.

The cost/time split at completion is **unchanged** — it slices the *actual
recorded* timer proportionally to member quantity, which is physics-agnostic.
Only the *planned* duration uses the max-vs-sum formula.

## Problem Statement

`get_batchable_operations` (the batch planner RPC,
`20260821024449_job-operation-batching.sql:328-346`) gates candidates on
`j."status" IN ('Ready','In Progress','Paused')`. The MES floor —
`get_active_job_operations_by_location` (`:189`) and `getOpenJobs`
(`apps/mes/app/services/operations.service.ts:53`, via `activeJobStatuses`,
`packages/database/src/utils.ts:17`) — gates on the **same** set. There is no
stored "Released" flag; `Ready` *is* released, relabelled in
`apps/mes/app/routes/x+/jobs.tsx:94`.

Consequences:

- **You cannot see an operation in the planner without also putting it on the
  floor.** Batching can only happen *after* the op is floor-eligible, so there
  is always a window where a should-be-batched operation is a loose,
  individually-dispatchable operation. An operator can sign into it and run it
  the wrong way (N setups instead of one shared run) before the planner ever
  touches it.
- **A batch has no release concept.** `jobOperationBatch.status` is
  `Active → Completing → Completed` and is `Active` (live) the instant it is
  created (`20260821024449…:53`, `…index.ts:682`). You cannot compose a batch
  ahead of time, review it, and release it as a unit; and you cannot release a
  batch's operations to the floor *before* their jobs are released, even though
  the batch is ready to run.
- **The scheduler is batch-unaware** (the existing spec's HIGH risk).
  `capacityReservation` is per-operation, so N batch members each reserve the
  full run time on one work center — N×-over-booking it — and nightly replan
  can split a batch across work centers. There is no model for the
  simultaneous-vs-sequential physics of batch resources: today's planned
  duration is hardcoded "shared setup + **summed** labor/machine"
  (`.claude/rules/mes-job-operation-ui.md`), i.e. it silently assumes every
  batch is sequential and over-estimates every furnace/oven load.

## Proposed Solution

### 1. The membership-handoff floor gate

One governing rule replaces the single job-status predicate:

> **An operation is floor-visible iff:**
> - it belongs to a batch → **the batch is Released** (`Active`/`Completing`), *or*
> - it belongs to no batch → **its job is released** (`Ready`/`In Progress`/`Paused`) — today's rule.
>
> (In both cases the operation itself must not be `Done`/`Canceled`.)

Membership transfers the gate from the job to the batch. Verified against every
case:

| Op in a batch? | Batch state | Job state | Floor-visible? | |
|---|---|---|---|---|
| No | — | Released | **Yes** | happy path — a batchable op nobody batched still runs; never blocked |
| Yes | Released | *Un*released (Draft/Planned) | **Yes** | a released batch pulls its members ahead of their jobs |
| Yes | Released | Released | Yes | — |
| Yes | **Planned** | Released | **No** | the leak, closed: an op planning pulled into a not-yet-released batch is held by it |
| No | — | Unreleased | No | nothing says go |
| any | any | any | **No** if op `Done`/`Canceled` | — |

The fourth row is the leak fix and it is **not a block**: the op was
deliberately pulled into a batch during planning; the batch is the intended
vehicle; releasing it is one click. To genuinely run it solo, remove it from
the batch (existing `remove`/`dissolve`) and job-gating resumes. Membership is
simultaneously the leak-prevention *and* the escape hatch — there is no separate
"override" concept.

### 2. Batch lifecycle: a pre-floor state + release

```
Planned ──release──> Active ──complete(phase 1)──> Completing ──phase 2──> Completed
   │                   │
   │  (unrelease,      │  (add/remove/work-center while no productionEvent)
   │   no event yet)   │
   └── dissolve ───────┘   (deletes the batch; members return to job-gating)
```

- **`Planned`** (new default on create): composed in the planner, **not on the
  floor**. Fully editable (add/remove members, set/clear work center, dissolve).
  Its members are invisible to MES (membership handoff: batch not Released).
- **`Active`** (= today's live state, UI label **"Released"**): on the floor.
  Members are floor-visible. Still editable until the first `productionEvent`
  (unchanged boundary). Timers run here.
- **`Completing` / `Completed`**: unchanged two-phase completion.

New transitions on the `batch-operations` edge function:

- **`release`** — guarded `Planned → Active`. Requires a `workCenterId` (a batch
  with no work center has nowhere to run) and ≥1 member. Makes members
  floor-visible. The ERP action wrapping it mirrors the job-release ordering:
  first `recalculateJobRequirements` for member jobs still in `Draft`/`Planned`
  (a batch can pull a Draft job's op onto the floor — its BOM quantities must be
  fresh, same safety recalc job release performs; **no MRP run**), then the
  edge-fn flip, then `notifyScheduleInputsChanged` (the flip must be persisted
  before the wave reads it — the same load-bearing ordering as job release).
- **`unrelease`** — guarded `Active → Planned`, allowed **only while no
  `productionEvent` exists** for the batch (symmetric with the add/remove
  boundary). Pulls the batch back off the floor. Triggers a reschedule.

Membership/work-center mutations (`add`/`remove`/`update`) widen from
"`Active` only" to "**`Planned` or `Active`**, pre-event" — a `Planned` batch
must be fully composable or the planning state is useless. `dissolve` and the
completion path are unchanged (`planBatchCompletion` already throws for any
status other than `Active`/`Completing`, so a `Planned` batch can never
complete).

**Server-side enforcement, not just list-visibility (Fable review finding):**
today MES has **no status gate at all** on the operation view or the start
route — `start.$operationId.tsx` checks only `companyId`, and the operation
loader treats a non-`Active` batch as "no batch", rendering a plain runnable
operation. Floor gating is purely which lists an op appears in. So the handoff
rule must also be enforced where work actually starts:

- `operation.$operationId.tsx` loader: an op in a **`Planned`** batch redirects
  away with a flash ("part of batch BAT…, not yet released to the floor"); an
  **unbatched** op whose job is unreleased redirects the same way.
- `start.$operationId.tsx`: the same check before writing any
  `productionEvent`.

Without these, the leak survives via direct URL or a stale tab.

Create supports the singleton happy path: the builder creates `Planned` by
default, with a **"Create & Release"** affordance that inserts `Active` and
schedules in one step (for the furnace op that doesn't need to wait for
company).

`dissolve` stays the pre-start "never mind" (deletes the row; members drop back
to job-gating). Completion is unchanged; `planBatchCompletion` throws for any
status other than `Active` (slice) / `Completing` (resume) — a `Planned` batch
has no timers so it can never reach `complete`.

### 3. Planner widening

`get_batchable_operations` drops the released-only job filter. Candidates are
operations of the (batchable) process at the location that are **unstarted**
(op status `Todo`/`Ready`/`Waiting`, no `productionEvent`), **unbatched**, whose
job is in any **live** status (`Draft`/`Planned`/`Ready`/`In Progress`/`Paused`
— i.e. not `Completed`/`Closed`/`Cancelled`). The `NOT EXISTS productionEvent`
guard and the "existing batch members as lanes" behaviour are unchanged; the
lanes now include `Planned` batches (the ones you are still composing) as well
as `Active`/`Completing`.

The route wrapper's `RELEASED_JOB_STATUSES` "hidden ops" attribution
(`api+/production.batchable-operations.ts:26`) is retired — an unreleased job is
no longer a reason to hide a candidate.

### 4. Batch-aware scheduling

**`process.batchType`** — a new enum on the process master data, next to
`batchable`: `Simultaneous | Sequential` (default **`Sequential`** — the
conservative sum-time assumption; over-reserving a machine is safer than
under-reserving it). Meaningful only when `batchable = true`.

**Planned duration of a Released batch** (used for the reservation and the
builder/MES estimate), where `run_i = max(labor_i, machine_i)` per member,
net-of-progress for a partially-complete member exactly as single ops are today:

```
setup = max(member setup_i)                 // shared load setup, both regimes
run   = Simultaneous ? max(run_i)           // parallel load — the cycle time
      : Sequential   ? Σ(run_i)             // serial queue — one after another
duration = setup + run
```

This replaces the hardcoded-sequential MES aggregate, fixing an existing latent
over-estimate for simultaneous processes.

**The batch is one scheduling unit** (mechanics refined by the Fable review
against the real engine):

- **Batch pre-pass.** Before the per-job forward passes, a batch-placement pass
  places every Released batch at the location: duration from
  `batchDuration(batchType, members)` (net-of-progress like single ops —
  remaining-work scaling, setup counted done once any batch event exists),
  anchored at `max(now, max over members of their predecessor op's persisted
  projectedCompletionAt)` — the engine's own last-wave forecasts, read from the
  DB at wave start (precedent: the need-by pass already reads stored `dueDate`
  pins). A predecessor placed later than the batch start in this wave surfaces
  as a **conflict flag** on the member, and the next wave converges. Earliest
  feasible slot on the batch's `workCenterId` given existing reservations.
- **One reservation, tagged.** `capacityReservation.operationId`/`jobId` are
  `NOT NULL`, so the batch reservation carries a new nullable
  `jobOperationBatchId` tag column and anchors its NOT NULL columns on the
  deterministic first member (min member op id). Consequences wired in:
  the per-job regen delete (`scheduling-engine.ts:1201`) adds
  `AND "jobOperationBatchId" IS NULL` (a member job's own regen must not
  destroy the batch's reservation), the not-yet-run snapshot exclusion
  (`master-data-provider.ts:497`) keeps batch-tagged rows visible (the batch is
  already placed; its members must see it as fixed), and the pre-pass owns
  delete + rewrite of batch-tagged rows for the location.
- **Members are pinned to the batch window** — `startDate` /
  `projectedCompletionAt` are the batch's; no per-member placement, no
  per-member WC reservation. Implementation hook: the engine **already
  supports** an op that skips placement and keeps a fixed window (the pinned
  Outside-Processing path, `date-calculator.ts:34-43`,
  `work-center-selector.ts:378` chains successors after a pinned end) — batch
  members generalize that path rather than adding a new mode.
- Each member's **downstream** operations depend on the batch's single
  `projectedCompletionAt` — all members leave the batch together (slightly
  conservative for a sequential batch's early-finished part; fine for v1).
- **`Planned` batches schedule as today** — members placed individually. The
  residual per-op over-booking for a Planned batch is bounded (pre-floor,
  planning state) and disappears at release; coalescing only Released batches
  keeps the pre-pass input stable (membership and WC can still churn on a
  Planned batch).
- **Work-center reservation only in v1.** The pre-pass does not reserve an
  employee for ability-gated batchable processes (a single op would); a batch
  is one crew on one machine and v1 accepts the slight optimism. Documented
  gap.

**Scheduler job-loading widens** so a released batch can pull unreleased-job
members onto the schedule: the location pass (`run-schedule.ts:77` loads
`status IN ('Ready','In Progress','Paused')`) additionally loads **any job with
a member operation in a Released batch**, deduped into the same deterministic
order. Those jobs run the engine like active jobs (their upstream ops claim
real capacity — a released batch commits its inputs, and the schedule should
say so); their non-batched ops remain floor-invisible via the handoff rule.

**Simultaneous capacity stays advisory.** `workCenter.batchCapacity` already
exists and is advisory (fill bar in the builder). The scheduler does **not**
split an over-capacity simultaneous batch into back-to-back reservations in v1
— it warns and reserves one block (consistent with the "never block"
principle). Splitting a load is a separate future spec.

**MRP is unaffected.** Batch release is a floor-visibility + scheduling event;
it does not change buy-vs-make decisions (materials still come from each job's
own BOM, planned at job level). No MRP or requirements-recalc runs on batch
release.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Core reframe | **Decouple planner-visibility from floor-visibility**; the batch is the vehicle that carries batchable ops across the floor gate | The single shared predicate IS the leak; two gates is the only structural fix. Precedent: SAP PP-PI treats "make a sub-unit executable" (phase release) as a gate separate from order release |
| Floor gate | **Membership handoff**: op in a batch → batch's release state governs; op in no batch → job's release governs | Satisfies "never block a batchable op nobody batched" AND "show a released batch's members on an unreleased job" AND "no leak" — one rule, all three. This is APS **campaigning**: members are "spoken for" by the campaign and stop appearing as loose ops, which is how double-dispatch is avoided by single ownership |
| Escape hatch | **Remove-from-batch** (existing `remove`/`dissolve`); no new "run solo" override | Membership is the only switch; fewer states, and the ERP cardinal sin (blocking) is avoided by a cheap, existing action |
| Batch pre-floor state | Add **`Planned`** before `Active`; **`Active` keeps meaning "live/released"**, UI relabels it "Released" | Minimal churn — completion/resume (`planBatchCompletion`), RPC predicates, and MES all key on `Active`/`Completing` and stay as-is. Renaming `Active`→`Released` was considered and rejected (touches every consumer for a label) |
| Release action | New edge-fn `release` (`Planned → Active`), requires `workCenterId` + ≥1 member, triggers a schedule | A batch with no work center has nowhere to run; scheduling must react to the new floor unit |
| Un-release | New edge-fn `unrelease` (`Active → Planned`), allowed only while no `productionEvent` | Maximum flexibility (Brad) without corrupting a run — same boundary as add/remove |
| Create default | `Planned`, with a **"Create & Release"** one-step affordance | Planning-first is the whole point; the one-step path preserves the singleton happy path (batch of one on a furnace) |
| Planner visibility | Any **live** job status (`Draft`/`Planned`/`Ready`/`In Progress`/`Paused`); unstarted + unbatched unchanged | Compose batches before release; still never offer started or completed work |
| Simultaneous vs sequential | **`process.batchType` enum (`Simultaneous`\|`Sequential`, default `Sequential`)** on the process, beside `batchable` | Same home as the capability flag; the machine determines the physics (furnace parallel, saw serial). This is the scheduling literature's **p-batch (parallel) vs s-batch (serial)**, defined as a property of the machine/resource — heat-treat is the canonical p-batch example |
| Planned duration | `setup(max) + run` where `run = max(run_i)` for Simultaneous, `Σ(run_i)` for Sequential; `run_i = max(labor,machine)` | The only place the two regimes differ; fixes the hardcoded-sequential MES estimate |
| Batch as schedule unit | **One coalesced `capacityReservation`** on one work center; members pinned to the window; downstream anchored to batch `projectedCompletionAt` | Resolves the existing HIGH over-booking risk directly; matches "schedule the batch, not the members" (Brad) |
| Scheduler job-loading | Location pass includes jobs with a member in a Released batch, even if the job is not in `activeJobStatuses` | Required for the "released batch on an unreleased job" case |
| Simultaneous capacity | **Advisory only** in v1 (warn, never split/block) | Consistent with "never block" and the existing advisory `batchCapacity`; load-splitting is a separate spec |
| MRP on release | **None** — batch release is floor + schedule only | Materials are per-job BOM, planned at job level; batching changes execution, not procurement |
| Multi-tenancy | No new tables; `Planned` enum value + `batchType` enum/column reuse existing composite-tenant scoping | Additive to the existing batching schema |
| Backward compatibility | `Planned` appended to the enum; `batchType` defaults `Sequential`; floor/planner predicate changes are the only behavioural deltas — a company with no batches is byte-for-byte unchanged (every op is "in no batch" → job-gating) | The handoff rule reduces to today's rule when `jobOperationBatchId IS NULL` |

## Data Model Changes

No new tables. **Two additive migrations** (Fable review: a value added by
`ALTER TYPE … ADD VALUE` cannot be *referenced* later in the same transaction,
and the migration runner wraps each file in one — so the enum add and its first
uses must be separate files). The batching feature's `20260821024449` migration
is on this branch but **fix forward** — do not edit it.

```sql
-- ── Migration A: enum values + batchType + reservation tag ──────────────────
-- Batch pre-floor state. BEFORE 'Active' keeps enum sort = lifecycle order.
ALTER TYPE "jobOperationBatchStatus" ADD VALUE IF NOT EXISTS 'Planned' BEFORE 'Active';

-- Simultaneous vs sequential batch physics (process master data).
-- (CREATE TYPE has no IF NOT EXISTS — guard with a DO block in the real file.)
CREATE TYPE "batchType" AS ENUM ('Sequential', 'Simultaneous');
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "batchType" "batchType" NOT NULL DEFAULT 'Sequential';
-- Recreate the "processes" view from its NEWEST definition (DROP + CREATE, not
-- REPLACE — a new p.* column cannot be appended by REPLACE) so it exposes batchType.

-- Batch reservation tag: operationId/jobId are NOT NULL on capacityReservation,
-- so the coalesced batch reservation anchors those on the deterministic first
-- member and carries this tag as its semantic key.
ALTER TABLE "capacityReservation" ADD COLUMN IF NOT EXISTS "jobOperationBatchId" TEXT;
ALTER TABLE "capacityReservation" ADD CONSTRAINT "capacityReservation_jobOperationBatchId_fkey"
  FOREIGN KEY ("jobOperationBatchId", "companyId")
  REFERENCES "jobOperationBatch"("id", "companyId")
  ON DELETE SET NULL ("jobOperationBatchId");   -- PG15 column-list form, per lesson
CREATE INDEX IF NOT EXISTS "capacityReservation_jobOperationBatchId_idx"
  ON "capacityReservation" ("jobOperationBatchId") WHERE "jobOperationBatchId" IS NOT NULL;

-- ── Migration B: everything that REFERENCES 'Planned' ───────────────────────
ALTER TABLE "jobOperationBatch" ALTER COLUMN "status" SET DEFAULT 'Planned';
-- Re-declare get_batchable_operations (fork 20260821024449, the newest def):
--   job filter  → j."status" NOT IN ('Completed','Closed','Cancelled')
--   batch lanes → b."status" IN ('Planned','Active','Completing')
--   output      + j."status" AS "jobStatus"  (builder chips need it)
-- Re-declare get_active_job_operations_by_location (fork 20260831170323, the
-- newest def) with the membership-handoff predicate (below).
```

Notes:

- The `batch-operations` `create` case changes its inserted `status` from
  `'Active'` to `'Planned'` (honouring `release: true` for "Create & Release");
  the column default flip is belt-and-braces on top.
- No change to `jobOperation.jobOperationBatchId`, `productionEvent`, or the
  sequence.
- After the migrations: `pnpm run generate:types` before typechecking.

Behavioural (not new tables) — the predicate changes are the heart of this spec:

- **`get_batchable_operations`** — replace `j."status" IN ('Ready','In
  Progress','Paused')` with the live-job set (`NOT IN ('Completed','Closed',
  'Cancelled')`); include `Planned` batches in the members-as-lanes union.
- **`get_active_job_operations_by_location`** (feeds the ERP schedule board AND
  the MES kanban) — change the `relevant_jobs` CTE from the job-status filter to
  the **membership-handoff** predicate:
  - include an operation when `jobOperationBatchId` is in an `Active`/
    `Completing` batch, regardless of job status; OR
  - when `jobOperationBatchId IS NULL` and the job is in `activeJobStatuses`.
  - A `Planned` batch's members are excluded (not on the floor) even if the job
    is released.
- **`getOpenJobs`** (`operations.service.ts`) — the job list widens to include
  a job that has an operation in a Released batch even if the job is not in
  `activeJobStatuses` (so a Draft job with a released-batch member appears, with
  only that operation actionable).
- The scheduler's **job-loading query** (`packages/ee/src/planning/scheduling/
  run-schedule.ts`) widens the same way (jobs with a Released-batch member).

## API / Service Changes

### `batch-operations` edge function (new intents)

Add to the discriminated union (`.claude/rules/workflow-edge-function.md`
shape; `requirePermissions(..., { update: "production" })` unchanged):

- `{ type: "release", batchId, companyId, userId }` — re-read the batch under
  `companyId`; assert `status = 'Planned'`, `workCenterId IS NOT NULL`, ≥1
  member; guarded flip `Planned → Active` (`WHERE status = 'Planned'`, rollback
  if 0 rows); after commit call `notifyScheduleInputsChanged(companyId,
  "work-center", "batch released", batchId?)` (kind TBD at plan — a batch is a
  work-center-scoped change). Returns `{ released: true }`.
- `{ type: "unrelease", batchId, companyId, userId }` — assert `status =
  'Active'` and **no** `productionEvent` tagged with the batch; guarded flip
  `Active → Planned`; reschedule. Refused (named error) once any timer exists —
  "production has been recorded — complete the batch instead".
- `{ type: "create", ..., release?: boolean }` — insert `status: release ?
  'Active' : 'Planned'` (default `Planned`). When `release`, apply the same
  `workCenterId`-required guard and trigger a schedule.

`create`'s existing `assertEligible` already does **not** gate on job status
(the RPC did), so widening the planner needs no edge-fn eligibility change —
members from Draft/Planned jobs were always acceptable to the gate.

### `production.service.ts` (ERP)

```typescript
releaseJobOperationBatch(client, { batchId, companyId, userId })     // type: "release"
unreleaseJobOperationBatch(client, { batchId, companyId, userId })   // type: "unrelease"
// createJobOperationBatch gains an optional `release` passthrough
```

`production.models.ts`: extend `jobOperationBatchStatus` const with `Planned`;
`createJobOperationBatchValidator` gains optional `release: zfd.checkbox()`;
new `releaseJobOperationBatchValidator` / `unreleaseJobOperationBatchValidator`
(batchId only).

### `resources` module

`processValidator` gains `batchType: z.enum(["Sequential","Simultaneous"])`
(default `Sequential`); `upsertProcess` passes it through; `ProcessForm` gains
the selector (only shown when `batchable` is on).

### Scheduling engine (`packages/ee/src/planning/scheduling/`)

Design-level contract (engine internals to be detailed in `/plan`):

- **Job-loading** widens to include jobs with a Released-batch member.
- **Batch placement**: a Released batch is placed as one unit on its
  `workCenterId` for `batchDuration(batchType, members)`; write ONE
  `capacityReservation` for the batch, not per member. Recommended shape: a
  batch-placement pass that runs before the per-job forward passes, then the
  per-job passes treat batched member ops as **pinned** (already placed) with
  their downstream deps anchored to the batch's `projectedCompletionAt`.
- **Duration helper** `batchDuration` lives in the shared scheduling code (and,
  if the builder/MES estimate needs it, mirror via `@carbon/utils` next to
  `batch-time-split`), so the reservation, the builder estimate, and the MES
  plan bar cannot disagree.
- `notifyScheduleInputsChanged` is the only sanctioned trigger (never write
  `startDate`/`projectedCompletionAt` directly) — `release`/`unrelease` fire it.

### MES (`apps/mes/app/services/`)

- `getOpenJobs` and the display board reads adopt the membership-handoff
  predicate (above). A `Planned` batch's members never appear; a Released
  batch's members appear regardless of their job's status.
- No change to the batch run/complete flow (`batch.$batchId.complete.tsx`,
  `BatchCompleteModal`) — completion still operates on `Active`/`Completing`.

## UI Changes

| Surface | Change |
|---------|--------|
| Process form (`resources/ui/Processes/ProcessForm.tsx`) | When `batchable` is on, show a **Batch type** selector: **Sequential** ("parts run one after another — saw, laser table") vs **Simultaneous** ("parts run together in one load — furnace, oven, plating"). Default Sequential |
| Batch builder (`ui/Batches/BatchBuilder.tsx`) | Candidate list widened to unreleased jobs (a job-status chip distinguishes Draft/Planned from Released so the planner sees what they're pulling forward). Review step: **"Create"** (Planned) and **"Create & Release"** (Active). The run-time estimate uses `batchDuration(batchType, …)` (max vs Σ) instead of the hardcoded sum |
| Batches list + detail drawer (`ui/Batches/…`) | New **Released** (was "Active") label; a **Planned** status badge; a **Release** action (Planned rows, requires a work center — the action is disabled with a hint if none) and an **Unrelease** action (Active rows with no production event). Status filter gains Planned |
| Operations schedule board / batch card (`BatchItemCard`) | The batch card renders in its work-center column for **Released** batches; members are not drawn individually (Brad: show the batch, not the members). **Amended at implementation (Fable, for veto): Planned batches do NOT appear on the board** — the board reads the floor RPC (shared with the MES kanban), and widening it would put planning-state work on a dispatch surface, the exact ambiguity this feature removes. Planned batches are managed on the Batches list + builder (status filter, Release action, drawer). The card ships a dashed `Planned` variant, dormant unless a planner lane is added later |
| MES kanban / floor | Unchanged UI, but a Released batch's members now appear even when their job is unreleased; a `Planned` batch's members do not appear even when their job is released. A batchable op **not** in any batch on a released job appears normally (happy path) |
| Job detail | A job with unbatched batchable operations after release surfaces an informational "**N operations awaiting batching**" line (not a block) so a planner knows those ops are held for the planner, not lost |

## Acceptance Criteria

- [ ] A process can be marked `batchable` with **Batch type** Sequential or Simultaneous; the field is hidden when `batchable` is off; existing processes default to Sequential.
- [ ] The batch builder lists unstarted, unbatched operations of a batchable process whose job is `Draft` or `Planned` (not only released jobs); a job-status chip distinguishes them; `Completed`/`Closed`/`Cancelled` jobs never appear.
- [ ] Creating a batch with **"Create"** yields `status = 'Planned'`; its member operations do **not** appear on the MES floor even if their jobs are released; the batch is fully editable (add/remove/work-center/dissolve).
- [ ] **"Create & Release"** (or the Release action on a Planned batch) requires a work center, flips the batch to `Active` ("Released"), triggers a schedule, and makes its members floor-visible **even if their parent jobs are `Draft`/`Planned`** (unreleased-job + released-batch case).
- [ ] A batchable operation on a **released** job that belongs to **no** batch appears on the floor and is individually runnable (happy path — never blocked).
- [ ] An operation pulled into a **Planned** batch does **not** appear on the floor even after its job is released (the leak, closed); removing it from the batch (or dissolving) restores job-gating and it appears again once its job is released.
- [ ] **Unrelease** returns an `Active` batch with no production events to `Planned` (members leave the floor, reschedule fires); it is refused with a named error once any batch timer exists.
- [ ] A `Planned` batch cannot be completed (`planBatchCompletion` rejects it); completion behaviour for `Active`/`Completing` is unchanged (two-phase, resumable, proportional slice).
- [ ] For a **Simultaneous** batch (members A/B/C with run times 40/70/50 min, setups 10/10/10), the scheduled reservation is `10 + max(40,70,50) = 80` min; for the **same** members on a **Sequential** batch it is `10 + (40+70+50) = 170` min.
- [ ] A Released batch occupies its work center as **one** `capacityReservation` for the batch duration (not N per-member reservations); member operations are pinned to that window; each member's downstream operation depends on the batch's single `projectedCompletionAt`; nightly replan keeps the batch on one work center (no member split).
- [ ] Job costing / estimates-vs-actuals for each member job is unchanged — the completion split still slices the actual recorded timer proportionally to member quantity (Simultaneous/Sequential does **not** change the split).
- [ ] A company with no batches behaves byte-for-byte as before (every op is "in no batch" → job-gating on the floor and released-only in the planner is the only behaviour that changed, and it is a widening).
- [ ] `pnpm exec turbo run typecheck --filter=erp --filter=mes` and `--filter=@carbon/ee`, lint, and tests pass; `batchDuration` has a unit test covering both regimes and net-of-progress; new MES/ERP strings extracted across locales.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Scheduling engine change (batch as a pinned unit, widened job-loading) is the deepest part and lives in EE, forward-ASAP, capacity-1 finite placement | High | Keep v1 to "one coalesced reservation + pin members + anchor downstream"; a dedicated batch-placement pass before per-job passes isolates the change; extensive `batchDuration` + placement unit tests; this directly *resolves* the existing spec's HIGH over-booking risk rather than adding a new one |
| `ALTER TYPE … ADD VALUE 'Planned'` transaction semantics (can't use the value in the same txn on older PG) | Med | Confirm Carbon's migration runner behaviour at plan time; isolate the `ADD VALUE` in its own statement/migration if needed |
| Widening `getOpenJobs` / `get_active_job_operations_by_location` regresses the floor for the common (no-batch) case | Med | The handoff predicate reduces to today's exact predicate when `jobOperationBatchId IS NULL`; smoke both boards + the MES floor with zero batches, one Planned batch, one Released batch on a Draft job |
| A released batch on a Draft job means a Draft job appears on the MES floor with only one actionable op — could confuse operators | Low | The op-level handoff makes only the batched op actionable; the job's other ops stay hidden until job release; document in AGENTS.md |
| Simultaneous batch exceeding physical capacity is only warned, not split | Low | Deliberate v1 scope (advisory capacity, never block); load-splitting is a named future spec; the fill bar already warns |
| Sequential-batch downstream anchoring is conservative (early-cut part waits for batch end) | Low | Accepted for v1; documented; refine only if customers need per-member early release |
| Batch anchor uses last-wave predecessor forecasts (stale by one wave for just-changed upstreams) | Low | Deterministic per wave; overruns surface as conflict flags; next wave converges — same self-healing contract the engine already has for conflicts |
| A batch member's job can be `Paused` (held) while the batch runs | Low | Batch governs visibility; member renders `Paused` via the existing coercion; operator excludes it at completion; documented |

## Open Questions

> Resolved with Brad in the 2026-09-04 design conversation. Items marked
> **(recommended — for veto)** are ones the spec author settled from the agreed
> principles and are surfaced for Brad to override; the rest are Brad's explicit
> answers. Per Brad's working style, accept-and-document with a veto window.

- [x] **How do we prevent the leak without blocking anyone?** — **Answer
  (Brad):** the **membership handoff** — an op in a batch is governed by the
  batch's release state, an op in no batch by the job's. Never hard-suppress
  batchable ops; removing an op from a batch is the escape hatch.
- [x] **Should a released job's un-batched batchable op still be runnable on the
  floor?** — **Answer (Brad):** yes, always. "The cardinal sin in ERP is to
  block someone from doing something they need to do."
- [x] **Should a released batch's members show on the floor even if their job is
  unreleased?** — **Answer (Brad):** yes.
- [x] **How to schedule simultaneous vs sequential batches?** — **Answer
  (Brad):** distinguish them; oven = parallel (`max` run), saw/laser = serial
  (`Σ` run). Modeled as `process.batchType`; the batch is scheduled as one
  unit, members not shown individually.
- [x] **`batchType` default and naming?** — **Answer (recommended — for veto):**
  enum `Sequential | Simultaneous`, default **Sequential** (conservative
  over-reserve). 
- [x] **Reuse `Active` as the live/released state or rename to `Released`?** —
  **Answer (recommended — for veto):** keep `Active` (UI label "Released"), add
  `Planned` — minimal churn to completion/RPC/MES consumers.
- [x] **Create default `Planned`, with a one-step "Create & Release"?** —
  **Answer (recommended — for veto):** yes — planning-first default preserves the
  singleton happy path.
- [x] **Does batch release require a work center / trigger MRP?** — **Answer
  (recommended — for veto):** require a work center (nowhere to run otherwise);
  trigger a schedule; **no** MRP/requirements recalc (materials are per-job BOM,
  planned at job level — Model X).
- [x] **Provide `unrelease` (Active → Planned)?** — **Answer (recommended — for
  veto):** yes, but only while no `productionEvent` exists (Brad's "maximum
  flexibility" without corrupting a run).
- [x] **Simultaneous over-capacity: split or warn?** — **Answer (recommended —
  for veto):** warn only (advisory), never split in v1.

The following were surfaced and resolved by the independent Fable review
(2026-09-04, Brad delegated: "review the 6 recommendations and make the plan
independently"). All six original recommendations were **upheld**; these are
the completeness findings that review added:

- [x] **MES has no server-side status gate today (direct-URL leak).** —
  **Fable:** enforce the handoff rule in the `operation.$operationId` loader and
  `start.$operationId` route, not only in list RPCs. Without it a Planned-batch
  member is startable via URL/stale tab and the leak survives.
- [x] **Does batch release refresh member-job requirements?** — **Fable:** yes —
  `recalculateJobRequirements` for member jobs still `Draft`/`Planned`, before
  the flip (mirrors job release's safety recalc, same ordering); still no MRP.
- [x] **How does the coalesced reservation coexist with NOT NULL
  `operationId`/`jobId` and the per-job regen?** — **Fable:** nullable
  `capacityReservation.jobOperationBatchId` tag + anchor-member row; per-job
  delete adds `AND "jobOperationBatchId" IS NULL`; snapshot exclusion keeps
  batch-tagged rows; the pre-pass owns batch-row delete/rewrite.
- [x] **What anchors the batch start when upstream ops aren't placed yet?** —
  **Fable:** persisted last-wave `projectedCompletionAt` of member predecessors
  (`max(now, …)`), conflicts flagged on overrun, wave-over-wave convergence.
  (Precedent: need-by pass reads stored pins.)
- [x] **Do `Planned` batches coalesce too?** — **Fable:** no — members schedule
  per-op as today until release; bounded residual over-book, stable pre-pass
  input.
- [x] **Are `add`/`remove`/`update` allowed on a `Planned` batch?** — **Fable:**
  yes — widen the edge-fn guards from "`Active` only" to "`Planned` or `Active`,
  pre-event"; a Planned batch must be fully composable.
- [x] **Employee finiteness for batch reservations?** — **Fable:** WC-only in
  v1; documented optimism for ability-gated batchable processes.
- [x] **Paused member job while its batch is Released?** — **Fable:** the batch
  governs floor visibility (the op stays visible — it is part of a shared
  load); the job-paused coercion in the floor view still renders that member
  `Paused`, and the operator can exclude it at completion ("Not in this run").
  Harmless inconsistency, documented.

## Changelog

- 2026-09-04: Created. Extends `2026-08-21-job-operation-batching.md` with a
  releasable batch lifecycle (`Planned` state + `release`/`unrelease`), the
  membership-handoff floor gate, `process.batchType` (Simultaneous/Sequential),
  and batch-as-one-unit scheduling. Design resolved in a live conversation with
  Brad; recommended-and-surfaced items flagged for veto.
- 2026-09-04: Confirmatory research reconciled
  (`.ai/research/2026-09-04-batch-release-and-scheduling.md`) — all four core
  choices (independent batch release, membership handoff, p-batch/s-batch resource
  typing, quantity-proportional split) have direct precedent (SAP PP-PI phase
  release, APS campaigning, scheduling-literature batch machines, SAP co-product
  equivalence); no contradictions. Two non-blocking future refinements noted
  (p-batch weight/size-driven duration; non-quantity override weights).
  Status: draft, pending Brad's veto pass on the recommended items, then `/plan`.
- 2026-09-05: Browser verification caught a runtime bug in the floor RPC fork
  (unqualified `"id"` in the relevant_jobs CTE is ambiguous with the plpgsql
  OUT parameter — the function threw at first call); fixed by qualifying
  `"job"."id"`. All 8 e2e scenarios then PASSED (leak closed incl. direct-URL
  guard; released-batch-on-Draft-job floor visibility; Sequential 120min vs
  Simultaneous 80min single coalesced reservations; zero member over-booking;
  unrelease refusal; unchanged proportional completion). Per Brad, the branch's
  nine incremental migrations were then consolidated into ONE final-state
  idempotent file: `20260905132037_job-operation-batching.sql`.
- 2026-09-04: Implementation amendment (Fable, for veto): the priority board
  stays floor-pure — Planned batches render only on the Batches list/builder,
  not as board cards (the board + MES kanban share the floor RPC; a Planned
  card there would re-mix planning into dispatch). Card variant kept dormant.
- 2026-09-04: **Independent Fable review** (Brad switched models and delegated
  the review + plan). All six recommendations **upheld**; one amended (#4 gains
  the member-job `recalculateJobRequirements` at release). Completeness
  findings folded in: MES loader/start-route handoff guards (no server-side
  status gate exists today — the leak was closable only at the list layer
  otherwise), `capacityReservation.jobOperationBatchId` tag + regen/snapshot
  predicate rules, batch anchor from persisted predecessor forecasts,
  Planned-batches-stay-per-op, `add`/`remove`/`update` widened to Planned,
  two-file migration split (enum-value same-transaction reference restriction),
  WC-only batch reservations, paused-member semantics. Grounded against
  `run-schedule.ts:77`, `scheduling-engine.ts:1201`,
  `master-data-provider.ts:497`, `date-calculator.ts:34-43`,
  `work-center-selector.ts:378`, `start.$operationId.tsx`,
  `operation.$operationId.tsx:90-112`, `20260720121629_capacity-planning.sql`.
  Status: in-progress — planned at
  `.ai/plans/2026-09-04-batch-release-and-scheduling.md`.
