# Phase 6 — Scheduling Research

Date: 2026-07-31
Sources: `prd.md`, `technical-decisions.md`, `workflow-engine.md`, `workflow-matcher.md`,
`event-system.md`, `packages/workflows/AGENTS.md`, `.ai/lessons.md`, migrations
`20260730142317`, `20260730135206`, `20260731025358`.

---

## What the PRD says about scheduling

Three trigger kinds exist: **record changed**, **business moment**, and **schedule**. The schedule
trigger kind is the one being implemented in phase 6.

Schedule config lives **on the trigger node in the version's nodes JSON**, not as columns on the
workflow record. The trigger node's `data` field looks like:

```jsonc
{
  "type": "trigger",
  "data": {
    "events": [],        // empty for a pure schedule — events OR schedule, never both (validator rule)
    "origin": "Both",
    "schedule": {
      "freq": "daily|weekly|monthly",
      "hour": 9,
      "minute": 0,
      "weekdays": [1,2,3,4,5],  // weekly only
      "day": 15,                 // monthly only; "last" is a valid value for last-day-of-month
      "tz": "America/New_York"
    }
  }
}
```

The PRD's UX commitments:
- Options: daily at HH:MM; weekly on any weekdays at HH:MM; monthly on day N plus a "last day of
  month" option (month-end close is a real ERP job, day 31 does not exist in February).
- No cron syntax exposed to customers.
- No "every N minutes/hours" (would turn a workflow into a load generator).
- Not in v1: run-once at a date/time; first/last business day (needs a holiday calendar).
- Time zone is stored **on the schedule itself**, defaulting to the browser's zone. Carbon has no
  company-wide timezone column; storing it per-schedule avoids a multi-site coupling problem.
- The picker says a scheduled run can be up to ~10 minutes late. This is intentional and disclosed.
- A scheduled trigger produces no triggering record, so its next node is almost always a lookup.

---

## Technical-decisions.md — Problem 3, verbatim

> All decided. Kept short.
>
> **What kinds**
>
> Yes: daily at HH:MM; weekly on any weekdays at HH:MM (one row covers "every weekday at 7am");
> monthly on day N plus a separate "last day of month" option, because month-end close is a real ERP
> job and day 31 does not exist in February.
>
> No: every N minutes or hours (nothing in the PRD needs it, and it is the one option that turns a
> scheduled workflow into a load generator), and cron syntax (PRD rules it out). Not v1: run once
> at a date and time, and first/last business day, which needs a holiday calendar we do not have.
>
> **Where the time zone comes from**
>
> Carbon has no company or location time zone — the only timezone column in the schema is on shifts.
> → Store the zone on the schedule itself, defaulting to the browser's zone when it is created. A
> company-level setting would block this feature on a settings change, and one zone per company is
> wrong for multi-site customers anyway; if a company zone lands later it just becomes the default.
>
> **Where the scheduler lives**
>
> Two facts from Inngest's docs settle it: a repeating timer cannot be registered at runtime (they
> are fixed in code at deploy, and the feature request was closed as not planned), but a single run
> can be booked at an exact future moment, up to a year out. So repetition is just a chain of single
> bookings.
>
> → One self-chaining scheduler that books its own next wakeup. Rejected: a repeating timer per
> workflow (impossible); a pg_cron row per workflow (SQL-only, so it still has to poke the job
> runner; needs a new privileged wrapper; a failed unschedule fires against a deleted workflow; and
> its zone is global, so per-workflow daylight saving means rewriting cron strings twice a year);
> polling every few minutes (works and self-heals, but ~8,600 wakeups a month to mostly find
> nothing, and up to five minutes late).
>
> Every wake does the same four things:
>
> 1. Read the workflows now due.
> 2. Book its own next wakeup first — the earliest future nextRunAt, or 10 minutes, whichever is
>    sooner. Booking first means a failure in step 4 cannot break the chain.
> 3. Claim each due row atomically: write the new nextRunAt only if the row still holds the value
>    just read. Zero rows back means another wakeup won the race.
> 4. Emit one run event per successful claim.
>
> **Why the wakeup is always capped at 10 minutes**
>
> Decision: the ceiling is not optional, and it is 10 minutes. Sleeping exactly until the next known
> due time is wrong, because "the next due time" is only true at the moment it was read. If the
> earliest schedule is five hours out the scheduler would sleep five hours — and anything created,
> edited or re-enabled inside that window is invisible to a scheduler that is already asleep. A
> schedule due in ten minutes would then fire nearly five hours late, and nothing would look broken.
>
> So every wake books min(10 minutes, earliest future nextRunAt). If the next thing is sooner than
> ten minutes we sleep exactly that long and it fires on time; if it is later we still wake in ten
> minutes, re-read the table, and pick up whatever arrived meanwhile. The cost is a bounded number of
> no-op wakes; the gain is that worst-case lateness for a newly created schedule is 10 minutes, not
> unbounded — without needing to cancel or recall an in-flight booking, which cannot be done cleanly
> anyway.
>
> **Keeping the chain alive**
>
> - An hourly backstop timer that does nothing but restart the chain if the scheduler has not woken
>   within the last 10 minutes. The only static timer we own.
> - nextRunAt in our table is the source of truth, never the booking. A booking is a hint about when
>   to look; the table decides what runs.
> - Never try to recall a booking when a schedule is edited. An in-flight one cannot be cancelled
>   cleanly, so the scheduler ignores anything whose nextRunAt has moved.
> - Do not merge nearby runs. Spend the tolerance spreading them with a small deterministic
>   per-workflow offset. (Customers pick round times; hundreds land on exactly 9:00.)
>
> **What still bites**
>
> - Overlapping runs: the previous run is still going when the next is due. → Skip, and record why.
>   A slow daily report must not pile up.
> - Missed windows are skipped. Downtime does not fire a daily workflow twice. No catch-up, no
>   backfill.
> - Daylight saving: not handled explicitly. Store wall time plus zone name and ask a zone-aware
>   library for the next occurrence each cycle. Never store a UTC instant and add 24 hours: after a
>   clock change that makes every US and EU schedule permanently an hour off.

---

## Current `workflow` table schema

From migration `20260730142317_workflows-foundation.sql` plus `20260731025358_workflows-webhook-secret.sql`:

```sql
CREATE TABLE "workflow" (
    "id"              TEXT NOT NULL DEFAULT id('wf'),
    "companyId"       TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "description"     TEXT,
    "ownerId"         TEXT NOT NULL REFERENCES "user"("id"),
    "active"          BOOLEAN NOT NULL DEFAULT FALSE,
    "activeVersionId" TEXT,                             -- nullable pointer to promoted version
    "nextRunAt"       TIMESTAMP WITH TIME ZONE,         -- THE scheduling column; NULL = not a scheduled workflow
    "createdBy"       TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy"       TEXT REFERENCES "user"("id"),
    "updatedAt"       TIMESTAMP WITH TIME ZONE,
    "webhookSecret"   TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "workflow_name_companyId_key" UNIQUE ("companyId", "name")
);
```

The composite FK for `activeVersionId` uses `ON DELETE SET NULL ("activeVersionId")` with the column
named explicitly — required by Postgres 15 when the composite key includes `companyId` (a NOT NULL
column that must not be nulled). See lessons.md for that trap.

**The partial index that powers the scheduler query:**

```sql
CREATE INDEX "workflow_due_idx" ON "workflow" ("nextRunAt")
    WHERE "active" = TRUE AND "nextRunAt" IS NOT NULL
      AND "activeVersionId" IS NOT NULL;
```

Both predicate halves matter: `activeVersionId IS NOT NULL` excludes rows whose promoted version
was deleted (which sets `activeVersionId` to NULL while `active` may stay TRUE).

**Other relevant tables already in place:**

`workflowRun` has `sourceEventId TEXT NOT NULL` with the UNIQUE constraint:
```sql
CONSTRAINT "workflowRun_dedupe_key" UNIQUE ("workflowId", "companyId", "workflowVersionId", "sourceEventId")
```
The technical decisions doc specifies that for a scheduled run the `sourceEventId` must be
`schedule:<workflowId>:<dueAtIso>` — a deterministic, NOT NULL key so the constraint works.
(NULL values are all-distinct in Postgres; a nullable column would silently defeat the deduplication.)

`workflowStepRun` has `"itemKey" TEXT NOT NULL DEFAULT ''` for the same reason.

---

## How the engine currently works

Source: `.claude/rules/workflow-engine.md` + `packages/workflows/AGENTS.md`.

**Two halves:**

```
packages/workflows/src/runtime/     pure — no I/O
  values.ts, resolve.ts, compare.ts, condition.ts, filter.ts,
  entity.ts, lookup.ts, action.ts, executors.ts, batch.ts

packages/jobs/src/workflows/engine/  touches the world
  walk.ts    pure graph maths — frontier, handles, MAX_NODE_EXECUTIONS (500)
  owner.ts   getOwnerClient / readOwnerPermissions / hasPermission
  loader.ts  EntityLoader over the owner's connection + triggerOutputs
  ledger.ts  claimStep / settleStep / failInterruptedSteps / redactForLog
  log.ts     loadRunContext / claimRun / finishRun / failCrashedRun
  execute.ts the orchestration: load → permissions → node:* → finish

packages/jobs/src/inngest/functions/workflows/run.ts   thin Inngest wrapper
packages/jobs/src/workflows/actions/services.ts        WorkflowServices impl
```

**The execute loop:**
1. `claimRun` — `UPDATE workflowRun WHERE status='Queued' RETURNING id`. Second delivery gets no row and stops.
2. Load the graph version + owner identity.
3. Check owner permissions for the trigger's module.
4. Walk nodes forward. Each node execution is one Inngest durable step with a deterministic id: `node:${nodeId}` or `node:${nodeId}:${itemKey}` for batch.
5. `claimStep` inserts `Running` with `ON CONFLICT … DO NOTHING` (at-most-once claim).
6. Execute the node through the `EXECUTORS` registry in `runtime/executors.ts`.
7. `settleStep` with result.
8. `finishRun`.

**The only privileged access** is to `workflowRun` and `workflowStepRun` (via `getJobDatabaseClient`). All business reads/writes use the owner's freshly-minted short-lived JWT (`getUserScopedClient(ownerId, { workflowRunId })`), minted **per step** because the token lives 5 minutes and a run can outlive that.

`workflowRunId` in the JWT claim is **not optional** — `dispatch_event_batch()` reads it to tag writes, which is how the origin filter and loop guards work. An untagged write looks like a person's.

**Scheduled runs vs event-triggered runs from the engine's perspective:** once a `workflowRun` row exists with `status='Queued'`, the engine handles it identically regardless of what created it. The `triggerTable` and `triggerRecordId` columns will be NULL for scheduled runs; `triggerOutputs` in `loader.ts` will need to handle that case (a schedule produces no record variables for the trigger node — the next node is almost always a lookup).

---

## How the matcher currently works

Source: `.claude/rules/workflow-matcher.md`.

**Two Inngest entry points** currently:
- `packages/jobs/src/inngest/functions/events/workflow.ts` — handles `carbon/event-workflow` (record announcements from PGMQ)
- `packages/jobs/src/inngest/functions/workflows/moment.ts` — handles `carbon/workflow-moment.raised` (business moments via `raiseMoment`)

Both call `matchAndQueue(db, input)` in `packages/jobs/src/workflows/matcher.ts`.

**The four steps of `matchAndQueue`:**
1. Read subscribers from `workflowTriggerEvent` (one indexed read on `(companyId, eventId)`).
2. Apply origin filter (`Person` / `Automation` / `Both` from the trigger node's `origin` field, copied into `workflowTriggerEvent.origin`).
3. Loop guards: cycle check (workflow id in `path`) and depth check (`depth >= 10`). Blocked runs are recorded as `status='Blocked'` `workflowRun` rows — never silently dropped.
4. Insert one `workflowRun` per matched workflow with `ON CONFLICT DO NOTHING`, then emit one `carbon/workflow-run.queued` per inserted row.

**`sourceEventId` values by trigger type:**
- Record announcement: `pgmq:<msgId>`
- Business moment: `moment:<momentId>` (nanoid minted by `raiseMoment`, reused as Inngest event id)
- Schedule (reserved, not yet implemented): `schedule:<workflowId>:<dueAtIso>`

**`workflowTriggerEvent` for scheduled workflows:** the matcher reads this table for both record and moment triggers. For a scheduled workflow, the trigger node has a `schedule` field but no `events`. The `workflowTriggerEvent` table currently has a row per `eventId`. Scheduled workflows need no entry in `workflowTriggerEvent` because the scheduler bypasses the matcher's subscriber lookup — it already knows which workflow to fire. The scheduler emits the run event directly, or calls `matchAndQueue` with a synthetic `"schedule"` input. The exact integration point is not yet implemented.

**`sync.ts` (`deriveWorkflowSubscriptions`):** moments contribute nothing to `eventSystemSubscription` rows. Scheduled triggers similarly need no `eventSystemSubscription` — there is no record table to watch. The sync functions will need to handle a pure-schedule trigger gracefully (no-op on the subscription side).

---

## Inngest patterns for job scheduling

From `technical-decisions.md` section 3 and `event-system.md`:

**What Inngest can do:**
- `step.sleepUntil(date)` — suspends the current function until a future timestamp, up to a year out. This is the "book a single run at an exact future moment" capability.
- `step.sleep(duration)` — suspends for a relative duration.
- Static `cron` triggers registered at deploy time (e.g. `{ cron: "0 * * * *" }` for hourly). These are **fixed in code at deploy** — not creatable at runtime, not per-workflow.

**What Inngest cannot do:**
- Register a repeating timer at runtime per workflow. The feature request was closed as "not planned". This is why a pg_cron-per-workflow approach was rejected.

**The self-chaining pattern:**
The scheduler is one Inngest function that, when it runs, uses `step.sleepUntil` to book its own next wakeup before doing the work. The static hourly backstop is a second Inngest function with `{ cron: "0 * * * *" }` that does nothing but send the wake event if the chain has gone quiet.

**The debounce gotcha (from lessons.md):** the local Inngest dev server (v1.19.4) cannot handle the `debounce` config option — it errors on every debounced event. Don't use `debounce` on the scheduler function; the self-chaining `step.sleepUntil` approach does not need it.

**Concurrency:** the scheduler function should have a concurrency limit of 1 so two wakeups don't race. The per-company and per-workflow concurrency keys are applied when the scheduler emits `carbon/workflow-run.queued` events, not inside the scheduler itself.

---

## Known pitfalls from lessons.md relevant to scheduling

**`ON DELETE SET NULL` on composite FKs must name the column explicitly:**
`workflow.activeVersionId` is a nullable pointer with `ON DELETE SET NULL ("activeVersionId")`.
Without the explicit column name, Postgres would also null `companyId` (which is NOT NULL), and
every version deletion would fail with a NOT NULL violation. Phase 6 doesn't add new FKs but must
understand this pattern if it touches the workflow table.

**`sourceEventId` is NOT NULL — the scheduled key must be deterministic and unique:**
`schedule:<workflowId>:<dueAtIso>` is the defined format. `dueAtIso` should be the ISO 8601
representation of the `nextRunAt` value that was claimed, in UTC (e.g. `2026-08-01T09:00:00.000Z`).
Two wakeups that both try to fire the same workflow for the same `nextRunAt` value will conflict on
the UNIQUE constraint — one inserts, the other gets `DO NOTHING`. This is the race-condition guard.

**Daylight saving — store wall time + zone name, never UTC + 24h:**
When computing the next `nextRunAt` after a run fires, use a zone-aware library (e.g. `date-fns-tz`
or `luxon`) to find the next wall-clock occurrence in the stored timezone. Never add 24h to a UTC
timestamp: after a DST change this permanently shifts the schedule by one hour.

**The format-migration seam must run before the current-schema parse:**
`readWorkflowVersion` in `packages/workflows/src/definition/normalize.ts` runs `migrateDefinition`
on the raw JSON before the current-schema parse. If phase 6 changes the `schedule` field shape in
`ScheduleConfig`, bump `CURRENT_DEFINITION_FORMAT_VERSION` (currently 2) and add a migration path
in `migrateDefinition`. A v2 document with an old `schedule` shape cannot satisfy the current schema.

**The `debounce` option is broken in local dev (Inngest v1.19.4):**
Do not use `debounce` on the scheduler. Use `step.sleepUntil` + the concurrency-1 gate instead.

**A `default:` arm in a switch over `WorkflowNode["type"]` silently defeats exhaustiveness:**
`packages/workflows/src/definition/nodes.ts` uses a mapped type `{ [K in Kind]: ... }` so a missing
entry is a compile error. When adding the `schedule` trigger variant (if the trigger node needs
scheduler-specific handling in `executors.ts`), follow the `NODE_KINDS` registry pattern — one entry
per kind, no `default:` arms.

**`apps/erp` targets ES2019 — `packages/workflows` cannot use BigInt literals or `node:crypto`:**
The scheduler lives in `packages/jobs` (Node, ES2022+ fine). Any scheduling math that lands in
`packages/workflows/src/` (e.g. a `nextOccurrenceAfter(schedule, after)` helper) must be ES2019-safe
and must not import `node:crypto`. Put timezone-aware date math in `packages/jobs` instead, or
ensure the shared package uses `Math.imul` / `fnv1a64` patterns.

---

## Open questions

1. **Where does the scheduler Inngest function live?** Likely
   `packages/jobs/src/inngest/functions/workflows/scheduler.ts`. What is its Inngest event id?
   Something like `carbon/workflow-scheduler.wake` with the static backstop sending the same event.

2. **How does the scheduler emit run events?** Two options:
   a. The scheduler directly inserts `workflowRun` rows and emits `carbon/workflow-run.queued` (same
      path as the matcher's step 4), bypassing the matcher's subscriber lookup.
   b. The scheduler calls `matchAndQueue` with a synthetic `{ kind: "schedule", workflowId, dueAt }`
      input, and `matchAndQueue` is extended to handle the schedule case.
   Option (a) is simpler and avoids widening the matcher; option (b) keeps all run-creation in one
   place. The technical decisions doc describes the scheduler emitting "one run event per claimed
   row" which reads more like option (a).

3. **Does a scheduled workflow need a row in `workflowTriggerEvent`?** Currently `syncWorkflowTriggers`
   derives rows from `events` on trigger nodes. A schedule trigger has no `events`. The sync function
   needs a branch: if the trigger has a `schedule` and no `events`, write no `workflowTriggerEvent`
   rows (and no `eventSystemSubscription` rows). The matcher is never involved for schedule-originated
   runs, so the absence of a `workflowTriggerEvent` row is correct.

4. **When is `nextRunAt` first written?** On activation (`syncWorkflowTriggers`?) or on promote?
   The scheduler needs it to be set before the first wakeup runs. The technical decisions doc says
   the scheduler "ignores anything whose `nextRunAt` has moved" — which implies `nextRunAt` is set
   by the activation path, not the scheduler. The activation route (phase 7) will need to compute
   the first `nextRunAt` and write it as part of the promote/activate transaction.

5. **How is `nextRunAt` recomputed after a run?** The scheduler does step 3 (claim: write new
   `nextRunAt` only if the row still holds the value just read). The new `nextRunAt` is the next
   wall-clock occurrence after the claimed `dueAt` in the schedule's timezone. This computation
   needs a helper: `nextOccurrenceAfter(schedule: ScheduleConfig, after: Date): Date`. Where does
   it live? Candidates: `packages/workflows/src/definition/` (pure, but must be ES2019) or
   `packages/jobs/src/workflows/` (Node, no constraints).

6. **What does `triggerOutputs` produce for a scheduled run?** A record trigger hands out `record`,
   `before`, `after`. A moment trigger hands out whatever the moment declared. A schedule trigger
   has no record. `loader.ts`'s `triggerOutputs` function currently seeds the entity cache from the
   trigger payload. For a scheduled run the payload carries no entity — `triggerOutputs` should
   produce no variables (empty map), and the trigger node's handle exposes nothing. This is consistent
   with the PRD: "a schedule starts with no record, so its next node is almost always a lookup."

7. **Overlapping-run detection (the "skip and record why" rule):** the scheduler must check whether
   the previous run for a workflow is still active before emitting a new one. Does this check happen
   in the scheduler before claiming, or in the engine before claimRun? The matcher has no equivalent
   check (it inserts and the unique constraint deduplicates). For scheduled runs an explicit "is the
   previous run terminal?" check is needed. The technical decisions doc says "skip, and record why" —
   suggesting a `Skipped` `workflowRun` row is written, visible in run history.

8. **The hourly backstop:** needs a statically-registered Inngest cron function. Does it live
   alongside the scheduler, or in a separate file? What is the restart logic — does it just send
   `carbon/workflow-scheduler.wake` unconditionally, or does it check whether the chain is alive
   first? The doc says "does nothing but restart the chain if the scheduler has not woken within
   the last 10 minutes" — implying a liveness check, probably against the last `workflowRun.createdAt`
   for the scheduler's own synthetic run or against a heartbeat key in Redis.

9. **`ScheduleConfig` zod schema in `packages/workflows/src/definition/types.ts`:** the technical
   decisions doc shows the JSON shape but the zod schema for it is not yet confirmed in code. The
   validator (`validateDefinition`) checks that a trigger has "either events or a schedule, never
   both" and that "the schedule is coherent" — but the exact coherence rules (e.g. `weekdays` only
   valid when `freq === 'weekly'`, `day` only valid when `freq === 'monthly'`) need to be in the
   zod schema and the `NODE_KINDS` entry for `trigger`.

10. **Per-workflow deterministic spread:** the technical decisions doc says "spend the tolerance
    spreading them with a small deterministic per-workflow offset" when customers cluster on round
    times. What is the spread formula? Something like `hash(workflowId) % 120` seconds added to
    the scheduled wall time before computing the next UTC instant. This needs to be documented and
    consistently applied in `nextOccurrenceAfter`.
