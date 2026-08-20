paths:
  - "apps/erp/app/modules/workflows/ui/Runs/**"
  - "packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts"
  - "packages/jobs/src/workflows/retention.ts"

# Workflow Run History

Observability layer for the workflow engine. Grounded against the implementation in
`packages/jobs/src/workflows/engine/`, `packages/jobs/src/workflows/retention.ts`,
`apps/erp/app/routes/x+/workflows+/runs*.tsx`, and the migration
`20260810100200_workflow-run-history.sql`.

## Routes

- **`/x/workflows/runs`** — global list (`runs.tsx`). Loader: `getWorkflowRuns(client, companyId, filters)`.
  No `workflowId` param; filter by workflow via `?filter=workflowId:eq:<id>` (standard `GenericQueryFilters`).
  Renders `<WorkflowRunsTable>` with `<Outlet>` for the detail drawer.
- **`/x/workflows/runs/:runId`** — detail drawer (`runs.$runId.tsx`). Loader: `getWorkflowRun`,
  `getWorkflowRunSteps`, then `getWorkflowRunChain` when `run.rootRunId` is set. All data
  flows as props; the component fetches nothing.

## Test runs

A builder test run (`engine/manual.ts`) has real side effects, so it writes real history:
one `workflowRun` row with `isTest = true`, plus the ordinary step rows, through the same
`createDatabaseLedger` a queued run uses. There is no in-memory ledger — `$id.test-run.tsx`
reads the steps back with `getWorkflowRunSteps`, the reader the run-history page already
uses, so the panel and that page cannot disagree about a run the customer can open in both.
The run is recorded against the version open in the builder (`versionId`, sent by
`TestRunDialog` and re-checked against the workflow in `$id.test-run.tsx`) — the canvas can
be a second ahead of it, but it is a definition a reader can actually open.

`executeManualWorkflowRun` owns the crash exit itself: the run row exists before the walk
does, so it wraps the walk and calls `failCrashedRun` on a throw. The durable path gets that
from Inngest's failure hook; a manual run has no such hook, and without it the row would sit
`Running` until the nightly reaper.

The run id is a real `wfr` id, so the `workflow_run_id` claim on every write points at a
row the matcher can read: a workflow the test triggers is chained and loop-guarded exactly
as in production. `sourceEventId` keeps the `manual:` prefix. The `workflowLastRun` view
filters `isTest = false` — a test is the author's experiment, not the workflow's health.

## Step list ordering

`WorkflowRunSteps` builds its row list using `topologicalNodeOrder(definition)` from
`@carbon/workflows` — trigger first, then breadth-first over edges, ties broken by position in
`definition.nodes`. When `definition` is null (version unreadable), falls back to the steps'
own `sequence` order and omits "Not reached" rows. A node in `order` with no step rows renders
as a greyed "Not reached" row. Step rows whose `nodeId` is not in `order` (definition changed
post-run) are appended at the end in `sequence` order. Use the node id as the React key — never
the array index (re-ordering on live revalidate would move rows under the cursor).

The trigger has a real step row. `execute.ts` writes it directly (`claimStep` + `settleStep`,
`nodeType: "trigger"`, always `Succeeded`, output = `triggerOutputs`) before the walk starts —
it is recorded, never executed, since `EXECUTORS` has no `trigger` entry. Its `sequence` is `0`,
which ties with the first real node, so the no-definition fallback sort breaks that tie in the
trigger's favour.

## Naming a step row

`useNodeLabel()` (`ui/Runs/useNodeLabel.ts`) is the one place that decides. It returns the
user's node `name` as the title, humanised — falling back to what the step does when the name
is still the auto-generated `action_0` form (`isDefaultNodeName` / `nodeTitle` in
`ui/Builder/labelKeys.ts`). `runOutcome` takes the same resolver as an argument so the outcome
sentence and the step list can never name one step two ways. Note `node.data.title` no longer
exists — it was dropped in definition format v3.

## The `detail` column contract

`workflowStepRun.detail` is diagnostics, never node data. It holds the per-clause condition
evaluation written by `conditionExecutor` (`packages/workflows/src/runtime/condition.ts`) and
surfaced by `ConditionDetail.tsx`. It is only set on Succeeded and Skipped nodes — Failed nodes
leave it null (the error string is what matters there, and the inputs are already in `input`).
The `detail` JSON shape is `NodeDetail` (`packages/workflows/src/runtime/types.ts`):
`{ kind: "condition", paths: [{ pathId, combinator, evaluations: [{ left, operator, right, passed, reason? }], taken }] }`.

## Retention — four passes, nightly at 04:00

`workflowRunRetentionFunction` in `packages/jobs/src/inngest/functions/scheduled/` runs four
`step.run` passes in order. Every pass that touches finished runs filters on a TERMINAL status
(`Succeeded | Failed | Blocked | Skipped`). In-flight runs are never deleted by passes 2–4.

| Pass | Step id | What it does | Constant |
|------|---------|--------------|----------|
| 1 | `reap-stale-runs` | Closes `Queued`/`Running` runs older than 24 h with `failInterruptedSteps` + `failCrashedRun` | `STALE_RUN_HOURS = 24` |
| 2 | `purge-run-headers` | Deletes terminal `workflowRun` rows (step rows cascade) | `RUN_HEADER_DAYS = 90` |
| 3 | `compact-step-payloads` | Shrinks `input`/`output`/`detail` via `compactForLog`, sets `compactedAt` on run and steps | `FULL_DETAIL_DAYS = 7` |
| 4 | `drop-step-detail` | Deletes `workflowStepRun` rows for terminal runs (header row survives) | `COMPACT_DETAIL_DAYS = 30` |

Pass 3 runs **before** pass 4 so `compactedAt` is always set on the `workflowRun` row before its step rows are deleted. The UI uses `run.compactedAt !== null` to distinguish "steps purged" from "run has no steps yet".

Age is always `COALESCE("completedAt", "createdAt")` — `Blocked` and `Skipped` runs never set
`completedAt`, and `workflowRun_retention_idx` is the index for it.

Every pass selects `ORDER BY` that age ascending, so a backlog drains oldest-first instead of
re-reading the same page each night. Each pass must also be able to *leave* its own candidate
set, or it never advances: pass 2 deletes the rows, pass 3 filters `compactedAt IS NULL`, and
pass 4 requires **both** `compactedAt IS NOT NULL` and `EXISTS (SELECT 1 FROM "workflowStepRun" …)`.
That EXISTS is what makes pass 4 self-advancing; the `compactedAt` requirement stops it
outrunning pass 3 (500/night vs 200/night) and deleting steps before the run is marked compacted,
which is the flag the UI reads to tell "steps purged" from "run has no steps yet".

Pass 3 writes its truncated payloads with one `UPDATE … FROM (VALUES …)` per 500 rows, not one
statement per row — `getJobDatabaseClient(5)` is a five-connection pool with a 10 s acquisition
timeout, and an unbounded `Promise.all` over a company's step rows exhausts it.

## `compactForLog` — value shrinker

`packages/jobs/src/workflows/retention.ts`. NOT a null-zeroing function — it reduces payload
SIZE while keeping structure readable. Constants: `MAX_LIST_ITEMS = 5`, `MAX_STRING_LENGTH = 256`,
`MAX_OBJECT_KEYS = 20`, `MAX_DEPTH = 5`. Entity `RuntimeValue`s (`kind === "entity"`) are
reduced to `{ kind, of, id }` (the `row` field is stripped). Markers use the same format as
`redactForLog` truncation so compacted values are never mistaken for complete ones.

## Redaction — what IS and is NOT redacted

`redactForLog` in `packages/jobs/src/workflows/engine/ledger.ts` keeps the key and replaces
the value with `"[REDACTED]"` for keys matching:
`/secret|token|password|passwd|credential|signature|authorization|apikey|api_key|client_secret|clientsecret|private_key|privatekey|bearer|cookie/i`

Deliberately NOT redacted (bare-word exclusions): `itemKey`, `authorizedBy`, `keyword`,
`sessionId`. These look like they might be secret-adjacent but are ordinary ERP data. A redacted
key is indistinguishable from an absent one — over-redaction in a debugging tool hides the
information the tool exists to show.

## Live updates

`RunLiveUpdates` / `RunsLiveUpdates` in `ui/Runs/RunLiveUpdates.tsx` use `useDebouncedRealtime`
to revalidate the loader after 1.5 s of quiet. They mount only while at least one row is
non-terminal — an unfiltered subscription on `workflowStepRun` would fire on every company's
every step. Caller supplies the filter; the hook does not add `companyId` itself.
