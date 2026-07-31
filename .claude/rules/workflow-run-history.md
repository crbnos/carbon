paths:
  - "apps/erp/app/modules/workflows/ui/Runs/**"
  - "packages/jobs/src/inngest/functions/scheduled/workflow-run-retention.ts"
  - "packages/jobs/src/workflows/retention.ts"

# Workflow Run History

Observability layer for the workflow engine. Grounded against the implementation in
`packages/jobs/src/workflows/engine/`, `packages/jobs/src/workflows/retention.ts`,
`apps/erp/app/routes/x+/workflows+/runs*.tsx`, and the migration
`20260731130044_workflow-run-history.sql`.

## Routes

- **`/x/workflows/runs`** — global list (`runs.tsx`). Loader: `getWorkflowRuns(client, companyId, filters)`.
  No `workflowId` param; filter by workflow via `?filter=workflowId:eq:<id>` (standard `GenericQueryFilters`).
  Renders `<WorkflowRunsTable>` with `<Outlet>` for the detail drawer.
- **`/x/workflows/runs/:runId`** — detail drawer (`runs.$runId.tsx`). Loader: `getWorkflowRun`,
  `getWorkflowRunSteps`, then `getWorkflowRunChain` when `run.rootRunId` is set. All data
  flows as props; the component fetches nothing.

## Step list ordering

`WorkflowRunSteps` builds its row list using `topologicalNodeOrder(definition)` from
`@carbon/workflows` — trigger first, then breadth-first over edges, ties broken by position in
`definition.nodes`. When `definition` is null (version unreadable), falls back to the steps'
own `sequence` order and omits "Not reached" rows. A node in `order` with no step rows renders
as a greyed "Not reached" row. Step rows whose `nodeId` is not in `order` (definition changed
post-run) are appended at the end in `sequence` order. Use the node id as the React key — never
the array index (re-ordering on live revalidate would move rows under the cursor).

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
`completedAt`. Pass 4 only touches rows where `compactedAt IS NULL`.

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
