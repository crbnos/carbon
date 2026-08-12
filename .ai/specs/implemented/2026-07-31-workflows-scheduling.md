# Workflows — Phase 6: the scheduler

Status: **Implemented** (2026-07-31)
Date: 2026-07-31
Phase document: `/Users/aashu/work/carbon/plans/automations-engine/phases/phase-6-scheduling.md`
Research: `.ai/research/2026-07-31-phase6-scheduling.md`, `.ai/research/2026-07-31-phase6-inngest-verification.md`
Prior phases: `.ai/specs/2026-07-30-workflows-foundation.md` (schema, validator, `scheduleSchema`),
`.ai/specs/2026-07-30-workflows-matcher.md` (run creation, loop guards),
`.ai/specs/2026-07-30-workflows-engine.md` (execution)

---

## TLDR

A workflow can already *declare* a schedule — `scheduleSchema` is on the trigger node, the validator
enforces it, and `workflow.nextRunAt` plus its partial index are in the database. Nothing computes that
column and nothing reads it, so a scheduled workflow is inert.

This phase makes the clock a trigger. It adds:

- **`nextOccurrenceAfter` / `nextRunAfter`** in `@carbon/workflows` — zone-aware next-occurrence maths
  over `@internationalized/date`, shared by the scheduler and (in phase 8) the builder's preview.
- **`syncWorkflowTriggers` also owns `nextRunAt`** — the one function phase 7 calls on promote/toggle
  now writes the first due time, or clears it, so a schedule cannot be half-wired.
- **A self-chaining scheduler** — one Inngest function that wakes, books its own next wake as a
  future-dated event, claims each due row with a compare-and-set on `nextRunAt`, and hands each claim
  to the same `carbon/workflow-run.queued` path every other trigger uses.
- **An hourly backstop** that revives the chain if it is ever lost, and a Redis chain token so a
  revived chain replaces the old one instead of running alongside it.
- **The rules that bite** — overlapping runs skipped with a reason, runs more than an hour late skipped
  with a reason, a deterministic 0–5 minute per-workflow spread, and wall-clock time recomputed every
  cycle so a daylight-saving change never shifts a schedule.

No migration. No UI. The scheduler never executes a workflow itself.

---

## Problem Statement

Phase 1 put the schedule in the definition and the bookkeeping column on the workflow row, and stopped
there deliberately. Today:

- `workflow.nextRunAt` has **no reader and no writer** anywhere in the repo. `workflow_due_idx` indexes
  a column nothing populates.
- `syncWorkflowTriggers` (`packages/workflows/src/sync.ts:121`) — the only code that reacts to a version
  being promoted — derives `workflowTriggerEvent` rows from `node.data.events` and ignores
  `node.data.schedule` entirely. A schedule-only trigger produces zero rows and is therefore
  unreachable by every dispatch path we have.
- `RunTrigger` (`packages/workflows/src/run-trigger.ts:4`) is a two-member union, `record | moment`.
  A scheduled run has no wire representation, and `triggerOutputs`
  (`packages/jobs/src/workflows/engine/loader.ts:73`) would fall into the record branch and read
  `trigger.record` off a payload that has none.

So a customer can build and validate a scheduled workflow, switch it on, and watch it never fire.

There is a second, harder problem underneath. Our job runner **cannot register a repeating timer at
runtime** — cron triggers are fixed in code at deploy, and the feature request asking otherwise
(`inngest/inngest#3012`) is closed as not planned. Repetition therefore has to be assembled out of
single future bookings, which means owning the liveness of that chain ourselves.

---

## Proposed Solution

### A. What phase 6 inherits (no change needed)

Already correct and load-bearing, listed so the plan does not re-derive it:

| Thing | Where | State |
|---|---|---|
| `scheduleSchema` — `freq`/`hour`/`minute`/`weekdays`/`day`/`tz` | `packages/workflows/src/definition/types.ts:188` | Done |
| `triggerNode.data.schedule` | `packages/workflows/src/definition/schema.ts:27` | Done |
| Events XOR schedule, weekday/day coherence, IANA zone check | `packages/workflows/src/definition/validate.ts:113-178` | Done |
| A scheduled trigger hands out **no** variables (`outputs → {}`) | `packages/workflows/src/definition/nodes.ts:251` | Done |
| `workflow.nextRunAt` + `workflow_due_idx` | migration `20260730142317` | Done |
| `workflowRun_dedupe_key` unique constraint | same migration | Done |
| Run creation, loop guards, `carbon/workflow-run.queued` | `packages/jobs/src/workflows/matcher.ts:183-239` | Done |

`weekdays` uses **0 = Sunday**, computed as `getDayOfWeek(date, "en-US")` — pinned locale, because
that helper is locale-relative and a different locale silently rotates the week.

### B. The maths — `packages/workflows/src/definition/schedule.ts` (new)

Pure, no I/O, ES2019-safe, browser-safe. Adds `@internationalized/date` as the fourth runtime
dependency of `@carbon/workflows` (catalog-pinned at 3.12.0, already a dependency of ten workspaces).
This is deliberate: phase 8's picker must show "next run: Fri 1 Aug, 9:05 am" from the *same* code the
scheduler uses, or the preview and reality can disagree and nobody will notice which is lying.

```ts
/** The next wall-clock occurrence of `schedule` strictly after `after`, in the schedule's zone. */
export function nextOccurrenceAfter(schedule: Schedule, after: Date): Date;

/** A stable 0–299 second offset for a workflow, so a 9:00 pile-up spreads across five minutes. */
export function scheduleOffsetSeconds(workflowId: string): number;

/** `nextOccurrenceAfter` with the per-workflow spread applied. This is what writes `nextRunAt`. */
export function nextRunAfter(schedule: Schedule, workflowId: string, after: Date): Date;
```

**`nextOccurrenceAfter` per frequency.** Work in the schedule's zone throughout; never add 24 hours to
a UTC instant.

- `Daily` — today at `hour:minute`; if that is not strictly after `after`, tomorrow.
- `Weekly` — walk forward day by day, at most 8 days, to the first day whose weekday is in `weekdays`
  and whose wall time is strictly after `after`.
- `Monthly`, numeric `day` — that day of this month; if it is not strictly after `after`, the next
  month. **A month that does not contain the day is skipped, not clamped** — a 31st schedule does not
  fire in February. That is precisely why `"last"` exists, and clamping would quietly turn a
  "31st" schedule into a "last day" schedule the customer never asked for.
- `Monthly`, `day: "last"` — the last calendar day of the month, same strictly-after rule.

**Daylight saving.** `toZoned(wallTime, tz, "compatible")`. A wall time that does not exist (the
spring-forward gap) moves forward past the gap; a wall time that happens twice (the autumn fall-back)
takes the first. Fires once, never twice, never skipped. The instant is recomputed from the wall clock
on every cycle, so a zone whose rules change is simply right the next time.

**The spread.** `scheduleOffsetSeconds` is `parseInt(fnv1a64(workflowId).slice(-6), 16) % 300` —
`fnv1a64` from `@carbon/utils` is the repo's hash and returns a hex string, so no BigInt literal is
needed (the package compiles at ES2019 for the browser). The offset is stable for the life of a
workflow, so "9:00" consistently means 9:03 for that workflow rather than jittering.

Applied so it cannot compound:

```ts
export function nextRunAfter(schedule, workflowId, after) {
  const offsetMs = scheduleOffsetSeconds(workflowId) * 1000;
  const base = nextOccurrenceAfter(schedule, new Date(after.getTime() - offsetMs));
  return new Date(base.getTime() + offsetMs);
}
```

### C. Activation — `syncWorkflowTriggers` also owns `nextRunAt`

`syncWorkflowTriggers(db, companyId, workflowId)` already reads `workflow.active` and
`activeVersionId`, loads that version's nodes, and rewrites `workflowTriggerEvent` in a transaction.
It gains one more write in that same transaction:

- Workflow active, active version present, trigger node has a `schedule`
  → `nextRunAt = nextRunAfter(schedule, workflowId, now)`.
- Any other case — switched off, no active version, trigger has events instead of a schedule
  → `nextRunAt = NULL`.

One function, one transaction, so phase 7 cannot wire the trigger rows and forget the due time. It
returns `{ scheduled: boolean }` so the caller knows a chain wake is worth sending (see E).

The `workflow_due_idx` predicate (`active AND nextRunAt IS NOT NULL AND activeVersionId IS NOT NULL`)
already assumes exactly this invariant.

### D. `RunTrigger` gains a third variant

```ts
z.object({
  kind: z.literal("schedule"),
  dueAt: z.string()      // the claimed nextRunAt, ISO 8601 UTC
})
```

`triggerOutputs` gets an explicit early return for it: **`{}`**, no entity, no cache seed. This matches
`NODE_KINDS.trigger.outputs`, which already returns `{}` for a scheduled trigger, so the builder's view
of the variables and the engine's view agree by construction. A schedule starts with no record; its
next node is almost always a Lookup.

`workflowRun.eventId` is `NOT NULL`, so a scheduled run stores the literal **`"schedule"`**.
`catalog.getEvent("schedule")` returns `undefined`, which `triggerOutputs` already handles as "no
declared outputs" — the same answer, reached two ways.

### E. The chain — one wake, five things

One Inngest function, `workflows-scheduler`, on event `carbon/workflow-scheduler.wake`, payload
`{ bookedFor: number | null }`. Config: `{ id: "workflows-scheduler", retries: 3, singleton: { key:
"workflows-scheduler", mode: "skip" } }`.

Each wake is a **short, self-contained run that ends** — it does not sleep and it does not loop.
This deviates from `technical-decisions.md`, which assumed `step.sleepUntil`; see Design Decisions for
why, and note that Inngest's own maintainers point at future-dated sends for exactly this shape.

1. **Own the chain.** Read the Redis key `workflows:scheduler:chain` (`@carbon/kv`). If this wake
   carries a `bookedFor` and the key holds a *different* value, this wake belongs to a superseded
   chain — return immediately, book nothing, do nothing. A `bookedFor` of `null` (the backstop) always
   adopts. A missing key always adopts.
2. **Scan.** Read up to `MAX_DUE_PER_WAKE` (200) rows from `workflow` where
   `active AND activeVersionId IS NOT NULL AND nextRunAt <= now()`, ordered by `nextRunAt`, together
   with the earliest `nextRunAt > now()` across all companies. One indexed read, all tenants at once —
   this is a platform sweep, like `mrp` and `audit-log-archive`.
3. **Book the next wake, before any work.** Target is `min(now + 10 minutes, earliest future
   nextRunAt)`, or `now + 30 seconds` if the scan hit its cap and rows are still overdue. Write the
   target to `workflows:scheduler:chain` (TTL 2 hours), then `step.sendEvent` a wake with that `ts` and
   `data.bookedFor = target`. Booking before the work means a failure in step 4 cannot break the chain.
4. **Claim and plan** (see F).
5. **Emit** one `carbon/workflow-run.queued` per queued claim, via `step.sendEvent`.

**The 10-minute ceiling is not optional.** Sleeping exactly until the next known due time is wrong,
because "the next due time" was only true at the moment it was read: anything created, edited or
re-enabled inside a five-hour sleep is invisible to a scheduler already asleep. Worst-case lateness for
a *newly created* schedule is therefore 10 minutes, which is what the picker discloses.

### The backstop

`workflows-scheduler-backstop`, `{ cron: "0 * * * *" }`, one step, no payload. It reads
`workflows:scheduler:chain`. If the key is missing, or holds a target more than 15 minutes in the past,
it sends one wake with `bookedFor: null`. Otherwise it does nothing. It is the only static timer we own.

Cold start after a deploy is covered by two things: this hourly backstop, and `ensureSchedulerChain()`
— a small helper exported from `@carbon/jobs` that phase 7's activation route calls when
`syncWorkflowTriggers` reports `{ scheduled: true }` and no chain key exists. Switching on a scheduled
workflow therefore starts the chain immediately rather than up to an hour later.

### F. Claiming, and the three outcomes

Per due row, in `nextRunAt` order:

**Claim** — the only thing that makes a firing at-most-once:

```sql
UPDATE "workflow" SET "nextRunAt" = :recomputed
 WHERE "id" = :id AND "companyId" = :companyId AND "nextRunAt" = :dueAt
RETURNING "id"
```

Zero rows back means another wake won the race; skip the row entirely and say nothing. `:recomputed` is
`nextRunAfter(schedule, workflowId, now)` — **strictly after now, not after `dueAt`** — so a long
outage never queues a cascade of catch-up runs. If the version can no longer be read, `nextRunAt` is
set to `NULL` and the row drops out of the index.

The claimed `dueAt` then produces `sourceEventId = schedule:<workflowId>:<dueAtIso>`, deterministic and
NOT NULL, so `workflowRun_dedupe_key` is the second guard behind the compare-and-set.

Then exactly one of three outcomes, all of them visible in run history — a scheduled workflow that
does not run must never be silent:

| Outcome | Condition | Row written | Event |
|---|---|---|---|
| **Queued** | neither below | `status = 'Queued'` | one `carbon/workflow-run.queued` |
| **Skipped, previous run active** | a `workflowRun` for this workflow (any version) has `status IN ('Queued','Running')` | `status = 'Skipped'`, `statusReason = "The previous run was still going when this one came due."` | none |
| **Skipped, too late** | `now - dueAt > 60 minutes` | `status = 'Skipped'`, `statusReason = "This run came due more than an hour ago and was skipped rather than run late."` | none |

Staleness is checked first: a run that is both stale and overlapping reads as stale, which is the more
informative reason.

Both skips still advance `nextRunAt`, so the schedule resumes normally at its next occurrence. There is
no backfill and no catch-up: downtime does not fire a daily workflow twice.

Insert goes through a shared helper extracted from `matchAndQueue`'s tail (the
`insertInto("workflowRun") … onConflict(workflowRun_dedupe_key).doNothing()` + event-building block),
so run creation stays in one place. The scheduler does **not** call `matchAndQueue` itself: that
function's first act is a `workflowTriggerEvent` subscriber lookup, and a scheduled workflow correctly
has no row there — the scheduler already knows which workflow to fire. Loop guards do not apply either;
a scheduled run is always a root, `depth` 0 with an empty `path`, exactly like a human edit.

### Design Decisions

| Decision | Choice | Why |
|---|---|---|
| How the chain re-arms | A future-dated `step.sendEvent`, not `step.sleepUntil` | A sleeping run is one fragile thread: lost to a deploy, an expiry or trace retention, and nothing fires until the backstop. A future-dated event is durable queued state and each tick is an independently-retried short run, so a lost tick costs one cycle rather than the chain. It is also immune to Inngest's 1000-step-per-run ceiling, which a looping design would eventually hit. Load is identical. Deviates from `technical-decisions.md`, which predates the step-limit check |
| Where the date maths lives | `@carbon/workflows`, adding `@internationalized/date` | Phase 8's "next run" preview and the scheduler must agree; two implementations drift and the disagreement is invisible. The library is catalog-pinned, browser-safe, ES2019-safe and already used by ten workspaces. Adding a runtime dep here is an "Ask First" item in that package's AGENTS.md — asked and approved |
| Date library | `@internationalized/date` | The repo's only date library. No `date-fns-tz`, `luxon`, `dayjs` or `cron-parser` exists anywhere, and adding one for this alone is not justified |
| Who writes `nextRunAt` | `syncWorkflowTriggers`, in its existing transaction | It is already the single promote/toggle seam. A separate `syncWorkflowSchedule` would let phase 7 call one and not the other, and the failure is silent — the workflow looks active and never runs |
| Spread | Stable 0–299 s from `fnv1a64(workflowId)` | Customers pick round times, so hundreds land on exactly 9:00. Five minutes sits comfortably inside the ~10 minutes of lateness the picker already discloses, and spreads a pile-up across 300 one-second buckets. Stable rather than random, so a workflow's firing time looks deliberate |
| A run discovered very late | Skipped past 60 minutes, with a reason | An ERP action fired against records that moved on three days ago is worse than no action. The skip is recorded, so an outage produces evidence rather than silence |
| Missed windows | Never backfilled; `nextRunAt` recomputed from **now** | Downtime must not fire a daily workflow twice, and a cascade of catch-up runs is the one failure mode that could flood the queue |
| Overlapping runs | Skipped with a reason, not queued | A slow daily report must not pile up. Recorded, because "my workflow didn't run" needs an answer |
| Fork protection | Redis chain token + `singleton: { mode: "skip" }` | Two live chains would each keep booking and multiply. The token means a revived chain replaces the old one; the singleton means two wakes never run at once |
| Month that lacks the day | Skipped, not clamped to the last day | Clamping silently converts a "31st" schedule into a "last day of month" schedule. `"last"` is the option for customers who want month-end |
| DST ambiguity | `"compatible"` disambiguation | Fires once in the repeated hour, moves forward out of the non-existent hour. Never twice, never skipped |
| `eventId` for a scheduled run | The literal `"schedule"` | The column is `NOT NULL`. `catalog.getEvent("schedule")` is `undefined`, which `triggerOutputs` already reads as "no declared outputs" |
| Where the scheduler emits from | A helper shared with `matchAndQueue`, not `matchAndQueue` itself | The matcher's first act is a subscriber lookup a scheduled workflow correctly has no row for. Sharing the insert-and-emit tail keeps run creation in one place without widening the matcher's contract |
| Scan scope | All companies in one indexed read, capped at 200 rows | Matches the existing platform-sweep precedent (`mrp`, `audit-log-archive`). Per-company sweeps would multiply wakes by tenant count for no gain |

### What this phase deliberately does not build

- **The schedule picker.** Phase 8 owns node configuration. Phase 6 ships the maths the picker will
  call, and nothing visual.
- **The activation route.** No workflow activation code exists anywhere yet (phase 7). Phase 6 makes
  `syncWorkflowTriggers` correct and exports `ensureSchedulerChain()`; phase 7 calls both.
- **Run-once-at-a-date, and first/last business day.** Not in v1 per the PRD — the latter needs a
  holiday calendar we do not have.
- **Every N minutes, and cron syntax.** Ruled out by the PRD. `Every N minutes` is the one option that
  turns a scheduled workflow into a load generator.
- **Merging nearby runs.** The tolerance is spent on spreading them instead.
- **Recalling a booking when a schedule is edited.** An in-flight booking cannot be cancelled cleanly.
  `nextRunAt` in our table is the source of truth; a booking is only a hint about when to look, and the
  claim's compare-and-set discards anything whose `nextRunAt` has moved.

---

## Data Model Changes

**None.** `workflow.nextRunAt` and `workflow_due_idx` were created in
`20260730142317_workflows-foundation.sql`; `workflowRun.status` already permits `Skipped` and
`statusReason` is already nullable text. `scheduleSchema` is unchanged, so
`CURRENT_DEFINITION_FORMAT_VERSION` stays at **2** and no `migrateDefinition` branch is added.

One Redis key is introduced: `workflows:scheduler:chain`, holding the epoch-ms target of the current
booking, TTL 2 hours.

---

## API / Service Changes

### New files

| File | Contents |
|---|---|
| `packages/workflows/src/definition/schedule.ts` | `nextOccurrenceAfter`, `scheduleOffsetSeconds`, `nextRunAfter` |
| `packages/workflows/src/definition/schedule.test.ts` | Frequency, month-skip, DST, spread, monotonicity |
| `packages/jobs/src/workflows/scheduler.ts` | `scanDue`, `claimDue`, `planScheduledRun`, `runSchedulerWake`, `ensureSchedulerChain` |
| `packages/jobs/src/workflows/scheduler.test.ts` | Claim race, overlap skip, stale skip, no-cascade |
| `packages/jobs/src/inngest/functions/workflows/scheduler.ts` | `workflowSchedulerFunction`, `workflowSchedulerBackstopFunction` |

### Modified files

| File | Change |
|---|---|
| `packages/workflows/package.json` | `@internationalized/date: "catalog:"` added to `dependencies` |
| `packages/workflows/src/index.ts` | Export the three schedule helpers |
| `packages/workflows/src/run-trigger.ts` | Third union member, `kind: "schedule"` with `dueAt` |
| `packages/workflows/src/sync.ts` | `syncWorkflowTriggers` computes or clears `nextRunAt` in its transaction; returns `{ scheduled: boolean }` |
| `packages/jobs/src/workflows/matcher.ts` | Extract the insert-and-emit tail into a shared helper |
| `packages/jobs/src/workflows/engine/loader.ts` | `triggerOutputs` returns `{}` for `kind: "schedule"` before the record branch |
| `packages/jobs/src/inngest/functions/workflows/index.ts` | Re-export the two new functions |
| `packages/jobs/src/inngest/index.ts` | Register both under `// Workflows` |
| `packages/lib/src/events.ts` | `carbon/workflow-scheduler.wake` event type |
| `packages/workflows/AGENTS.md`, `packages/jobs/AGENTS.md`, `.claude/rules/workflow-engine.md`, `.claude/rules/workflow-matcher.md` | Document the scheduler and the fourth runtime dependency |

---

## UI Changes

**N/A.** The schedule picker is phase 8. Nothing customer-visible ships in this phase; a scheduled
workflow is exercised by writing a version with a `schedule` on its trigger node and calling
`syncWorkflowTriggers`.

---

## Acceptance Criteria

**The maths**

- [ ] A `Daily` 09:00 `America/New_York` schedule evaluated at 2026-08-01T08:00 New York returns
      2026-08-01T09:00 New York; evaluated at 09:00 exactly, returns 2026-08-02T09:00 (strictly after).
- [ ] A `Weekly` schedule with `weekdays: [1,2,3,4,5]` at 07:00 evaluated on a Friday after 07:00
      returns the following Monday, not Saturday.
- [ ] A `Monthly` schedule with `day: 31` evaluated on 2026-01-31T10:00 returns 2026-03-31, skipping
      February entirely.
- [ ] A `Monthly` schedule with `day: "last"` returns 2026-02-28 in a common year and 2028-02-29 in a
      leap year.
- [ ] A `Daily` 02:30 `America/New_York` schedule crossing the March spring-forward returns an instant
      that exists, and crossing the November fall-back returns exactly one instant, not two.
- [ ] A `Daily` 09:00 schedule spanning a DST boundary keeps firing at 09:00 local — the UTC instant
      moves by an hour, the wall time does not.
- [ ] `scheduleOffsetSeconds` is in `[0, 300)`, stable across calls for the same id, and differs for at
      least 95 of 100 sample ids.
- [ ] `nextRunAfter` applied repeatedly to its own output is strictly increasing and never compounds
      the offset (two consecutive daily results are 24 hours apart, ±1 hour for DST).

**Activation**

- [ ] `syncWorkflowTriggers` on an active workflow whose active version has a scheduled trigger writes
      a `nextRunAt` strictly in the future and returns `{ scheduled: true }`.
- [ ] The same workflow switched off, or with `activeVersionId` set to null, or promoted to a version
      whose trigger has events instead of a schedule, has `nextRunAt` set to `NULL`.
- [ ] A scheduled trigger produces zero `workflowTriggerEvent` and zero `eventSystemSubscription` rows,
      and the `workflow-trigger-event-drift` check still passes.

**The chain**

- [ ] A wake with no due rows and an earliest future `nextRunAt` five hours out books its next wake
      10 minutes ahead, not five hours.
- [ ] A wake whose earliest future `nextRunAt` is 90 seconds out books 90 seconds ahead.
- [ ] A wake books its next wake before it claims any row: injecting a failure into the claim step
      leaves a booking in place and the chain alive.
- [ ] A wake carrying a `bookedFor` that does not match `workflows:scheduler:chain` returns without
      booking and without claiming.
- [ ] The backstop sends nothing when the chain key holds a target less than 15 minutes past, and sends
      one adopting wake when the key is missing.

**Firing**

- [ ] A workflow due now is claimed once, produces one `Queued` `workflowRun` with
      `sourceEventId = schedule:<workflowId>:<dueAtIso>` and `eventId = "schedule"`, and emits one
      `carbon/workflow-run.queued`.
- [ ] Two wakes racing the same due row produce exactly one run: the loser's `UPDATE … WHERE
      nextRunAt = :dueAt` returns zero rows.
- [ ] After firing, `nextRunAt` is the next occurrence after **now**; a workflow whose `nextRunAt` was
      three days stale produces exactly one row and a `nextRunAt` in the future, never a cascade.
- [ ] A workflow whose previous run is `Running` produces a `Skipped` row with the previous-run reason,
      emits no event, and still advances `nextRunAt`.
- [ ] A workflow due 90 minutes ago produces a `Skipped` row with the too-late reason and emits no
      event.
- [ ] A workflow that is both stale and overlapping records the stale reason.
- [ ] The engine executes a scheduled run end to end: `triggerOutputs` yields `{}`, a Lookup as the
      first node resolves against the owner's permissions, and the run reaches `Succeeded`.

---

## Risks

- **Redis is on the scheduling path.** If `@carbon/kv` is unavailable the chain token cannot be read.
  Mitigation: treat a read failure as "adopt and proceed" so scheduling survives a Redis outage; the
  cost is a possible transient fork, which the token resolves as soon as Redis returns, and which the
  claim's compare-and-set makes harmless in the meantime (a forked chain cannot double-fire anything).
- **A fork still costs no-op wakes.** Bounded, and both the singleton and the token converge it back
  to one chain within a cycle.
- **The 200-row cap.** A company base with more than 200 schedules due in the same second sees the
  overflow handled by an immediate 30-second re-wake rather than in the same pass. Worst-case lateness
  grows by 30 seconds per 200 overdue rows; well inside the disclosed tolerance until roughly 4,000
  simultaneous schedules, at which point the cap should be raised deliberately.
- **A future-dated event is not visible as a pending run.** Unlike a sleeping run, a booked wake does
  not appear in the Inngest dashboard until it fires, so "is the scheduler alive?" is answered by the
  Redis key rather than by the UI. The backstop's 15-minute staleness check is the operational alarm.
- **The 60-minute staleness cut-off is a judgement call.** A customer who expects a missed nightly job
  to run when the system comes back at 07:00 gets a `Skipped` row instead. It is recorded and
  explained, and the threshold is a single constant if that proves wrong.
- **Phase 7 must call two things.** `syncWorkflowTriggers` is now sufficient for correctness, but
  `ensureSchedulerChain()` is what makes activation immediate rather than up to an hour late. Missing
  it degrades, it does not break.

---

## Open Questions

All resolved with the user before this spec was written.

- [x] Should the chain re-arm with `step.sleepUntil` (as `technical-decisions.md` assumed) or a
      future-dated self-event? — **Answer:** future-dated self-event. Verification against current
      Inngest docs surfaced two facts the technical-decisions doc predates: a run is capped at 1000
      steps, and the maintainers' sanctioned answer to "dynamic per-tenant crons" (issue #3012, closed
      as not planned) is a future-dated `ts` on send. A sleeping run is also a single fragile thread —
      lost to a deploy or trace retention, the chain dies until the backstop, whereas a future-dated
      event is durable queued state and each tick is retried independently. Load is identical. The user
      asked for whichever misses fewest runs while staying light; this is both.
- [x] Where should the next-occurrence maths live, and in which library? — **Answer:**
      `packages/workflows/src/definition/schedule.ts`, using `@internationalized/date` as a fourth
      runtime dependency of that package. Phase 8's preview must be computed by the same code as the
      firing, or the two drift invisibly. The library is the repo's only date library, catalog-pinned,
      and ES2019/browser-safe, which the package requires.
- [x] Nothing activates a workflow yet — how does `nextRunAt` get written? — **Answer:** fold it into
      `syncWorkflowTriggers`, in the transaction that already rewrites the trigger rows. A separate
      `syncWorkflowSchedule` would let phase 7 call one and not the other, and that failure is silent.
- [x] How wide should the deterministic per-workflow spread be? — **Answer:** up to five minutes
      (0–299 seconds from `fnv1a64(workflowId)`). Stable per workflow, comfortably inside the ~10
      minutes of lateness the picker already discloses, and enough buckets to break up a 9:00 pile-up.
- [x] What happens to a run discovered long after it was due? — **Answer:** skip anything more than an
      hour late, recording a `Skipped` row that says why, and resume at the next normal occurrence. An
      ERP action fired against records that moved on days ago is worse than no action; the skip leaves
      evidence rather than silence.

Surfaced while writing and resolved from prior specs and the code, not invented:

- [x] Does the scheduler call `matchAndQueue`? — **Answer:** no, but it shares its insert-and-emit
      tail. `matchAndQueue` opens with a `workflowTriggerEvent` subscriber lookup that a scheduled
      workflow correctly has no row for. The matcher spec's cross-phase note ("enters the same
      run-creation path, so the scheduler never duplicates the loop guards") is satisfied by sharing
      the tail, which is where run creation actually lives.
- [x] What `eventId` does a scheduled run store, given the column is `NOT NULL`? — **Answer:** the
      literal `"schedule"`. `catalog.getEvent("schedule")` is `undefined`, which `triggerOutputs`
      already treats as "no declared outputs" — the same result the scheduled branch returns directly.
- [x] Is a month lacking the chosen day skipped or clamped? — **Answer:** skipped. Clamping would
      silently convert a "31st" schedule into a "last day of month" schedule, and `"last"` already
      exists for customers who want month-end.

---

## Cross-phase dependencies this phase creates

- **Phase 7** (builder, activation) must call `syncWorkflowTriggers` on every promote and on every
  on/off toggle — it is now the only thing that writes `workflow.nextRunAt` — and should call
  `ensureSchedulerChain()` from `@carbon/jobs` when it returns `{ scheduled: true }`, so switching a
  scheduled workflow on starts the chain immediately instead of within the hour.
- **Phase 8** (node configuration) must build the schedule picker on `nextOccurrenceAfter` /
  `nextRunAfter` for its "next run" preview, defaulting `tz` to the browser's zone, and must surface
  the "can be up to about 10 minutes late" note the PRD commits to.
- **Phase 9** (run history) must render the two scheduler skip reasons as first-class outcomes rather
  than errors — a `Skipped` run is the answer to "why didn't my workflow run", and hiding it recreates
  the silence this phase exists to remove.

---

## Research

- `.ai/research/2026-07-31-phase6-scheduling.md` — the PRD and technical-decisions positions, current
  schema, engine and matcher behaviour, and the ten questions this spec resolves.
- `.ai/research/2026-07-31-phase6-inngest-verification.md` — Inngest 3.54.0 verified against current
  documentation: `sleepUntil` limits, the closed dynamic-cron feature request, the 1000-step run cap,
  the 24-hour event-id dedupe window, `singleton` semantics, and `step.sendEvent` versus a bare
  `inngest.send` inside a function.

---

## Changelog

- 2026-07-31: Created. Five open questions resolved with the user before writing, plus three surfaced
  during writing and resolved from prior specs and the code. One deliberate deviation from
  `technical-decisions.md` — the chain re-arms with a future-dated event rather than `step.sleepUntil`
  — recorded in Design Decisions with the two verified Inngest facts that motivate it. One deviation
  from the phase document's assumption that the scheduler emits runs directly: it shares
  `matchAndQueue`'s insert-and-emit tail instead, honouring the matcher spec's cross-phase note.
