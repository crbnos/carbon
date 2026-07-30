# Workflows — Phase 3: the matcher and the event-system wiring

**Status:** Implemented on `feat/automation` — pending e2e sign-off
**Phase brief:** `/Users/aashu/work/carbon/plans/automations-engine/phases/phase-3-matcher.md`
**Source documents:** `/Users/aashu/work/carbon/plans/automations-engine/prd.md`,
`/Users/aashu/work/carbon/plans/automations-engine/technical-decisions.md`
**Predecessors:** `.ai/specs/2026-07-30-workflows-foundation.md` (phase 1),
`.ai/specs/2026-07-30-workflows-event-catalog.md` (phase 2)

## TLDR

Connect Carbon's existing record-change announcements to the phase-2 catalog, so a real database
change ends as "these workflows should run" — a `workflowRun` row and one queued job each — and
nothing more expensive than that.

Five deliverables:

1. **Run tagging.** A workflow acts as its owner, so today its writes are indistinguishable from that
   person's. The engine's minted token gains a `workflow_run_id` claim; `dispatch_event_batch()` reads
   it alongside `auth.uid()` and stamps `workflowRunId` onto the queue message. This is what makes both
   the origin filter and loop protection possible at all.
2. **The matcher.** One announcement → event ids (via the catalog's `match` blocks and the existing
   `computeDiff`) → subscribers (one indexed read on `workflowTriggerEvent (companyId, eventId)`) →
   one run per workflow per triggering record. No value comparisons, no conditions.
3. **The reconciler.** `syncWorkflowTriggers` rewrites a workflow's `workflowTriggerEvent` rows and its
   company's `WORKFLOW` `eventSystemSubscription` rows in one transaction, so a company with no
   workflows pays nothing and the queue never carries rows no consumer wants.
4. **Loop protection.** Cycle and depth checks against `workflowRun.path` / `.depth`, evaluated before
   a run is created. A blocked firing is written as a `Blocked` run linked to its cause, never dropped.
5. **The origin filter.** `Person` / `Automation` / `Both`, decided purely by whether the change
   carries a workflow run tag.

The phase ends with a queued run and a run row, consumed by a stub. The engine is phase 4.

## Problem Statement

Phase 1 built the tables. Phase 2 built the catalog of 106 events. Nothing connects them to reality:
`packages/jobs/src/inngest/functions/events/workflow.ts` is a stub that logs a `workflowId` and stops,
`carbon/workflow-moment.raised` has nine live raise sites and no consumer, and `workflowTriggerEvent`
has a drift check but no writer. A record can change all day and no workflow will ever hear about it.

Four things stand between the announcement and a run, and each has a wrinkle the source documents
either leave open or state without checking:

- **The announcement does not say who caused it.** `actorId` is `auth.uid()` at trigger time, and a
  workflow acting as its owner *is* `auth.uid()`. `technical-decisions.md` says origin is answered by
  "the actor plus the run-id tag on the write" — but no such tag exists, and neither the payload nor
  any table carries one. Without it the origin filter cannot distinguish anything and `depth` can never
  grow past 0, so an A→B→A loop runs forever. This is the load-bearing gap of the phase.
- **The dispatch path assumes one workflow per subscription.** `queue.ts:124-138` flattens
  `handlerConfig.workflowId` into the dispatched event, and drops `companyId` and `actorId` entirely.
  A per-table subscription serving many workflows does not fit that shape, and the matcher needs
  exactly the two fields that were dropped.
- **Nothing computes the changed-field set.** Every message carries whole `old` and `new` rows and no
  field list, so "which watched column changed" is TypeScript's job. `computeDiff`
  (`packages/jobs/src/inngest/functions/events/diff.ts:76`) already does this for the audit log.
- **Nothing writes `workflowTriggerEvent`.** Its invariant is documented
  (`packages/workflows/AGENTS.md:127-138`) and its drift check is written, but the writer was left to
  this phase and phase 7.

## Proposed Solution

### A. Run tagging — one claim on the token the engine already mints

`getUserScopedClient(userId)` (`packages/auth/src/lib/supabase/client.server.ts:14`) mints a 5-minute
HS256 JWT with `jose` and returns an anon-key client. It gains an optional second argument:

```ts
export async function getUserScopedClient(
  userId: string,
  options?: { workflowRunId?: string }
): Promise<SupabaseClient<Database>>
```

When present, `workflow_run_id` is added to the signed payload. PostgREST puts the whole verified
payload into the `request.jwt.claims` GUC, which Carbon's own RLS already reads
(`20230123004206_claims.sql:14`), so `dispatch_event_batch()` can pick it up next to `auth.uid()`:

```sql
current_actor_id := auth.uid()::TEXT;
current_workflow_run_id :=
  (current_setting('request.jwt.claims', true)::jsonb)->>'workflow_run_id';
```

and stamp it onto every message the statement produces, as a new top-level key alongside `actorId`:

```jsonc
{ "handlerType": "WORKFLOW", "companyId": "…", "actorId": "usr_…",
  "workflowRunId": "wfr_…" | null,
  "event": { "table": "purchaseOrder", "operation": "UPDATE", "recordId": "…",
             "old": { /* whole row */ }, "new": { /* whole row */ }, "timestamp": "…" } }
```

**Why the token and not a per-write mechanism.** The engine mints a fresh client per step anyway
(phase 4), so the run id is attached once and every write through that client carries it — an action
author writes nothing and cannot forget it. There is deliberately **no fallback path** for direct SQL:
a Kysely or service-role write bypasses row-level security, and phase 4's requirement is that a
workflow acts as its owner with exactly their permissions, so such a write is already forbidden. That
turns what would have been a silent hole into an explicit constraint.

> **Constraint for phase 5, recorded here:** a workflow action writes through the owner-scoped client
> or it is not an action. Anything needing service-role, Kysely, or an edge function is out of the
> action catalog until that is designed separately.

The claim is not a security boundary — forging it needs `SUPABASE_JWT_SECRET`, the same trust boundary
as `sub` — and a forged value can only affect loop-guard accounting, never permissions.

### B. The matcher

Two entry points over one shared core, because record changes and moments arrive on different Inngest
events but stop differing the moment they become event ids.

```
packages/jobs/src/workflows/
├── event-ids.ts     # announcement -> event ids            (pure, unit-tested)
├── matcher.ts       # subscribers, origin, loop guards, run rows, queueing
├── types.ts
├── event-ids.test.ts
└── matcher.test.ts

packages/jobs/src/inngest/functions/events/workflow.ts      # record-change entry point (rewritten)
packages/jobs/src/inngest/functions/workflows/moment.ts     # moment entry point (new)
packages/jobs/src/inngest/functions/workflows/run.ts        # stub consumer (new)
packages/jobs/src/inngest/functions/workflows/index.ts      # barrel (new)
```

**Step one — announcement to event ids** (`event-ids.ts`, pure and injectable):

A module-level index is built once from `WORKFLOW_EVENTS`, keyed `table → operation → field?`, by
reading each entry's `match` block. Then:

| Operation | Event ids produced |
|---|---|
| `INSERT` | the one `<entity>.created` id for that table, if the catalog has one |
| `DELETE` | the one `<entity>.deleted` id |
| `UPDATE` | `computeDiff(old, new)` → for each changed top-level key, the `<entity>.<field>.changed` id if the catalog has one |

`computeDiff` returns `null` when nothing meaningful changed, which ends the work immediately — that is
what removes the bulk of the noise. It applies `auditConfig.skipFields` (`updatedAt`, `updatedBy`,
`embedding`); none of the 77 watched columns collide with those, verified. It also flattens nested
objects into dotted keys (`customFields.foo`), which simply never match a watched column and are
ignored. Editing only a PO's notes produces no event id and the matcher writes nothing at all.

A moment is already an event id: `match: { moment: "production.jobReleased" }`, so the moment entry
point looks it up directly.

**Step two — the subscribers.** One read, `workflowTriggerEvent` joined to `workflow`:

```sql
SELECT te."workflowId", te."workflowVersionId", te."eventId", te."origin",
       w."ownerId"
FROM "workflowTriggerEvent" te
JOIN "workflow" w
  ON w."id" = te."workflowId" AND w."companyId" = te."companyId"
WHERE te."companyId" = $1 AND te."eventId" = ANY($2)
```

driven by `workflowTriggerEvent_dispatch_idx ("companyId","eventId")`. The join is to `workflow`'s
composite primary key and exists only to fetch `ownerId`, which `workflowRun.ownerId` requires and the
derived table does not carry. Activeness is **not** re-checked in the query — the table's invariant is
that a row exists only for an active workflow with a promoted version, and re-checking it here would
paper over drift rather than surface it. The drift check
(`packages/checks/src/invariants/workflow-trigger-event-drift.sql`) is what catches a broken invariant.

**Step three — the origin filter.** Decided purely by the tag:

| `workflowRunId` on the announcement | Origin of the change |
|---|---|
| present | `Automation` |
| absent | `Person` |

A row whose `origin` is `Both` always survives; otherwise it survives only on a match. This is exact,
needs nothing beyond the tag, and matches why the filter exists — to let a customer stop workflows
setting each other off. The consequence is deliberate and should be stated in the phase-8 help text: a
change made by MRP, a CSV import or a posting routine counts as `Person`, because no workflow made it.
Deciding it on `actorId` instead would leave posting a receipt matching *neither* value, since the
write happens in a privileged edge function that records no user — so a "only when a person does it"
rule would silently never fire on posting.

**Step four — loop protection.** Only when `workflowRunId` is present does the matcher read the causing
run (one indexed read on the primary key) for `rootRunId`, `depth`, `path`, `workflowId`, and derive the
next hop:

```
nextRootRunId = causing.rootRunId ?? causing.id
nextDepth     = causing.depth + 1
nextPath      = [...causing.path, causing.workflowId]
```

A human edit, an import or a schedule starts at `depth` 0 with an empty `path`, so ordinary work is
never capped. Then, per surviving subscriber, before any run is created:

- `workflowId` already in `nextPath` → **cycle**. Write a `Blocked` run,
  `statusReason: "Cycle: this workflow already ran in this chain"`, `causedByRunId` set. Do not queue.
- `nextDepth >= MAX_CHAIN_DEPTH` (10, already exported from `@carbon/workflows`) → **too deep**. Write a
  `Blocked` run, `statusReason: "Chain depth limit reached (10 hops)"`. Do not queue.

Blocked runs carry the same `sourceEventId` and therefore the same dedupe key, so a re-delivery finds
the existing blocked row rather than writing a second one.

**Step five — the run row and the queued job.** One insert per surviving subscriber:

```ts
.insertInto("workflowRun")
.values({ companyId, workflowId, workflowVersionId, eventId, sourceEventId,
          triggerTable, triggerRecordId, ownerId, status: "Queued",
          rootRunId, causedByRunId, depth, path })
.onConflict((oc) => oc.constraint("workflowRun_dedupe_key").doNothing())
.returning("id")
```

Zero rows back means this announcement was already handled — the run-level idempotency guarantee — and
the matcher sends nothing. Otherwise it sends one `carbon/workflow-run.queued` event.

`sourceEventId` is always present and deterministic per trigger kind:

| Trigger | `sourceEventId` |
|---|---|
| record change | `pgmq:<msgId>` |
| business moment | `moment:<momentId>` |
| schedule (phase 6) | `schedule:<workflowId>:<dueAtIso>` |

The moment id is minted by `raiseMoment` rather than taken from Inngest: `EventPayload.id` in Inngest
3.54 is a *sender-set* optional idempotency field, not a server-assigned one, so there is nothing to
read. `raiseMoment` generates a `momentId` with `nanoid`, sets it as both the payload field and the
Inngest event `id` (so a double send is suppressed upstream too), and the matcher uses it verbatim.

### C. The queued run event and the stub consumer

```ts
"carbon/workflow-run.queued": {
  data: {
    runId: string;
    companyId: string;
    workflowId: string;
    workflowVersionId: string;
    eventId: string;
    ownerId: string;
    sourceEventId: string;
    trigger:
      | { kind: "record"; table: string; recordId: string;
          operation: "INSERT" | "UPDATE" | "DELETE";
          record: Record<string, unknown> | null;
          before: Record<string, unknown> | null;
          after: Record<string, unknown> | null }
      | { kind: "moment"; moment: string; outputs: Record<string, { id: string }> };
  };
}
```

Sent with `id: \`${workflowId}:${workflowVersionId}:${sourceEventId}\`` so Inngest suppresses a
duplicate delivery independently of the database constraint.

**The whole `before` and `after` rows are carried, not just ids.** `before` is unrecoverable — once the
update commits, nothing can read the prior row — and the PRD's crossing case (`amount > 10000` AND
`before.amount <= 10000`) depends on it. They come free in the announcement, and two rows of a
Carbon entity are a few kilobytes against Inngest's 256KB event cap. This is the one place entities are
not reduced to a type plus an id; run *logs* keep that rule.

The stub consumer (`workflows/run.ts`) is an Inngest function on that event that parses the payload,
logs the run id and workflow id, and returns. Phase 4 replaces its body with the walker and adds the
per-company and per-workflow concurrency keys; the stub deliberately carries no concurrency config
rather than a guessed one.

### D. Subscription and trigger-event management

New file `packages/workflows/src/sync.ts`, exported from `@carbon/workflows` — importable by both the
ERP app (phase 7's activation screen) and background jobs, which an ERP module service would not be.
(Originally specified as `packages/database/src/workflow.ts`; moved at plan time — see Changelog.)

```ts
export async function syncWorkflowTriggers(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  workflowId: string
): Promise<{ eventIds: string[]; tables: string[] }>;

export async function syncWorkflowSubscriptions(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<{ tables: string[] }>;
```

`syncWorkflowTriggers` runs one Kysely transaction:

1. Read the workflow (`active`, `activeVersionId`) and, if promoted, that version's `nodes`.
2. Derive the desired rows: for an active workflow with a promoted version, one row per event id on
   each trigger node, carrying that node's `origin`. For an inactive or unpromoted workflow, none.
3. `DELETE` that workflow's `workflowTriggerEvent` rows, then `INSERT` the desired set. Delete-then-
   insert rather than an upsert, because the table has no `UPDATE` RLS policy by design
   (`20260730142317_workflows-foundation.sql:256-257`).
4. Recompute the company's `WORKFLOW` subscriptions from the resulting rows and reconcile them in the
   same transaction.

Subscriptions are derived, never fixed: for every distinct table across the company's
`workflowTriggerEvent` rows (resolved through each event id's `match` block), one row named
`workflow-<table>` with `operations` set to exactly the operations those events need. A company
watching only `purchaseOrder.status.changed` subscribes to `UPDATE` alone, so an insert on that table
never enters the queue. Tables no longer needed have their `workflow-<table>` row deleted.

Two deliberate departures from how `audit.ts` does the equivalent
(`packages/database/src/audit.ts:231-299`): the writes are plain SQL inside the Kysely transaction
rather than a per-table loop over `create_event_system_subscription`, because the invariant requires
atomicity and a loop of RPCs is neither atomic nor one round trip; and removal is by exact
`(companyId, name, table)` rather than `deleteEventSystemSubscriptionsByName`, which matches on name
only.

Kysely bypasses row-level security, so the caller authorizes first — phase 7's activation route gates
on `workflows_update` before calling. This is the ordinary Carbon pattern for a multi-row write.

### E. The queue dispatch seam

`packages/jobs/src/inngest/functions/events/queue.ts:124-138`, the `WORKFLOW` branch, changes shape.
It currently flattens `handlerConfig.workflowId` — a field that will now never be set, because a
per-table subscription serves many workflows — and drops the two fields the matcher needs:

```ts
// before
{ msgId: job.msg_id, workflowId: job.message.handlerConfig.workflowId, data: job.message.event }

// after
{ msgId: job.msg_id, companyId: job.message.companyId, actorId: job.message.actorId ?? null,
  workflowRunId: job.message.workflowRunId ?? null, data: job.message.event }
```

Per-row dispatch, `chunk(..., CHUNK_SIZE)` and `idempotency: "event.data.msgId"` are all unchanged —
the WORKFLOW branch stays the one-event-per-message shape it already had.

Two fixes travel with it. `workflow.ts`'s `concurrency: { limit: 0, … }` was copied verbatim from
`webhook.ts:22-25`; 0 is not a meaningful Inngest limit, so the matcher keys concurrency on
`event.data.companyId` with a real limit instead. And the `handlerType` CHECK constraint is untouched —
`'WORKFLOW'` has been allowed since `20260116215036_event_system_impl.sql:30`, which is the whole
reason the feature carries this name.

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| How a workflow-made change is identified | A `workflow_run_id` claim on the token `getUserScopedClient` mints, read by `dispatch_event_batch()` from `request.jwt.claims` | The engine mints a client per step anyway, so every write through it is tagged automatically and no call site can forget. Precedent for reading that GUC is `20230123004206_claims.sql:14`. Rejected: a transaction-local GUC (does not survive PostgREST, which is how the engine writes) and a request header (same migration cost, one more layer that can silently drop it) |
| A fallback for direct-SQL writes | None | A Kysely or service-role write bypasses RLS, which phase 4's act-as-owner requirement already forbids. Recording the constraint makes a violation visible instead of survivable |
| What `Person` and `Automation` mean | Purely the presence of the run tag | Exact, needs nothing else, and matches why the filter exists. Deciding on `actorId` would leave a posted receipt matching neither value, because posting writes from a privileged edge function with no user |
| Where the reconciler lives | `packages/workflows/src/sync.ts`, one Kysely transaction | Both the ERP app and background jobs can import it; an ERP module service could not be reached from jobs. Kysely because the invariant needs one transaction, which a loop of RPCs cannot give |
| Subscription granularity | One `workflow-<table>` row per company per table, `operations` derived from the subscribed events | Caps exposure to the 86 triggered tables regardless of catalog growth, and a company with no workflows pays literally nothing. Deriving operations means an unwatched operation never enters the queue at all |
| `handlerConfig.workflowId` | Dropped; the WORKFLOW dispatch forwards `companyId`, `actorId` and `workflowRunId` instead | A per-table subscription serves many workflows, so a single id in `config` cannot express the fan-out. The two fields the matcher genuinely needs were the two the branch discarded |
| Changed-field computation | Reuse `computeDiff` | Already handles skip-fields, empty-to-empty transitions and rich text, and is unit-tested. No watched column collides with `skipFields`, verified against all 77 |
| Matcher entry points | Two Inngest functions over one shared core | Record changes and moments arrive on different events and stop differing the moment they are event ids; one core keeps origin, loop guards and run creation from being written twice |
| `sourceEventId` for a moment | `moment:<momentId>`, minted by `raiseMoment` with `nanoid` | Inngest's `EventPayload.id` is sender-set, not server-assigned, so there is nothing to read. Minting it also lets the same value be the Inngest event id, suppressing a double send upstream |
| What the queued run event carries | The whole `before` and `after` rows | `before` is unrecoverable after the commit, and the PRD's crossing case needs it. Costs a few KB against a 256KB cap. Run *logs* keep the type-plus-id rule |
| Owner permission check at match time | Not done | `technical-decisions.md` places it at activation and at run time, where a failure can be reported as "the owner no longer has access to Sales". Checking here would cost a read per announcement and produce a silent drop |
| Activeness re-checked in the subscriber query | No | The `workflowTriggerEvent` invariant already guarantees it; re-checking would hide drift that the existing invariant check exists to surface |
| Composite-key row pairing | The `pk_join` fix from `20260717143448` is restored into the rewritten function | It was silently lost when `20260721184852` copied the body forward from `20260427120000`. Leaving it means the next rewrite copies the broken body forward a third time. No behaviour change for tables keyed on `id`, which is all ten registry entities |
| `concurrency.limit: 0` on the stub | Replaced with a real per-company limit | 0 is not a documented Inngest value; it was copied from `webhook.ts`. Phase 1 flagged it as needing a check before being relied on |

### What this phase deliberately does not build

- **No engine.** No graph walking, no node executors, no owner-scoped connection minting, no
  `get_claims` check. `getUserScopedClient` gains the option; nothing calls it with a run id yet.
- **No scheduling.** `sourceEventId`'s schedule form is documented and unimplemented (phase 6).
- **No action, operation or lookup catalog** (phase 5).
- **No UI, no route, no navigation entry** (phases 7–9). The reconciler is callable but nothing calls
  it from a screen.
- **The seven moments phase 2 deferred stay deferred.** They are catalog work rather than matcher work
  and each needs its own judgement about where to raise it; they move to phase 5.
- **No new tables and no new columns.** The migration replaces one function.
- **No dead-letter handling.** The drainer deletes pgmq messages before handlers run
  (`queue.ts:207-213`), so a matcher that exhausts its Inngest retries loses that announcement. This is
  pre-existing and shared with every other handler; it is recorded under Risks, not fixed here.

## Data Model Changes

One migration, `pnpm db:migrate:new workflows-run-tag`. It replaces `dispatch_event_batch()` — no
tables, no columns, no enum values, no CHECK-constraint change.

The new body is the current one (`20260721184852_event-queue-wake.sql:82-240`) with three edits:

1. Two new locals, `current_workflow_run_id TEXT` and `pk_join TEXT`.
2. After `current_actor_id := auth.uid()::TEXT;`:
   ```sql
   current_workflow_run_id :=
     (current_setting('request.jwt.claims', true)::jsonb)->>'workflow_run_id';
   ```
   and `'workflowRunId', $10` added to the message object built at `:134-219`, passed through the
   existing `EXECUTE … USING` parameter list.
3. The `pk_join` derivation and the `JOIN batched_old o ON %s` form restored from
   `20260717143448_fix-event-update-row-pairing.sql:76-91,200-203`, replacing the single-column
   `JOIN batched_old o ON n.%I = o.%I` at `:212`.

Everything else — the `app.sync_in_progress` guard, the company extraction, the fast check, the
`filter` containment, `pgmq.send_batch`, the `carbon.event_wake_sent` wake — is carried forward
unchanged.

`pnpm run generate:types` is **not** needed: no table or column changed. `git status` must still be
checked for ride-along regeneration of `packages/database/src/types.ts`,
`src/swagger-docs-schema.ts` and `supabase/functions/lib/types.ts` before committing.

## API / Service Changes

### New files

```
packages/workflows/src/sync.ts                             # syncWorkflowTriggers, syncWorkflowSubscriptions
packages/jobs/src/workflows/event-ids.ts                   # announcement -> event ids (pure)
packages/jobs/src/workflows/matcher.ts                     # subscribers, origin, loop guards, runs
packages/jobs/src/workflows/types.ts
packages/jobs/src/workflows/event-ids.test.ts
packages/jobs/src/workflows/matcher.test.ts
packages/jobs/src/inngest/functions/workflows/moment.ts    # carbon/workflow-moment.raised entry point
packages/jobs/src/inngest/functions/workflows/run.ts       # carbon/workflow-run.queued stub consumer
packages/jobs/src/inngest/functions/workflows/index.ts
packages/database/supabase/migrations/<ts>_workflows-run-tag.sql
```

### Modified files

- `packages/auth/src/lib/supabase/client.server.ts` — `getUserScopedClient` gains
  `options?: { workflowRunId?: string }`, adding a `workflow_run_id` claim when present.
- `packages/database/src/event.ts` — `QueueMessageSchema` gains `workflowRunId: z.string().nullish()`.
- `packages/database/package.json` — `"./workflow": "./src/workflow.ts"` export.
- `packages/jobs/src/inngest/functions/events/queue.ts` — the `WORKFLOW` dispatch branch forwards
  `companyId` / `actorId` / `workflowRunId` and drops `workflowId`.
- `packages/jobs/src/inngest/functions/events/workflow.ts` — the stub becomes the record-change entry
  point; `concurrency.limit: 0` replaced with a real per-company limit.
- `packages/jobs/src/inngest/functions/events/index.ts` and `packages/jobs/src/inngest/index.ts` — the
  two new functions registered in both the barrel and the served `functions` array.
- `packages/lib/src/events.ts` — `carbon/event-workflow`'s payload updated to the new shape;
  `carbon/workflow-run.queued` added; `carbon/workflow-moment.raised` gains `momentId`.
- `packages/lib/src/trigger.ts` — `"workflow-run"` added to `taskToEvent`.
- `packages/lib/src/workflows/raise-moment.ts` — mints `momentId` and passes it as the Inngest event id.
- `packages/jobs/package.json` — `@carbon/workflows` as a dependency (the matcher reads the catalog).
- `packages/workflows/AGENTS.md`, `.claude/rules/event-system.md`,
  `.claude/rules/workflow-event-system.md` — the `WORKFLOW` handler is no longer a stub, the dispatch
  payload changed, and the message gains `workflowRunId`. All three currently say otherwise.
- `.claude/rules/workflow-matcher.md` — new rule for the subsystem.

## UI Changes

N/A. Nothing in this phase is reachable from a screen; the reconciler is called by phase 7's activation
route, which does not exist yet.

## Acceptance Criteria

Unit-testable without a database:

1. `computeEventIds` on an INSERT announcement for `purchaseOrder` returns exactly
   `["purchaseOrder.created"]`.
2. On an UPDATE where only `notes` changed, it returns `[]` — and on one where `status` and `supplierId`
   both changed, exactly the two `.changed` ids, in catalog order.
3. On an UPDATE where only `updatedAt` and `updatedBy` changed, it returns `[]` (`computeDiff` returns
   `null`).
4. On an announcement for a table absent from the catalog, it returns `[]` without touching the
   database.
5. Origin filtering: given subscribers with `origin` `Person`, `Automation` and `Both`, an announcement
   with `workflowRunId: null` yields the `Person` and `Both` subscribers only; one with a run id yields
   `Automation` and `Both` only.
6. Loop guards: a causing run with `path: ["wf_1","wf_7"]` firing `wf_7` produces a `Blocked` run with
   the cycle reason and no queued event; one with `depth: 9` firing an unrelated workflow produces
   `depth: 10` and a `Blocked` run with the depth reason; one with `depth: 8` produces a `Queued` run at
   `depth: 9`.
7. Trace derivation: a causing run with `rootRunId: null, id: "wfr_a", depth: 0, path: []` for workflow
   `wf_1` yields `rootRunId: "wfr_a", depth: 1, path: ["wf_1"]` on the next hop.
8. `syncWorkflowTriggers` against a workflow whose active version has one trigger node listing two
   events with `origin: "Person"` produces exactly two `workflowTriggerEvent` rows with that origin, and
   one `workflow-purchaseOrder` subscription with `operations: ["UPDATE"]`; deactivating the workflow
   and re-running removes both rows and the subscription.

End to end, against a running local stack (`pnpm dev`, Inngest dev server on :8288):

9. With no active workflow for a company, updating a purchase order's status enqueues **no** pgmq
   message with `handlerType = 'WORKFLOW'` — `SELECT * FROM "eventSystemSubscription" WHERE "companyId"
   = '…' AND "handlerType" = 'WORKFLOW'` returns zero rows and the fast check short-circuits.
10. After seeding a workflow with a promoted version whose trigger node lists
    `purchaseOrder.status.changed` and calling `syncWorkflowTriggers`, changing that PO's status
    produces exactly one `workflowRun` row with `status: 'Queued'`, the right `eventId`,
    `sourceEventId` matching `pgmq:<n>`, `depth: 0`, `path: {}`, and one
    `carbon/workflow-run.queued` run visible in the Inngest dashboard reaching the stub.
11. Changing only that PO's notes produces no `workflowRun` row.
12. Replaying the same `carbon/event-workflow` event produces no second `workflowRun` row (the dedupe
    constraint holds) and no second queued event.
13. A `raiseMoment("production.jobReleased", …)` call from releasing a job produces one `workflowRun`
    with `sourceEventId` matching `moment:<id>` for a workflow subscribed to that moment.
14. `pnpm --filter @carbon/checks workflow-events` and the
    `workflow-trigger-event-drift` invariant both pass after step 10.

Validation commands:

```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=@carbon/database --filter=@carbon/auth --filter=@carbon/lib
pnpm exec biome check
pnpm run test
pnpm run check:workflow-catalog
```

## Risks

- **Rewriting `dispatch_event_batch()` touches every triggered table.** It is `SECURITY DEFINER`,
  statement-level, and attached to 86 tables; a mistake breaks the audit log, search indexing,
  accounting sync and embeddings at once. Mitigation: the new body is the current one with three
  additive edits, the migration is reviewed against `20260721184852` line by line, and criterion 9
  checks the no-subscription fast path still short-circuits.
- **The drainer deletes pgmq messages before handlers run.** A matcher that exhausts its three Inngest
  retries loses that announcement permanently — there is no dead-letter queue. Pre-existing and shared
  with every handler; recorded rather than fixed, and worth revisiting once run history (phase 9) can
  show the gap.
- **`request.jwt.claims` is only populated on the PostgREST path.** That is exactly the path phase 4
  will use, but it means the tag is silently absent for any other write path — which is the reason the
  act-as-owner constraint is written down rather than assumed.
- **The reconciler's invariant is only as good as its callers.** Nothing enforces that phase 7 calls
  `syncWorkflowTriggers` on every promote, trigger edit and active toggle. The drift check catches a
  violation after the fact; it cannot prevent one.
- **A bulk import fans out per row.** 500 changed rows × N matching workflows is 500N runs, by design
  (`prd.md:236`). Inngest's per-company concurrency cap is the protection and it belongs to phase 4;
  until then a large import against a matching workflow will queue a large number of stub runs.

## Open Questions

All resolved with the user on 2026-07-30, before this spec was written. Recorded as an audit trail.

- [x] How should a change made by a running workflow be marked, so the matcher can recognise it? —
      **Answer:** a `workflow_run_id` claim on the token `getUserScopedClient` already mints, read by
      `dispatch_event_batch()` from `request.jwt.claims` and stamped onto the queue message. The user
      asked whether it could be simpler while still covering every case; it can — the originally
      proposed transaction-GUC fallback was dropped, because the write path it covered (Kysely or
      service-role) is already forbidden by phase 4's act-as-owner requirement. The constraint is
      recorded for phase 5 instead. Rejected: a GUC alone (does not survive PostgREST, which is how the
      engine writes), a request header (same cost, one more layer that can drop it), and deferring
      (leaves the origin filter and both loop guards inoperative).
- [x] How far should this phase go on the reconciler, given the activation screen is phase 7? —
      **Answer:** phase 3 builds one shared `syncWorkflowTriggers` in `packages/workflows/src/sync.ts`,
      rewriting both tables in a single Kysely transaction; phase 7's screen just calls it. Rejected: an
      ERP module service (background jobs cannot import ERP app code, so a future repair job would need
      a second copy) and leaving it entirely to phase 7 (the matcher could then not be exercised at all
      in this phase, and the phase brief asks for subscription management here).
- [x] What exactly do `Person` and `Automation` mean on the origin filter? — **Answer:** purely the
      presence of the run tag. `Automation` = the change carries a workflow run id; `Person` = it does
      not. Accepted consequence: a change made by MRP, an import or a posting routine counts as
      `Person`. Rejected: additionally requiring a real user id, which would leave a posted receipt or
      shipment matching neither value, because posting writes from a privileged edge function that
      records no user — so a "only when a person does it" rule would silently never fire on posting.
- [x] Phase 2 deferred seven business moments and named phase 3 as their home. In or out? —
      **Answer:** out. They are catalog work rather than matcher work, each needs its own judgement
      about where to raise it, and this phase already carries a migration to a function shared by 86
      tables. They move to phase 5.
- [x] While rewriting `dispatch_event_batch()`, restore the composite-key pairing fix that was
      accidentally dropped? — **Answer:** yes. `20260721184852` copied its body forward from
      `20260427120000`, silently reverting `20260717143448`'s `pk_join` logic; verified by comparing the
      two files. Restoring it is ~15 lines, is a no-op for tables keyed on `id` (all ten registry
      entities), and fixes phantom audit-log diffs on tables like `itemPlanning`. Leaving it would mean
      the next rewrite copies the broken body forward a third time.

## Cross-phase dependencies this phase creates

- **Phase 4** calls `getUserScopedClient(ownerId, { workflowRunId })` per step, consumes
  `carbon/workflow-run.queued` in place of the stub, and adds the per-company and per-workflow
  concurrency keys the stub deliberately omits. It inherits the constraint that a workflow action
  writes through the owner-scoped client — service-role, Kysely and edge-function writes are untagged
  and therefore invisible to loop protection.
- **Phase 5** owns the seven deferred moments, and must honour the same act-as-owner constraint when
  curating the action catalog.
- **Phase 6** supplies `sourceEventId` in the `schedule:<workflowId>:<dueAtIso>` form and enters the
  same run-creation path, so the scheduler never duplicates the loop guards.
- **Phase 7** must call `syncWorkflowTriggers` on every promote, trigger-node edit and `active` toggle,
  inside the same transaction as the change itself. Nothing else upholds the `workflowTriggerEvent`
  invariant.
- **Phase 8** should say plainly in the origin filter's help text that a change made by an import or a
  posting routine counts as made by a person.

## Changelog

- 2026-07-30: Created. Five open questions resolved with the user before writing (see Open Questions).
  Three deliberate deviations from `technical-decisions.md`, each recorded in Design Decisions with
  rationale: the causation tag is a JWT claim rather than the unspecified "run-id tag on the write";
  the origin filter ignores `actorId` entirely rather than combining it with the tag; and the
  subscriber lookup joins `workflow` for `ownerId` rather than being the single unjoined read the
  document costs it at. One correction to a fact both source documents rely on: `handlerConfig
  .workflowId` cannot serve a per-table subscription and is removed rather than reinterpreted.
- 2026-07-30: Implemented. One deviation, decided at plan time: the reconciler lives in
  `packages/workflows/src/sync.ts`, not `packages/database/src/workflow.ts`. It must read
  `WORKFLOW_EVENTS`, and `@carbon/workflows` already has `@carbon/database` as a devDependency —
  the reverse edge is a package cycle Turborepo rejects outright. Signatures, callers and the
  placement rationale are unchanged; Kysely is imported type-only so the package gains no runtime
  dependency. The `@carbon/database/workflow` export was therefore never added.
- 2026-07-30: Code-quality review. Behavior unchanged; five structural fixes, all recorded in the
  plan's Progress note. The two that alter files this spec names: the matcher's Kysely client is now
  the package-wide `getJobDatabaseClient()` in `packages/jobs/src/db.ts` (the phase's own `workflows/
  db.ts` was a third copy of an existing helper and is deleted), and the run trigger payload is a
  single `runTriggerSchema` / `RunTrigger` in `packages/workflows/src/run-trigger.ts` instead of
  three hand-restated copies. The matcher also inserts a firing's runs in one statement rather than
  one `await` per plan.
