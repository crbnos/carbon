# Workflows Phase 6 — the scheduler — implementation plan

**Spec / source:** `.ai/specs/2026-07-31-workflows-scheduling.md`
**Branch:** `feat/automation`
**Phase document:** `/Users/aashu/work/carbon/plans/automations-engine/phases/phase-6-scheduling.md`

Read the spec before starting. It resolves every design question; this plan does not re-argue them.

There is **no database migration in this plan**. `workflow.nextRunAt`, `workflow_due_idx`,
`workflowRun.status = 'Skipped'` and `workflowRun.statusReason` all already exist from migration
`packages/database/supabase/migrations/20260730142317_workflows-foundation.sql`. If you find yourself
writing SQL DDL, STOP and report — something is wrong with your reading of the plan.

## Progress

- [ ] Task 1: Add the zone-aware schedule maths to `@carbon/workflows`
- [ ] Task 2: Add the `schedule` variant to `RunTrigger` and teach `triggerOutputs` about it
- [ ] Task 3: Make `syncWorkflowTriggers` own `workflow.nextRunAt`
- [ ] Task 4: Extract the run insert-and-emit tail out of `matchAndQueue`
- [ ] Task 5: Build the scheduler core in `@carbon/jobs`
- [ ] Task 6: Declare the `carbon/workflow-scheduler.wake` event type
- [ ] Task 7: Wire the Inngest scheduler function and its hourly backstop
- [ ] Task 8: Update AGENTS.md files and rules
- [ ] Task 9: End-to-end verification

## Dependencies

- Task 2 needs Task 1 (it does not, strictly, but keeping order avoids a half-typechecking tree).
- Task 3 needs Task 1.
- Task 5 needs Tasks 1, 2, 3 and 4.
- Task 7 needs Tasks 5 and 6.
- Tasks 4 and 6 are independent of everything before them and of each other — they may run in
  parallel with Tasks 1–3.
- Task 8 needs Tasks 1–7. Task 9 needs everything.

---

## Task 1: Add the zone-aware schedule maths to `@carbon/workflows`

**Depends on:** none

**Files:**
- Modify: `packages/workflows/package.json` — add one dependency
- Create: `packages/workflows/src/definition/schedule.ts`
- Create: `packages/workflows/src/definition/schedule.test.ts`
- Modify: `packages/workflows/src/index.ts` — export the three helpers
- Copy from (precedent, test style): `packages/workflows/src/definition/validate.test.ts`

**Steps:**

1. In `packages/workflows/package.json`, add `"@internationalized/date": "catalog:"` to
   `dependencies`, keeping the keys alphabetically sorted. The block becomes:

   ```json
   "dependencies": {
     "@carbon/utils": "workspace:*",
     "@internationalized/date": "catalog:",
     "@lingui/core": "catalog:",
     "zod": "catalog:"
   },
   ```

   Then run `pnpm install` from the repo root so the workspace link is created.

   The version is pinned repo-wide at `3.12.0` in `pnpm-workspace.yaml`. Do not pin it locally.
   This is the only new dependency in the whole plan; `packages/workflows/AGENTS.md` lists adding one
   as "Ask First" and the spec records that it was asked and approved. If you find yourself wanting a
   second one (`date-fns-tz`, `luxon`, `cron-parser`, anything), STOP and report — do not improvise.

2. Create `packages/workflows/src/definition/schedule.ts`:

   ```ts
   import { fnv1a64 } from "@carbon/utils";
   import {
     fromAbsolute,
     getDayOfWeek,
     type ZonedDateTime
   } from "@internationalized/date";
   import type { Schedule } from "./types";

   /** Widest spread applied to a schedule's wall time, in seconds. */
   const SPREAD_SECONDS = 300;

   /** Weekday numbers are 0 = Sunday, so the locale is pinned — getDayOfWeek is locale-relative. */
   const WEEKDAY_LOCALE = "en-US";

   /** Searching more than this many candidates means the schedule is unsatisfiable. */
   const MAX_DAY_STEPS = 8;
   const MAX_MONTH_STEPS = 60;

   function atWallTime(date: ZonedDateTime, schedule: Schedule): ZonedDateTime {
     return date.set(
       {
         hour: schedule.hour,
         minute: schedule.minute,
         second: 0,
         millisecond: 0
       },
       "compatible"
     );
   }

   /**
    * The next wall-clock occurrence of `schedule` strictly after `after`, in the schedule's zone.
    * Always recomputed from the wall clock, never by adding 24 hours to an instant — that would
    * leave every US and EU schedule an hour off after a daylight-saving change.
    */
   export function nextOccurrenceAfter(schedule: Schedule, after: Date): Date {
     const afterMs = after.getTime();
     const start = atWallTime(fromAbsolute(afterMs, schedule.tz), schedule);

     if (schedule.freq === "Daily") {
       return start.toDate().getTime() > afterMs
         ? start.toDate()
         : atWallTime(start.add({ days: 1 }), schedule).toDate();
     }

     if (schedule.freq === "Weekly") {
       const weekdays = schedule.weekdays ?? [];
       let candidate = start;
       for (let step = 0; step < MAX_DAY_STEPS; step++) {
         if (
           weekdays.includes(getDayOfWeek(candidate, WEEKDAY_LOCALE)) &&
           candidate.toDate().getTime() > afterMs
         ) {
           return candidate.toDate();
         }
         candidate = atWallTime(candidate.add({ days: 1 }), schedule);
       }
       throw new Error("Weekly schedule has no satisfiable weekday");
     }

     // Monthly. A month that does not contain the chosen day is SKIPPED, never clamped:
     // clamping would silently turn a "31st" schedule into a "last day of month" schedule.
     let month = atWallTime(start.set({ day: 1 }), schedule);
     for (let step = 0; step < MAX_MONTH_STEPS; step++) {
       const daysInMonth = month.calendar.getDaysInMonth(month);
       const target = schedule.day === "last" ? daysInMonth : (schedule.day ?? 1);
       if (target <= daysInMonth) {
         const occurrence = atWallTime(month.set({ day: target }), schedule);
         if (occurrence.toDate().getTime() > afterMs) return occurrence.toDate();
       }
       month = atWallTime(month.add({ months: 1 }).set({ day: 1 }), schedule);
     }
     throw new Error("Monthly schedule has no satisfiable day");
   }

   /**
    * A stable 0–299 second offset per workflow. Customers pick round times, so hundreds of
    * schedules land on exactly 9:00; spreading them is what the disclosed lateness buys us.
    * `fnv1a64` returns hex, so no BigInt literal is needed — this package compiles at ES2019.
    */
   export function scheduleOffsetSeconds(workflowId: string): number {
     return parseInt(fnv1a64(workflowId).slice(-6), 16) % SPREAD_SECONDS;
   }

   /** `nextOccurrenceAfter` with the spread applied. This is what writes `workflow.nextRunAt`. */
   export function nextRunAfter(
     schedule: Schedule,
     workflowId: string,
     after: Date
   ): Date {
     const offsetMs = scheduleOffsetSeconds(workflowId) * 1000;
     const base = nextOccurrenceAfter(schedule, new Date(after.getTime() - offsetMs));
     return new Date(base.getTime() + offsetMs);
   }
   ```

   The subtract-then-add in `nextRunAfter` is deliberate: applying the offset after an unshifted
   search would let it compound on every cycle.

3. Create `packages/workflows/src/definition/schedule.test.ts` with vitest, covering exactly the
   spec's acceptance criteria. Assert on ISO strings so a failure is readable.

   ```ts
   import { describe, expect, it } from "vitest";
   import type { Schedule } from "./types";
   import {
     nextOccurrenceAfter,
     nextRunAfter,
     scheduleOffsetSeconds
   } from "./schedule";

   const daily = (tz = "America/New_York"): Schedule => ({
     freq: "Daily",
     hour: 9,
     minute: 0,
     tz
   });
   ```

   Write these cases:

   - **Daily, before the time** — `nextOccurrenceAfter(daily(), new Date("2026-08-01T12:00:00Z"))`
     (08:00 New York) is `2026-08-01T13:00:00.000Z`.
   - **Daily, exactly at the time** — from `2026-08-01T13:00:00Z` the answer is
     `2026-08-02T13:00:00.000Z`, proving "strictly after".
   - **Weekly skips the weekend** — `{ freq: "Weekly", hour: 7, minute: 0, weekdays: [1,2,3,4,5],
     tz: "America/New_York" }` evaluated at `2026-08-07T12:00:00Z` (Friday 08:00 New York) returns
     `2026-08-10T11:00:00.000Z` (Monday 07:00 New York).
   - **Monthly skips February** — `{ freq: "Monthly", hour: 9, minute: 0, day: 31,
     tz: "America/New_York" }` evaluated at `2026-01-31T14:00:00Z` returns the 31st of **March**,
     never a February date. Assert `new Date(result).getUTCMonth() === 2`.
   - **Monthly "last"** — `day: "last"` in `UTC` returns `2026-02-28` in 2026 and `2028-02-29`
     when evaluated inside 2028.
   - **DST spring forward** — a `Daily` 02:30 `America/New_York` schedule evaluated just before
     2026-03-08 returns an instant that round-trips through
     `new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric" })` without
     throwing, and is strictly after the input.
   - **DST keeps wall time** — a `Daily` 09:00 `America/New_York` schedule evaluated on either side
     of 2026-11-01 yields `13:00Z` before and `14:00Z` after. This is the test that would have
     caught "add 24 hours to a UTC instant".
   - **Offset range and stability** — `scheduleOffsetSeconds("wf_abc")` is in `[0, 300)` and equal
     across two calls; across 100 ids `new Set(...).size >= 95`.
   - **No compounding** — call `nextRunAfter(daily(), "wf_abc", d)` then feed its result back in;
     the two results are 24 hours apart (86_400_000 ms).

4. Add to `packages/workflows/src/index.ts`, in the `definition/*` export group and keeping the
   file's existing alphabetical-by-symbol style:

   ```ts
   export {
     nextOccurrenceAfter,
     nextRunAfter,
     scheduleOffsetSeconds
   } from "./definition/schedule";
   ```

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all schedule.test.ts cases pass, and no previously-passing test regresses.
pnpm --filter @carbon/workflows typecheck
# Expected: no output, exit 0.
```

**Out of scope:** `scheduleSchema` itself (already correct in
`packages/workflows/src/definition/types.ts:188`), `validate.ts` (its `INVALID_SCHEDULE` rules are
already complete), `CURRENT_DEFINITION_FORMAT_VERSION` (stays at 2 — the stored shape does not
change, so there is no `migrateDefinition` branch to add), and any UI.

---

## Task 2: Add the `schedule` variant to `RunTrigger` and teach `triggerOutputs` about it

**Depends on:** Task 1

**Files:**
- Modify: `packages/workflows/src/run-trigger.ts` — third union member
- Modify: `packages/jobs/src/workflows/engine/loader.ts` — early return in `triggerOutputs`

**Steps:**

1. In `packages/workflows/src/run-trigger.ts`, add a third member to the discriminated union, after
   the `moment` member:

   ```ts
   z.object({
     kind: z.literal("schedule"),
     /** The claimed nextRunAt, ISO 8601 in UTC. */
     dueAt: z.string()
   })
   ```

2. In `packages/jobs/src/workflows/engine/loader.ts`, inside `triggerOutputs`, add an early return
   **before** the existing `if (trigger.kind === "moment")` block:

   ```ts
   // A schedule starts with no record, so the trigger node hands out nothing and seeds no cache.
   // This mirrors NODE_KINDS.trigger.outputs, which already returns {} for a scheduled trigger.
   if (trigger.kind === "schedule") return outputs;
   ```

   `outputs` is already declared above as an empty record, so this returns `{}`.

   This edit is not optional bookkeeping: without it the new union member falls through to the
   record branch, which reads `trigger.record` off a payload that has no such field. Adding the
   union member without this change is a typecheck error, which is the point.

**Verify:**
```bash
pnpm --filter @carbon/workflows typecheck
pnpm --filter @carbon/jobs typecheck
# Expected: both silent, exit 0. If @carbon/jobs reports an error about `record` not existing on
# the trigger union anywhere OTHER than loader.ts, STOP and report — the plan expected exactly one
# consumer to need narrowing.
pnpm --filter @carbon/jobs test
# Expected: existing engine and matcher tests still pass.
```

**Out of scope:** the engine's walk, ledger or execute loop — a queued run is executed identically
regardless of what created it. Do not add a schedule branch anywhere in `execute.ts`.

---

## Task 3: Make `syncWorkflowTriggers` own `workflow.nextRunAt`

**Depends on:** Task 1

**Files:**
- Modify: `packages/workflows/src/sync.ts`
- Create: `packages/workflows/src/sync.test.ts` — only if one does not already exist; if it does,
  extend it
- Modify: `packages/workflows/src/index.ts` — export `findTriggerSchedule`

**Steps:**

1. In `packages/workflows/src/sync.ts`, add imports for `nextRunAfter` from
   `./definition/schedule` and `type Schedule` from `./definition/types`.

2. Add a helper next to `deriveWorkflowTriggerRows`, using the same `nodesSchema` parse the file
   already has:

   ```ts
   /** The schedule on the version's trigger node, or null if it is event-triggered. */
   export function findTriggerSchedule(nodes: unknown): Schedule | null {
     const parsed = nodesSchema.safeParse(nodes);
     if (!parsed.success) {
       throw new Error(
         `workflowVersion nodes failed to parse: ${parsed.error.message}`
       );
     }
     for (const node of parsed.data) {
       if (node.type === "trigger" && node.data.schedule) return node.data.schedule;
     }
     return null;
   }
   ```

3. Change `syncWorkflowTriggers`'s return type from
   `Promise<{ eventIds: string[]; tables: string[] }>` to
   `Promise<{ eventIds: string[]; tables: string[]; scheduled: boolean }>`.

4. Inside the transaction, alongside the existing `desired` computation, also derive the schedule.
   Where the code currently reads:

   ```ts
   if (version) {
     versionId = version.id;
     desired = deriveWorkflowTriggerRows(version.nodes);
   }
   ```

   make it also set a `schedule` variable declared next to `versionId`:

   ```ts
   let schedule: Schedule | null = null;
   // ...
   if (version) {
     versionId = version.id;
     desired = deriveWorkflowTriggerRows(version.nodes);
     schedule = findTriggerSchedule(version.nodes);
   }
   ```

5. After the `workflowTriggerEvent` insert and **before** `reconcileWorkflowSubscriptions`, write
   the due time in the same transaction:

   ```ts
   // The one writer of workflow.nextRunAt. Folded in here so a promote or a toggle cannot wire
   // the trigger rows and forget the due time — that failure would be silent, and the workflow
   // would look active and never run. workflow_due_idx assumes exactly this invariant.
   const nextRunAt =
     schedule && versionId
       ? nextRunAfter(schedule, workflowId, new Date()).toISOString()
       : null;

   await trx
     .updateTable("workflow")
     .set({ nextRunAt })
     .where("id", "=", workflowId)
     .where("companyId", "=", companyId)
     .execute();
   ```

6. Return `{ eventIds: desired.map((d) => d.eventId), tables, scheduled: nextRunAt !== null }`.

7. Export `findTriggerSchedule` from `packages/workflows/src/index.ts` in the existing `./sync`
   export block.

8. Tests. If `packages/workflows/src/sync.test.ts` does not exist, the Kysely calls make a pure unit
   test awkward — in that case test `findTriggerSchedule` only (a scheduled trigger node returns its
   schedule; an event-only trigger node returns null; an empty node list returns null), and rely on
   Task 9 for the database behaviour. Do not stand up a database in a unit test.

**Verify:**
```bash
pnpm --filter @carbon/workflows test
pnpm --filter @carbon/workflows typecheck
# Expected: both pass. syncWorkflowTriggers has no call sites in the repo yet (phase 7 adds them),
# so nothing downstream should break. If something DOES reference its return type, STOP and report.
```

**Out of scope:** `reconcileWorkflowSubscriptions` and `deriveWorkflowSubscriptions` — a scheduled
trigger correctly contributes zero `workflowTriggerEvent` rows and zero `eventSystemSubscription`
rows, and both functions already do the right thing by ignoring it. Do not "fix" them.

---

## Task 4: Extract the run insert-and-emit tail out of `matchAndQueue`

**Depends on:** none

**Files:**
- Modify: `packages/jobs/src/workflows/matcher.ts` — extract lines 181–241 into an exported helper
- Modify: `packages/jobs/src/workflows/types.ts` — if the row/event types need a home

**Steps:**

1. In `packages/jobs/src/workflows/matcher.ts`, extract the block that currently runs from the
   `insertInto("workflowRun")` call through the event-building loop (roughly lines 181–241) into a
   new exported function in the same file:

   ```ts
   export type PlannedRun = {
     workflowId: string;
     workflowVersionId: string;
     eventId: string;
     ownerId: string;
     status: "Queued" | "Blocked" | "Skipped";
     statusReason: string | null;
     rootRunId: string | null;
     causedByRunId: string | null;
     depth: number;
     path: string[];
   };

   /**
    * The one place a workflowRun is created. One statement, so the whole firing lands or none of
    * it does; ON CONFLICT returns only the genuinely new rows, which is also the dedupe count.
    * Only Queued rows produce an event — Blocked and Skipped rows exist to be read in run history.
    */
   export async function insertRunsAndBuildEvents(
     db: Kysely<KyselyDatabase>,
     params: {
       companyId: string;
       sourceEventId: string;
       triggerTable: string | null;
       triggerRecordId: string | null;
       trigger: RunTrigger;
       planned: PlannedRun[];
     }
   ): Promise<MatchResult>
   ```

2. Rewrite `matchAndQueue`'s tail to build its `PlannedRun[]` from `planned` (flattening
   `plan.subscriber.*` and `plan.trace.*` into the flat shape) and delegate to the new helper. The
   behaviour must be byte-for-byte identical: same columns, same
   `onConflict(...).constraint("workflowRun_dedupe_key").doNothing()`, same event `id` of
   `` `${workflowId}:${workflowVersionId}:${sourceEventId}` ``, same `MatchResult` counters.

3. This is a pure refactor. Do not change `planRuns`, the subscriber query, the origin filter or
   either loop guard.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
# Expected: packages/jobs/src/workflows/matcher.test.ts passes unchanged — that is the proof this
# refactor changed nothing. If you had to edit an assertion in matcher.test.ts, STOP and report:
# the extraction changed behaviour and it should not have.
pnpm --filter @carbon/jobs typecheck
```

**Out of scope:** the loop guards, `deriveNextTrace`, and the two Inngest entry points
(`events/workflow.ts`, `workflows/moment.ts`) — they call `matchAndQueue`, whose signature does not
change.

---

## Task 5: Build the scheduler core in `@carbon/jobs`

**Depends on:** Tasks 1, 2, 3, 4

**Files:**
- Create: `packages/jobs/src/workflows/scheduler.ts`
- Create: `packages/jobs/src/workflows/scheduler.test.ts`
- Copy from (precedent, structure and testability): `packages/jobs/src/workflows/matcher.ts` and
  `packages/jobs/src/workflows/matcher.test.ts`

This file imports **no Inngest** — same rule the matcher and engine follow, and it is what makes the
acceptance criteria unit-testable.

**Steps:**

1. Create `packages/jobs/src/workflows/scheduler.ts` with these constants and exports:

   ```ts
   export const MAX_DUE_PER_WAKE = 200;
   export const WAKE_CEILING_MS = 10 * 60 * 1000;
   export const OVERFLOW_WAKE_MS = 30 * 1000;
   export const STALE_AFTER_MS = 60 * 60 * 1000;
   export const BACKSTOP_STALE_MS = 15 * 60 * 1000;
   export const CHAIN_KEY = "workflows:scheduler:chain";
   export const CHAIN_TTL_SECONDS = 7200;

   export const SCHEDULE_EVENT_ID = "schedule";

   export const PREVIOUS_RUN_ACTIVE =
     "The previous run was still going when this one came due.";
   export const TOO_LATE =
     "This run came due more than an hour ago and was skipped rather than run late.";
   ```

2. `scanDue` — one indexed read across all tenants, matching the `workflow_due_idx` predicate. This
   is a platform sweep like `mrp` and `audit-log-archive`, not a per-company loop.

   ```ts
   export type DueWorkflow = {
     id: string;
     companyId: string;
     ownerId: string;
     activeVersionId: string;
     nextRunAt: Date;
     nodes: unknown;
   };

   export async function scanDue(
     db: Kysely<KyselyDatabase>,
     now: Date
   ): Promise<{ due: DueWorkflow[]; earliestFuture: Date | null }>
   ```

   The due query:

   ```ts
   db.selectFrom("workflow as w")
     .innerJoin("workflowVersion as v", (join) =>
       join
         .onRef("v.id", "=", "w.activeVersionId")
         .onRef("v.companyId", "=", "w.companyId")
     )
     .select(["w.id", "w.companyId", "w.ownerId", "w.activeVersionId", "w.nextRunAt", "v.nodes"])
     .where("w.active", "=", true)
     .where("w.activeVersionId", "is not", null)
     .where("w.nextRunAt", "<=", now.toISOString())
     .orderBy("w.nextRunAt", "asc")
     .limit(MAX_DUE_PER_WAKE)
     .execute()
   ```

   The earliest-future query is the same predicate with `">"` instead of `"<="`, selecting only
   `nextRunAt`, `orderBy asc`, `limit 1`.

3. `planWakeAt` — pure, so it is directly testable:

   ```ts
   /**
    * The ceiling is not optional. "The next due time" is only true at the moment it was read:
    * anything created, edited or re-enabled inside a five-hour sleep is invisible to a scheduler
    * already asleep. Capping at ten minutes bounds worst-case lateness for a NEW schedule.
    */
   export function planWakeAt(params: {
     now: Date;
     earliestFuture: Date | null;
     overflow: boolean;
   }): number {
     const { now, earliestFuture, overflow } = params;
     if (overflow) return now.getTime() + OVERFLOW_WAKE_MS;
     const ceiling = now.getTime() + WAKE_CEILING_MS;
     if (!earliestFuture) return ceiling;
     return Math.min(ceiling, Math.max(earliestFuture.getTime(), now.getTime() + 1000));
   }
   ```

   `overflow` is true when `due.length === MAX_DUE_PER_WAKE` — rows are still overdue and the next
   wake should be immediate rather than in ten minutes.

4. `claimDue` — the compare-and-set that makes a firing at-most-once:

   ```ts
   /**
    * Writes the recomputed nextRunAt only if the row still holds the value we read. Zero rows back
    * means another wake won the race. The new value is computed from NOW, not from dueAt, so a long
    * outage can never queue a cascade of catch-up runs.
    */
   export async function claimDue(
     db: Kysely<KyselyDatabase>,
     row: DueWorkflow,
     now: Date
   ): Promise<boolean>
   ```

   Read the schedule with `findTriggerSchedule(row.nodes)` from `@carbon/workflows`. If it returns
   null — the promoted version is no longer schedule-triggered — set `nextRunAt` to `null` in the
   same compare-and-set and return `false`, so the row drops out of the index. Otherwise:

   ```ts
   const recomputed = nextRunAfter(schedule, row.id, now).toISOString();
   const claimed = await db
     .updateTable("workflow")
     .set({ nextRunAt: recomputed })
     .where("id", "=", row.id)
     .where("companyId", "=", row.companyId)
     .where("nextRunAt", "=", row.nextRunAt.toISOString())
     .returning(["id"])
     .executeTakeFirst();
   return claimed !== undefined;
   ```

5. `hasActiveRun` — the overlap check, across all versions of the workflow:

   ```ts
   async function hasActiveRun(
     db: Kysely<KyselyDatabase>,
     workflowId: string,
     companyId: string
   ): Promise<boolean>
   ```

   `selectFrom("workflowRun").select("id").where("workflowId","=",…).where("companyId","=",…)
   .where("status","in",["Queued","Running"]).limit(1)`.

6. `dispatchDue` — the orchestrator. For each row, in `nextRunAt` order:

   ```ts
   export async function dispatchDue(
     db: Kysely<KyselyDatabase>,
     now: Date
   ): Promise<{ events: MatchResult["events"]; queued: number; skipped: number; overflow: boolean }>
   ```

   Per row:
   1. Capture `dueAt = row.nextRunAt` and `dueAtIso = dueAt.toISOString()` **before** claiming.
   2. `claimDue(...)`; if false, skip this row entirely and record nothing — another wake won, or
      the workflow is no longer scheduled.
   3. Decide the status, staleness first (a run that is both stale and overlapping reads as stale,
      which is the more informative reason):
      - `now.getTime() - dueAt.getTime() > STALE_AFTER_MS` → `Skipped`, `statusReason: TOO_LATE`
      - else `await hasActiveRun(...)` → `Skipped`, `statusReason: PREVIOUS_RUN_ACTIVE`
      - else → `Queued`, `statusReason: null`
   4. Build one `PlannedRun` (Task 4's type) with `eventId: SCHEDULE_EVENT_ID`, `ownerId` from the
      row, `workflowVersionId: row.activeVersionId`, `rootRunId: null`, `causedByRunId: null`,
      `depth: 0`, `path: []`. A scheduled run is always a root, exactly like a human edit, so no
      loop guard applies.
   5. Call `insertRunsAndBuildEvents` with `sourceEventId: \`schedule:${row.id}:${dueAtIso}\``,
      `triggerTable: null`, `triggerRecordId: null`, and
      `trigger: { kind: "schedule", dueAt: dueAtIso }`.

   Call `insertRunsAndBuildEvents` **once per row**, not once for the batch: each row has its own
   `sourceEventId` and its own trigger payload, and the helper's contract is one `sourceEventId` per
   call. Accumulate the returned events and counters.

   Both skip outcomes still leave the advanced `nextRunAt` in place, so the schedule resumes
   normally. There is no backfill and no catch-up.

7. `ensureSchedulerChain` and the chain token, using `redis` from `@carbon/kv` (already a dependency
   of `@carbon/jobs`):

   ```ts
   /** True if this wake is the live chain and may book the next one. */
   export async function ownsChain(bookedFor: number | null): Promise<boolean> {
     if (bookedFor === null) return true;        // the backstop always adopts
     try {
       const current = await redis.get(CHAIN_KEY);
       return current === null || current === String(bookedFor);
     } catch {
       return true;   // Redis down: keep scheduling. A transient fork is bounded and harmless —
     }                // the claim's compare-and-set means a fork cannot double-fire anything.
   }

   export async function bookChain(wakeAt: number): Promise<void> {
     try {
       await redis.set(CHAIN_KEY, String(wakeAt), "EX", CHAIN_TTL_SECONDS);
     } catch {
       // Non-fatal: the hourly backstop revives the chain.
     }
   }

   /** True when the chain looks dead and a wake should be sent to adopt it. */
   export async function chainIsStale(now: Date): Promise<boolean> {
     try {
       const current = await redis.get(CHAIN_KEY);
       if (current === null) return true;
       return Number(current) < now.getTime() - BACKSTOP_STALE_MS;
     } catch {
       return true;
     }
   }
   ```

   `@carbon/kv` exports `redis`, an ioredis client wrapped by `withResilience`
   (`packages/kv/src/resilient.ts:96`) — a Proxy typed as `Redis` that already swallows connection
   errors and returns a fallback instead of throwing, so `redis.get` yields `null` when Redis is
   down. That happens to be exactly the "adopt the chain" branch, and the `try/catch` above is belt
   and braces on top of it. `redis.set(key, value, "EX", seconds)` is the standard ioredis TTL form
   and typechecks through the Proxy. If `@carbon/kv` exports something other than a bare `redis`
   client, STOP and report.

8. `packages/jobs/src/workflows/scheduler.test.ts`. Follow `matcher.test.ts`'s approach to faking the
   database. Cover:
   - `planWakeAt` returns `now + 10 min` when `earliestFuture` is five hours out.
   - `planWakeAt` returns the earliest future when it is 90 seconds out.
   - `planWakeAt` returns `now + 30s` when `overflow` is true, regardless of `earliestFuture`.
   - A due row with no active run yields one `Queued` plan, `sourceEventId` exactly
     `schedule:<workflowId>:<dueAtIso>`, `eventId` `"schedule"`, `depth` 0 and an empty `path`.
   - A due row whose workflow has a `Running` run yields a `Skipped` plan with
     `PREVIOUS_RUN_ACTIVE` and **no** event.
   - A due row 90 minutes late yields a `Skipped` plan with `TOO_LATE` and no event.
   - A row that is both 90 minutes late and overlapping records `TOO_LATE`.
   - A claim returning zero rows produces no plan and no event at all.
   - After a claim, the written `nextRunAt` is strictly greater than `now` even when `dueAt` was
     three days ago — the no-cascade guarantee.

**Verify:**
```bash
pnpm --filter @carbon/jobs test
pnpm --filter @carbon/jobs typecheck
# Expected: both pass, and every scheduler.test.ts case above is present and green.
```

**Out of scope:** anything Inngest — no `inngest.createFunction`, no `step`, no event sending in
this file. That is Task 7.

---

## Task 6: Declare the `carbon/workflow-scheduler.wake` event type

**Depends on:** none

**Files:**
- Modify: `packages/lib/src/events.ts` — add one entry to the `Events` type

**Steps:**

1. In `packages/lib/src/events.ts`, immediately after the `"carbon/workflow-moment.raised"` entry,
   add:

   ```ts
   // The self-chaining scheduler's own wake. Each wake books the next one as a future-dated send;
   // `bookedFor` is the booking this wake was created by, or null from the hourly backstop, which
   // always adopts the chain.
   "carbon/workflow-scheduler.wake": {
     data: {
       bookedFor: number | null;
     };
   };
   ```

**Verify:**
```bash
pnpm --filter @carbon/lib typecheck
# Expected: no output, exit 0. If @carbon/lib has no typecheck script, run
# pnpm --filter @carbon/jobs typecheck instead — it consumes this type.
```

**Out of scope:** `packages/lib/src/trigger.ts` — the wake is sent from inside an Inngest function
via `step.sendEvent`, never from app code via `trigger()`, so it needs no taskId mapping.

---

## Task 7: Wire the Inngest scheduler function and its hourly backstop

**Depends on:** Tasks 5, 6

**Files:**
- Create: `packages/jobs/src/inngest/functions/workflows/scheduler.ts`
- Modify: `packages/jobs/src/inngest/functions/workflows/index.ts` — re-export both
- Modify: `packages/jobs/src/inngest/index.ts` — import and register both
- Copy from (precedent, thin-wrapper shape): `packages/jobs/src/inngest/functions/workflows/moment.ts`
- Copy from (precedent, cron shape): `packages/jobs/src/inngest/functions/scheduled/mrp.ts`

**Steps:**

1. Create `packages/jobs/src/inngest/functions/workflows/scheduler.ts` with two functions.

   The wake function:

   ```ts
   export const workflowSchedulerFunction = inngest.createFunction(
     {
       id: "workflows-scheduler",
       retries: 3,
       // Never two wakes at once. Combined with the Redis chain token, a duplicate chain
       // converges back to one instead of multiplying.
       singleton: { key: "workflows-scheduler", mode: "skip" }
     },
     { event: "carbon/workflow-scheduler.wake" },
     async ({ event, step, logger }) => { ... }
   );
   ```

   The body, in this exact order — booking before work is what makes a failure in the dispatch step
   unable to break the chain:

   1. `const owns = await step.run("own-chain", () => ownsChain(event.data.bookedFor ?? null))`.
      If `!owns`, return `{ skipped: "superseded chain" }` and do nothing else.
   2. `const scan = await step.run("scan", async () => { ... })` — call `scanDue(getJobDatabaseClient(), new Date())`
      and return a JSON-serialisable summary: `{ dueCount, earliestFuture: iso | null }`. Step
      return values cross a JSON boundary, so return ISO strings, never `Date` objects.
   3. `const wakeAt = planWakeAt({ now: new Date(), earliestFuture, overflow: dueCount === MAX_DUE_PER_WAKE })`.
   4. `await step.run("book-chain", () => bookChain(wakeAt))`, then
      ```ts
      await step.sendEvent("book-next-wake", {
        name: "carbon/workflow-scheduler.wake",
        ts: wakeAt,
        data: { bookedFor: wakeAt }
      });
      ```
      Use `step.sendEvent`, never a bare `inngest.send` — a bare send re-fires on retry and forks
      the chain, while `step.sendEvent` is memoized.
   5. `const result = await step.run("dispatch", () => dispatchDue(getJobDatabaseClient(), new Date()))`.
   6. `if (result.events.length > 0) await step.sendEvent("queue-runs", result.events)`.
   7. Return `{ queued: result.queued, skipped: result.skipped }` and `logger.info` the same.

   The backstop:

   ```ts
   /** The only static timer we own. It does nothing but revive a chain that has gone quiet. */
   export const workflowSchedulerBackstopFunction = inngest.createFunction(
     { id: "workflows-scheduler-backstop", retries: 2 },
     { cron: "0 * * * *" },
     async ({ step, logger }) => {
       const stale = await step.run("check-chain", () => chainIsStale(new Date()));
       if (!stale) return { revived: false };
       await step.sendEvent("revive-chain", {
         name: "carbon/workflow-scheduler.wake",
         data: { bookedFor: null }
       });
       return { revived: true };
     }
   );
   ```

2. In the same file, add `ensureSchedulerChain`. It belongs here, not in
   `packages/jobs/src/workflows/scheduler.ts`, because it sends an Inngest event and that file
   imports no Inngest by design:

   ```ts
   /**
    * Starts the chain if it has gone quiet. Phase 7's activation route calls this after
    * syncWorkflowTriggers returns { scheduled: true }, so switching a scheduled workflow on fires
    * within minutes instead of waiting up to an hour for the backstop.
    */
   export async function ensureSchedulerChain(): Promise<void> {
     if (!(await chainIsStale(new Date()))) return;
     await inngest.send({
       name: "carbon/workflow-scheduler.wake",
       data: { bookedFor: null }
     });
   }
   ```

   A plain `inngest.send` is correct here — this is called from a request handler, not from inside
   an Inngest function, so there is no step context to memoize against. Export it from
   `packages/jobs/src/inngest/functions/workflows/index.ts`.

3. Update `packages/jobs/src/inngest/functions/workflows/index.ts` to:

   ```ts
   export { workflowMomentFunction } from "./moment";
   export { workflowRunFunction } from "./run";
   export {
     ensureSchedulerChain,
     workflowSchedulerBackstopFunction,
     workflowSchedulerFunction
   } from "./scheduler";
   ```

4. In `packages/jobs/src/inngest/index.ts`, extend the existing
   `import { workflowMomentFunction, workflowRunFunction } from "./functions/workflows";` to also
   import `workflowSchedulerBackstopFunction` and `workflowSchedulerFunction`, and add both to the
   `functions` array under the `// Workflows` comment, after `workflowRunFunction`.

   A function that is not in this array is not served and will never run.

**Verify:**
```bash
pnpm --filter @carbon/jobs typecheck
pnpm --filter @carbon/jobs test
pnpm exec biome check packages/jobs/src packages/workflows/src packages/lib/src
# Expected: typecheck silent; tests green; biome reports no NEW error-severity findings (the repo
# carries ~419 pre-existing warnings — leave those alone).
```

If `singleton` is not accepted by the installed Inngest typings, STOP and report — do not silently
drop it. The repo resolves `inngest@3.54.0`, whose `types.d.ts` declares `singleton?:` at line 1381.

**Out of scope:** changing any existing cron cadence, and touching
`apps/erp/app/routes/api+/inngest.ts` — it serves whatever is in the `functions` array, so no edit
is needed there.

---

## Task 8: Update AGENTS.md files and rules

**Depends on:** Tasks 1–7

**Files:**
- Modify: `packages/workflows/AGENTS.md` — the fourth runtime dependency and the schedule helpers
- Modify: `packages/jobs/AGENTS.md` — the two new functions in the workflow-functions table
- Modify: `.claude/rules/workflow-matcher.md` — `schedule:<workflowId>:<dueAtIso>` is now built, not
  reserved; `syncWorkflowTriggers` now also writes `nextRunAt`
- Modify: `.claude/rules/workflow-engine.md` — `RunTrigger` has three variants; a scheduled run's
  `triggerOutputs` is `{}`
- Modify: `.ai/specs/2026-07-31-workflows-scheduling.md` — set Status to `Implemented` and add a
  changelog line

**Steps:**

1. In `packages/workflows/AGENTS.md`, correct the "Never" bullet that says runtime dependencies are
   `zod`, `@carbon/utils` and `@lingui/core` — it is now four, including `@internationalized/date`,
   which is browser-safe and ES2019-safe (that is why it was allowed). Add an "Always" bullet: the
   next-occurrence maths lives in `src/definition/schedule.ts` and both the scheduler and phase 8's
   preview call it, so it must never be reimplemented in a consumer.
2. In `packages/jobs/AGENTS.md`, add `workflows-scheduler` and `workflows-scheduler-backstop` rows to
   the "Workflow functions" table with their events and one-line purposes, and note that
   `src/workflows/scheduler.ts` is the Inngest-free core, like `matcher.ts`.
3. In `.claude/rules/workflow-matcher.md`, change the "`schedule:<workflowId>:<dueAtIso>` reserved
   for phase 6" wording to describe what now exists, and add `nextRunAt` to the
   `syncWorkflowTriggers` description in the "Subscriptions are derived" section.
4. In `.claude/rules/workflow-engine.md`, update the `RunTrigger` description to three variants.
5. Do not document anything that is not committed, and do not invent behaviour — every claim must be
   checkable against the code you just wrote.

**Verify:**
```bash
grep -rn "reserved for phase 6" .claude/rules/ packages/*/AGENTS.md
# Expected: no matches.
grep -n "internationalized" packages/workflows/AGENTS.md
# Expected: at least one match.
```

**Out of scope:** `docs/content/` — nothing customer-visible ships in this phase, so there is no
product documentation to write. Phase 8's picker is when that becomes true.

---

## Task 9: End-to-end verification

**Depends on:** all previous tasks

**Files:** none — this task only runs things.

**Steps:**

1. Run the full scoped verification set:

   ```bash
   pnpm --filter @carbon/workflows test
   pnpm --filter @carbon/workflows typecheck
   pnpm --filter @carbon/jobs test
   pnpm --filter @carbon/jobs typecheck
   pnpm exec biome check packages/workflows/src packages/jobs/src packages/lib/src
   ```

   Do **not** run a whole-repo typecheck — it OOMs on this repo. If `apps/erp` needs checking because
   something leaked into its type surface, run `pnpm exec turbo run typecheck --filter=erp`
   (the package is named `erp`, not `@carbon/erp`; the wrong filter silently passes).

2. Walk the spec's Acceptance Criteria list top to bottom and confirm each line is covered by a test
   that actually exists and actually passes. Report any criterion that is not — do not mark this task
   complete with an uncovered criterion.

3. Report, in the run log, the exact command output for each command above. Evidence before
   assertions: run the command, read the output, then state the result.

**Verify:**
```bash
pnpm --filter @carbon/workflows test && pnpm --filter @carbon/jobs test
# Expected: both suites green, zero failures, and the new schedule.test.ts and scheduler.test.ts
# files both appear in the output with all their cases passing.
```

**Out of scope:** running the app, seeding a scheduled workflow through the UI, or a live Inngest
dev-server test — no UI exists to create a schedule until phase 8, and the phase document does not
ask for a manual harness. Do not build one.
