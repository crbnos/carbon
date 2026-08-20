---
description: The workflow matcher — how one database announcement or business moment becomes queued workflow runs, with the origin filter and the cycle/depth loop guards. Read before touching the matcher, the two Inngest entry points, or the trigger-event reconciler.
paths:
  - "packages/jobs/src/workflows/**"
  - "packages/jobs/src/inngest/functions/workflows/**"
  - "packages/workflows/src/sync.ts"
---

# Workflow Matcher

Turns "something happened" into "these customer workflows should run". "Workflow" here is
the customer-facing feature (a "when this happens, do that" rule) — not the
`.claude/rules/workflow-*.md` developer-procedure files.

Spec: `.ai/specs/2026-07-30-workflows-matcher.md`. Catalog: `workflow-event-catalog.md`.
The event system underneath it: `event-system.md`.

## The pipeline

```
record change                            business moment
  dispatch_event_batch() → pgmq            raiseMoment() → carbon/workflow-moment.raised
  → event-queue drainer                            │
  → carbon/event-workflow                          │
        │                                          │
  events/workflow.ts                        workflows/moment.ts
  computeEventIds(table, op, old, new)      the moment IS the event id
        └──────────────┬───────────────────────────┘
                       ▼
              matchAndQueue(db, input)          packages/jobs/src/workflows/matcher.ts
                 1. read subscribers   workflowTriggerEvent × workflow (one indexed read)
                 2. origin filter      Person / Automation / Both
                 3. loop guards        cycle, then depth
                 4. insert workflowRun one per workflow, ON CONFLICT DO NOTHING
                 5. emit one carbon/workflow-run.queued per row actually inserted
                       ▼
              workflows/run.ts → engine/execute.ts   (workflow-engine.md)
```

`packages/jobs/src/workflows/` holds the core and imports no Inngest:
`event-ids.ts` (announcement → catalog event ids), `matcher.ts` (four pure planning
functions + the one DB-touching orchestrator) and `types.ts`. That split is what makes the
acceptance criteria unit-testable — see `event-ids.test.ts` and `matcher.test.ts`. The
Kysely client is the package-wide `getJobDatabaseClient()` from `packages/jobs/src/db.ts`,
which `events/queue.ts` and the company backup/restore tasks share.

The trigger payload (`kind: "record" | "moment"`) is declared once as `runTriggerSchema` /
`RunTrigger` in `packages/workflows/src/run-trigger.ts` — `@carbon/workflows` is the only
package both `@carbon/lib` (which types `carbon/workflow-run.queued` with it) and
`@carbon/jobs` (which parses with it) already depend on.

## Announcement → event ids

`computeEventIds` builds a module-level index from every catalog `match` block once, then:
INSERT/DELETE look up the table's `created`/`deleted` id directly; UPDATE runs
`computeDiff` (the audit differ — it drops `updatedAt`/`updatedBy`/`embedding`, empty↔empty
transitions and rich-text formatting churn) and returns one `.changed` id per watched
column that really moved, **in catalog order**. An update touching no watched column
returns `[]` and nothing is written at all. An unknown table returns `[]`.

## Origin filter

A trigger node declares `Person`, `Automation` or `Both`. The decision is purely the
presence of the run tag on the announcement: `workflowRunId` set → the write came from a
running workflow (`Automation`), absent → `Person`. `Both` always survives.

`Person` is a misnomer kept for the stored value: it means **not a workflow**, so a human,
an import, an integration, an API key and a background job all land there. The builder
shows it as **"Everything else"** for that reason (`TriggerForm.tsx`). Telling those apart
would need `actorId`, which the queue carries for the audit handler and which neither
`events/workflow.ts` nor `workflows/moment.ts` parses.

The tag comes from the `workflow_run_id` claim on the caller's JWT.
`getUserScopedClient(userId, { workflowRunId })` (`packages/auth`) mints it;
`dispatch_event_batch()` reads it out of `request.jwt.claims` and stamps it on every queue
message (migration `20260810100000_workflows-run-tag.sql`), and `QueueMessage.workflowRunId`
carries it to the handler. **A workflow action that writes through anything but the
owner-scoped client is untagged** — it will look like a person's write, so the origin filter
and both loop guards go blind. The engine mints it: `getOwnerClient(ownerId, runId)` in
`packages/jobs/src/workflows/engine/owner.ts`.

## Loop guards

Each run carries `rootRunId` / `causedByRunId` / `depth` / `path` (`path` = the workflow ids
already in this chain). `deriveNextTrace` derives the next hop from the causing run; a fresh,
person-caused firing gets `{rootRunId: null, causedByRunId: null, depth: 0, path: []}`.

- **Cycle** — the candidate workflow id is already in `path` → blocked,
  `"Cycle: this workflow already ran in this chain"`.
- **Depth** — `depth >= MAX_CHAIN_DEPTH` (10, from `@carbon/workflows`) → blocked,
  `"Chain depth limit reached (10 hops)"`.

A blocked firing is **recorded as a `Blocked` workflowRun, never silently dropped** — that
row is the only way a customer can see why their chain stopped. No queued event is sent for
it. If the causing run row is missing (purged), the matcher falls back to a synthetic
`{depth: 0, path: []}` trace so the chain stays countable even though its history is
unknowable.

## Runs, dedupe, idempotency

One run per workflow per announcement: if two watched columns change and a workflow
subscribes to both, the first event id in catalog order wins. Idempotency is layered so a
replay can never double-fire:

- `sourceEventId` identifies the announcement: `pgmq:<msgId>` (record change),
  `moment:<momentId>` (moment; `raiseMoment` mints the nanoid and reuses it as the Inngest
  event id), `schedule:<workflowId>:<dueAtIso>` (scheduler — the dueAt is the `nextRunAt` the
  scheduler claimed before advancing it).
- The unique constraint `workflowRun_dedupe_key (workflowId, companyId, workflowVersionId,
  sourceEventId)` + `ON CONFLICT DO NOTHING` means a second attempt inserts nothing and
  sends nothing.
- The Inngest event id is `` `${workflowId}:${workflowVersionId}:${sourceEventId}` ``.
- Both entry points also set Inngest `idempotency` (`event.data.msgId` /
  `event.data.momentId`). Neither declares a `concurrency` block — no function-level
  key means Inngest applies the account/plan concurrency instead of a hand-picked cap.

## Subscriptions are derived, never hand-managed

`packages/workflows/src/sync.ts` owns both levels and keeps them in one transaction:

- `deriveWorkflowTriggerRows(nodes)` — trigger nodes → one desired `workflowTriggerEvent`
  row per event id, carrying that node's origin (first origin wins on a duplicate id).
- `deriveWorkflowSubscriptions(eventIds)` — event ids → one `workflow-<table>`
  `eventSystemSubscription` per distinct table, `operations` the exact union those events
  need. Moments resolve to no table and contribute nothing.
- `findTriggerSchedule(nodes)` — returns the `Schedule` from the trigger node, or `null`.
- `syncWorkflowTriggers(db, companyId, workflowId, lockCompany)` — rewrite one workflow's trigger rows
  (delete-then-insert; the table has no UPDATE policy by design), **write `workflow.nextRunAt`**
  (the scheduler's bookmark, or null for event-triggered workflows), and reconcile the company's
  subscriptions. Returns `{ eventIds, tables, scheduled }`. Call it on promote, on trigger edit,
  and on activate/deactivate.
- `syncWorkflowSubscriptions(db, companyId)` — standalone repair from existing rows.

Reconciliation is surgical: only `handlerType = 'WORKFLOW'` rows are touched, matched by
exact `(companyId, name, table)`, and a row with the wrong `operations` is deleted and
re-inserted. It never resets a company's WEBHOOK/SEARCH/AUDIT subscriptions.

**Why this lives in `@carbon/workflows` and not `@carbon/database`:** it must read
`WORKFLOW_EVENTS`, and `@carbon/workflows` already dev-depends on `@carbon/database` — the
reverse edge is a package cycle Turborepo rejects. Kysely is imported **type-only** here
(`import type { Kysely, Transaction }`), so the package gains no runtime dependency; node-pg
serializes plain objects/arrays for the JSONB and `TEXT[]` columns, so no runtime `sql` tag
is needed.

`lockCompany` is a **required** `CompanyLock` callback, run as the first statement inside the
transaction. Reconciliation reads the company's ENTIRE subscription set inside a per-workflow
transaction, so two overlapping publishes would each compute `desired` from pre-commit state and
one could delete a subscription the other still needs — silently stopping delivery for that table.
The caller owns it because `@carbon/workflows` imports Kysely **type-only** (the package is bundled
for the browser) and cannot run raw SQL; `workflows.server.ts` supplies
`` sql`SELECT pg_advisory_xact_lock(hashtext(${companyId}))` ``.

Kysely bypasses RLS. **The caller authorizes first** — phase 7's activation route gates on
`workflows_update` before calling.

## Gotchas

- No `eventSystemSubscription` row for a table means the trigger never even enqueues — a
  company with no workflows costs nothing. That is the point of deriving subscriptions.
- `events/workflow.ts` returns early on `TRUNCATE`; `record` is `new ?? old`, and
  `before`/`after` are populated only for UPDATE.
- `workflows/run.ts` hands the payload to `src/workflows/engine/` and declares
  `idempotency: "event.data.runId"` and no `concurrency` block — runs are limited by the
  account's concurrency, not a per-`companyId`/per-`workflowId` cap. See `workflow-engine.md`.
- Deploy-time drift checks live with `packages/checks`: the `workflow-trigger-event-drift`
  SQL invariant and `pnpm --filter @carbon/checks workflow-events`.
